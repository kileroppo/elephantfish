# -*- coding: utf-8 -*-
"""转述对局服务。

这个服务的存在意义只有一个：**让人当信使**。

    对手大模型下一步棋  →  人把这一步录进棋盘  →  引擎算出应手
    →  人把应手喂回对手大模型  →  循环，直到将死对方

所以接口不是围绕「人和引擎下棋」设计的，而是围绕
「录入对方走法 / 取走我方应手」这两件事设计的：

* ``POST /api/move``          录入一步（ICCS ``h2e2`` 或中文记谱 ``炮二平五`` 都认）
* ``POST /api/engine-move``   轮到引擎时让它出招
* ``GET  /api/task/<id>``     轮询搜索进度（深度 / 评分 / 节点 / 主变）
* ``POST /api/undo``          录错了往回退，回到「等对方出招」的界面状态

搜索放在后台线程里跑，前端轮询进度，所以深度一层层涨上去的过程是看得见的，
不会出现「点了没反应，三秒后突然蹦出一步棋」。
"""

import functools
import json
import os
import sys
import threading
import time
import traceback
import uuid
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from engine import Game, RED, BLACK, notation as nt, core          # noqa: E402
from engine.search import Searcher                                  # noqa: E402

STATIC_DIR = os.path.join(_ROOT, 'frontend', 'dist')
LEGACY_DIR = os.path.join(_ROOT, 'ui')

# 深度与耗时的默认值。迭代加深每层耗时指数增长（实测深度 6≈0.5s、7≈3s、8≈6s），
# 所以用「时间」做主控，深度只作为上限，保证响应时间可预期。
DEFAULT_SETTINGS = {
    'max_depth': 12,
    'think_ms': 2500,
    'auto_reply': True,
}


# --------------------------------------------------------------------------- #
# 会话：一局棋 + 一个搜索引擎 + 一次在跑的搜索任务
# --------------------------------------------------------------------------- #

class SearchTask:
    """一次后台搜索。前端靠轮询它拿到实时的深度与评分。"""

    def __init__(self, kind='engine-move'):
        self.id = uuid.uuid4().hex[:12]
        self.kind = kind            # engine-move / analyze
        self.status = 'running'     # running / done / stopped / error
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


