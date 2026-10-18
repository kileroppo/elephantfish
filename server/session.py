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

**存档写在哪**（见 ``server/store.py``）：每个 ``with self.lock:`` 作用域的**最后
一条语句** ``self.store.sync_game(self)``。漏一处不会报错，只会让库里那一局从此
每一步都差一步 —— 所以 L 段的断言不是「有没有写过库」，而是「每个动词跑完之后，
库里的棋谱与 ``game.records`` 是否逐字段相同」。
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
from server.store import open_store

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
    # ---- 判分（给人这一步打分的那次搜索）------------------------------- #
    #
    # 与走棋那次分开配置，是因为两者要的正好相反：走棋要**赢**，判分要在
    # 「人正看着棋盘」这段时间里把前几名摆出来。所以它只在轮到人的时候跑，
    # 人一走就停，预算默认也比走棋小 —— 空闲算力是借来的，不是抢来的。
    'analyze': True,
    'analyze_ms': 1500,
    'analyze_depth': 14,
    'analyze_width': 3,
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
    """一次后台搜索。前端靠轮询它拿到实时的深度与评分。

    ``kind='engine-move'`` 的那次会落子，``kind='analyze'`` 的那次不落子、只把
    排名线攒在 ``lines`` 里给人那一步打分。两种共用一个类，是因为它们的生死
    规则一模一样：换局就作废、局面代数对不上就不许写回。
    """

    def __init__(self, kind='engine-move'):
        self.id = uuid.uuid4().hex[:12]
        self.kind = kind            # engine-move / analyze
        self.status = 'running'     # running / done / error / skipped
        self.progress = None        # 最近一层的结果
        self.result = None          # 最终结果
        self.error = None
        self.started = time.time()
        self.stop_event = threading.Event()
        self.thread = None
        self.move = None            # 已经落子的走法（引擎应手）
        # analyze 专用：同一个局面上排好序的排名线，以及「这局是第几手、
        # 哪个局面」—— 打分之前要拿它对一下，免得把上一局的排名安到这一局头上。
        self.lines = []
        self.subject = None

    def to_dict(self):
        return {
            'id': self.id,
            'kind': self.kind,
            'status': self.status,
            'progress': self.progress,
            'result': self.result,
            'error': self.error,
            'elapsed': time.time() - self.started,
            'lines': list(self.lines),
            'subject': dict(self.subject) if self.subject else None,
        }


def _piece_at(board, i):
    """第 i 格上的棋子字符；空格、越界、棋盘串里的填充格都算「没有子」。

    棋盘是一串定宽字符、其中只有 90 个是真实格子（见 ``core._SQUARES``），
    所以「取到了一个字符」不等于「取到了一颗棋子」。
    """
    if not (0 <= i < len(board)):
        return None
    c = board[i]
    if c == '.' or c.upper() not in core.piece:
        return None
    return c


def _pv_playable(board, red_to_move, m):
    """这一手能不能落在 ``board`` 上 —— 只验「起点有该方的子、落点不是自己的子」。

    不做完整合法性判断（``core.legal_moves`` 一次 1.8ms，主变每步都问会把
    判分那一搜的开销顶起来）：这里拦的是**会崩的**那一类，不是「马走错了方向」。
    """
    p = _piece_at(board, m[0])
    if p is None or (p.isupper() != red_to_move):
        return False
    q = _piece_at(board, m[1])
    return q is None or (q.isupper() != red_to_move)


def pv_detail(board, red_to_move, pv_moves):
    """把主变翻译成前端能直接展示的样子（ICCS + 中文记谱）。

    主变是一串连续的推演，所以要一路把局面推下去才能算对每一步的记谱。

    每一步先验再格式化，不验就停：``to_chinese`` 拿**起点那颗子**定棋子名，
    起点是空格就当场 ``KeyError``。而内置引擎的主变是从置换表里拼出来的，
    表被同局面的浅层结果替换过之后，拼出来的一串完全可能第 3 步起就对不上
    局面。对不上的那一步起就不要了 —— 报一段短主变只是讲得少，
    报一手棋盘上没有的棋是讲错了。
    """
    out = []
    b, red = board, red_to_move
    for m in pv_moves:
        if not _pv_playable(b, red, m):
            break
        out.append({'iccs': nt.to_iccs(m), 'chinese': nt.to_chinese(b, m)})
        b = core.apply_move(b, red, m)
        red = not red
    return out


