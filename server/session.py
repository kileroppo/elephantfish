# -*- coding: utf-8 -*-
"""对局会话 —— 一局棋 + 一个引擎 + 一次在跑的搜索。

这个模块存在的理由是**测试面**：以前这些全在 ``server/app.py`` 里，和 HTTP 路由、
静态文件服务、端口顺延挤在一个文件中，于是想测「引擎收手后排队那一步会不会落地」
就只能先把 HTTP 服务起起来、构造请求体、再解析 JSON。``tools/verify.py`` 干脆绕开
HTTP 直接造一个会话 —— 结果是 HTTP 层一条断言都没有。

现在接口是状态变更动词加 ``snapshot()``：HTTP 层只负责解析请求和写响应，会话自己
管锁、管线程、管排队、管战绩。两边各测各的 —— ``tools/verify.py`` 直接打这层，
``tools/smoke_http.py`` 走真实 HTTP 验对外契约。

**它修掉的三个真实竞态**（都不是理论问题，是读代码能看出来的）：

1. 引擎的 worker 线程在锁外读 ``self.game.board`` 做「局面变了吗」的比对，
   而 ``load`` / ``new_game`` 会在锁内把整个 game 对象换掉。旧 worker 于是拿新的
   game 去比一个闭包里存着的旧局面 —— 而且如果新旧局面**恰好相同**（新开一局同
   样的执子方、或载入同样的局面），比对会通过，然后它把一手棋落到新对局上。
   现在用 ``_epoch`` 局面代数判定：换局/载入就 +1，worker 落子前必查。
2. ``resign`` 之后局面没变，所以「局面比对」拦不住 worker，它照样会往已结束的
   对局里推一步。现在落子前连同 ``is_over()`` 一起查。
3. ``poll_opponent`` 与 ``clear_stats`` 直接读写 ``SESSION`` 的字段而不持锁。
   前者还包着最长 10 秒的网络 I/O —— 持锁做 I/O 会把所有请求堵住，
   所以它的做法是：锁内取配置快照 → 锁外发请求 → 再走正常的 ``submit_move``。
"""

from __future__ import annotations

import dataclasses
import json
import threading
import time
import traceback
import urllib.request
import uuid

from engine import (
    Game, RED, notation as nt, core,
    SearchRequest,
    PIKAFISH, BUILTIN,
    default_engines,
)

# 深度与耗时的默认值。
#
# 注意这里**没有** engine_type：引擎偏好的真值在 EngineSet 里（因为它还要
# 迭上「装了没装」的降级结果）。再往这个字典里抄一份，就立刻有了两个真值。
DEFAULT_SETTINGS = {
    'max_depth': 20,
    'think_ms': 2500,
    'auto_reply': True,
    'threads': 2,
    'hash_mb': 64,
}

DEFAULT_ENGINE_PREFERENCE = PIKAFISH


@dataclasses.dataclass(frozen=True)
class Reply:
    """会话给 HTTP 层的回答：一个 body 加一个状态码。

    HTTP 层拿到它就 ``self._json(reply.body, reply.status)``，不再自己判断
    「这个返回值是 dict 还是 (dict, status) 元组」—— 那种双重形状是错的温床。
    """

    body: dict
    status: int = 200


# --------------------------------------------------------------------------- #
# 一次后台搜索
# --------------------------------------------------------------------------- #

class SearchTask:
    """一次后台搜索。前端靠轮询它拿到实时的深度与评分。"""

    def __init__(self, kind='engine-move'):
        self.id = uuid.uuid4().hex[:12]
        self.kind = kind            # engine-move / analyze
        self.status = 'running'     # running / done / error
        self.progress = None        # 最近一层的结果
        self.result = None          # 最终结果
        self.error = None
        self.started = time.time()
        self.stop_event = threading.Event()
        self.thread = None
        self.move = None            # 已经落子的走法（引擎应手）

    def to_dict(self):
        return {
            'id': self.id,
            'kind': self.kind,
            'status': self.status,
            'progress': self.progress,
            'result': self.result,
            'error': self.error,
            'elapsed': time.time() - self.started,
        }


def pv_detail(board, red_to_move, pv_moves):
    """把主变翻译成前端能直接展示的样子（ICCS + 中文记谱）。

    主变是一串连续的推演，所以要一路把局面推下去才能算对每一步的记谱。
    """
    out = []
    b, red = board, red_to_move
    for m in pv_moves:
        out.append({'iccs': nt.to_iccs(m), 'chinese': nt.to_chinese(b, m)})
        try:
            b = core.apply_move(b, red, m)
        except Exception:                                     # noqa: BLE001
            break
        red = not red
    return out