class Session:
    def __init__(self):
        self.lock = threading.RLock()
        self.game = Game(engine_side=RED)
        self.searcher = Searcher()
        self.settings = dict(DEFAULT_SETTINGS)
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
        self.engine_stats = {**_blank_stats(), 'wins': 0, 'losses': 0, 'draws': 0}
        self.game_stats = _blank_stats()
        # 引擎正在算棋时录进来的对方走法。不拒绝、不报错，先存着，
        # 等引擎收手立刻落子 —— 人是从另一个窗口读棋的，没道理被我们卡住。
        self.pending = None
        # 服务端主动要告诉用户的一句话（排队那步的结果之类），
        # 带序号，前端只在序号变化时弹一次。
        self.notice = None
        self._notice_seq = 0

    # ---- 搜索任务管理 -------------------------------------------------- #

    def task_busy(self):
        return self.task is not None and self.task.status == 'running'

    def say(self, text, tone='info'):
        self._notice_seq += 1
        self.notice = {'seq': self._notice_seq, 'text': text, 'tone': tone}

    def settle(self):
        """对局刚结束就把胜负记进累计战绩。重复调用只算一次。"""
        if self.game_stats.get('settled'):
            return
        status = self.game.status()
        if status['state'] == 'playing':
            return
        outcome = self._outcome(status)
        self.game_stats['settled'] = outcome
        self.engine_stats[outcome] += 1

    def unsettle(self):
        """悔棋/退回把已经记过的一场胜负撤销掉，免得战绩虚高。"""
        outcome = self.game_stats.get('settled')
        if outcome:
            self.engine_stats[outcome] = max(0, self.engine_stats[outcome] - 1)
            self.game_stats['settled'] = False

    def _outcome(self, status):
        if status['state'] == 'draw' or status['winner'] is None:
            return 'draws'
        return 'wins' if status['winner'] == self.game.engine_side else 'losses'

    # ---- 排队的对方走法 ------------------------------------------------ #

    def flush_pending(self):
        """引擎收手了，把之前排队的那步对方走法落下去。调用方需持有锁。"""
        pending = self.pending
        self.pending = None
        if not pending:
            return
        text = pending['text']
        if self.game.is_over():
            self.say(f'{text} 没能录入：对局已经结束了', 'warn')
            return
        if not self.game.opponent_to_move:
            # 局面在这期间被改过（悔棋、载入、换边），这步不再适用
            self.say(f'{text} 没有录入：局面已经变了', 'warn')
            return
        result = apply_move_locked(text, queued=True)
        if not result.get('ok'):
            self.say(result.get('message') or f'{text} 没能录入', 'error')

    def start_search(self):
        """在后台线程里让引擎出招。调用方需持有锁。"""
        if self.task_busy():
            return self.task
        if self.game.is_over():
            return None

        game = self.game
        task = SearchTask('engine-move')
        self.task = task

        # 开跑前就把搜索输入固化下来，避免搜索途中局面被动过
        red_to_move = game.red_to_move
        pos = core.make_position(game.board, red_to_move)
        history = list(game.boards)
        settings = dict(self.settings)

        def worker():
            try:
                deadline = time.time() + settings['think_ms'] / 1000.0
                searcher = self.searcher
                last = None
                for info in searcher.search(
                        pos,
                        max_depth=settings['max_depth'],
                        time_limit=settings['think_ms'] / 1000.0,
                        game_history=history,
                        external_stop=task.stop_event.is_set,
                        root_is_red=red_to_move):
                    last = info
                    task.progress = {
                        'depth': info['depth'],
                        'score': info['score'],
                        'mate': info['mate'],
                        'nodes': info['nodes'],
                        'time': round(info['time'], 3),
                        'nps': info['nps'],
                        'pv': [nt.to_iccs(m) for m in info['pv']],
                        'pv_detail': pv_detail(game.board, red_to_move, info['pv']),
                    }
                    if task.stop_event.is_set():
                        break

                if last is None or last.get('move') is None:
                    task.status = 'done'
                    task.result = {'status': 'no_move', 'message': '无着可走'}
                    return

                engine_move = last['move']
                # 搜索期间局面理论上不会变（其它入口都被 task_busy 挡住），
                # 但还是断言一下，宁可报错也不要走出一手对不上局面的棋。
                check_pos = core.make_position(self.game.board, self.game.red_to_move)
                if check_pos.board != pos.board:
                    task.status = 'error'
                    task.error = '搜索期间局面发生了变化，已放弃这步棋'
                    return

                abs_move = engine_move if red_to_move else core.flip_move(engine_move)
                if abs_move not in self.game.legal_moves():
                    task.status = 'error'
                    task.error = '引擎给出的走法非法，已放弃'
                    return

                score_red = last['score'] if red_to_move else -last['score']
                with self.lock:
                    rec = self.game.push(
                        abs_move, by='engine',
                        eval_red=score_red,
                        depth=last['depth'],
                        think_time=round(last['time'], 3),
                    )
                task.move = rec['iccs']
                task.result = {
                    'status': 'ok',
                    'move': rec['iccs'],
                    'chinese': rec['chinese'],
                    'depth': last['depth'],
                    'score': score_red,
                    'mate': last['mate'],
                    'nodes': last['nodes'],
                    'time': round(last['time'], 3),
                    'nps': last['nps'],
                    'elapsed': round(time.time() - task.started, 3),
                    'stopped': task.stop_event.is_set(),
                }
                with self.lock:
                    self.engine_stats['moves'] += 1
                    self.engine_stats['nodes'] += last['nodes']
                    self.engine_stats['think_time'] += last['time']
                    self.engine_stats['depth_max'] = max(
                        self.engine_stats['depth_max'], last['depth'])
                    self.game_stats['moves'] += 1
                    self.game_stats['nodes'] += last['nodes']
                    self.game_stats['think_time'] += last['time']
                    self.game_stats['depth_max'] = max(
                        self.game_stats['depth_max'], last['depth'])
                    self.settle()
                task.status = 'done'
                # 引擎收手了：如果有排队的对方走法，现在就替它落下去
                with self.lock:
                    self.flush_pending()
            except Exception as exc:                      # noqa: BLE001
                traceback.print_exc()
                task.status = 'error'
                task.error = str(exc)

        task.thread = threading.Thread(target=worker, name='engine-search', daemon=True)
        task.thread.start()
        return task

    def stop_search(self, task_id=None):
        if self.task is None:
            return False
        if task_id and self.task.id != task_id:
            return False
        if self.task.status != 'running':
            return False
        self.task.stop_event.set()
        return True

    # ---- 序列化 -------------------------------------------------------- #

    def state(self):
        with self.lock:
            return {
                'game': self.game.snapshot(),
                'task': self.task.to_dict() if self.task else None,
                'settings': dict(self.settings),
                'opponent': dict(self.opponent),
                'stats': dict(self.engine_stats),
                'game_stats': dict(self.game_stats),
                'pending': dict(self.pending) if self.pending else None,
                'notice': dict(self.notice) if self.notice else None,
                'server_time': time.time(),
            }