def _pv_first_capture(board, red_to_move, pv):
    """沿一条主变推到「第一次吃到子」为止；窗口里没吃到子就返回 ``None``。

    读的是 ``pv_detail`` 存下来的那批串（``{'iccs','chinese'}``），不是引擎的绝对
    坐标：这样这里报出去的那一步与面板上显示的那一步**必然是同一个字符串**。
    自己现算一遍记谱就会有两处各算一遍的机会，那正是「讲解与棋谱写的不是同一步」
    这种 bug 的产地。代价是把窗口里那几步重放一遍 —— 都是已经在手的字符串，
    不值得为它多存一份棋盘，更不值得为它多花一秒搜索。

    两处「算了，当没有吃子」的出口各有各的原因：

    * 落到将/帅上的那一手：「吃掉老将」不是一步合法的棋（那是终局，不是吃子），
      杀棋的说法本来就盖住了这种线，所以整条线报 ``None``，
      ``captured`` 里永远不许出现 将 或 帅。
    * 撞上 ``_pv_playable`` 不认的那一步：主变可能是置换表里拼出来的陈旧串
      （``pv_detail`` 就是因为这个才截断的），对不上的那一步起就不再往下推。
      吃到子的时候当场就返回了，所以截断只会讲得少，不会讲错。
    """
    b, red = board, red_to_move
    for ply, step in enumerate(pv or (), 1):
        if not isinstance(step, dict):
            break
        iccs, chinese = step.get('iccs') or '', step.get('chinese') or ''
        # 名字凑不齐的一步不能报：讲不出「吃了哪颗子」的事实就别写这个事实。
        if not iccs or not chinese:
            break
        m = nt.from_iccs(iccs)
        if m is None or not _pv_playable(b, red, m):
            break
        victim = _piece_at(b, m[1])
        if victim is not None:
            if victim.upper() == 'K':
                return None
            return {'ply': ply, 'iccs': iccs, 'chinese': chinese,
                    'by': 'red' if red else 'black',
                    'captured': nt.PIECE_NAME[victim]}
        b = core.apply_move(b, red, m)
        red = not red
    return None


def pv_reason(board, red_to_move, best_pv, played_pv):
    """两条主变各自「第一次吃到子」的那一手。

    交回的是**事实**（第几步、哪一方吃的、吃了什么子），不是一句话。
    「为什么这一手更差」那句中文只写在 ``frontend/src/lib/format.ts``：
    服务端这里一编句子，就变成了两处各编一套话。

    两边的 ``None`` 只说一件事 —— 「整个窗口从头到尾没吃到子」。它**不等于**
    「没有这条线」：人那手压根不在排名线里时，``_attach_review`` 连 ``reason``
    这个键都不挂，界面把「键不在」念成「没看过」。这两个说法差得很远，
    所以这里不许用一个 None 去顶替「没看过」。
    """
    return {'best': _pv_first_capture(board, red_to_move, best_pv),
            'played': _pv_first_capture(board, red_to_move, played_pv)}


def _progress(info, board, red_to_move):
    """一层搜索结果 → 前端每 130ms 轮询读的那份进度。

    红方视角（``eval_red``）与侧方视角（``score``）一并给出，是因为这个面板
    既读实时进度又读棋谱里的落子评估，而 records 存的是红方视角 —— 以前它只能
    拿侧方视角的 ``score`` 去填，于是黑方思考时「黑方大优」会被显示成
    「红方大优」。两个视角都给，前端就不用来回猜。
    """
    return {
        'depth': info.depth,
        'multipv': info.multipv,
        'bound': info.bound,
        'score': info.score,
        'eval_red': info.eval_red,
        'mate': info.mate,
        'mate_in': info.mate_in,
        'book': info.book,
        'nodes': info.nodes,
        'time': round(info.time, 3),
        'nps': info.nps,
        'pv': list(info.pv_iccs),
        'pv_detail': pv_detail(board, red_to_move, info.pv),
    }


def _subject_of(game, epoch):
    """「哪一局的哪一个局面」—— 判分要挂回去的那把键。

    四个字段一个都不能少：``epoch`` 挡住换局，``board`` 挡住走子，
    ``red_to_move`` 挡住同一条棋盘串被两边共用（象棋里确有这种对称局面），
    ``ply`` 挡住「悔棋退回同一个局面，但那是另一遍」。
    """
    return {
        'epoch': epoch,
        'board': game.board,
        'red_to_move': game.red_to_move,
        'ply': len(game.records),
        'fen': nt.to_fen(game.board, game.red_to_move),
    }