def _blank_stats():
    return {'moves': 0, 'nodes': 0, 'think_time': 0.0, 'depth_max': 0}


# --------------------------------------------------------------------------- #
# 会话
# --------------------------------------------------------------------------- #

class GameSession:
    """一局棋 + 一个引擎 + 一次在跑的搜索。

    公开接口就两类：**状态变更动词**（各自管锁，返回 ``Reply``）与 **查询**
    （``snapshot`` / ``task_snapshot`` / ``health``）。没有别的东西可以碰。
    """

    def __init__(self, engines=None, settings=None):
        self.lock = threading.RLock()
        self.game = Game(engine_side=RED)
        # 引擎接缝：两个 adapter + 「选哪个 / 谁可用 / 怎么降级」的规则，
        # 全在 EngineSet 里。这个会话只知道「要一个引擎」，不知道有几个。
        self.engines = engines if engines is not None else default_engines(
            prefer=DEFAULT_ENGINE_PREFERENCE,
            threads=DEFAULT_SETTINGS['threads'],
            hash_mb=DEFAULT_SETTINGS['hash_mb'],
        )
        # 皮卡鱼不在就把偏好落回内置：界面读的是 settings.engine_type，
        # 不能让它显示一个实际不会生效的引擎。
        if not self.engines.available(PIKAFISH):
            self.engines.set_preference(BUILTIN)
        self.settings = dict(settings or DEFAULT_SETTINGS)

        # 局面代数。换局 / 载入时 +1。worker 落子前必查 —— 这是「搜索期间局面被
        # 整个换掉」唯一的可靠判据（比对棋盘串挡不住新旧局面恰好相同的情形）。
        self._epoch = 0
        self.task = None

        self.opponent = {
            'mode': 'manual',       # manual | http
            'url': '',
            'method': 'GET',
            'move_field': 'move',
            'headers': {},
            'auto': False,
            'last_error': None,
            'last_poll': None,
        }
        # 累计（跨局）与单局分开记：界面上「本局统计」必须真的是本局的。
        #
        # 这两本账放在会话而不是 Game 里，是因为它们跨局 —— engine_stats 要
        # 累计很多局，而 Game 是一局之内的局面状态。让 Game 去记跨局战绩，
        # 就是把汇总塞进一个生命周期更短的对象里。
        self.engine_stats = {**_blank_stats(), 'wins': 0, 'losses': 0, 'draws': 0}
        self.game_stats = _blank_stats()
        # 引擎正在算棋时录进来的对方走法。不拒绝、不报错，先存着，
        # 等引擎收手立刻落子 —— 人是从另一个窗口读棋的，没道理被我们卡住。
        self.pending = None
        # 服务端主动要告诉用户的一句话（排队那步的结果之类），
        # 带序号，前端只在序号变化时弹一次。
        self.notice = None
        self._notice_seq = 0

    # ---- 内部：任务与战绩 ---------------------------------------------- #
    #
    # 下面这些一律**要求调用方已持有 self.lock**（RLock，动词方法自己会拿）。

    def _task_busy(self):
        return self.task is not None and self.task.status == 'running'

    def _say(self, text, tone='info'):
        self._notice_seq += 1
        self.notice = {'seq': self._notice_seq, 'text': text, 'tone': tone}

    def _settle(self):
        """对局刚结束就把胜负记进累计战绩。重复调用只算一次。"""
        if self.game_stats.get('settled'):
            return
        status = self.game.status()
        if status['state'] == 'playing':
            return
        outcome = self._outcome(status)
        self.game_stats['settled'] = outcome
        self.engine_stats[outcome] += 1

    def _unsettle(self):
        """悔棋/退回把已经记过的一场胜负撤销掉，免得战绩虚高。"""
        outcome = self.game_stats.get('settled')
        if outcome:
            self.engine_stats[outcome] = max(0, self.engine_stats[outcome] - 1)
            self.game_stats['settled'] = False

    def _outcome(self, status):
        if status['state'] == 'draw' or status['winner'] is None:
            return 'draws'
        return 'wins' if status['winner'] == self.game.engine_side else 'losses'

    def _flush_pending(self):
        """引擎收手了，把之前排队的那步对方走法落下去。"""
        pending = self.pending
        self.pending = None
        if not pending:
            return
        text = pending['text']
        if self.game.is_over():
            self._say(f'{text} 没能录入：对局已经结束了', 'warn')
            return
        if not self.game.opponent_to_move:
            # 局面在这期间被改过（悔棋、载入、换边），这步不再适用
            self._say(f'{text} 没有录入：局面已经变了', 'warn')
            return
        result = self._apply_move_locked(text, queued=True)
        if not result.get('ok'):
            self._say(result.get('message') or f'{text} 没能录入', 'error')

    # ---- 内部：搜索 ----------------------------------------------------- #

    def _start_search(self):
        """在后台线程里让引擎出招。调用方需持有锁。"""
        if self._task_busy():
            return self.task
        if self.game.is_over():
            return None

        game = self.game
        task = SearchTask('engine-move')
        self.task = task

        # 开跑前就把搜索输入固化下来，避免搜索途中局面被动过。
        # 两个引擎的差异（要棋盘串还是要 Position、要 ICCS 棋谱还是局面串、
        # 怎么喊停）全在 adapter 里；这里只说一次「要什么」。
        settings = dict(self.settings)
        req = SearchRequest(
            board=game.board,
            red_to_move=game.red_to_move,
            game_history=tuple(game.boards),
            move_history_iccs=tuple(r['iccs'] for r in game.records),
            start_fen=getattr(game, 'start_fen', None),
            max_depth=settings['max_depth'],
            time_limit=settings['think_ms'] / 1000.0,
            stop=task.stop_event.is_set,
        )
        engine = self.engines.choose()
        start_board = req.board
        red_to_move = req.red_to_move
        epoch = self._epoch

        def worker():
            try:
                last = None
                for info in engine.search(req):
                    last = info
                    task.progress = {
                        'depth': info.depth,
                        'score': info.score,
                        'mate': info.mate,
                        'nodes': info.nodes,
                        'time': round(info.time, 3),
                        'nps': info.nps,
                        'pv': list(info.pv_iccs),
                        'pv_detail': pv_detail(start_board, red_to_move, info.pv),
                    }
                    if task.stop_event.is_set():
                        break

                if last is None or last.move is None:
                    task.status = 'done'
                    task.result = {'status': 'no_move', 'message': '无着可走'}
                    return

                abs_move = last.move

                # 判定与落子必须在**同一次**持锁里完成，中间不能松手：
                # 松手的那一瞬间新局/载入就能插进来，后面所有比对都失去意义。
                with self.lock:
                    if self._epoch != epoch:
                        # 这一局已经被整个换掉了（新开一局或载入局面）。
                        # 比对棋盘串挡不住它 —— 新旧局面可能恰好一样。
                        task.status = 'done'
                        task.result = {'status': 'discarded',
                                       'message': '搜索期间局面已被替换，这一步丢弃'}
                        return
                    if self.game.is_over():
                        # 认输之类不改局面的操作，靠棋盘比对是拦不住的
                        task.status = 'done'
                        task.result = {'status': 'discarded',
                                       'message': '搜索期间对局已结束，这一步丢弃'}
                        return
                    if (self.game.board != start_board
                            or self.game.red_to_move != red_to_move):
                        task.status = 'error'
                        task.error = '搜索期间局面发生了变化，已放弃这步棋'
                        return
                    if abs_move not in self.game.legal_moves():
                        task.status = 'error'
                        task.error = '引擎给出的走法非法，已放弃'
                        return

                    rec = self.game.push(
                        abs_move, by='engine',
                        eval_red=last.eval_red,
                        depth=last.depth,
                        think_time=round(last.time, 3),
                    )
                    self.engine_stats['moves'] += 1
                    self.engine_stats['nodes'] += last.nodes
                    self.engine_stats['think_time'] += last.time
                    self.engine_stats['depth_max'] = max(
                        self.engine_stats['depth_max'], last.depth)
                    self.game_stats['moves'] += 1
                    self.game_stats['nodes'] += last.nodes
                    self.game_stats['think_time'] += last.time
                    self.game_stats['depth_max'] = max(
                        self.game_stats['depth_max'], last.depth)
                    self._settle()

                    task.move = rec['iccs']
                    task.result = {
                        'status': 'ok',
                        'engine': engine.name,
                        'move': rec['iccs'],
                        'chinese': rec['chinese'],
                        'depth': last.depth,
                        'score': last.eval_red,
                        'mate': last.mate,
                        'nodes': last.nodes,
                        'time': round(last.time, 3),
                        'nps': last.nps,
                        'elapsed': round(time.time() - task.started, 3),
                        'stopped': task.stop_event.is_set(),
                    }
                    task.status = 'done'
                    # 引擎收手了：如果有排队的对方走法，现在就替它落下去
                    self._flush_pending()
            except Exception as exc:                      # noqa: BLE001
                traceback.print_exc()
                task.status = 'error'
                task.error = str(exc)

        task.thread = threading.Thread(target=worker, name='engine-search', daemon=True)
        task.thread.start()
        return task

    def stop_search(self, task_id=None):
        """请求停掉当前搜索。拿不准就返回 False，不抛。调用方需持有锁。"""
        if self.task is None:
            return False
        if task_id and self.task.id != task_id:
            return False
        if self.task.status != 'running':
            return False
        self.task.stop_event.set()
        return True

    # ---- 内部：落子 ----------------------------------------------------- #

    def _parse_move(self, text):
        """先把输入当 ICCS 试，再当中文记谱试。"""
        move = nt.from_iccs(text)
        source = 'iccs'
        if move is None:
            move = nt.from_chinese(self.game.board, text,
                                   self.game.red_to_move,
                                   legal=self.game.legal_moves())
            source = 'chinese'
        return move, source

    def _apply_move_locked(self, text, queued=False):
        """真的把一步棋落到盘上。调用方必须已经持有锁。"""
        if self.game.is_over():
            return {'ok': False, 'message': '对局已结束'}

        move, source = self._parse_move(text)
        if move is None:
            return {'ok': False, 'message': f'看不懂这一步：{text}'}
        if move not in self.game.legal_moves():
            readable = nt.to_iccs(move) if source == 'iccs' else text
            return {'ok': False, 'message': f'非法走法 {readable}'}

        rec = self.game.push(move)
        prefix = '（排队中）' if queued else ''
        message = f'{prefix}已录入 {rec["chinese"]}（{rec["iccs"]}）'
        if rec['captured']:
            message += f'，吃掉{rec["glyph"]}'
        if rec['check']:
            message += '，将军！'

        task = None
        if (not self.game.is_over() and self.game.engine_to_move
                and self.settings['auto_reply']):
            task = self._start_search()
        self._settle()

        return {'ok': True, 'state': self.snapshot(), 'message': message,
                'record': rec, 'queued': queued,
                'auto_task': task.id if task else None}

    # ---- 公开动词 ------------------------------------------------------- #
    #
    # 每一个自己拿锁、自己返回 Reply。HTTP 层只负责解析请求与序列化，
    # 测试可以直接调这些方法，不需要起服务。

    def new_game(self, payload):
        engine_side = payload.get('engine_side', RED)
        with self.lock:
            self.stop_search()
            self.game = Game(engine_side=engine_side)
            # 换局了：在飞的搜索作废
            self._epoch += 1
            # 新对局的引擎清理（内置丢置换表、皮卡鱼发 ucinewgame）由接缝管，
            # 调用方不用知道有几个引擎、各自要清什么。
            self.engines.new_game()
            self.task = None
            self.pending = None
            self.game_stats = _blank_stats()
            if 'max_depth' in payload:
                self.settings['max_depth'] = int(payload['max_depth'])
            if 'think_ms' in payload:
                self.settings['think_ms'] = int(payload['think_ms'])
            if 'auto_reply' in payload:
                self.settings['auto_reply'] = bool(payload['auto_reply'])
            if 'engine_type' in payload:
                # 校验规则只有 EngineSet 一份：名字不认就原样不动
                self.engines.set_preference(payload['engine_type'])
            if self.game.engine_to_move:
                self._start_search()
            message = f'新对局开始，引擎执{"红" if self.game.engine_side == RED else "黑"}方'
            body = {'ok': True, 'state': self.snapshot(), 'message': message}
        return Reply(body)

    def submit_move(self, payload):
        """录入一步对方走法。

        引擎正在算棋的时候**不报错、不拒绝**：把这步记下来，等引擎收手立刻落子。
        转述的人是从另一个窗口读对手的棋的，本来就该比引擎快，没道理被卡住。
        """
        text = (payload.get('move') or '').strip()
        if not text:
            return Reply({'ok': False, 'message': '没有收到走法'}, 400)

        with self.lock:
            if self._task_busy():
                self.pending = {'text': text, 'at': time.time()}
                return Reply({'ok': True, 'queued': True, 'state': self.snapshot(),
                              'message': f'引擎还在算，{text} 已排队'})
            result = self._apply_move_locked(text)
            if not result.get('ok'):
                return Reply(result, 400)
            return Reply(result)

    def engine_move(self, _payload):
        with self.lock:
            if self._task_busy():
                return Reply({'ok': False, 'message': '引擎正在思考'}, 409)
            if self.game.is_over():
                return Reply({'ok': False, 'message': '对局已结束'}, 400)
            if not self.game.engine_to_move:
                return Reply({'ok': False, 'message': '现在不是引擎的回合'}, 400)
            task = self._start_search()
            return Reply({'ok': True, 'state': self.snapshot(),
                          'task': task.to_dict() if task else None})

    def undo(self, payload):
        with self.lock:
            self.stop_search()
            self.task = None
            self.pending = None
            self._unsettle()
            was_over = self.game.is_over()
            if payload.get('round', True):
                n = self.game.undo_round()
            else:
                n = self.game.undo(int(payload.get('plies', 1)))
            if n:
                message = f'已回退 {n} 步'
            elif was_over:
                message = '已撤销终局判定，接着下'
            else:
                message = '没有可回退的棋步'
            body = {'ok': True, 'state': self.snapshot(),
                    'message': message, 'undone': n}
        return Reply(body)

    def resign(self, payload):
        with self.lock:
            self.stop_search()
            self.pending = None
            side = payload.get('side') or self.game.turn
            self.game.resign(side)
            self._settle()
            body = {'ok': True, 'state': self.snapshot(), 'message': '已认输'}
        return Reply(body)

    def clear_pending(self, _payload):
        with self.lock:
            dropped = self.pending
            self.pending = None
            message = f'已撤销排队的 {dropped["text"]}' if dropped else '没有排队的棋步'
            body = {'ok': True, 'state': self.snapshot(), 'message': message}
        return Reply(body)

    def load(self, payload):
        with self.lock:
            self.stop_search()
            self.task = None
            self.pending = None
            game = Game(engine_side=payload.get('engine_side', self.game.engine_side))
            if payload.get('fen'):
                game.load_fen(payload['fen'])
            if payload.get('moves'):
                applied, failed = game.load_moves(payload['moves'])
                if failed:
                    return Reply(
                        {'ok': False,
                         'message': f'第 {len(applied)+1} 步无法识别：{failed[0]}',
                         'state': self.snapshot()}, 400)
            self.game = game
            # 载入新局面：在飞的搜索作废（同样可能是「换了对象但局面一模一样」）
            self._epoch += 1
            self.game_stats = _blank_stats()
            self.engines.new_game()
            if self.game.engine_to_move and not self.game.is_over():
                self._start_search()
            body = {'ok': True, 'state': self.snapshot(), 'message': '局面已载入'}
        return Reply(body)

    def update_settings(self, payload):
        with self.lock:
            if 'max_depth' in payload:
                self.settings['max_depth'] = max(2, min(50, int(payload['max_depth'])))
            if 'think_ms' in payload:
                self.settings['think_ms'] = max(120, min(60000, int(payload['think_ms'])))
            if 'auto_reply' in payload:
                self.settings['auto_reply'] = bool(payload['auto_reply'])
            if 'engine_type' in payload:
                self.engines.set_preference(payload['engine_type'])
            if 'threads' in payload:
                threads = max(1, min(16, int(payload['threads'])))
                self.settings['threads'] = threads
                self.engines.set_options(threads=threads)
            if 'hash_mb' in payload:
                hash_mb = max(16, min(1024, int(payload['hash_mb'])))
                self.settings['hash_mb'] = hash_mb
                self.engines.set_options(hash_mb=hash_mb)
            active = self.engines.active
            label = '皮卡鱼' if active == PIKAFISH else '象鱼内置'
            body = {'ok': True, 'state': self.snapshot(),
                    'message': f'设置已更新（当前引擎：{label}）'}
        return Reply(body)

    def clear_stats(self, _payload):
        with self.lock:
            # 以前这是在 HTTP 层直接改的，没有持锁
            self.engine_stats.update({'moves': 0, 'nodes': 0, 'think_time': 0})
            body = {'ok': True, 'state': self.snapshot()}
        return Reply(body)

    def stop_task(self, task_id):
        with self.lock:
            # 以前 do_POST 直接调 stop_search 而没持锁
            body = {'ok': self.stop_search(task_id), 'state': self.snapshot()}
        return Reply(body)

    def configure_opponent(self, payload):
        with self.lock:
            for key in ('mode', 'url', 'method', 'move_field'):
                if key in payload:
                    self.opponent[key] = payload[key]
            if 'headers' in payload and isinstance(payload['headers'], dict):
                self.opponent['headers'] = payload['headers']
            if 'auto' in payload:
                self.opponent['auto'] = bool(payload['auto'])
            body = {'ok': True, 'state': self.snapshot(),
                    'message': '对手接入配置已更新'}
        return Reply(body)

    def poll_opponent(self, _payload):
        """从配置的地址拉一步对手走法并录入。手动模式下这个接口用不上。

        网络 I/O **不持锁**：这里超时是 10 秒，持锁发请求会把整个服务堵住。
        做法是锁内取配置快照、锁外发请求、最后走正常的 submit_move。
        """
        with self.lock:
            cfg = dict(self.opponent)

        if not cfg.get('url'):
            return Reply({'ok': False, 'message': '未配置对手地址'}, 400)

        try:
            req = urllib.request.Request(cfg['url'], method=cfg.get('method', 'GET'),
                                         headers=cfg.get('headers') or {})
            with urllib.request.urlopen(req, timeout=10) as resp:
                raw = resp.read().decode('utf-8', 'replace')
        except Exception as exc:                              # noqa: BLE001
            with self.lock:
                self.opponent['last_error'] = str(exc)
            return Reply({'ok': False, 'message': f'拉取失败：{exc}'}, 502)

        move_text = raw.strip()
        try:
            data = json.loads(raw)
            if isinstance(data, dict):
                move_text = str(data.get(cfg.get('move_field') or 'move', '')).strip()
            elif isinstance(data, list) and data:
                move_text = str(data[-1]).strip()
        except (ValueError, TypeError):
            pass

        with self.lock:
            self.opponent['last_poll'] = time.time()
        if not move_text:
            return Reply({'ok': False, 'message': '对方接口没有返回走法'}, 400)
        return self.submit_move({'move': move_text})

    # ---- 公开查询 ------------------------------------------------------- #

    def settings_snapshot(self):
        """对外的设置快照。``engine_type`` 现从 EngineSet 取，不存第二份。"""
        return {**self.settings, 'engine_type': self.engines.preference}

    def snapshot(self):
        with self.lock:
            return {
                'game': self.game.snapshot(),
                'task': self.task.to_dict() if self.task else None,
                'settings': self.settings_snapshot(),
                'engine_info': {
                    'active': self.engines.active,
                    'pikafish_available': self.engines.available(PIKAFISH),
                    'pikafish_path': self.engines.pikafish_path,
                },
                'opponent': dict(self.opponent),
                'stats': dict(self.engine_stats),
                'game_stats': dict(self.game_stats),
                'pending': dict(self.pending) if self.pending else None,
                'notice': dict(self.notice) if self.notice else None,
                'server_time': time.time(),
            }

    def state_reply(self):
        return Reply({'ok': True, 'state': self.snapshot()})

    def health(self):
        """探活。注意 ``engine`` 用的是**显示词表**（elephantfish / pikafish），
        与 ``settings.engine_type`` 的 builtin / pikafish 不同 —— 两套词都是既有的
        HTTP 契约，谁都不能改，所以映射在引擎接缝里做掉了。"""
        return {
            'ok': True,
            'engine': self.engines.choose().name,
            'pikafish_available': self.engines.available(PIKAFISH),
        }

    def health_reply(self):
        return Reply(self.health())

    def task_snapshot(self, task_id):
        """轮询一个搜索任务。

        任务会被顶掉：比如排队的那一步落地后，服务端立刻替引擎开了下一次搜索。
        前端手上还是旧 id，这时候不该丢它一个 404 —— 它只要一次就能从 state 里
        发现新任务，继续轮询就是了。
        """
        with self.lock:
            task = self.task
            if task is None:
                return Reply({'ok': False, 'message': '任务不存在'}, 404)
            return Reply({
                'ok': True,
                'task': task.to_dict(),
                'state': self.snapshot(),
                'stale': task.id != task_id,
            })