SESSION = Session()


# --------------------------------------------------------------------------- #
# 业务动作
# --------------------------------------------------------------------------- #

def act_new(payload):
    engine_side = payload.get('engine_side', RED)
    with SESSION.lock:
        SESSION.stop_search()
        SESSION.game = Game(engine_side=engine_side)
        SESSION.searcher = Searcher()
        SESSION.task = None
        SESSION.pending = None
        SESSION.game_stats = _blank_stats()
        if 'max_depth' in payload:
            SESSION.settings['max_depth'] = int(payload['max_depth'])
        if 'think_ms' in payload:
            SESSION.settings['think_ms'] = int(payload['think_ms'])
        if 'auto_reply' in payload:
            SESSION.settings['auto_reply'] = bool(payload['auto_reply'])
        task = None
        if SESSION.game.engine_to_move:
            task = SESSION.start_search()
    return {'ok': True, 'state': SESSION.state(),
            'message': f'新对局开始，引擎执{"红" if SESSION.game.engine_side == RED else "黑"}方'}


def _parse_move(text):
    """先把输入当 ICCS 试，再当中文记谱试。"""
    move = nt.from_iccs(text)
    source = 'iccs'
    if move is None:
        move = nt.from_chinese(SESSION.game.board, text,
                               SESSION.game.red_to_move,
                               legal=SESSION.game.legal_moves())
        source = 'chinese'
    return move, source


def apply_move_locked(text, queued=False):
    """真的把一步棋落到盘上。调用方必须已经持有锁。"""
    if SESSION.game.is_over():
        return {'ok': False, 'message': '对局已结束'}

    move, source = _parse_move(text)
    if move is None:
        return {'ok': False, 'message': f'看不懂这一步：{text}'}
    if move not in SESSION.game.legal_moves():
        readable = nt.to_iccs(move) if source == 'iccs' else text
        return {'ok': False, 'message': f'非法走法 {readable}'}

    rec = SESSION.game.push(move)
    prefix = '（排队中）' if queued else ''
    message = f'{prefix}已录入 {rec["chinese"]}（{rec["iccs"]}）'
    if rec['captured']:
        message += f'，吃掉{rec["glyph"]}'
    if rec['check']:
        message += '，将军！'

    task = None
    if not SESSION.game.is_over() and SESSION.game.engine_to_move \
            and SESSION.settings['auto_reply']:
        task = SESSION.start_search()
    SESSION.settle()

    return {'ok': True, 'state': SESSION.state(), 'message': message,
            'record': rec, 'queued': queued,
            'auto_task': task.id if task else None}


def act_move(payload):
    """录入一步对方走法。

    引擎正在算棋的时候**不报错、不拒绝**：把这步记下来，等引擎收手立刻落子。
    转述的人是从另一个窗口读对手的棋的，本来就该比引擎快，没道理被卡住。
    """
    text = (payload.get('move') or '').strip()
    if not text:
        return {'ok': False, 'message': '没有收到走法'}, 400

    with SESSION.lock:
        if SESSION.task_busy():
            SESSION.pending = {'text': text, 'at': time.time()}
            return {'ok': True, 'queued': True, 'state': SESSION.state(),
                    'message': f'引擎还在算，{text} 已排队'}
        result = apply_move_locked(text)
        if not result.get('ok'):
            return result, 400
        return result