def _matches(subject, want):
    """``want`` 里那几个字段对不对得上（``want`` 可以只带子集）。"""
    if not subject:
        return False
    return all(subject.get(k) == v for k, v in want.items())


def _blank_stats():
    return {'moves': 0, 'nodes': 0, 'think_time': 0.0, 'depth_max': 0}


def _line_record(info, board, red_to_move):
    """一条排名线 → 判分与界面共用的那一份 dict。

    ``score`` 保持**走子方视角**（接缝给的就是这个），``eval_red`` 是红方视角。
    两份都带上，是因为这两家要的参考系天生不同：判分要在走子方视角上做减法，
    而棋盘上的评估曲线、棋谱里的分数一律是红方视角。少给一份，前端就得自己
    翻符号 —— 那是最容易翻错的地方（黑方思考时「黑方大优」念成「红方大优」）。
    """
    mv = info.move
    return {
        'rank': int(info.multipv or 1),
        'iccs': nt.to_iccs(mv) if mv else '',
        'chinese': nt.to_chinese(board, mv) if mv else '',
        'score': info.score,
        'eval_red': info.eval_red,
        'mate': info.mate,
        'mate_in': info.mate_in,
        'bound': info.bound,
        'depth': info.depth,
        'nodes': info.nodes,
        'time': round(info.time, 3),
        'pv': pv_detail(board, red_to_move, info.pv),
    }


# --------------------------------------------------------------------------- #
# 给人这一步打分
# --------------------------------------------------------------------------- #

# 差值的可信程度。名字说的是「这个 loss 能不能当真值用」：
#   exact      两条线都是全窗搜出来的精确值
#   at_least   真值只会更大（截断来的分数撑不起「只差这么多」）
#   at_most    真值只会更小
#   uncertain  两个界的方向互相抵消，什么都证不出来
#   mate       有一条线是杀棋：centipawn 的减法在这里没有意义
#   below_top  人这手压根没进前几名，连它的分都不知道
LOSS_KINDS = ('exact', 'at_least', 'at_most', 'uncertain', 'mate', 'below_top')

# 判分结果里每条线最多带几步主变。存全条主变（一局里能有三四十步）会让
# 「投影」每手重写几十 KB，而讲解只用得上「正解接下来怎么走下去」的头几步。
REVIEW_PV_PLIES = 6


def _bound_dir(bound):
    """这个分数能把真值顶到哪一边：'floor' = 真值不低于它，'ceil' = 不高于它。

    ``exact`` 两边都算 —— 已知真值就是它。
    """
    if bound == 'lowerbound':
        return {'floor'}
    if bound == 'upperbound':
        return {'ceil'}
    return {'floor', 'ceil'}