def act_engine_move(payload):
    with SESSION.lock:
        if SESSION.task_busy():
            return {'ok': False, 'message': '引擎正在思考'}, 409
        if SESSION.game.is_over():
            return {'ok': False, 'message': '对局已结束'}, 400
        if not SESSION.game.engine_to_move:
            return {'ok': False, 'message': '现在不是引擎的回合'}, 400
        task = SESSION.start_search()
    return {'ok': True, 'state': SESSION.state(), 'task': task.to_dict() if task else None}


def act_undo(payload):
    with SESSION.lock:
        SESSION.stop_search()
        SESSION.task = None
        SESSION.pending = None
        SESSION.unsettle()
        was_over = SESSION.game.is_over()
        if payload.get('round', True):
            n = SESSION.game.undo_round()
        else:
            n = SESSION.game.undo(int(payload.get('plies', 1)))
        if n:
            message = f'已回退 {n} 步'
        elif was_over:
            message = '已撤销终局判定，接着下'
        else:
            message = '没有可回退的棋步'
    return {'ok': True, 'state': SESSION.state(), 'message': message, 'undone': n}


def act_resign(payload):
    with SESSION.lock:
        SESSION.stop_search()
        SESSION.pending = None
        side = payload.get('side') or SESSION.game.turn
        SESSION.game.resign(side)
        SESSION.settle()
    return {'ok': True, 'state': SESSION.state(), 'message': '已认输'}


def act_clear_pending(_payload):
    with SESSION.lock:
        dropped = SESSION.pending
        SESSION.pending = None
    return {'ok': True, 'state': SESSION.state(),
            'message': f'已撤销排队的 {dropped["text"]}' if dropped else '没有排队的棋步'}


def act_load(payload):
    with SESSION.lock:
        SESSION.stop_search()
        SESSION.task = None
        SESSION.pending = None
        game = Game(engine_side=payload.get('engine_side', SESSION.game.engine_side))
        if payload.get('fen'):
            game.load_fen(payload['fen'])
        if payload.get('moves'):
            applied, failed = game.load_moves(payload['moves'])
            if failed:
                return {'ok': False, 'message': f'第 {len(applied)+1} 步无法识别：{failed[0]}',
                        'state': SESSION.state()}, 400
        SESSION.game = game
        SESSION.game_stats = _blank_stats()
        if SESSION.game.engine_to_move and not SESSION.game.is_over():
            SESSION.start_search()
    return {'ok': True, 'state': SESSION.state(), 'message': '局面已载入'}


def act_settings(payload):
    with SESSION.lock:
        if 'max_depth' in payload:
            SESSION.settings['max_depth'] = max(2, min(40, int(payload['max_depth'])))
        if 'think_ms' in payload:
            SESSION.settings['think_ms'] = max(120, min(60000, int(payload['think_ms'])))
        if 'auto_reply' in payload:
            SESSION.settings['auto_reply'] = bool(payload['auto_reply'])
    return {'ok': True, 'state': SESSION.state(),
            'message': f'思考时间已设为 {SESSION.settings["think_ms"]} 毫秒'}


def act_opponent_config(payload):
    with SESSION.lock:
        for key in ('mode', 'url', 'method', 'move_field'):
            if key in payload:
                SESSION.opponent[key] = payload[key]
        if 'headers' in payload and isinstance(payload['headers'], dict):
            SESSION.opponent['headers'] = payload['headers']
        if 'auto' in payload:
            SESSION.opponent['auto'] = bool(payload['auto'])
    return {'ok': True, 'state': SESSION.state(), 'message': '对手接入配置已更新'}


def act_opponent_poll(payload):
    """从配置的地址拉一步对手走法并录入。手动模式下这个接口用不上。"""
    import urllib.request

    cfg = SESSION.opponent
    if not cfg.get('url'):
        return {'ok': False, 'message': '未配置对手地址'}, 400

    try:
        req = urllib.request.Request(cfg['url'], method=cfg.get('method', 'GET'),
                                     headers=cfg.get('headers') or {})
        with urllib.request.urlopen(req, timeout=10) as resp:
            raw = resp.read().decode('utf-8', 'replace')
    except Exception as exc:                              # noqa: BLE001
        cfg['last_error'] = str(exc)
        return {'ok': False, 'message': f'拉取失败：{exc}'}, 502

    move_text = raw.strip()
    try:
        data = json.loads(raw)
        if isinstance(data, dict):
            move_text = str(data.get(cfg.get('move_field') or 'move', '')).strip()
        elif isinstance(data, list) and data:
            move_text = str(data[-1]).strip()
    except (ValueError, TypeError):
        pass

    cfg['last_poll'] = time.time()
    if not move_text:
        return {'ok': False, 'message': '对方接口没有返回走法'}, 400
    return act_move({'move': move_text})


ROUTES = {
    '/api/new': act_new,
    '/api/move': act_move,
    '/api/engine-move': act_engine_move,
    '/api/undo': act_undo,
    '/api/resign': act_resign,
    '/api/load': act_load,
    '/api/settings': act_settings,
    '/api/clear-pending': act_clear_pending,
}
GET_ROUTES = {
    '/api/state': lambda _: {'ok': True, 'state': SESSION.state()},
    '/api/health': lambda _: {'ok': True, 'engine': 'elephantfish',
                              'python': sys.version.split()[0]},
}


# --------------------------------------------------------------------------- #
# HTTP
# --------------------------------------------------------------------------- #

class Handler(SimpleHTTPRequestHandler):
    server_version = 'elephantfish-relay'
    # 用 HTTP/1.0：每个请求一条连接。这是个本机应用，轮询频率再高也不差这点
    # 开销，但省掉了长连接下「请求体没读完就和下一个请求串味」的一整类麻烦。
    protocol_version = 'HTTP/1.0'

    # ---- 工具 ---- #

    def _json(self, payload, code=200):
        body = json.dumps(payload, ensure_ascii=False).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self._cors()
        self.end_headers()
        self.wfile.write(body)

    def _cors(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, DELETE')

    def _read_body(self):
        """一次性把请求体读干净，之后的处理只管用解析结果。"""
        length = int(self.headers.get('Content-Length') or 0)
        raw = self.rfile.read(length) if length else b''
        if not raw:
            return {}
        for encoding in ('utf-8', 'gbk', 'latin-1'):
            try:
                return json.loads(raw.decode(encoding))
            except (UnicodeDecodeError, ValueError):
                continue
        return {'__parse_error__': raw.decode('utf-8', 'replace')[:200]}

    def log_message(self, fmt, *args):
        # 静音轮询日志，否则控制台会被刷屏。
        # 注意：send_error() 会走 log_error() -> log_message()，此时第一个位置参数
        # 可能是个 HTTPStatus 枚举而不是字符串，直接 `in` 会抛 TypeError，
        # 异常冒到 socketserver 就会把连接掐掉 —— 浏览器只看到「空响应」。
        try:
            line = fmt % args
        except (TypeError, ValueError):
            line = ' '.join([str(fmt), *(str(a) for a in args)])
        if '/api/state' in line or '/api/task/' in line:
            return
        sys.stderr.write('%s - %s\n' % (self.address_string(), line))

    # ---- 路由 ---- #

    def do_OPTIONS(self):
        self._read_body()
        self.send_response(204)
        self._cors()
        self.send_header('Content-Length', '0')
        self.end_headers()

    def do_POST(self):
        payload = self._read_body()
        path = urlparse(self.path).path

        if payload.get('__parse_error__') is not None:
            self._json({'ok': False,
                        'message': '请求体不是合法 JSON：' + payload['__parse_error__']}, 400)
            return

        route = ROUTES.get(path)
        if route is None:
            if path == '/api/opponent/config':
                route = act_opponent_config
            elif path == '/api/opponent/poll':
                route = act_opponent_poll
            elif path.startswith('/api/task/') and path.endswith('/stop'):
                task_id = path[len('/api/task/'):-len('/stop')]
                self._json({'ok': SESSION.stop_search(task_id),
                            'state': SESSION.state()})
                return
            elif path == '/api/clear-stats':
                SESSION.engine_stats.update({'moves': 0, 'nodes': 0, 'think_time': 0})
                self._json({'ok': True, 'state': SESSION.state()})
                return
            else:
                self._json({'ok': False, 'message': f'未知接口 {path}'}, 404)
                return

        try:
            result = route(payload)
        except Exception as exc:                          # noqa: BLE001
            traceback.print_exc()
            self._json({'ok': False, 'message': str(exc)}, 500)
            return

        if isinstance(result, tuple):
            self._json(result[0], result[1])
        else:
            self._json(result)

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if path in GET_ROUTES:
            self._json(GET_ROUTES[path](parse_qs(parsed.query)))
            return

        if path.startswith('/api/task/'):
            task_id = path[len('/api/task/'):]
            task = SESSION.task
            if task is None:
                self._json({'ok': False, 'message': '任务不存在'}, 404)
                return
            # 搜索任务会被顶掉：比如排队的那一步落地后，服务端立刻替引擎
            # 开了下一次搜索。前端手上还是旧 id，这时候不该丢它一个 404 ——
            # 它只要一次就能从 state 里发现新任务，继续轮询就是了。
            self._json({'ok': True, 'task': task.to_dict(), 'state': SESSION.state(),
                        'stale': task.id != task_id})
            return

        if path.startswith('/api/'):
            self._json({'ok': False, 'message': f'未知接口 {path}'}, 404)
            return

        # 静态资源：优先前端构建产物，再退回到旧版 ui/
        if path in ('/', '/index.html'):
            self.path = '/index.html'

        if not os.path.isdir(STATIC_DIR):
            self._serve_legacy(path)
            return

        target = os.path.join(STATIC_DIR, path.lstrip('/').replace('/', os.sep))
        # 单页应用：文件不存在就交给前端路由，而不是丢 404
        if not os.path.isfile(target) and '.' not in os.path.basename(path):
            self.path = '/index.html'
        super().do_GET()

    def _serve_legacy(self, path):
        """前端还没构建时，退回到原版页面，至少不是白屏。"""
        self.directory = LEGACY_DIR
        if path in ('/', '/index.html'):
            self.path = '/chess.html'
        if os.path.isfile(os.path.join(LEGACY_DIR, self.path.lstrip('/'))):
            super().do_GET()
            return
        body = (
            '<!doctype html><meta charset="utf-8">'
            '<title>elephantfish</title>'
            '<body style="font-family:system-ui;max-width:640px;margin:80px auto;'
            'line-height:1.7;color:#333">'
            '<h2>前端还没构建</h2>'
            '<p>新版界面需要用 Vite 构建一次。在项目根目录执行：</p>'
            '<pre style="background:#f4f1ea;padding:16px;border-radius:8px">'
            'cd frontend\nnpm install\nnpm run build</pre>'
            '<p>构建完成后刷新本页即可。开发模式请用 '
            '<code>npm run dev</code>，默认地址 http://localhost:5173</p>'
            '</body>').encode('utf-8')
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)