def grade_move(move_iccs, lines):
    """把人走的这一手，对着**同一个局面**的排名线打个分。

    ``lines`` 按 ``rank`` 升序，第 0 条就是引擎当下最好的那手；每条线至少要带
    ``iccs`` / ``score`` / ``eval_red`` / ``bound``，``mate_in`` 与 ``pv`` 可以没有。

    差值算在**走子方视角**上（``score``），不是红方视角：``eval_red`` 相减会
    把黑方的失误算成红方的进步 —— 那是符号错误，不是精度问题，界面上念出来
    就是「这步好棋」和「这步漏着」互换。

    纯函数：不碰引擎、不碰会话、不碰库，给一堆线就还一份判分。所以它可以
    被 ``tools/verify.py`` 用编出来的排名线逐条问（杀棋、界、掉出前三），
    不必修引擎、不必等搜索。

    ``lines`` 为空时返回 ``None`` —— 「没判」与「判了但没差值」是两件事，
    前者不许写进存档，否则以后没法分辨。
    """
    if not lines:
        return None
    best = lines[0]
    played = next((l for l in lines if l['iccs'] == move_iccs), None)

    out = {
        'status': 'ok' if played else 'outside',
        # 这批线来自哪一层、花了多少算力 —— 「排第 3」这句话的可信程度全在这
        'depth': max(int(l.get('depth') or 0) for l in lines),
        'nodes': max(int(l.get('nodes') or 0) for l in lines),
        'time': max(float(l.get('time') or 0.0) for l in lines),
        'width': len(lines),
        'best_iccs': best['iccs'],
        'best_eval_red': best.get('eval_red'),
        'best_mate_in': best.get('mate_in'),
        'best_bound': best.get('bound'),
        'rank': played['rank'] if played else None,
        'played_iccs': move_iccs,
        'played_eval_red': played.get('eval_red') if played else None,
        'played_mate_in': played.get('mate_in') if played else None,
        'played_bound': played.get('bound') if played else None,
        'loss': None,
        'loss_kind': None,
        'lines': [dict(l, pv=list(l.get('pv') or [])[:REVIEW_PV_PLIES])
                  for l in lines],
    }

    if played is None:
        # 掉出前三不是「差 0 步」也不是「差很多」，是**不知道差多少**。
        # 界面只能念「不在引擎前几名里」，不许编一个数。
        out['loss_kind'] = 'below_top'
        return out

    if best.get('mate_in') is not None or played.get('mate_in') is not None:
        # 杀棋分在接缝里被钉在同一个锚点上（``MATE_CP``），减出来的是 0 或
        # 一个巨大的假数。距离读 mate_in，这里就不给 centipawn 的差值了。
        out['loss_kind'] = 'mate'
        return out

    loss = int(best['score']) - int(played['score'])
    out['loss'] = loss
    # loss = best − played：best 的下界把差值往上顶，played 的上界也是；反之
    # best 的上界与 played 的下界把差值往下压。两边都证得出来才是精确值。
    # 差 0 也走这条路 —— 第 1 名是个下界时，「一样好」只能说成「至少不差」。
    best_dir = _bound_dir(best.get('bound'))
    played_dir = _bound_dir(played.get('bound'))
    lower_ok = 'floor' in best_dir and 'ceil' in played_dir
    upper_ok = 'ceil' in best_dir and 'floor' in played_dir
    if lower_ok and upper_ok:
        out['loss_kind'] = 'exact'
    elif lower_ok:
        out['loss_kind'] = 'at_least'
    elif upper_ok:
        out['loss_kind'] = 'at_most'
    else:
        out['loss_kind'] = 'uncertain'
    return out


# --------------------------------------------------------------------------- #
# 会话
# --------------------------------------------------------------------------- #