class Server(ThreadingHTTPServer):
    # 不给 SO_REUSEADDR 钻空子的机会：Windows 上 0.0.0.0:8010 和 127.0.0.1:8010
    # 可以同时存在，请求会随机落到其中一个，排查起来非常费劲。宁可让 bind 直接失败。
    allow_reuse_address = False
    daemon_threads = True


def run(port=8010, host='127.0.0.1'):
    # 让后台搜索线程和 HTTP 线程公平轮转，否则搜索时页面会卡
    sys.setswitchinterval(0.002)
    handler = functools.partial(Handler, directory=STATIC_DIR)

    httpd = None
    chosen = port
    for candidate in range(port, port + 12):
        try:
            httpd = Server((host, candidate), handler)
            chosen = candidate
            break
        except OSError:
            continue
    if httpd is None:
        print(f'端口 {port}~{port + 11} 全被占用，请手动指定一个空闲端口')
        return

    if chosen != port:
        print(f'端口 {port} 已被占用（可能是旧版 start.bat 还在跑），改用 {chosen}')

    print('=' * 58)
    print('  elephantfish 转述对局台')
    print(f'  打开   http://{host}:{chosen}/')
    print(f'  静态   {STATIC_DIR}')
    print('  停止   Ctrl+C')
    print('=' * 58)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print('\n已停止')
    finally:
        httpd.server_close()


if __name__ == '__main__':
    port = 8010
    for arg in sys.argv[1:]:
        if arg.isdigit():
            port = int(arg)
    run(port)