class GameSession:
    """一局棋 + 一个引擎 + 一次在跑的搜索。

    公开接口就两类：**状态变更动词**（各自管锁，返回 ``Reply``）与 **查询**
    （``snapshot`` / ``task_snapshot`` / ``health``）。没有别的东西可以碰。
    """

    def __init__(self, engines=None, settings=None, store=None):
        self.lock = threading.RLock()
        self.game = Game(engine_side=RED)
        # 存档。这一局的身份证与「它是下出来的还是摆出来的」都在这里，
        # 换发时机只有 new_game 与 load —— 悔棋不换（还是那一局，只是退回去），
        # 载入必须换（那是另一道题，成绩不许混进上一局的胜率里）。
        self.store = store if store is not None else open_store()
        self.game_id = uuid.uuid4().hex[:12]
        self.game_source = 'play'
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
        self.settings = {**DEFAULT_SETTINGS, **(settings or {})}

        # 局面代数。换局 / 载入时 +1。worker 落子前必查 —— 这是「搜索期间局面被
        # 整个换掉」唯一的可靠判据（比对棋盘串挡不住新旧局面恰好相同的情形）。
        self._epoch = 0
        self.task = None
        # 判分那次搜索单独一个槽：它不推棋、不该被 ``stop_search`` 当成引擎应手
        # 叫停，也不该在 ``task`` 换人时被顶掉（前端两份读数各有各的来源）。
        self.analysis_task = None
        # 一次只许有一条搜索在飞。这不是保险，是**必须**：内置引擎全场共用一个
        # ``Searcher``（置换表、世代号、节点计数都是它的实例字段），两个线程同时
        # 搜会互相踩状态；皮卡鱼只有一个进程，两条 ``go`` 会串话。所以走棋那路
        # 拿锁拿到成功，判分那路拿不到就这一轮不判 —— 借来的算力不许排队。
        self._engine_io = threading.Lock()

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
        # 这本账是跨重启的：重启服务不该把「这台机器一共下了多少局、赢了几局」
        # 抹掉，所以从库里读回来。读不到就是空账（第一次跑，或 EF_STORE=off）。
        self.engine_stats.update(self.store.load_agg_stats(self.engine_stats))
        self.game_stats = _blank_stats()
        # 引擎正在算棋时录进来的对方走法。不拒绝、不报错，先存着，
        # 等引擎收手立刻落子 —— 人是从另一个窗口读棋的，没道理被我们卡住。
        self.pending = None
        # 服务端主动要告诉用户的一句话（排队那步的结果之类），
        # 带序号，前端只在序号变化时弹一次。
        self.notice = None
        self._notice_seq = 0
        # 上一次「搜索失败后自动重试」发生在哪个局面。同一局面只重试一次，
        # 否则引擎真坏了会变成死循环。
        self._retried = None

    # ---- 内部：任务与战绩 ---------------------------------------------- #
    #
    # 下面这些一律**要求调用方已持有 self.lock**（RLock，动词方法自己会拿）。

    def _task_busy(self):
        return self.task is not None and self.task.status == 'running'

    def _analysis_busy(self):
        t = self.analysis_task
        return t is not None and t.status == 'running'

    def _stop_analysis(self):
        """叫停判分那次搜索。调用方需持有锁。

        两个 adapter 都认 ``stop``：内置在 ``_tick`` 的 1024 节点那一拍收手，
        皮卡鱼发 UCI 的 ``stop`` 等 ``bestmove``。所以叫停之后那条线程还会跑
        一小会儿，这正是 ``_engine_io`` 那把锁存在的理由。
        """
        if self._analysis_busy():
            self.analysis_task.stop_event.set()

    def _same_subject(self, task):
        """这个任务分析的还是眼前这个局面吗。"""
        return _matches(task.subject if task else None,
                        _subject_of(self.game, self._epoch))

    def _attach_review(self, pre, rec):
        """把人刚走的这一步对着排名线打个分。调用方需持有锁。

        只判 ``by == 'opponent'``：引擎那一步的分是它自己搜出来的，比「旁边另有
        一条线说它排第 3」可信得多，拿后者去覆盖前者是降级。

        排名线必须是**走完这一步之前**那个局面搜出来的 —— ``pre`` 就是那一刻的
        键，对不上就当没判过。判分从不现场搜：那会把「人等一手棋」的延迟从
        引擎的 think_ms 变成 think_ms + analyze_ms，而排名线的钱本来就已经付了。
        """
        task = self.analysis_task
        if rec['by'] != 'opponent' or not task or not task.lines:
            return
        if not _matches(task.subject, pre):
            return
        review = grade_move(rec['iccs'], task.lines)
        if review is None:
            return
        pre_board, pre_red = pre.get('board'), pre.get('red_to_move')
        # 「为什么更差」那份事实只在**人这手确实在排名线里**的时候才挂：
        # below_top / outside 那两种连这手的主变都没搜出来，无从重放。键缺位
        # 就是界面上的「没看过」，挂一个 None 会被念成「看过，两条线都不吃子」——
        # 那是把没证出来的东西说成证出来了。
        # pre 允许只带 subject 的字段子集（见 ``_matches``），所以重放要的
        # 棋盘与走子方必须真的在手上才敢重放。
        if (review['status'] == 'ok' and isinstance(pre_board, str)
                and isinstance(pre_red, bool)):
            played_line = next((l for l in review['lines']
                                if l['iccs'] == review['played_iccs']), None)
            if played_line is not None:
                review['reason'] = {
                    'side': 'red' if pre_red else 'black',
                    'pv_plies': REVIEW_PV_PLIES,
                    **pv_reason(pre_board, pre_red,
                                review['lines'][0]['pv'], played_line['pv']),
                }
        rec['review'] = review
        if rec['eval'] is None and review['rank'] is not None:
            # 顺手把这一步的评估补上：排名线里有「走完这手之后局面怎样」，
            # 换算成红方视角存起来，评估曲线就不再是只有引擎那半条了。
            # 掉出前几名之外就留 NULL —— 不知道，比编一个好。
            rec['eval'] = review['played_eval_red']
            rec['mate_in'] = review['played_mate_in']
            rec['depth'] = review['depth']
            rec['time'] = review['time']

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
        # 引擎要出招了，判分那次先叫停：一个 Searcher、一个 UCI 进程，
        # 同一时刻只容得下一条搜索。
        self._stop_analysis()

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
                # 判分那次可能正在收手（被叫停之后还要一两拍），所以这里**等**锁。
                # 等的是「引擎该出招了」这件更要紧的事；等待不持 self.lock，
                # HTTP 线程与前端轮询都不受影响。
                with self._engine_io:
                    for info in engine.search(req):
                        # 落子只认**排名第一**那层：多线搜索每层交回好几条，
                        # 拿最后那条（往往是 rank 3）去 push 就是替对手走棋。
                        # 单线时每条都是 rank 1，与今天的行为一模一样。
                        if info.multipv <= 1:
                            last = info
                        task.progress = _progress(info, start_board, red_to_move)
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
                        mate_in=last.mate_in,
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
                        'eval_red': last.eval_red,
                        'mate': last.mate,
                        'mate_in': last.mate_in,
                        'book': last.book,
                        'nodes': last.nodes,
                        'time': round(last.time, 3),
                        'nps': last.nps,
                        'elapsed': round(time.time() - task.started, 3),
                        'stopped': task.stop_event.is_set(),
                    }
                    task.status = 'done'
                    # 引擎这一手落定、任务也标成 done 之后才开场判分：判分那路
                    # 见 ``self._task_busy()`` 为真就不开，早一行的话这一次就白过了。
                    self._maybe_analyze()
                    # 引擎这一手是在 worker 线程里落的，不经过任何公开动词 ——
                    # 少这一条，「引擎想出来的棋」就整局都不在库里，而界面看着
                    # 一切正常：这正是投影式存档最容易漏掉的一个写入点。
                    self.store.sync_game(self)
            except Exception as exc:                      # noqa: BLE001
                traceback.print_exc()
                task.status = 'error'
                task.error = str(exc)
            finally:
                # 不论成功、失败还是丢弃，排队的那步都要有个说法。
                # 只在「成功落子」之后才 flush 的话，引擎这步一出错，
                # 排队的对方走法就永久挂在那里 —— 盘面上看就是「引擎不走了」。
                with self.lock:
                    self._flush_pending()
                    if task.status == 'error':
                        self._retry_after_error(epoch)

        task.thread = threading.Thread(target=worker, name='engine-search', daemon=True)
        task.thread.start()
        return task

    def _maybe_analyze(self):
        """轮到人了，就替他把当前局面算一遍。调用方需持有锁。

        只在「引擎不需要算力、而人正需要提示」的那段时间里跑 —— 这是这台机器
        借给学习的空闲算力，不是第三条搜索线程。所以：引擎该出招时不开、引擎
        正在算时不开、同一个局面已经有一次（在跑或已跑完）也不重开。
        """
        if not self.settings.get('analyze'):
            return None
        if self.game.is_over() or self.game.engine_to_move or self._task_busy():
            return None
        if self._same_subject(self.analysis_task):
            return self.analysis_task
        if self._analysis_busy():
            self._stop_analysis()
        return self._start_analysis()

    def _start_analysis(self):
        """开一次判分搜索。调用方需持有锁。

        与走棋那次的三处不同，各有各的原因：

        * ``use_book=False``：开局库交回的是占位分（20）。拿它当第 1 名去减
          「你这一手差多少」，减出来的数没有依据。
        * ``multipv > 1``：要的是前几名的**排名**，不是最好的一手。
        * 不落子、不记账、不进战绩，而且**不碰 ``self.lock``** —— 它只往自己
          那个 task 对象上写。写回棋谱是 ``_apply_move_locked`` 的事，那时候
          局面、代数、第几手三样一起对，对不上就当没判过。
        """
        settings = dict(self.settings)
        game = self.game
        task = SearchTask('analyze')
        task.subject = _subject_of(game, self._epoch)
        self.analysis_task = task

        req = SearchRequest(
            board=game.board,
            red_to_move=game.red_to_move,
            game_history=tuple(game.boards),
            move_history_iccs=tuple(r['iccs'] for r in game.records),
            start_fen=getattr(game, 'start_fen', None),
            max_depth=settings['analyze_depth'],
            time_limit=settings['analyze_ms'] / 1000.0,
            multipv=max(1, int(settings['analyze_width'])),
            use_book=False,
            stop=task.stop_event.is_set,
        )
        engine = self.engines.choose()
        board, red_to_move = req.board, req.red_to_move
        width = max(1, int(settings['analyze_width']))
        # 根着法的合法集，锁内一次算好带进线程：排名线只认这块盘上真存在的棋。
        legal_root = frozenset(game.legal_moves())

        def worker():
            # 拿不到锁就这一轮不判。判分用的是借来的算力，它没有排队的资格，
            # 而且干等在这儿只会把下一次开场一起拖晚。
            if not self._engine_io.acquire(timeout=0.5):
                task.status = 'skipped'
                task.result = {'status': 'busy', 'message': '引擎正忙，这一手先不判'}
                return
            try:
                by_rank = {}
                dropped = 0             # 引擎交回的非法根着法，见下面那处判断
                whole_layer = False     # 交出去过**一整层**吗

                def commit(lines, force=False):
                    """把一层排名线交出去，返回有没有交。

                    不整层不交，也不许用残缺的一层覆盖齐整的一层：「排第 3、比最优
                    差 1.4 兵」这两个数必须来自同一层。``force`` 只用在从头到尾
                    都没凑齐一层的时候（例如刚出 rank 1 就被叫停）—— 那时
                    有几条算几条，而 ``grade_move`` 读的是这批线的实际条数，
                    「前三之外」会自己变成「头一名之外」，仍然是实话。
                    """
                    nonlocal whole_layer
                    recs = sorted((ln for ln in lines if ln and ln.get('iccs')),
                                  key=lambda ln: ln['rank'])
                    if not recs or (len(recs) < width and not force):
                        return False
                    task.lines = recs[:width]
                    if len(recs) >= width:
                        whole_layer = True
                    return True

                for info in engine.search(req):
                    mv = info.move
                    if mv is None or mv not in legal_root:
                        # 引擎交回一步在这块盘上并不存在的棋。走棋那一路是当场
                        # 弃掉这手并报「引擎给出的走法非法」；这里同样不许把这种
                        # 线存进排名 —— 拿它对人的着法打分，比不打分更糟。
                        dropped += 1
                        continue
                    rank = int(info.multipv or 1)
                    if rank <= 1:
                        commit(list(by_rank.values()))
                        by_rank = {}
                    by_rank[rank] = _line_record(info, board, red_to_move)
                    task.progress = _progress(info, board, red_to_move)
                    if len(by_rank) >= width:
                        commit(list(by_rank.values()))
                        by_rank = {}
                    if task.stop_event.is_set():
                        break
                if not whole_layer:
                    commit(list(by_rank.values()), force=True)
                task.result = {
                    'status': 'ok',
                    'engine': engine.name,
                    'width': len(task.lines),
                    'dropped': dropped,
                    'elapsed': round(time.time() - task.started, 3),
                    'stopped': task.stop_event.is_set(),
                }
                task.status = 'done'
            except Exception as exc:                          # noqa: BLE001
                traceback.print_exc()
                task.status = 'error'
                task.error = str(exc)
            finally:
                self._engine_io.release()

        task.thread = threading.Thread(target=worker, name='analyze', daemon=True)
        task.thread.start()
        return task

    def _retry_after_error(self, epoch):
        """搜索失败后自动重试一次。

        为什么需要：引擎进程崩一次（比如喂进它不认的局面）之后，那一手就永远
        没人算了，界面上只弹一条 toast，盘面从此停摆。同一局面只重试一次，
        引擎真坏了也不会变成死循环。调用方需持有锁。
        """
        if epoch != self._epoch:
            return
        if self.game.is_over():
            return
        if not (self.game.engine_to_move and self.settings['auto_reply']):
            return
        key = (epoch, len(self.game.records))
        if self._retried == key:
            self._say('引擎连续两次没算出应手，先检查引擎设置或换个引擎', 'error')
            return
        self._retried = key
        self._say('引擎这一步没算出来，正在重试', 'warn')
        self._start_search()

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

        # push 之后 self.game 已经是走完的样子了，所以判分要用的那个键先抄下来。
        pre = _subject_of(self.game, self._epoch)
        rec = self.game.push(move)
        self._attach_review(pre, rec)
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
        # 轮到人的时候（自动应手关着，或这局压根没开引擎执子）就接着判下一手；
        # 轮到引擎的时候它自己会退回不做。
        self._maybe_analyze()
        self.store.sync_game(self)

        return {'ok': True, 'state': self.snapshot(), 'message': message,
                'record': rec, 'queued': queued,
                'auto_task': task.id if task else None}

    # ---- 公开动词 ------------------------------------------------------- #
    #
    # 每一个自己拿锁、自己返回 Reply。HTTP 层只负责解析请求与序列化，
    # 测试可以直接调这些方法，不需要起服务。

    # 白名单与各自的取值范围只在这一份里。以前 new_game 抄了一份不带范围的，
    # 于是「新开一局时传个 max_depth=999」能绕过设置接口该拦的东西 ——
    # 同一个键两条写路径，范围只写在其中一条上，早晚会再漏一次。
    _SETTING_CLAMPS = {
        'max_depth': (2, 50, int),
        'think_ms': (120, 60000, int),
        'analyze_ms': (200, 15000, int),
        'analyze_depth': (2, 50, int),
        'analyze_width': (1, 5, int),
    }
    _SETTING_FLAGS = ('auto_reply', 'analyze')

    def _apply_settings_locked(self, payload):
        """按白名单把 payload 里的设置落到会话上。调用方需持有锁。"""
        for key, (lo, hi, cast) in self._SETTING_CLAMPS.items():
            if key in payload:
                self.settings[key] = max(lo, min(hi, cast(payload[key])))
        for key in self._SETTING_FLAGS:
            if key in payload:
                self.settings[key] = bool(payload[key])
        if 'engine_type' in payload:
            # 校验规则只有 EngineSet 一份：名字不认就原样不动
            self.engines.set_preference(payload['engine_type'])
        if 'threads' in payload:
            threads = max(1, min(16, int(payload['threads'])))
            self.settings['threads'] = threads
            self.engines.set_options(threads=threads)
        if 'hash_mb' in payload:
            hash_mb = max(16, min(1024, int(payload['hash_mb'])))
            self.settings['hash_mb'] = hash_mb
            self.engines.set_options(hash_mb=hash_mb)

    def new_game(self, payload):
        engine_side = payload.get('engine_side', RED)
        with self.lock:
            self.stop_search()
            self._stop_analysis()
            self.game = Game(engine_side=engine_side)
            # 换局了：在飞的搜索作废
            self._epoch += 1
            # 同时换发存档身份：新开的一局与刚下完的那局是两条记录
            self.game_id = uuid.uuid4().hex[:12]
            self.game_source = 'play'
            # 新对局的引擎清理（内置丢置换表、皮卡鱼发 ucinewgame）由接缝管，
            # 调用方不用知道有几个引擎、各自要清什么。
            self.engines.new_game()
            self.task = None
            # 上一局的排名线不属于这一局：连槽一起清掉，
            # 否则换局后第一次判分会拿旧局面那批线给新局打分。
            self.analysis_task = None
            self.pending = None
            self.game_stats = _blank_stats()
            self._apply_settings_locked(payload)
            if self.game.engine_to_move:
                self._start_search()
            else:
                self._maybe_analyze()
            message = f'新对局开始，引擎执{"红" if self.game.engine_side == RED else "黑"}方'
            body = {'ok': True, 'state': self.snapshot(), 'message': message}
            self.store.sync_game(self)
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
            self._stop_analysis()
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
            # 退回去的那个局面正是复盘要看的那个：轮到人才重开一次判分。
            # 排名线不会跟过来（subject 对不上），所以旧的那一批自动作废。
            self._maybe_analyze()
            body = {'ok': True, 'state': self.snapshot(),
                    'message': message, 'undone': n}
            self.store.sync_game(self)
        return Reply(body)

    def resign(self, payload):
        with self.lock:
            self.stop_search()
            self._stop_analysis()
            self.pending = None
            side = payload.get('side') or self.game.turn
            self.game.resign(side)
            self._settle()
            body = {'ok': True, 'state': self.snapshot(), 'message': '已认输'}
            # 认输不改棋谱，只改结果 —— 但结果正是学习要用的那一半，
            # 所以这一条 sync 是 outcome 唯一的落库时机。
            self.store.sync_game(self)
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
            self._stop_analysis()
            self.task = None
            self.analysis_task = None
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
            # 排局/补棋摆出来的局另发一张身份证：它不是上一局的续集，
            # 而 source=setup 让它的胜负不进「我这盘下得怎么样」那本账。
            self.game_id = uuid.uuid4().hex[:12]
            self.game_source = 'setup'
            self.game_stats = _blank_stats()
            self.engines.new_game()
            if self.game.engine_to_move and not self.game.is_over():
                self._start_search()
            else:
                self._maybe_analyze()
            body = {'ok': True, 'state': self.snapshot(), 'message': '局面已载入'}
            self.store.sync_game(self)
        return Reply(body)

    def update_settings(self, payload):
        with self.lock:
            self._apply_settings_locked(payload)
            if not self.settings['analyze']:
                # 关掉判分要把在飞的和已经攒下的排名线一起收走：槽留着，
                # 下一次录入就会拿旧的那批线去打分。
                self._stop_analysis()
                self.analysis_task = None
            else:
                self._maybe_analyze()
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
            self.store.sync_game(self)
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
                # 判分那次单独一个键：它不推棋、不该和引擎的应手混在 ``task`` 里，
                # 前端两份读数（「引擎在想」与「这一手排在第几」）各有各的来源。
                'analysis': self.analysis_task.to_dict() if self.analysis_task else None,
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
