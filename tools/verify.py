# -*- coding: utf-8 -*-
"""引擎一致性回归自检。

跑这个脚本的目的只有一个：**证明重写过的引擎和原版 elephantfish 在规则层面
逐条对齐**，并且 UI 依赖的那几条不变量确实成立。它不测界面，只测棋。

    python tools/verify.py            # 完整跑一遍
    python tools/verify.py --quick    # 少跑几局，改代码时快速冒烟
    python tools/verify.py --arena2-full   # M 段连真对局与基准工作树一起跑

覆盖的断言：

    A  走法生成与原版逐位对齐（含顺序），随机 400 局逐局面比对
    B  中文记谱 / ICCS 往返无损，覆盖随机局面里每一步合法走法
    C  困毙（无子可动而非被将）判负 —— 原版当和棋处理，是错的
    D  认输之后悔棋能撤销认输，回到「等对方出招」
    E  累计战绩：认输计入、悔棋撤回，走公开动词不打内部
    F  主变每一步都合法、记谱往返一致，红黑两个视角都验
    G  快照性能（前端每 130ms 轮询一次的那个接口）
    H  引擎接缝：两个 adapter 产出同一套字段与参考系（含黑方走棋时的坐标翻转），
       并验固定节点预算是硬上界、use_book=False 时不许交开局库的手
    H2 引擎接缝可替换：注入假引擎，EngineSet 照着用，降级与校验只有一份
    H3 MultiPV：两个引擎的根着法排名与界标（名次 1..N、按分数排好、bound 在词表里）
    I  会话并发：搜索在飞时换局 / 认输，那一步不该落地；排队的一步该落地
    I2 拉对手走法时发请求不持锁（否则一次网络超时会把整个服务堵住）
    J  摆棋/残局开局：起始局面必须被记住，否则 UCI 重放棋谱会认定非法而自杀
    K  分数单位：两个引擎的分折算成同一把尺（centipawn），杀棋距离走 mate_in
    L  存档：每个动词跑完，库里的棋谱与实况逐字段相同；存档本身能重放出局面
    L2 判分：人走的每一步对着**同一个局面**的排名线打分 —— 名次、差值、
       差值的可信程度（界标）、掉出前三、杀棋；`pv_reason` 从重放的主变里只报
       「第一次吃到子那一手」这份事实（键缺位=没看过，None=窗口里没吃到）；
       判分整份进库
    N  错题本：跨历次对局按 fen_before 聚合判分（只读）—— 门槛只写在
       review_verdict 一处，跑一遍整本库逐字节不变，非 exact 那几种不许算成错
    O  逐手回放的读路径：recent_games / game_replay 只靠存档就能把整局一手手
       摆回盘上（start_fen + 有序 ICCS 过一遍真规则），只读、不碰会话锁
    M  对局度量台 tools/arena2.py 的自检（切分不泄漏、WDL 含和棋、95% CI、
       节点预算两侧同口径、裁决在小样本上只许 inconclusive），含牙齿检验

任何一条不过就以非零码退出，方便挂在提交钩子上。
"""

import argparse
import contextlib
import hashlib
import io
import json
import os
import random
import sqlite3
import sys
import threading
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

# 存档自检必须打临时库。**无条件设**，不用 setdefault：``data/elephantfish.sqlite``
# 是用户越下越厚的那本真账，跑一次自检就在里面多出几十局测试棋是不能接受的。
import tempfile                                           # noqa: E402

_ARCHIVE_DIR = tempfile.mkdtemp(prefix='ef-verify-')
os.environ['EF_STORE_PATH'] = os.path.join(_ARCHIVE_DIR, 'process.sqlite')


def _fresh_archive(tag):
    """给这一段开一本全新的档。

    累计账是**跨会话读回来**的（L 节就在验这个行为），而 E / J 那些断言写的是
    「记了一笔负」这种绝对数：同一段跑完，库里已经躺着那一笔，下一段一开场
    读回来的起点就不是零。各段各开一本，起点才是这一段自己写下的那个。
    """
    os.environ['EF_STORE_PATH'] = os.path.join(_ARCHIVE_DIR, f'{tag}.sqlite')

import elephantfish as base                                    # noqa: E402
from engine import (                                           # noqa: E402
    core, notation as nt, Game, RED, BLACK,
    SearchRequest, EngineInfo, EngineSet,
    BuiltinEngine, PikafishAdapter, PIKAFISH, BUILTIN, BOUND_NAMES,
    default_engines,
)
from engine.search import Searcher, _mate_in              # noqa: E402
from engine.engine import (_normalize, CP_PAWN, BUILTIN_PAWN,  # noqa: E402
                           MATE_CP)
import server.session as session_mod                            # noqa: E402
import server.store as store_mod                                 # noqa: E402
from server.store import Store, dump_review                        # noqa: E402
from server.session import GameSession                          # noqa: E402

# --------------------------------------------------------------------------- #
# 结果收集
# --------------------------------------------------------------------------- #

_FAILURES = []
_CHECKS = 0


def check(label, ok, detail=''):
    global _CHECKS
    _CHECKS += 1
    mark = 'ok  ' if ok else 'FAIL'
    line = f'  [{mark}] {label}'
    if detail:
        line += f'  —— {detail}'
    print(line)
    if not ok:
        _FAILURES.append(label)
    return ok


def section(title):
    print()
    print('=' * 72)
    print('  ' + title)
    print('=' * 72)


# --------------------------------------------------------------------------- #
# A. 走法生成：与原版逐位对齐
# --------------------------------------------------------------------------- #

def gen_moves_same(board):
    """两个实现的 gen_moves 必须产出**完全一样**的列表（含顺序）。"""
    mine = list(core.Position(board, 0).gen_moves())
    theirs = list(base.Position(board, 0).gen_moves())
    return mine, theirs


def test_move_generation(games):
    section(f'A. 走法生成与原版逐位对齐（{games} 局随机对局）')
    rng = random.Random(7)

    positions = 0
    mismatches = 0
    first_bad = None
    plies_total = 0

    for g in range(games):
        board = core.initial
        red = True
        for ply in range(60):
            mine, theirs = gen_moves_same(board)
            positions += 1
            if mine != theirs:
                mismatches += 1
                if first_bad is None:
                    first_bad = (board, red, sorted(set(mine) ^ set(theirs))[:4])
            legal = core.legal_moves(board, red)
            if not legal:
                break
            move = rng.choice(legal)
            board = core.apply_move(board, red, move)
            red = not red
            plies_total += 1

    check('逐局面比对无分歧', mismatches == 0,
          f'比了 {positions:,} 个局面、走了 {plies_total:,} 步，分歧 {mismatches}')
    if first_bad:
        print(f'         首个分歧局面: {first_bad[0]!r} red={first_bad[1]} '
              f'差集={first_bad[2]}')
    return positions


# --------------------------------------------------------------------------- #
# B. 记谱往返
# --------------------------------------------------------------------------- #

def test_notation(games):
    section(f'B. 中文记谱 / ICCS 往返无损（{games} 局随机对局里每一步合法走法）')
    rng = random.Random(11)

    total = 0
    iccs_fail = 0
    cn_fail = 0
    samples = []

    for _ in range(games):
        board = core.initial
        red = True
        for _ply in range(60):
            legal = core.legal_moves(board, red)
            if not legal:
                break
            for m in legal:
                total += 1
                # ICCS 往返
                if nt.from_iccs(nt.to_iccs(m)) != m:
                    iccs_fail += 1
                # 中文记谱往返（带合法列表做校验，避免歧义误判）
                text = nt.to_chinese(board, m)
                back = nt.from_chinese(board, text, red, legal=legal)
                if back != m:
                    cn_fail += 1
                    if len(samples) < 5:
                        samples.append((text, nt.to_iccs(m),
                                        nt.to_iccs(back) if back else None))

            move = rng.choice(legal)
            board = core.apply_move(board, red, move)
            red = not red

    check('ICCS 往返无损', iccs_fail == 0, f'{total:,} 步，失败 {iccs_fail}')
    check('中文记谱往返无损', cn_fail == 0, f'{total:,} 步，失败 {cn_fail}')
    for text, want, got in samples:
        print(f'         反例: {text}  期望 {want}  实得 {got}')
    return total


# --------------------------------------------------------------------------- #
# C. 困毙判负
# --------------------------------------------------------------------------- #

# 黑将 e9，红帅 d0、红车 d1/f1、红兵 e7。
# 黑将三个落点 d9 / f9 / e8 分别被 d1 车、f1 车、e7 兵控制，
# 而黑将本身**没有被将军** —— 正是标准的「困毙」。
STALEMATE_FEN = ('....k..../........./....P..../........./........./'
                 '........./........./...R.R.../........./...K..... b - - 0 1')


def test_stalemate():
    section('C. 困毙（无子可动而非被将）判负')

    board, red_to_move, _hm, _fm = nt.from_fen(STALEMATE_FEN)
    check('局面载入：轮到黑方', red_to_move is False)

    checking = core.is_in_check(board, red_to_move)
    check('黑方此刻并未被将军', checking is False, f'is_in_check={checking}')

    legal = core.legal_moves(board, red_to_move)
    check('黑方确实无子可动', legal == [], f'合法走法 {len(legal)} 步')

    game = Game(engine_side=RED)
    game.load_fen(STALEMATE_FEN)
    status = game.status()
    check('Game 判为困毙', status['state'] == 'stalemate', f"state={status['state']}")
    check('困毙判黑方负、红方胜', status['winner'] == RED,
          f"winner={status['winner']}  reason={status['reason']}")
    check('困毙不是和棋（原版这里会判和）', status['winner'] is not None)

    # 对照：把 e7 的红兵拿掉，黑将就有 e8 可走，应当回到「还在下」
    open_fen = STALEMATE_FEN.replace('....P....', '.........', 1)
    g2 = Game(engine_side=RED)
    g2.load_fen(open_fen)
    st2 = g2.status()
    check('抽掉红兵后不再困毙（对照）', st2['state'] == 'playing',
          f"state={st2['state']}")


def test_king_facing():
    section('C2. 王不见王（帅将照面飞将）：任何导致双王对射的着法均为非法送将')

    # 1. 黑将主动走到与红帅同一列（红帅在 f0，黑将在 e9，f 列中间无子）
    b1 = list(core.initial)
    for i in core._SQUARES: b1[i] = '.'
    b1[core.parse('f0')] = 'K'
    b1[core.parse('e9')] = 'k'
    b1_str = ''.join(b1)
    black_moves = [core.render(m[0]) + core.render(m[1]) for m in core.legal_moves(b1_str, False)]
    check('黑将不可走入与红帅直接照面的 f 列 (e9f9 非法)', 'e9f9' not in black_moves, f'moves={black_moves}')
    check('黑将可走入不照面的格子 (e9e8, e9d9 合法)', 'e9e8' in black_moves and 'e9d9' in black_moves)

    # 2. 红帅主动走到与黑将同一列
    b2 = list(core.initial)
    for i in core._SQUARES: b2[i] = '.'
    b2[core.parse('e0')] = 'K'
    b2[core.parse('f9')] = 'k'
    b2_str = ''.join(b2)
    red_moves = [core.render(m[0]) + core.render(m[1]) for m in core.legal_moves(b2_str, True)]
    check('红帅不可走入与黑将直接照面的 f 列 (e0f0 非法)', 'e0f0' not in red_moves, f'moves={red_moves}')

    # 3. 挡在两王之间的棋子不可横向移开
    b3 = list(core.initial)
    for i in core._SQUARES: b3[i] = '.'
    b3[core.parse('e0')] = 'K'
    b3[core.parse('e9')] = 'k'
    b3[core.parse('e4')] = 'C'
    b3_str = ''.join(b3)
    c_moves = [core.render(m[0]) + core.render(m[1]) for m in core.legal_moves(b3_str, True) if m[0] == core.parse('e4')]
    check('阻挡两王的炮不可横移让开 (如 e4d4/e4f4 非法)', all(m[2] == 'e' for m in c_moves), f'c_moves={c_moves}')
    check('阻挡两王的炮可以纵向移动 (如 e4e5 合法)', 'e4e5' in c_moves)


# --------------------------------------------------------------------------- #
# D. 认输之后悔棋
# --------------------------------------------------------------------------- #

def test_resign_undo():
    section('D. 认输之后悔棋能撤销认输')

    game = Game(engine_side=RED)
    game.push(core.legal_moves(core.initial, True)[0])          # 红走
    black_move = core.legal_moves(game.board, False)[0]
    game.push(black_move)                                       # 黑走
    check('已走两步', game.ply == 2, f'ply={game.ply}')

    game.resign(BLACK)
    check('认输后状态为 resign', game.status()['state'] == 'resign',
          f"state={game.status()['state']}")
    check('认输方是黑、胜方是红', game.status()['winner'] == RED)

    n = game.undo_round()
    check('悔棋有实际回退', n >= 1, f'回退 {n} 步')
    check('认输已被撤销', game.resigned is None)
    check('回到「还没结束」', game.status()['state'] == 'playing',
          f"state={game.status()['state']}")
    check('回到「等对手出招」', game.opponent_to_move,
          f'turn={game.turn} opponent={game.opponent_side}')

    # 一步都没走就认输的边界情况：悔棋应当只撤销认输、不报错
    g2 = Game(engine_side=RED)
    g2.resign(RED)
    n2 = g2.undo_round()
    check('零步认输后悔棋不炸', n2 == 0 and g2.resigned is None,
          f'n={n2} resigned={g2.resigned} state={g2.status()["state"]}')


# --------------------------------------------------------------------------- #
# E. 战绩结算
# --------------------------------------------------------------------------- #

def test_scoreboard():
    section('E. 累计战绩：认输计入、悔棋撤回（只走公开动词）')
    _fresh_archive('scoreboard')

    # 战绩逻辑住在 server/session.py，就从那里取，不再借道 server.app。
    #
    # 这里刻意只调公开动词（resign / undo），不碰 _settle / _unsettle：
    # 内部拆成几个私有辅助函数是这个模块的家务事，不该让这个测试变红。
    sess = GameSession()                   # 引擎执红

    check('初始战绩为零', sess.engine_stats['wins'] == 0
          and sess.engine_stats['losses'] == 0 and sess.engine_stats['draws'] == 0,
          f"wins={sess.engine_stats['wins']} losses={sess.engine_stats['losses']} "
          f"draws={sess.engine_stats['draws']}")

    # 黑方认输 -> 引擎胜
    sess.resign({'side': BLACK})
    check('黑方认输记为引擎胜', sess.engine_stats['wins'] == 1,
          f"wins={sess.engine_stats['wins']} settled={sess.game_stats.get('settled')}")

    sess.resign({'side': BLACK})
    check('对局已结束后再认输，战绩不重复记', sess.engine_stats['wins'] == 1,
          f"wins={sess.engine_stats['wins']}")

    sess.undo({})
    check('悔棋把已经记过的胜负撤回', sess.engine_stats['wins'] == 0
          and not sess.game_stats.get('settled'),
          f"wins={sess.engine_stats['wins']} settled={sess.game_stats.get('settled')}")

    # 另一半：引擎自己认输 -> 记负
    other = GameSession()                  # 同样引擎执红
    other.resign({'side': RED})
    check('引擎认输记为负', other.engine_stats['losses'] == 1
          and other.engine_stats['wins'] == 0,
          f"losses={other.engine_stats['losses']} wins={other.engine_stats['wins']}")


# --------------------------------------------------------------------------- #
# F. 主变逐步合法
# --------------------------------------------------------------------------- #

def walk_pv(label, board, red, pv):
    """把主变一步步走一遍，同时校验合法性与记谱往返。"""
    b, r = board, red
    bad = None
    for k, m in enumerate(pv, 1):
        legal = core.legal_moves(b, r)
        if m not in legal:
            bad = f'第 {k} 步 {nt.to_iccs(m)} 不合法'
            break
        text = nt.to_chinese(b, m)
        if nt.from_chinese(b, text, r, legal=legal) != m:
            bad = f'第 {k} 步 {text} 记谱往返不一致'
            break
        print(f'         {k} ok  {nt.to_iccs(m):6s} {text}')
        b = core.apply_move(b, r, m)
        r = not r
    if bad:
        print(f'         => {label}: {bad}')
    return bad is None


def test_pv(time_limit):
    section('F. 主变逐步合法 + 记谱往返（红黑两个视角）')

    ok_all = True
    for root_is_red in (True, False):
        label = '红方视角' if root_is_red else '黑方视角'
        searcher = Searcher()
        pos = core.make_position(core.initial, root_is_red)
        last = None
        print(f'  --- {label}')
        for info in searcher.search(pos, max_depth=6, time_limit=time_limit,
                                    root_is_red=root_is_red):
            last = info
        if not last or not last['pv']:
            check(f'{label} 产出了非空主变', False)
            ok_all = False
            continue
        print(f'      score={last["score"]} depth={last["depth"]} '
              f'pv={len(last["pv"])} nodes={last["nodes"]} '
              f'time={last["time"]:.2f}s nps={last["nps"]}')
        ok = walk_pv(label, core.initial, root_is_red, last['pv'])
        check(f'{label} 主变逐步合法且记谱往返一致', ok)
        ok_all = ok_all and ok
    return ok_all


# --------------------------------------------------------------------------- #
# G. 快照性能
# --------------------------------------------------------------------------- #

def test_snapshot(n=300):
    section('G. 快照性能（前端每 130ms 轮询的接口）')

    game = Game(engine_side=RED)
    rng = random.Random(3)
    for _ in range(20):
        legal = core.legal_moves(game.board, game.red_to_move)
        if not legal:
            break
        game.push(rng.choice(legal))

    t0 = time.time()
    for _ in range(n):
        snap = game.snapshot()
    dt = time.time() - t0
    per_ms = dt / n * 1000
    legal_count = len(snap['legal_moves'])
    check('快照耗时远低于轮询间隔', per_ms < 20.0,
          f'{n} 次共 {dt:.3f}s，平均 {per_ms:.2f}ms/次，'
          f'合法走法 {legal_count} 步')


# --------------------------------------------------------------------------- #
# H. 引擎接缝
# --------------------------------------------------------------------------- #

class _FakeEngine:
    """假引擎 —— 接缝是否可替换的判据。

    它不搜任何东西，直接交回一手合法着法。存在的意义不是替代真引擎，
    而是证明「引擎」这一格是可以随便塞的：调用方（以及 worker 的测试）
    不需要真的起一个搜索线程或子进程。
    """

    name = 'fake'

    def __init__(self):
        self.calls = []

    def new_game(self):
        self.calls.append('new_game')

    def search(self, req):
        self.calls.append(req)
        legal = core.legal_moves(req.board, req.red_to_move)
        move = legal[0]
        for depth in (1, 2):
            yield EngineInfo(
                depth=depth, move=move, score=0, eval_red=0,
                mate=False, nodes=depth * 10, time=0.01, nps=1000,
                pv=(move,), pv_iccs=(nt.to_iccs(move),),
            )


def _pv_legal(board, red, pv):
    """主变是否每一步都在它自己的局面里合法。安静版（不逐行打印）。"""
    b, r = board, red
    for m in pv:
        if m not in core.legal_moves(b, r):
            return False
        b = core.apply_move(b, r, m)
        r = not r
    return True


def _seam_check(label, adapter, board, red_to_move, history, time_limit,
                max_nodes=None):
    """把一个 adapter 跑一遍，验证它产出的每一层都守着接缝的约定。

    真正的判据是 ``move`` 落在**绝对坐标**的合法着法集合里：如果 adapter
    忘了按走子方翻转（或翻多了），这条立刻就红 —— 而且只在其中一个走子方下红，
    正是原来那段代码容易漏掉的情形。

    ``max_nodes`` 非空时多验两件事，因为它们都是 ``tools/arena2.py`` 那把尺子的
    地基，而尺子只看接缝这一层：预算必须是**硬上界**（超了就不是等预算对比），
    ``book`` 字段必须如实报告（丢了它，「带书的一侧赢了」和「搜索变强了」长得一样）。
    """
    req = SearchRequest(board=board, red_to_move=red_to_move,
                        move_history_iccs=tuple(history),
                        max_depth=6, time_limit=time_limit,
                        max_nodes=max_nodes, use_book=False)
    infos = list(adapter.search(req))
    if not infos:
        return check(f'{label} 产出了结果', False)

    legal = core.legal_moves(board, red_to_move)
    last = infos[-1]
    bad = []

    if last.move is None:
        bad.append('move 为空')
    elif last.move not in legal:
        bad.append(f'move={nt.to_iccs(last.move)} 不合法 —— 参考系没翻对')

    expect_red = last.score if red_to_move else -last.score
    if last.eval_red != expect_red:
        bad.append(f'eval_red={last.eval_red} 与 score={last.score} 不成红方视角')

    if len(last.pv) != len(last.pv_iccs):
        bad.append(f'pv {len(last.pv)} 步 vs pv_iccs {len(last.pv_iccs)} 步')
    else:
        for i, m in enumerate(last.pv):
            if nt.to_iccs(m) != last.pv_iccs[i]:
                bad.append(f'pv[{i}] 记谱对不上')
                break

    if last.pv and not _pv_legal(board, red_to_move, last.pv):
        bad.append('主变里有不合法的一步')

    # 单位与杀棋距离的约定也必须在这一层成立（细节见 K 段）
    if last.mate_in is not None:
        if last.mate_in < 0:
            bad.append(f'mate_in={last.mate_in} 为负 —— 方向只能靠 score 的符号')
        if abs(last.score) != MATE_CP:
            bad.append(f'杀棋层 score={last.score} 没钉在 ±MATE_CP')
    elif abs(last.score) > 2000:
        # 一车才 530cp，非杀棋层报出这个量级只能是单位又串了
        # （最典型的是把 ±(30000−n) 那种自造杀棋大数当成了子力分）。
        bad.append(f'非杀棋层 score={last.score} 超出合理 centipawn 量级')

    if last.book:
        bad.append('use_book=False 却交了开局库的手 —— 接缝没把「这步是背的还是搜的」'
                   '如实带出来')

    if max_nodes:
        # 内置的预算判在 _tick 的自增点上，是硬上界；皮卡鱼按自己的计数收手，
        # 那一下必然多花一点（实测 20 万节点超 182，0.09%），容差只给它。
        bound = (int(max_nodes) if adapter.name == 'elephantfish'
                 else int(max_nodes) + max(512, int(max_nodes) // 50))
        if last.nodes > bound:
            bad.append(f'nodes={last.nodes} 越过预算上界 {bound}（预算 {max_nodes}）')
        if last.nodes < 2:
            # 0 <= bound 恒成立，所以「把 nodes 报成 0」能骗过上面那条。这条是正控：
            # 预算限制的那次搜索必须真的发生过，上界才不是空话。
            bad.append(f'nodes={last.nodes} 小得不像发生过搜索 —— 上界形同虚设')

    return check(f'{label} 守着接缝的约定 —— {len(infos)} 层'
                 + (f'（预算 {max_nodes}，实测 {last.nodes} 节点）' if max_nodes else ''),
                 not bad, '；'.join(bad))


def test_engine_seam(time_limit):
    section('H. 引擎接缝（两个 adapter 同一套字段与参考系）')

    # 黑方走棋那个局面才是重点：内置引擎在黑方走棋时整个棋盘是转过的，
    # 接缝必须把它翻回绝对坐标，漏翻或翻多都会在其中一个走子方下露出来。
    first = core.legal_moves(core.initial, True)[0]
    board_black = core.apply_move(core.initial, True, first)
    history_black = [nt.to_iccs(first)]

    cases = [
        ('内置·红方走棋', core.initial, True, []),
        ('内置·黑方走棋', board_black, False, history_black),
    ]
    ok_all = True
    for label, board, red_to_move, history in cases:
        ok_all &= _seam_check(label, BuiltinEngine(), board, red_to_move,
                              history, time_limit)

    # 节点预算是 tools/arena2.py 那把尺子唯一的刻度，所以它必须在**接缝**这一层
    # 就有牙，而不是等 arena2 自己去信 adapter。3000 个节点：内置约 30ms（95 knps），
    # 而初始局面搜到 depth 6 的自然展开量远大于它 —— 预算比自然量小，才验得出
    # 「收手的确实是预算，不是深度先到了」。上界与正控（nodes>=2）都在 _seam_check 里。
    seam_budget = 3000
    for label, board, red_to_move, history in cases:
        ok_all &= _seam_check(f'{label}·预算{seam_budget}', BuiltinEngine(),
                              board, red_to_move, history, time_limit,
                              max_nodes=seam_budget)

    # 皮卡鱼是第二个 adapter。它没装就跳过 —— 但接缝本身不依赖它装没装。
    pikafish = PikafishAdapter(threads=1, hash_mb=16)
    if not pikafish.available:
        check('皮卡鱼 adapter（未安装二进制，跳过）', True, 'PIKAFISH_PATH 未设置')
    else:
        try:
            for label, board, red_to_move, history in cases:
                ok_all &= _seam_check(f'皮卡鱼·{label.split("·")[1]}', pikafish,
                                      board, red_to_move, history, time_limit)
                # 两侧同一个预算：内置在 _tick 里判，皮卡鱼发 go nodes。
                # 少验这一侧，「接缝对两个 adapter 行为一致」就只是一句愿望。
                ok_all &= _seam_check(f'皮卡鱼·{label.split("·")[1]}·预算{seam_budget}',
                                      pikafish, board, red_to_move, history,
                                      time_limit, max_nodes=seam_budget)
        finally:
            pikafish.engine.quit()
    return ok_all


def test_engine_replacement():
    """接缝到底可不可替换：假引擎塞进去，EngineSet 就该照着用。"""
    section('H2. 引擎接缝可替换（注入假引擎，不碰真搜索）')

    fake = _FakeEngine()
    engines = EngineSet(builtin=fake, pikafish=None)

    check('没装皮卡鱼时偏好自动降级到内置', engines.active == BUILTIN,
          f'prefer={engines.preference} active={engines.active}')
    check('choose() 交出注入的那个对象', engines.choose() is fake)

    req = SearchRequest(board=core.initial, red_to_move=True,
                        max_depth=4, time_limit=0.5)
    infos = list(engines.choose().search(req))
    legal = core.legal_moves(core.initial, True)
    check('假引擎照样产出接缝约定的结果',
          bool(infos) and infos[-1].move in legal)

    # 偏好校验只有 EngineSet 一份 —— HTTP 层不该自己再判一遍
    before = engines.preference
    accepted = engines.set_preference('nonsense')
    check('非法引擎名被拒且不改动偏好',
          accepted is False and engines.preference == before)
    engines.set_preference(PIKAFISH)
    check('偏好皮卡鱼但没装 -> 仍然降级到内置', engines.active == BUILTIN)

    engines.new_game()
    check('new_game 转达到 adapter', 'new_game' in fake.calls)
    return True


# --------------------------------------------------------------------------- #
# H3. MultiPV：根着法排名与界标
# --------------------------------------------------------------------------- #

# 教学那一层要的是「你这一手排第几、比最优差多少」，那是**一整排**根着法，
# 不是单线搜索那一个分数。排名本身好看就行，界标才是这条断言的重点：
# 对 alpha 试探失败的着法只拿到一个上界，把它当精确分报给学员就是谎报差距。
#
# 局面刻意选开局库里没有的：命中开局库时搜索压根没跑，只交回 rank 1 一条，
# 那验不出排名来（H 段的初始局面正是那种情况）。
MULTIPV_FEN = ('rnb1kabCr/4a4/7c1/p1p1p1p1p/9/9/P1P1P1P1P/1c7/4C4/R1BAKABNR '
               'w - - 0 1')

# 单线形状比对用定深、不限时：带时限的话跑到第几层看机器心情，比不出个所以然。
MULTIPV_SOLO_DEPTH = 4


def _solo_shape(info):
    """一层的「形状」：能被确定下来的那些字段。

    ``time`` / ``nps`` 里流着墙钟，两次搜索不可能一样，比对它们只会造出偶发假红。
    """
    return (info.depth, info.move, info.score, info.eval_red, info.mate,
            info.nodes, info.pv, info.pv_iccs, info.multipv, info.bound)


def _multipv_layers(infos, label, multipv, board, red_to_move, rank1_exact):
    """把一次多线搜索按 (层, 名次) 收拢，逐层验排名与界标这套形状。

    收拢而不是按到达顺序读：皮卡鱼不保证一层的多条信息挨着到齐，同一层同一
    名次也可能报两次（分数改进后再报一次）。收拢时每层每个名次留**最后一条**
    —— 那才是这一层这一名的终值。

    ``rank1_exact`` 只有内置能要求：它的渴求窗口循环只在最优分**落在窗内**时才
    收手，所以第 1 名必是全窗复搜出来的精确值。引擎在收手前那一刻报个 bound
    是完全合法的，硬要求它就是给自己造偶发假红。

    返回收拢好的 ``{层: {名次: EngineInfo}}``：断言在这里做完，调用方还想把
    最深处那一排打出来看看排名长什么样。
    """
    legal = set(core.legal_moves(board, red_to_move))
    layers = {}
    for info in infos:
        layers.setdefault(info.depth, {})[info.multipv] = info
    if not layers:
        check(f'{label} 多线搜索有产出', False, '一条都没回来')
        return layers

    bad = []
    widest = 0
    for depth, by_rank in sorted(layers.items()):
        ranks = sorted(by_rank)
        if ranks != list(range(1, len(ranks) + 1)):
            bad.append(f'第 {depth} 层名次不是 1..N：{ranks}')
            continue
        if len(ranks) > multipv:
            bad.append(f'第 {depth} 层回来 {len(ranks)} 条，比要的 {multipv} 条还多')
        widest = max(widest, len(ranks))

        seq = [by_rank[r] for r in ranks]
        for info in seq:
            tag = f'第 {depth} 层 rank {info.multipv}'
            if info.bound not in BOUND_NAMES:
                bad.append(f'{tag} 界标不在词表里：{info.bound!r}')
            if info.move is None:
                bad.append(f'{tag} 没有着法')
            elif info.move not in legal:
                bad.append(f'{tag} 的 {nt.to_iccs(info.move)} 不在合法着法里'
                           f' —— 参考系没翻对')
            expect_red = info.score if red_to_move else -info.score
            if info.eval_red != expect_red:
                bad.append(f'{tag} 的 eval_red={info.eval_red} 与 '
                           f'score={info.score} 不成红方视角')
            if info.mate and abs(info.score) < core.MATE_LOWER:
                bad.append(f'{tag} 报杀棋，分数却只有 {info.score}')
        scores = [i.score for i in seq]
        if any(b > a for a, b in zip(scores, scores[1:])):
            bad.append(f'第 {depth} 层没按分数从好到差排：{scores}')
        if rank1_exact and seq[0].bound != 'exact':
            bad.append(f'第 {depth} 层第 1 名不是精确值：{seq[0].bound}')

    check(f'{label} 每层名次 1..N、按分数排好、界标都在词表里'
          f'（{len(layers)} 层，最多 {widest} 条）', not bad,
          '；'.join(bad[:4]))
    return layers


def _multipv_run(adapter_factory, board, red_to_move, history, multipv,
                 max_depth, time_limit):
    """跑一轮搜索，把接缝交回来的每一层都收进列表。

    ``multipv`` 传 ``None`` 是**压根不写这个字段** —— 和显式写 1 必须等价，
    否则老调用点（只认得起那几个字段的）就会看见一个它没料到的形状。
    """
    fields = {} if multipv is None else {'multipv': multipv}
    req = SearchRequest(board=board, red_to_move=red_to_move,
                        move_history_iccs=tuple(history),
                        max_depth=max_depth, time_limit=time_limit, **fields)
    return list(adapter_factory().search(req))


def _print_ranking(label, layers):
    """把最深处那一排打出来 —— 排名的东西光看 ok/FAIL 看不出长什么样。"""
    if not layers:
        return
    depth = max(layers)
    line = ' | '.join(
        f'{r} {nt.to_iccs(layers[depth][r].move)} '
        f'{layers[depth][r].score:+d} {layers[depth][r].bound}'
        for r in sorted(layers[depth]))
    print(f'  {label} 第 {depth} 层：{line}')


def test_multipv(time_limit):
    section('H3. MultiPV：两个引擎的根着法排名与界标')

    board, red_to_move, _hm, _fm = nt.from_fen(MULTIPV_FEN)
    # 黑方走棋那一半才是重点：内置引擎这时整个棋盘是转过的，排名里每一条的
    # move 与主变都必须已经翻回绝对坐标 —— 排名一多，漏翻就不只错一手了。
    first = core.legal_moves(board, red_to_move)[0]
    board_black = core.apply_move(board, red_to_move, first)
    cases = [
        ('内置·红方走棋', board, red_to_move, ()),
        ('内置·黑方走棋', board_black, not red_to_move, [nt.to_iccs(first)]),
    ]

    ok_all = True
    shown = None
    for label, bd, rt, history in cases:
        infos = _multipv_run(BuiltinEngine, bd, rt, history, 4, 6, time_limit)
        layers = _multipv_layers(infos, label, 4, bd, rt, rank1_exact=True)
        # 打第一个有产出的那 case 就够了：这一段只是给人眼确认「排名真的排出来了」
        shown = shown or layers
        ok_all = ok_all and bool(layers)
    _print_ranking('内置', shown)

    # 单线不许走形：一层一条、恒 rank 1、恒 exact；写 1 与不写必须一模一样。
    # 这里定深、不限时 —— 带时限的话跑到第几层看机器心情，比不出个所以然。
    explicit = _multipv_run(BuiltinEngine, board, red_to_move, (), 1,
                            MULTIPV_SOLO_DEPTH, None)
    absent = _multipv_run(BuiltinEngine, board, red_to_move, (), None,
                          MULTIPV_SOLO_DEPTH, None)
    check('内置 multipv=1 时一层一条、恒 rank 1 恒 exact',
          bool(explicit)
          and [i.depth for i in explicit] == list(range(1, len(explicit) + 1))
          and all(i.multipv == 1 and i.bound == 'exact' for i in explicit),
          f'{len(explicit)} 条，层号 {[i.depth for i in explicit]}')
    check('内置写 multipv=1 与不写这个字段的输出逐字段相同',
          bool(explicit)
          and [_solo_shape(i) for i in explicit]
          == [_solo_shape(i) for i in absent])

    # 皮卡鱼：第二个 adapter。没装二进制就跳过 —— 与 H 段同一个做法。
    pikafish = PikafishAdapter(threads=1, hash_mb=16)
    if not pikafish.available:
        check('皮卡鱼多线 adapter（未安装二进制，跳过）', True,
              'PIKAFISH_PATH 未设置')
        return ok_all
    _label, bd, rt, history = cases[0]
    try:
        infos = _multipv_run(lambda: pikafish, bd, rt, history, 4, 20,
                             min(time_limit, 1.5))
        layers = _multipv_layers(infos, '皮卡鱼·红方走棋', 4, bd, rt,
                                 rank1_exact=False)
    finally:
        pikafish.engine.quit()
    ok_all = ok_all and bool(layers)
    _print_ranking('皮卡鱼', layers)
    return ok_all


# --------------------------------------------------------------------------- #
# I. 会话并发
# --------------------------------------------------------------------------- #

class _GatedEngine:
    """听得懂「先别动」的假引擎。

    每次 ``search()`` 都现开一对闸门：``started`` 立刻开（等于说「我进来了」），
    ``release`` 交给测试来开。竞态全部发生在「引擎算完了」到「那步棋落到盘上」
    之间，这对闸门正好把测试停在那个窗口里 —— 不需要 sleep 碰运气。
    """

    name = 'gated'

    def __init__(self, move_iccs=None):
        self.move_iccs = move_iccs
        self.gates = []

    def new_game(self):
        pass

    def search(self, req):
        started, release = threading.Event(), threading.Event()
        self.gates.append((started, release))
        started.set()
        release.wait(timeout=10)

        if self.move_iccs:
            move = nt.from_iccs(self.move_iccs)
        else:
            move = core.legal_moves(req.board, req.red_to_move)[0]
        yield EngineInfo(
            depth=3, move=move, score=9,
            eval_red=9 if req.red_to_move else -9,
            mate=False, nodes=1234, time=0.05, nps=24680,
            pv=(move,), pv_iccs=(nt.to_iccs(move),),
        )


def _gated_session(move_iccs=None):
    """一个装上了假引擎的会话 —— 不碰真搜索，也不碰子进程。"""
    fake = _GatedEngine(move_iccs)
    return GameSession(engines=EngineSet(builtin=fake, pikafish=None)), fake


def _release_after(fake, index):
    """等第 index 次搜索真的进了 search()，返回它那扇放行闸门。"""
    deadline = time.time() + 5
    while len(fake.gates) <= index and time.time() < deadline:
        time.sleep(0.005)
    if len(fake.gates) <= index:
        raise AssertionError(f'第 {index + 1} 次搜索没起来')
    fake.gates[index][0].wait(timeout=5)
    return fake.gates[index][1]


def test_session_races():
    section('I. 搜索在飞的时候换局 / 认输 —— 那一步不该落地')
    _fresh_archive('races')

    # ---- 换局：新旧局面一模一样 ----
    #
    # 这是「比对棋盘串」拦不住的那种情形。引擎执红、新开一局、执子方不变，
    # 于是棋盘串与走子方**完全相同**。旧 worker 拿它一比：通过，然后把一手
    # 棋落到新对局上。只有局面代数能认出「对象被换掉了」。
    sess, fake = _gated_session()
    sess.new_game({'engine_side': 'red'})
    task1 = sess.task
    release1 = _release_after(fake, 0)

    sess.new_game({'engine_side': 'red'})
    task2 = sess.task
    check('换局后换了一个新任务', task2 is not None and task2.id != task1.id,
          f'{task1.id} -> {task2 and task2.id}')

    # 单飞闸门：内置全场共用一个 Searcher，皮卡鱼只有一个进程，同一时刻只容得下
    # 一条搜索。所以第二条**不是同时在飞**，而是等第一条收手才起 —— 假引擎不理
    # stop（它卡在闸门上，压根没到检查停表的那一步），只能由测试把它放行。
    release1.set()
    task1.thread.join(timeout=5)
    check('旧搜索的结果被丢弃（没往新对局上落子）',
          (task1.result or {}).get('status') == 'discarded',
          f'result={task1.result} error={task1.error}')
    check('旧那手没借着换局落进新对局（新搜索这时才起）',
          len(sess.game.records) == 0, f'{len(sess.game.records)} 手')

    release2 = _release_after(fake, 1)
    release2.set()
    task2.thread.join(timeout=5)
    check('新搜索正常落子', (task2.result or {}).get('status') == 'ok',
          f'result={task2.result} error={task2.error}')
    check('盘上只有一手 —— 旧 worker 那手没混进来',
          len(sess.game.records) == 1, f'{len(sess.game.records)} 手')

    # ---- 认输：局面根本没变 ----
    #
    # 认输不改棋盘、不改走子方，所以「棋盘比对」同样拦不住，它会照常往一个
    # 已经结束的对局里推一步。必须连同 is_over() 一起查。
    sess2, fake2 = _gated_session()
    sess2.new_game({'engine_side': 'red'})
    task = sess2.task
    release = _release_after(fake2, 0)

    sess2.resign({'side': 'red'})
    release.set()
    task.thread.join(timeout=5)

    check('认输后引擎那一步被丢弃（不往已结束的对局里推棋）',
          (task.result or {}).get('status') == 'discarded',
          f'result={task.result} error={task.error}')
    check('认输之后盘上一步都没有', len(sess2.game.records) == 0,
          f'{len(sess2.game.records)} 手')
    check('认输照样记了负', sess2.engine_stats['losses'] == 1,
          f"losses={sess2.engine_stats['losses']}")

    # ---- 排队：引擎算棋时录进来的对方走法 ----
    #
    # auto_reply=False，只留引擎先手那一次搜索 —— 否则排队那步落地后会再
    # 触发一次搜索，测试里就多出一个没人放行的线程。
    sess3, fake3 = _gated_session(move_iccs='h2e2')      # 引擎执红，炮二平五
    sess3.new_game({'engine_side': 'red', 'auto_reply': False})
    task = sess3.task
    release = _release_after(fake3, 0)

    after_engine = core.apply_move(core.initial, True, nt.from_iccs('h2e2'))
    black_move = nt.to_iccs(core.legal_moves(after_engine, False)[0])
    queued = sess3.submit_move({'move': black_move})
    check('引擎在算棋时录入走法 -> 排队，不报错',
          queued.body.get('queued') is True,
          f"queued={queued.body.get('queued')} msg={queued.body.get('message')}")

    release.set()
    task.thread.join(timeout=5)
    check('引擎收手后排队那一步立刻落地',
          len(sess3.game.records) == 2, f'{len(sess3.game.records)} 手')
    if len(sess3.game.records) == 2:
        check('落地的那一步正是排队的那一步',
              sess3.game.records[1]['iccs'] == black_move,
              f"{sess3.game.records[1]['iccs']} vs {black_move}")

    return True


def test_opponent_poll_not_under_lock():
    section('I2. 拉对手走法时发请求不持锁（否则一次超时堵住整个服务）')

    sess, _ = _gated_session()
    sess.configure_opponent({'url': 'http://opponent.invalid/move'})

    # 把那次出站请求替换成「进去就卡住」，于是测试可以稳稳地停在 I/O 中间。
    # 真正的判据不是这个替换，而是卡住的那段时间里 snapshot() 还回不回得来。
    entered, gate = threading.Event(), threading.Event()

    class _Resp:
        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

        def read(self):
            return b'{"move": "h2e2"}'

    original = session_mod.urllib.request.urlopen

    def blocked_urlopen(req, timeout=None):
        entered.set()
        gate.wait(timeout=5)
        return _Resp()

    box = {}

    def call_poll():
        try:
            box['reply'] = sess.poll_opponent({})
        except Exception as exc:                          # noqa: BLE001
            box['error'] = exc

    session_mod.urllib.request.urlopen = blocked_urlopen
    try:
        poller = threading.Thread(target=call_poll, daemon=True)
        poller.start()
        entered.wait(timeout=5)

        t0 = time.time()
        sess.snapshot()
        dt = time.time() - t0

        gate.set()
        poller.join(timeout=5)
    finally:
        session_mod.urllib.request.urlopen = original

    check('出站请求卡住时，别的请求照常进得来（I/O 在锁外）',
          dt < 0.3, f'snapshot 耗时 {dt * 1000:.0f}ms')
    reply = box.get('reply')
    check('卡住的那次拉取最终仍然把走法录了进来',
          reply is not None and reply.body.get('ok') is True
          and len(sess.game.records) == 1,
          f"ok={reply and reply.body.get('ok')} err={box.get('error')} "
          f"ply={len(sess.game.records)}")
    return True


# --------------------------------------------------------------------------- #
# J. 从「非初始局面」开局：引擎必须能连续出招
# --------------------------------------------------------------------------- #

def _wait_task(sess, limit=20.0):
    t0 = time.time()
    while time.time() - t0 < limit:
        snap = sess.snapshot()
        task = snap['task']
        if task is None or task['status'] != 'running':
            return snap
        time.sleep(0.03)
    return sess.snapshot()


def test_score_unit():
    """K. 分数单位与杀棋距离：两个引擎必须被折算成**同一把尺**。

    回归的是一个已经发生过的真实错读：接缝把内置引擎的分（一兵 44）和
    皮卡鱼的分（UCI 惯例 centipawn，一兵 100）原样混进同一个字段，而前端
    只会拿一个固定除数去除、并拿一个固定阈值判杀。于是皮卡鱼报「红方让一车
    多」的 1304 分被念成「红方 1197 步杀」，真杀棋（皮卡鱼给的
    ±(30000−n)）又一律被兜底成「1 步杀」，距离全丢。

    这些断言不看界面、不需要引擎进程，直接把 ``_normalize`` 当纯函数问：
    「给你这个原始分，你往外报什么」。
    """
    section('K. 分数单位：接缝只说 centipawn，杀棋距离走 mate_in')

    # ---- 内置引擎：一兵 44，必须被换算成一兵 100 -------------------- #
    one_pawn = _normalize({'depth': 5, 'move': None, 'score': core.piece['P'],
                           'mate_in': None}, True, flip_move=False,
                          pawn_value=BUILTIN_PAWN)
    check('内置的一兵(44) 出去是 100cp', one_pawn.score == CP_PAWN,
          f'score={one_pawn.score}')
    one_rook = _normalize({'depth': 5, 'move': None, 'score': core.piece['R'],
                           'mate_in': None}, True, flip_move=False,
                          pawn_value=BUILTIN_PAWN)
    check('内置的一车(233) 出去约 530cp', one_rook.score == 530,
          f'score={one_rook.score}')
    check('子力优势不被判成杀棋', one_rook.mate_in is None and not one_rook.mate)

    # ---- 皮卡鱼：本来就是 centipawn，不许再被除一次 ------------------ #
    pf_pawn = _normalize({'depth': 20, 'move': None, 'score': 100,
                          'mate_in': None}, True, flip_move=False,
                         pawn_value=CP_PAWN)
    check('皮卡鱼的一兵(100cp) 原样通过', pf_pawn.score == 100,
          f'score={pf_pawn.score}')
    # 这一条就是那个错读的正面写照：1304 在 cp 里只是「多一车多」，不是杀棋。
    pf_big = _normalize({'depth': 20, 'move': None, 'score': 1304,
                         'mate_in': None}, True, flip_move=False,
                        pawn_value=CP_PAWN)
    check('皮卡鱼的 1304cp 不被误判成杀棋',
          pf_big.mate_in is None and not pf_big.mate,
          f'mate_in={pf_big.mate_in} mate={pf_big.mate}')

    # ---- 杀棋距离：内置的 ±(MATE_UPPER − ply) 换算成「步」 ----------- #
    check('杀在 ply=1 是 1 步', _mate_in(core.MATE_UPPER - 1) == 1,
          f'{_mate_in(core.MATE_UPPER - 1)}')
    check('杀在 ply=2（对手一步杀我）也是 1 步',
          _mate_in(-(core.MATE_UPPER - 2)) == 1)
    check('杀在 ply=3 是 2 步', _mate_in(core.MATE_UPPER - 3) == 2)
    check('已经被杀死是 0 步', _mate_in(-core.MATE_UPPER) == 0)
    check('普通子力分不给 mate_in', _mate_in(300) is None)

    # ---- 杀棋时分数退化成方向，距离归距离，两边不许互相冒充 ---------- #
    pf_mate = _normalize({'depth': 20, 'move': None, 'score': 0,
                          'mate_in': 3, 'mate_sign': -1}, False,
                         flip_move=False, pawn_value=CP_PAWN)
    check('mate_sign 决定方向：走子方(黑)被杀 -> score 为负',
          pf_mate.score == -MATE_CP, f'score={pf_mate.score}')
    check('杀棋层照样要成红方视角（黑走子时反号）',
          pf_mate.eval_red == MATE_CP, f'eval_red={pf_mate.eval_red}')
    check('距离原样带出，不再被折进分数里', pf_mate.mate_in == 3)
    check('mate_in 永远非负（方向只在符号里）', pf_mate.mate_in >= 0)

    bi_mate = _normalize({'depth': 12, 'move': None,
                          'score': core.MATE_UPPER - 1,
                          'mate_in': _mate_in(core.MATE_UPPER - 1)},
                         True, flip_move=False, pawn_value=BUILTIN_PAWN)
    check('内置的一步杀也是同一个约定',
          bi_mate.score == MATE_CP and bi_mate.mate_in == 1 and bi_mate.mate,
          f'score={bi_mate.score} mate_in={bi_mate.mate_in}')

    # ---- 开局库那一层以前被丢掉，界面分不清「背的」和「算的」 --------- #
    book = _normalize({'depth': 1, 'move': None, 'score': 20,
                       'mate_in': None, 'book': True}, True,
                      flip_move=False, pawn_value=BUILTIN_PAWN)
    check('book 标志透传出来了', book.book, f'book={book.book}')


def test_start_fen_roundtrip():
    """摆棋（载入 FEN）开局的棋，引擎第二手必须还能出招。

    回归的是一个真实事故：``Game`` 从来没保存过 ``start_fen``，于是
    ``SearchRequest.start_fen`` 永远是 None，皮卡鱼只能退回
    ``position startpos moves ...`` 重放棋谱。从初始局面开局时这刚好是对的，
    一旦是摆棋/残局开局，重放的着法在 startpos 下非法 —— 皮卡鱼 exit(1)，
    之后每一次写管道都是 Errno 22，整局再也不出招。
    （现象：排完棋盘 → 引擎走一步 → 转述人录入一步 → 引擎不走了）
    """
    section('J. 摆棋开局（非初始局面）：引擎能连续出招')

    initial_fen = nt.to_fen(core.initial, True)
    g = Game()
    check('Game 记住了起始局面', getattr(g, 'start_fen', None) == initial_fen,
          repr(getattr(g, 'start_fen', None)))

    # 造一个真正的残局
    g2 = Game()
    for _ in range(6):
        legal = g2.legal_moves()
        if not legal:
            break
        g2.push(legal[0])
    mid_fen = nt.to_fen(g2.board, g2.red_to_move)
    g3 = Game()
    g3.load_fen(mid_fen)
    check('载入 FEN 后起始局面跟着更新', g3.start_fen == mid_fen, g3.start_fen)
    check('残局 FEN 与初始局面不同', mid_fen != initial_fen, mid_fen)

    engines = default_engines(prefer=PIKAFISH, threads=1, hash_mb=32)
    if not engines.available(PIKAFISH):
        print('  [skip] 皮卡鱼不可用，只验了 start_fen 的传递')
        return True

    sess = GameSession(engines=engines, settings={
        'max_depth': 8, 'think_ms': 300, 'auto_reply': True,
        'threads': 1, 'hash_mb': 32,
    })
    sess.load({'fen': mid_fen, 'engine_side': RED})
    snap = _wait_task(sess)
    check('残局开局后引擎走出了第一步',
          snap['game']['ply'] == 1 and snap['task']['status'] == 'done',
          f"ply={snap['game']['ply']} task={snap['task']['status']}")

    legal = sess.game.legal_moves()
    first = nt.to_iccs(legal[0])
    resp = sess.submit_move({'move': first})
    check('转述人录入后引擎应手被触发', bool(resp.body.get('auto_task')),
          f"auto_task={resp.body.get('auto_task')}")
    snap = _wait_task(sess)
    task = snap['task']
    check('引擎第二手成功落子（进程没被打死）',
          task['status'] == 'done' and snap['game']['ply'] == 3,
          f"status={task['status']} err={task['error']} ply={snap['game']['ply']}")

    third = nt.to_iccs(sess.game.legal_moves()[0])
    resp = sess.submit_move({'move': third})
    snap = _wait_task(sess)
    check('第三手照样能出招（连续两轮）',
          snap['task']['status'] == 'done' and snap['game']['ply'] == 5,
          f"status={snap['task']['status']} ply={snap['game']['ply']}")

    # 引擎进程必须还活着，不能靠「崩了就崩了」通过
    pf = engines.pikafish.engine
    alive = pf.proc is not None and pf.proc.poll() is None
    check('三轮过后引擎进程仍存活', alive,
          'code=%s' % (pf.proc.poll() if pf.proc else None))
    return True


# --------------------------------------------------------------------------- #
# L. 存档：投影必须逐字段等于实况
# --------------------------------------------------------------------------- #

# 这一段盯的形状不是「库里有没有写过」，而是**每个状态变更动词跑完之后，把这一局
# 的 plies 整张读回来，与 game.records 逐字段比**。投影式存档只有这种断言才配叫
# 「对不上就会红」—— 它同时就是牙齿，把 ``server/session.py`` 里对应那条 sync_game
# 删掉，括号里那条立刻红：
#
#   ``_apply_move_locked``  → 「录入 6 手，每一手之后逐字段相同」
#   worker 里那条            → 「引擎替黑落的那一手进了库」
#   ``undo``                → 「悔两步之后库里那两行真的没了」
#   ``resign``              → 「认输把结果写进 games」
#   ``load``                → 「排局另发身份证、标成 setup」
#   ``new_game``            → 「新开一局就在库里建了档」
#   ``clear_stats``         → 「清账也会写进库」
#
# 用真引擎但把深度压到 5、时限 800ms：这一段的主题是「写进去的东西对不对」，
# 不是引擎强弱。

_PLY_FIELDS = (
    ('ply', 'ply'), ('side', 'side'), ('by', 'by'), ('iccs', 'iccs'),
    ('chinese', 'chinese'), ('piece', 'piece'), ('captured', 'captured'),
    ('check', 'gives_check'), ('mate', 'mate'), ('eval', 'eval_red'),
    ('mate_in', 'mate_in'), ('depth', 'depth'), ('time', 'think_time'),
    ('review', 'review'),
)


def _open_reader(path):
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    return conn


def _archive_diff(conn, sess):
    """库里这一局 vs 实况。返回不一致的说明；空列表就是逐字段相同。"""
    game = sess.game
    out = []
    rows = conn.execute('SELECT * FROM plies WHERE game_id=? ORDER BY ply',
                        (sess.game_id,)).fetchall()
    if len(rows) != len(game.records):
        out.append(f'库里 {len(rows)} 手，实况 {len(game.records)} 手')
    for i, (rec, row) in enumerate(zip(game.records, rows)):
        for src, col in _PLY_FIELDS:
            want = rec.get(src) if src == 'review' else rec[src]
            got = row[col]
            if col in ('gives_check', 'mate'):
                want = 1 if want else 0
            elif col == 'review':
                # 判分整份存成 JSON 文本。比之前先过一遍**同一个**序列化函数，
                # 否则「键顺序不同」这种假差异会抢在真差异前面报出来。
                want = dump_review(want)
            if want != got:
                out.append(f'第 {rec["ply"]} 手 {col}：库里 {got!r} ≠ 实况 {want!r}')
                break
        want_fen = nt.to_fen(game.boards[i], game.sides[i])
        if row['fen_before'] != want_fen:
            out.append(f'第 {rec["ply"]} 手 fen_before 不是「走这一步面对的局面」')

    head = conn.execute('SELECT * FROM games WHERE game_id=?',
                        (sess.game_id,)).fetchone()
    if head is None:
        return out + ['games 里没有这一局']
    status = game.status()
    for col, want in (
            ('start_fen', game.start_fen),
            ('engine_side', game.engine_side),
            ('source', sess.game_source),
            ('ply_count', len(game.records)),
            ('fen_now', nt.to_fen(game.board, game.red_to_move)),
            ('state', status['state']),
            ('winner', status['winner']),
            ('reason', status['reason']),
            ('outcome', sess.game_stats.get('settled'))):
        if head[col] != want:
            out.append(f'games.{col}：库里 {head[col]!r} ≠ 实况 {want!r}')
    return out


def _replay(conn, game_id):
    """光靠存档把局面重放出来：start_fen + 有序 ICCS 就是全部真值。"""
    head = conn.execute('SELECT start_fen FROM games WHERE game_id=?',
                        (game_id,)).fetchone()
    board, red, _h, _m = nt.from_fen(head['start_fen'])
    for row in conn.execute('SELECT iccs FROM plies WHERE game_id=? ORDER BY ply',
                            (game_id,)):
        board = core.apply_move(board, red, nt.from_iccs(row['iccs']))
        red = not red
    return board, red


def test_archive():
    section('L. 存档：每个动词跑完，库里就是实况')

    path = os.path.join(_ARCHIVE_DIR, 'L.sqlite')
    store = Store(path)
    conn = _open_reader(path)
    settings = {**session_mod.DEFAULT_SETTINGS, 'auto_reply': False}
    sess = GameSession(settings=settings, store=store)

    bad = []
    for n in range(6):
        sess.submit_move({'move': nt.to_iccs(sess.game.legal_moves()[0])})
        bad += [f'第 {n + 1} 手之后：{d}' for d in _archive_diff(conn, sess)]
    check('录入 6 手，每一手之后库与实况逐字段相同', not bad, '；'.join(bad[:3]))

    sess.undo({'round': False, 'plies': 2})
    bad3 = _archive_diff(conn, sess)
    check('悔两步之后库里那两行真的没了（不是留在库里差一行）',
          not bad3 and len(sess.game.records) == 4,
          f"实况 {len(sess.game.records)} 手；{'；'.join(bad3[:2])}")

    sess.resign({'side': BLACK})
    bad4 = _archive_diff(conn, sess)
    outcome = conn.execute('SELECT outcome FROM games WHERE game_id=?',
                           (sess.game_id,)).fetchone()['outcome']
    check('认输把结果写进 games（棋谱没变，变的正是学习要用的那一半）',
          not bad4 and outcome == 'wins',
          f'outcome={outcome}；{"；".join(bad4[:2])}')

    # 引擎那一手不经过任何公开动词（worker 里直接 push），是最容易漏的一个写入点。
    # 整段只用**一个**会话：engine_stats 是「这个进程的累计账」，两个会话各自
    # 投影一份的话，后写的那一份会把先写的盖掉 —— 生产上只有一个会话，所以
    # 那不是被测的行为，别把它当成期望写进断言里。
    sess.new_game({'engine_side': BLACK, 'auto_reply': True,
                   'think_ms': 800, 'max_depth': 5})
    # 立刻读一次库，别让后面那手棋把这条盖过去：「新开一局就建档」本身就是
    # 要验的 —— 只下一手就关页面的话，那一局在库里根本不该是空的。
    bad_new = _archive_diff(conn, sess)
    head = conn.execute('SELECT ply_count, source FROM games WHERE game_id=?',
                        (sess.game_id,)).fetchone()
    check('新开一局就在库里建了档（哪怕一步没走）',
          head is not None and head['ply_count'] == 0
          and head['source'] == 'play' and not bad_new,
          f"head={tuple(head) if head else None}；{'；'.join(bad_new[:2])}")

    sess.submit_move({'move': nt.to_iccs(sess.game.legal_moves()[0])})
    snap = _wait_task(sess)
    bad2 = _archive_diff(conn, sess)
    by_engine = [r for r in sess.game.records if r['by'] == 'engine']
    check('引擎替黑落的那一手进了库（worker 里那条 sync）',
          snap['game']['ply'] == 2 and len(by_engine) == 1 and not bad2,
          f"ply={snap['game']['ply']} 引擎手={len(by_engine)} "
          f"差异：{'；'.join(bad2[:3]) or '无'}")

    board, red = _replay(conn, sess.game_id)
    check('光靠存档能重放出当前局面（start_fen + 有序 ICCS 就是真值）',
          board == sess.game.board and red == sess.game.red_to_move,
          f"重放 {len(sess.game.records)} 手后 "
          f"{'对得上' if board == sess.game.board else '对不上'}")

    # 排局/补棋摆出来的那局必须是另一局：旧局整局留在库里，新局另起一行。
    old_id = sess.game_id
    old_plies = conn.execute('SELECT COUNT(*) FROM plies WHERE game_id=?',
                             (old_id,)).fetchone()[0]
    sess.load({'fen': '4k4/9/9/9/9/9/9/9/8K/R8 w - - 0 1', 'engine_side': BLACK})
    still = conn.execute('SELECT COUNT(*) FROM plies WHERE game_id=?',
                         (old_id,)).fetchone()[0]
    bad5 = _archive_diff(conn, sess)
    check('排局另发身份证、标成 setup、旧局一格不动',
          sess.game_id != old_id and still == old_plies and not bad5,
          f'旧局 {old_plies} 手 → 现在 {still} 手；{"；".join(bad5[:2])}')

    total = conn.execute('SELECT COUNT(*) FROM plies').fetchone()[0]
    summed = conn.execute('SELECT SUM(ply_count) FROM games').fetchone()[0] or 0
    check('plies 的总行数与 games.ply_count 合计对得上（没有孤儿、没有残留）',
          total == summed, f'{total} 行 vs 合计 {summed}')

    # 重启之后那本累计账还在：这才是「利用每一局」能被看见的那一半。
    again = GameSession(engines=EngineSet(BuiltinEngine(), None, BUILTIN),
                        settings=settings, store=store)
    check('新开一个会话会把累计账读回来（重启不清账）',
          again.engine_stats['wins'] == 1 and again.engine_stats['moves'] >= 1,
          f"wins={again.engine_stats['wins']} moves={again.engine_stats['moves']}")

    again.clear_stats({})
    after = GameSession(engines=EngineSet(BuiltinEngine(), None, BUILTIN),
                        settings=settings, store=store)
    check('清账也会写进库（不然重启之后被清掉的数字又自己长回来）',
          after.engine_stats['moves'] == 0
          and after.engine_stats['nodes'] == 0
          and after.engine_stats['wins'] == 1,
          str(after.engine_stats))

    store.close()

    # ---- 关掉存档与写失败：两种都不许把下棋弄停摆 ------------------------ #

    off = GameSession(engines=EngineSet(BuiltinEngine(), None, BUILTIN),
                      settings=settings, store=Store(None))
    resp = off.submit_move({'move': nt.to_iccs(off.game.legal_moves()[0])})
    check('EF_STORE=off 时棋照样下（存档不许成为下棋的依赖）',
          resp.body['ok'] and off.game.ply == 1 and off.store.errors == 0,
          f"ok={resp.body['ok']} ply={off.game.ply}")

    break_path = os.path.join(_ARCHIVE_DIR, 'L-break.sqlite')
    broken = Store(break_path)
    sess3 = GameSession(engines=EngineSet(BuiltinEngine(), None, BUILTIN),
                        settings=settings, store=broken)
    sess3.submit_move({'move': nt.to_iccs(sess3.game.legal_moves()[0])})
    errors_before = broken.errors
    with broken._lock:
        broken._conn.execute('DROP TABLE plies')
        broken._conn.commit()
    # 吞异常是为了不停摆，但**不许沉默**：这一条把 stderr 收进 buffer，
    # 既让自检输出里不冒出一段看着像崩了的 traceback，也顺便验它真的喊过。
    noise = io.StringIO()
    with contextlib.redirect_stderr(noise):
        resp = sess3.submit_move({'move': nt.to_iccs(sess3.game.legal_moves()[0])})
    check('写库存不下来时棋照下，但必须留下计数（不许悄悄停摆）',
          resp.body['ok'] and sess3.game.ply == 2
          and broken.errors == errors_before + 1
          and 'no such table: plies' in noise.getvalue(),
          f"ok={resp.body['ok']} ply={sess3.game.ply} errors={broken.errors}")
    broken.close()


# --------------------------------------------------------------------------- #
# L2. 判分：人走的每一步对着同一个局面的排名线打分
# --------------------------------------------------------------------------- #

def _ranked(rank, iccs, score, *, eval_red=None, bound='exact', mate_in=None,
            depth=8, nodes=1000, pv_len=0):
    """一条排名线（就是 ``_line_record`` 交出去的那个形状）。

    编出来而不是搜出来：界标、名次、掉出前三、杀棋这几种情形，真引擎什么时候
    给出哪一种全看搜索走到第几层，断言里就写不成常数。
    """
    return {
        'rank': rank, 'iccs': iccs, 'chinese': '',
        'score': score,
        'eval_red': score if eval_red is None else eval_red,
        'mate': mate_in is not None, 'mate_in': mate_in, 'bound': bound,
        'depth': depth, 'nodes': nodes, 'time': 0.2,
        'pv': [{'iccs': f'x{i}', 'chinese': f'第{i}步'} for i in range(pv_len)],
    }


class _RankingEngine(_FakeEngine):
    """一次交回一整排根着法的假引擎：判分那一路只吃这个形状，不碰真搜索。

    分数按名次递减（第 1 名 100 减层数，每掉一名少 40），所以「排第 2、差 40 兵」
    是能写死的常数。``layers`` 收尾那一层就是判分读到的那一批。
    """

    def __init__(self, layers=2):
        super().__init__()
        self.layers = layers

    def search(self, req):
        self.calls.append(req)
        legal = core.legal_moves(req.board, req.red_to_move)
        width = max(1, min(int(req.multipv or 1), len(legal)))
        for depth in range(1, self.layers + 1):
            for rank in range(1, width + 1):
                mv = legal[rank - 1]
                score = 100 - (rank - 1) * 40 - depth
                yield EngineInfo(
                    depth=depth, move=mv, score=score,
                    eval_red=score if req.red_to_move else -score,
                    mate=False, nodes=depth * 100 + rank,
                    time=0.01 * depth, nps=10000,
                    pv=(mv,), pv_iccs=(nt.to_iccs(mv),),
                    multipv=rank, bound='exact')


def _grading_session(store=None, engine_side=BLACK, **over):
    """一个「人执红、判分开着、引擎不替人落子」的会话 + 那台假引擎。

    默认 ``engine_side=BLACK``：判分只在轮到人的时候开场，这一段的每条断言
    都从「现在轮到红」起步才有意义。
    """
    fake = _RankingEngine()
    settings = {**session_mod.DEFAULT_SETTINGS, 'auto_reply': False,
                'analyze': True, 'analyze_width': 3, 'analyze_ms': 300,
                'analyze_depth': 4, **over}
    sess = GameSession(engines=EngineSet(builtin=fake, pikafish=None),
                       settings=settings,
                       store=store if store is not None else Store(None))
    sess.new_game({'engine_side': engine_side})
    return sess, fake


def _wait_analysis(sess, limit=3.0):
    """等判分这一路收手（done / error / skipped），别让它跟断言赛跑。"""
    t0 = time.time()
    while time.time() - t0 < limit:
        a = sess.snapshot()['analysis']
        if a and a['status'] in ('done', 'error', 'skipped'):
            return a
        time.sleep(0.02)
    return sess.snapshot()['analysis']


def _quiet_pv(board, red_to_move, n):
    """一条前 ``n`` 手都不吃子的「主变」，形状与 ``pv_detail`` 交回的完全一致。

    「这条线没吃到子」是这份事实里最难证的一种说法 —— 拿真走法逐手挑第一个不吃子的
    着法，才能肯定这个窗口是**走满的**而里面确实一手都没吃到，而不是我少给了几步。
    """
    out, b, red = [], board, red_to_move
    for _ in range(n):
        m = next((mv for mv in core.legal_moves(b, red) if b[mv[1]] == '.'), None)
        if m is None:
            break
        out.append({'iccs': nt.to_iccs(m), 'chinese': nt.to_chinese(b, m)})
        b = core.apply_move(b, red, m)
        red = not red
    return out


def test_grading():
    section('L2. 判分：人这一步排第几、差多少，只认同一个局面的排名线')

    # ---- grade_move 是纯函数：编一批排名线就能逐条问 ---------------------- #

    check('没有排名线就是「没判」，不是一份全 null 的判分',
          session_mod.grade_move('a0a1', []) is None)

    lines = [_ranked(1, 'b0c2', 98, pv_len=10),
             _ranked(2, 'h0g2', 58),
             _ranked(3, 'b2e2', 18)]
    r = session_mod.grade_move('h0g2', lines)
    check('两条线都是精确值：排第 2、比最优差 40 兵',
          r['status'] == 'ok' and r['rank'] == 2 and r['loss'] == 40
          and r['loss_kind'] == 'exact' and r['width'] == 3
          and r['best_iccs'] == 'b0c2', str(r)[:200])
    check('判分里的主变只留讲解用得到的头几步（投影不许每手重写几十 KB）',
          len(r['lines'][0]['pv']) == session_mod.REVIEW_PV_PLIES)
    check('depth / nodes 取这批线里最深、最大的那一条',
          r['depth'] == 8 and r['nodes'] == 1000, f"{r['depth']} {r['nodes']}")

    # 黑方的失误用红方视角相减会算成红方的进步 —— 那不是精度问题，是符号错，
    # 念到学员耳朵里就是「好棋」和「漏着」整批互换。
    rb = session_mod.grade_move('h9g7', [_ranked(1, 'a9b9', -50, eval_red=50),
                                        _ranked(2, 'h9g7', -90, eval_red=90)])
    check('黑方亏 40 兵：差值算在走子方视角上，红方视角只用来显示',
          rb['loss'] == 40 and rb['played_eval_red'] == 90, str(rb)[:200])

    # 内置引擎对 alpha 试探失败的根着法交回的是上界，同分时 loss 会正好是 0。
    # 「差 0 兵」在这台引擎上几乎总是假的，所以这个词不许出现在判分里。
    b1 = session_mod.grade_move('h0g2', [_ranked(1, 'b0c2', 11),
                                        _ranked(2, 'h0g2', 11,
                                                bound='upperbound')])
    check('同分而第 2 名只是上界：说成「至少」而不是「差 0 兵」',
          b1['loss'] == 0 and b1['loss_kind'] == 'at_least', str(b1)[:200])
    b2 = session_mod.grade_move('h0g2', [_ranked(1, 'b0c2', 20, bound='upperbound'),
                                        _ranked(2, 'h0g2', 10)])
    check('最优那手只是上界：差值只能讲成「至多」',
          b2['loss'] == 10 and b2['loss_kind'] == 'at_most', str(b2)[:200])
    b3 = session_mod.grade_move('h0g2', [_ranked(1, 'b0c2', 20, bound='lowerbound'),
                                        _ranked(2, 'h0g2', 10,
                                                bound='lowerbound')])
    check('两边都是下界：证不出方向，只能给名次，不给数',
          b3['loss_kind'] == 'uncertain', str(b3)[:200])

    mate = session_mod.grade_move('h0g2', [_ranked(1, 'b0c2', MATE_CP, mate_in=3),
                                          _ranked(2, 'h0g2', MATE_CP, mate_in=5)])
    check('有一条是杀棋就不做 centipawn 减法：距离读 mate_in',
          mate['loss'] is None and mate['loss_kind'] == 'mate'
          and mate['played_mate_in'] == 5, str(mate)[:200])

    out = session_mod.grade_move('i0h0', lines)
    check('掉出前三是「不知道差多少」，不是「差很多」，也不是 0',
          out['status'] == 'outside' and out['rank'] is None
          and out['loss'] is None and out['loss_kind'] == 'below_top'
          and out['best_iccs'] == 'b0c2', str(out)[:200])

    kinds = {x['loss_kind'] for x in (r, rb, b1, b2, b3, mate, out)}
    check('判分给出的差值可信程度都在这套词表里',
          kinds <= set(session_mod.LOSS_KINDS), str(sorted(kinds)))

    # ---- 主变里出现棋盘上没有的棋：截断，不崩 ---------------------------- #

    g = Game()
    lm = core.legal_moves(g.board, True)
    # 一条真的交替走下去的主变（拿同一批黑方着法拼一串，验的就不是主变而是拼错了）
    walk, b, r = [], g.board, True
    for _ in range(3):
        m = core.legal_moves(b, r)[0]
        walk.append(m)
        b = core.apply_move(b, r, m)
        r = not r
    after = b
    check('主变每一步都落在自己推出来的局面上时，一步不截',
          len(session_mod.pv_detail(g.board, True, walk)) == 3)
    check('主变第 2 步起对不上局面：只截到那一步，不报错',
          session_mod.pv_detail(
              g.board, True, [lm[0], (core.parse('d5'), core.parse('d6'))]) ==
          [{'iccs': nt.to_iccs(lm[0]), 'chinese': nt.to_chinese(g.board, lm[0])}])
    check('起点是空格的主变交回空列表（旧版在这里 KeyError 崩掉判分线程）',
          session_mod.pv_detail(
              g.board, True, [(core.parse('d5'), core.parse('d6'))]) == [])
    check('落点是自己的子同样不报错，棋盘串里的填充格也不算子',
          session_mod.pv_detail(
              g.board, True, [(core.parse('a0'), core.parse('a3'))]) == []
          and session_mod.pv_detail(g.board, True, [(250, 251)]) == [])

    # ---- pv_reason：两条主变各自「第一次吃到子」的那一手 ------------------- #
    #
    # 服务端到这里仍然只给**事实**（第几步、哪一方吃的、吃了什么子），「为什么更差」
    # 那句中文只写在 frontend/src/lib/format.ts。所以断言问的全是形状与取值。
    # 三块假棋盘各管一件事：a 能吃车、b 能吃两种子、d 那条线一路走到老将上。
    board_a, board_b, board_d = (
        nt.from_fen(f)[0] for f in (
            'r2k5/9/9/9/9/9/9/9/9/R2CK3R w - - 0 1',      # 红车 a0 一路通到 a9 的黑车
            '3k5/9/9/9/r8/9/9/7n1/9/R1B1K1N1R w - - 0 1',  # 红车吃 a5 黑车、红马吃 h2 黑马
            '8k/9/9/9/7r1/9/9/9/9/4K2RR w - - 0 1'))       # 红车 i0 顶到 i9 老将、h0 吃 h5 黑车
    # 喂进去的一定是 pv_detail 交回的那批串，不是自己另拼的：这样这里报的 chinese
    # 与面板上那一步必然是同一个字符串（「讲解与棋谱写的不是同一步」的产地）。
    eat_rook_a = session_mod.pv_detail(board_a, True, [nt.from_iccs('a0a9')])
    quiet_a = _quiet_pv(board_a, True, session_mod.REVIEW_PV_PLIES)
    reason_a = session_mod.pv_reason(board_a, True, eat_rook_a, quiet_a)
    check('正解第一步就把车吃了、人那手的窗口走满六步一步不吃：只报得出前一半',
          reason_a['best'] == {'ply': 1, 'iccs': 'a0a9',
                               'chinese': eat_rook_a[0]['chinese'],
                               'by': 'red', 'captured': '车'}
          and reason_a['played'] is None
          and len(quiet_a) == session_mod.REVIEW_PV_PLIES, str(reason_a)[:200])

    reason_b = session_mod.pv_reason(
        board_b, True,
        session_mod.pv_detail(board_b, True, [nt.from_iccs('a0a5')]),
        session_mod.pv_detail(board_b, True, [nt.from_iccs('g0h2')]))
    check('两条线都吃子、吃的还不是同一颗子：各报各的，不许只留第一条',
          reason_b['best']['captured'] == '车'
          and reason_b['played']['captured'] == '马'
          and reason_b['best']['by'] == reason_b['played']['by'] == 'red',
          str(reason_b)[:200])

    # by 说的是「吃掉别人的那一方」，不是「该谁走」：第 2 手吃子的仍是黑方。
    red_then_black = session_mod.pv_detail(
        board_a, True, [nt.from_iccs('a0a5'), nt.from_iccs('a9a5')])
    reason_ab = session_mod.pv_reason(board_a, True, red_then_black, [])
    check('吃到子的那一手在第 2 步、由黑方走：ply 双方交替都算，by 认吃人的那一方',
          len(red_then_black) == 2 and reason_ab['best'] == {
              'ply': 2, 'iccs': 'a9a5', 'chinese': red_then_black[1]['chinese'],
              'by': 'black', 'captured': '车'}, str(reason_ab['best'])[:160])

    reason_c = session_mod.pv_reason(core.initial, True,
                                     _quiet_pv(core.initial, True, 6),
                                     _quiet_pv(core.initial, True, 2))
    check('两条线都不吃子：两边都是 None，但两个键都必须在（「没吃到」≠「没看过」）',
          reason_c == {'best': None, 'played': None}, str(reason_c)[:160])

    reason_d = session_mod.pv_reason(
        board_d, True,
        session_mod.pv_detail(board_d, True, [nt.from_iccs('i0i9')]),
        session_mod.pv_detail(board_d, True, [nt.from_iccs('h0h5')]))
    check('主变一路走到老将上的是杀棋线：整条线报 None，另一条该怎么报还怎么报',
          reason_d['best'] is None
          and reason_d['played'] == {'ply': 1, 'iccs': 'h0h5',
                                     'chinese': '车二进五', 'by': 'red',
                                     'captured': '车'}, str(reason_d)[:200])
    dump_d = json.dumps(reason_d, ensure_ascii=False)
    caps = [c for rr in (reason_a, reason_b, reason_ab, reason_c, reason_d)
            for c in (rr['best'], rr['played']) if c]
    check('这份事实的词表里永远没有 将 / 帅：「吃掉老将」不是一步棋，是终局',
          '将' not in dump_d and '帅' not in dump_d
          and caps and all(c['captured'] not in ('将', '帅') for c in caps),
          f'{dump_d[:120]} / {[c["captured"] for c in caps]}')

    # 截断而不是报错：主变可能是置换表里拼出来的陈旧串（pv_detail 就是因为这个
    # 才截断的）。已经找到的那一手必须照样报出来 —— 截掉的是尾巴，不是结论。
    stale = session_mod.pv_detail(board_b, True, [nt.from_iccs('a0a5')])
    reasons_e = (
        session_mod.pv_reason(board_b, True,
                              stale + [{'iccs': 'd5d6', 'chinese': '对不上局面的一步'}], []),
        session_mod.pv_reason(core.initial, True,
                              [{'iccs': 'd5d6', 'chinese': '起点是空格'}], []),
        session_mod.pv_reason(core.initial, True, [{'iccs': 'x0', 'chinese': '不是走法'}],
                              [{'iccs': 'a0a5'}]),
        session_mod.pv_reason(core.initial, True, [5], []))
    check('主变里出现这块盘上并没有的一步：就地截断，不抛异常',
          reasons_e[0]['best'] == {'ply': 1, 'iccs': 'a0a5', 'chinese': '车九进五',
                                   'by': 'red', 'captured': '车'}
          and reasons_e[0]['played'] is None, str(reasons_e[0])[:200])
    check('一步都推不下去的主变交回 None（起点空格、ICCS 不成串、名字凑不齐、'
          '根本不是 dict 都不许崩掉判分那一路）',
          reasons_e[1] == {'best': None, 'played': None}
          and reasons_e[2] == {'best': None, 'played': None}
          and reasons_e[3] == {'best': None, 'played': None},
          str(reasons_e[1:])[:200])
    # 陈旧主变最阴的一种：重放到第 2 手，落点上站的是**走子方自己的子**。
    # 闸门在这里挡住的是「把吃自己的子报成一次吃子」这种谎，而不是「马走错了方向」。
    stale_own = session_mod.pv_detail(board_b, True, [nt.from_iccs('i0i2')]) + [
        {'iccs': 'a5h2', 'chinese': '车1平2'}]
    stale_turn = session_mod.pv_detail(board_a, True, [nt.from_iccs('i0i1')]) + [
        {'iccs': 'i1i9', 'chinese': '车1进8'}, {'iccs': 'i9a9', 'chinese': '车九平七'}]
    check('落点上站的是自己的子：截断，绝不把「吃自己」报成吃子',
          session_mod.pv_reason(board_b, True, stale_own, [])['best'] is None,
          str(stale_own)[:160])
    check('该某人走却站着对方的子：同样截断，后面的吃子一步都不许再算（也不许崩）',
          session_mod.pv_reason(board_a, True, stale_turn, [])['best'] is None,
          str(stale_turn)[:160])

    # ---- analyze 任务：只在轮到人的时候开场 ----------------------------- #

    sess, fake = _grading_session()
    a = _wait_analysis(sess)
    check('轮到人才判分：三条排名线都在，对着的正是此刻这个局面',
          a and a['status'] == 'done' and len(a['lines']) == 3
          and a['subject']['ply'] == 0
          and a['subject']['fen'] == nt.to_fen(sess.game.board, True),
          str(a)[:200])
    reqs = [c for c in fake.calls if isinstance(c, SearchRequest)]
    check('判分那一路不吃开局库、要的就是前几名（不是最好的一手）',
          reqs and all(not c.use_book and c.multipv == 3 for c in reqs),
          f'{len(reqs)} 次搜索')

    played = a['lines'][1]['iccs']
    resp = sess.submit_move({'move': played})
    rec = resp.body['state']['game']['records'][-1]
    rv = rec.get('review') or {}
    check('人这一步拿到名次与差值：排第 2、比最优差 40 兵',
          rv.get('rank') == 2 and rv.get('loss') == 40
          and rv.get('loss_kind') == 'exact', str(rv)[:200])
    check('人这一步的分数从此不再空着（走势线才有第二段）',
          rec['eval'] is not None and rec['eval'] == rv['played_eval_red'],
          f"eval={rec['eval']} review={rv.get('played_eval_red')}")

    back = sess.snapshot()
    check('人一走就把判分停下来：槽里那批线仍只属于它自己那个局面',
          back['game']['ply'] == 1 and back['analysis']['subject']['ply'] == 0,
          f"ply={back['game']['ply']} "
          f"线属于 {back['analysis']['subject']['ply']}")

    sess.undo({'plies': 1, 'round': False})
    again = sess.snapshot()['analysis']
    check('悔棋退回同一个局面：排名线还在，不必重新搜一遍',
          again and again['subject']['ply'] == 0 and len(again['lines']) == 3,
          str(again)[:160])

    # ---- 挂判分的那道闸：局面、代数、第几手三样都对得上才算判过 ---------- #

    good = dict(a['subject'])
    attached = {'by': 'opponent', 'iccs': a['lines'][0]['iccs'], 'eval': None,
                'mate_in': None, 'depth': None, 'time': None}
    sess._attach_review(good, attached)
    check('subject 对得上时才挂：同一局面、同一代数，判分才属于这一步',
          'review' in attached and attached['eval'] is not None, str(attached)[:160])
    reason = (attached.get('review') or {}).get('reason') or {}
    check('判到手的那一手同时带「为什么更差」那份事实，四个键一个不多一个不少',
          set(reason) == {'side', 'pv_plies', 'best', 'played'}
          and reason.get('side') == 'red'
          and reason.get('pv_plies') == session_mod.REVIEW_PV_PLIES
          and all(reason.get(k) is None or set(reason[k]) ==
                  {'ply', 'iccs', 'chinese', 'by', 'captured'}
                  for k in ('best', 'played')), str(reason)[:200])

    # 掉出排名线的那一手**压根没有**可供重放的主变：这时候 reason 这个键必须缺位。
    # 挂一个 {'best': None, 'played': None} 会被界面念成「看过两条线，都不吃子」，
    # 那是把没证出来的东西说成证出来了。
    inside = {ln['iccs'] for ln in a['lines']}
    off_iccs = next(nt.to_iccs(m) for m in sess.game.legal_moves()
                    if nt.to_iccs(m) not in inside)
    off_rec = {'by': 'opponent', 'iccs': off_iccs, 'eval': None, 'mate_in': None,
               'depth': None, 'time': None}
    sess._attach_review(good, off_rec)
    check('不在排名线里的那一手不挂 reason：键缺位才是「没看过」',
          off_rec['review']['status'] == 'outside' and 'reason' not in off_rec['review'],
          f"status={off_rec['review']['status']} "
          f"{sorted(off_rec['review'])[:6]}")

    stale = {'by': 'opponent', 'iccs': 'b0c2', 'eval': None}
    sess._attach_review(dict(good, epoch=good['epoch'] + 1), stale)
    check('换过一局（代数变了）就不许把上一局的排名安到这一局头上',
          'review' not in stale, str(stale)[:160])
    # ply 0 这块盘就是初始局面，所以「换个局面」要真的换一块：走掉一手之后再比。
    sess._attach_review(dict(good, board=after), stale)
    check('局面变了同样作废：排名是按局面问的，不是按第几手问的',
          'review' not in stale, str(stale)[:160])
    eng_rec = {'by': 'engine', 'iccs': 'b0c2', 'eval': None}
    sess._attach_review(good, eng_rec)
    check('引擎那一步永远不判分（它本来就知道自己为什么走这一手）',
          'review' not in eng_rec, str(eng_rec)[:160])

    # ---- 借来的算力没有排队的资格 --------------------------------------- #

    busy, _ = _grading_session(analyze=False)
    busy._engine_io.acquire()                       # 走棋那一路正占着引擎
    try:
        busy.update_settings({'analyze': True})     # 开场的是这一句，不是 new_game
        skipped = _wait_analysis(busy)
    finally:
        busy._engine_io.release()
    check('引擎正忙时这一手直接不判（不排队，免得把下一次开场一起拖晚）',
          skipped and skipped['status'] == 'skipped'
          and (skipped['result'] or {}).get('status') == 'busy'
          and not skipped['lines'], str(skipped)[:200])

    eng_turn, _ = _grading_session()
    a4 = _wait_analysis(eng_turn)
    eng_turn.submit_move({'move': a4['lines'][0]['iccs']})
    with eng_turn.lock:
        opened = eng_turn._maybe_analyze()
    check('轮到引擎的时候不开场：判分只是空闲时借来的算力',
          opened is None
          and eng_turn.snapshot()['analysis']['subject']['ply'] == 0,
          str(opened)[:160])

    quiet, _ = _grading_session(analyze=False)
    check('analyze 开关关掉是真的不搜，不只是界面不显示',
          quiet.snapshot()['analysis'] is None and not quiet._analysis_busy())

    clamped, _ = _grading_session()
    clamped.update_settings({'analyze_ms': 999999, 'analyze_depth': 0,
                             'analyze_width': 99, 'think_ms': 1})
    check('判分参数也过同一份白名单与上下限（new_game 与改设置不是两套规则）',
          clamped.settings['analyze_ms'] == 15000
          and clamped.settings['analyze_depth'] == 2
          and clamped.settings['analyze_width'] == 5
          and clamped.settings['think_ms'] == 120, str(clamped.settings)[:200])

    # ---- 判分整份进库：错题本要拿正解那条主变讲「你该走哪」 -------------- #

    path = os.path.join(_ARCHIVE_DIR, 'L2.sqlite')
    store = Store(path)
    archived, _fake = _grading_session(store=store, auto_reply=True)
    a3 = _wait_analysis(archived)
    archived.submit_move({'move': (a3['lines'] or [{'iccs': None}])[0]['iccs']})
    _wait_task(archived)
    conn = _open_reader(path)
    rows = conn.execute('SELECT by, review FROM plies WHERE game_id=? ORDER BY ply',
                        (archived.game_id,)).fetchall()
    live = archived.game.records
    check('库里每一步的 review 与实况逐字段相同（人那手有，引擎那手没有）',
          len(rows) == len(live)
          and all(row['review'] == dump_review(rec.get('review'))
                  for row, rec in zip(rows, live))
          and any(row['review'] for row in rows)
          and not any(row['review'] for row, rec in zip(rows, live)
                      if rec['by'] == 'engine'),
          f'{[bool(r["review"]) for r in rows]}')
    check('存档与实况在这一段也一样对齐（判分不许把投影写歪）',
          not _archive_diff(conn, archived),
          '；'.join(_archive_diff(conn, archived)[:2]))
    stored = json.loads(next(r['review'] for r in rows if r['review']))
    check('库里的判分能原样读回来讲这一手：名次、差值、正解都在',
          stored['best_iccs'] and stored['rank'] == 1 and 'loss' in stored,
          str(stored)[:160])
    conn.close()
    store.close()


# --------------------------------------------------------------------------- #
# N. 错题本：按**局面**聚合历次判分（只读）
# --------------------------------------------------------------------------- #

class _ScriptedLines(_FakeEngine):
    """按脚本交回一整排排名线：分数、界标、杀棋距离都由测试点名。

    ``_RankingEngine`` 的界标是公式化的（恒 ``exact``），够 L2 用；错题本要问的
    却是「``at_most`` / ``uncertain`` 那几种算不算错」—— 真搜索什么时候给出哪一种
    全看运气，所以这里必须能点名。名次按 ``core.legal_moves`` 的顺序占位：
    脚本只说「第几名长什么样」，不说走到哪儿。
    """

    def __init__(self, plan):
        super().__init__()
        self.plan = plan                    # [(score, bound, mate_in), ...] 按名次

    def search(self, req):
        self.calls.append(req)
        legal = core.legal_moves(req.board, req.red_to_move)
        width = max(1, min(len(self.plan), len(legal)))
        sign = 1 if req.red_to_move else -1
        for rank in range(1, width + 1):
            score, bound, mate_in = self.plan[rank - 1]
            mv = legal[rank - 1]
            yield EngineInfo(
                depth=6, move=mv, score=score, eval_red=score * sign,
                mate=mate_in is not None, mate_in=mate_in,
                nodes=100 * rank, time=0.02, nps=10000,
                pv=(mv,), pv_iccs=(nt.to_iccs(mv),),
                multipv=rank, bound=bound)


def _mistake_game(store, plan, played='rank2', moves=None, engine_side=BLACK):
    """开一局（新 game_id）：按脚本判分，替人录一手，把判分写进存档。

    走公开动词（``new_game`` / ``load`` / ``submit_move``），所以这一手是真经
    ``sync_game`` 落库的 —— 错题本读的就是那条写路径留下的东西。
    ``moves`` 那一路先摆几步（判分关着）再打开判分：摆出来的那几手留 ``review``
    为 NULL、其中引擎那一方那手连 ``by`` 都不是 ``opponent`` —— 它们正是
    「没判分的手与引擎那手不进这本账」那条断言的对照物；而被人录下的那一手
    落在**另一个局面**上，用来证「按 fen 分组」不是「按 game 分组」换了个名字。
    """
    settings = {**session_mod.DEFAULT_SETTINGS, 'auto_reply': False,
                'analyze': False, 'analyze_ms': 300, 'analyze_depth': 4,
                'analyze_width': len(plan)}
    sess = GameSession(engines=EngineSet(builtin=_ScriptedLines(plan),
                                         pikafish=None),
                       settings=settings, store=store)
    if moves:
        sess.load({**payload_side(engine_side), 'moves': moves})
        sess.update_settings({'analyze': True})
    else:
        sess.new_game({**payload_side(engine_side), 'analyze': True})
    a = _wait_analysis(sess)
    lines = a['lines'] if a else []
    if not lines:
        raise AssertionError(f'假引擎没出排名线：{a}')
    if played == 'outside':
        inside = {ln['iccs'] for ln in lines}
        iccs = next(nt.to_iccs(m) for m in sess.game.legal_moves()
                    if nt.to_iccs(m) not in inside)
    else:
        iccs = lines[0 if played == 'rank1' else 1]['iccs']
    sess.submit_move({'move': iccs})
    return sess, iccs


def payload_side(side):
    return {'engine_side': side}


def _db_snapshot(conn):
    """整本库的逐字节指纹：错题本跑之前之后各取一次，必须一模一样。"""
    digest = hashlib.sha256()
    for table in ('games', 'plies', 'agg_stats'):
        for row in conn.execute(f'SELECT * FROM {table} ORDER BY rowid'):
            digest.update(repr(tuple(row)).encode('utf-8'))
    return digest.hexdigest()


# 七局都从初始局面开局：第 0 手的 fen_before 就是同一个局面 —— 这正是
# 错题本要问的那种重复（同一类局面反复错）。
_EXACT_40 = [(100, 'exact', None), (60, 'exact', None), (20, 'exact', None)]
_EXACT_140 = [(100, 'exact', None), (-40, 'exact', None)]
_AT_LEAST = [(100, 'lowerbound', None), (60, 'upperbound', None)]
_AT_MOST = [(20, 'upperbound', None), (10, 'exact', None)]
_UNCERTAIN = [(20, 'lowerbound', None), (10, 'lowerbound', None)]
_MATE_MISS = [(MATE_CP, 'exact', 3), (100, 'exact', None)]


def test_mistake_book():
    section('N. 错题本：按局面把历次判分聚在一起（只读）')

    # ---- 判据本体：门槛只写在 review_verdict 一处 ------------------------ #

    # 这里不抄第二套判据 —— 抄一份就是造出会分叉的两份，直接问那唯一一处。
    verdict = store_mod.review_verdict
    check('exact 且 loss>0：证得出更差，计入错题',
          verdict({'status': 'ok', 'loss_kind': 'exact', 'loss': 40, 'rank': 2})
          [0] == 'miss', '')
    check('exact 且 loss=0（第 1 名或同分）：判清了，不算错',
          verdict({'status': 'ok', 'loss_kind': 'exact', 'loss': 0, 'rank': 1})
          [0] == 'clean')
    check('at_least 且 loss>0 计入：真值只会更大，「更差」已经证到了',
          verdict({'status': 'ok', 'loss_kind': 'at_least', 'loss': 10, 'rank': 2})
          [0] == 'miss')
    check('at_most 不计入：那个正数可能压根是 0 —— 报出来就是没证出来的比较',
          verdict({'status': 'ok', 'loss_kind': 'at_most', 'loss': 10, 'rank': 2})
          [0] == 'blurred')
    check('uncertain 不计入：两个界互相抵消，什么都没证出来',
          verdict({'status': 'ok', 'loss_kind': 'uncertain', 'loss': 10, 'rank': 2})
          [0] == 'blurred')
    check('below_top 不计入：连它自己的分都没搜出来',
          verdict({'status': 'outside', 'loss_kind': 'below_top', 'loss': None,
                   'rank': None, 'width': 3})[0] == 'blurred')
    check('带界的 0 不算错：at_least 与 loss=0 撞在一起正是「差 0 兵」那种假数',
          verdict({'status': 'ok', 'loss_kind': 'at_least', 'loss': 0, 'rank': 1})
          [0] == 'clean')

    mate_lines = [{'rank': 1, 'score': MATE_CP, 'mate_in': 3}]
    check('杀棋：本来能将死对方却走了别的，计入，且单算一档',
          verdict({'status': 'ok', 'loss_kind': 'mate', 'rank': 2, 'loss': None,
                   'best_mate_in': 3, 'played_mate_in': None,
                   'lines': mate_lines})[0] == 'miss')
    check('杀棋：走的就是那记杀（rank 1），不算错',
          verdict({'status': 'ok', 'loss_kind': 'mate', 'rank': 1, 'loss': None,
                   'best_mate_in': 3, 'played_mate_in': 3,
                   'lines': mate_lines})[0] == 'clean')
    check('杀棋冲着我来、这手撑得更短：计入（这一手的功课是守）',
          verdict({'status': 'ok', 'loss_kind': 'mate', 'rank': 2, 'loss': None,
                   'best_mate_in': 5, 'played_mate_in': 3,
                   'lines': [{'rank': 1, 'score': -MATE_CP, 'mate_in': 5}]})[0]
          == 'miss')
    check('杀棋冲着我来、距离说不准：不计入，也不许界面念成「没错」',
          verdict({'status': 'ok', 'loss_kind': 'mate', 'rank': 2, 'loss': None,
                   'best_mate_in': 5, 'played_mate_in': None,
                   'lines': [{'rank': 1, 'score': -MATE_CP, 'mate_in': 5}]})[0]
          == 'blurred')
    check('词表闭合：LOSS_KINDS 每一种问一遍，bucket 只有三个词',
          all(verdict({'status': 'ok', 'loss_kind': k, 'loss': 10, 'rank': 2,
                       'best_mate_in': None, 'played_mate_in': None,
                       'lines': mate_lines})[0] in ('miss', 'clean', 'blurred')
              for k in session_mod.LOSS_KINDS))
    check('缺 loss_kind 的旧判分退到 blurred（不许猜成 miss 或 clean）',
          verdict({'status': 'ok', 'loss': 10, 'rank': 2})[0] == 'blurred')

    # 挑「最差那次」用的是两位刻度 (档, 档内大小)，这里量的是**档先于大小**这件事。
    # 只写一个数字的话，「慢一步杀」这种档内差 2 的漏着会被一次 900cp 的漏着挤掉，
    # 而注释与界面都讲了「性质变了比程度变了更值得重做」—— 那句话得有断言撑着。
    slow_mate = verdict({'status': 'ok', 'loss_kind': 'mate', 'rank': 2, 'loss': None,
                         'best_mate_in': 3, 'played_mate_in': 5,
                         'lines': mate_lines})[2]
    big_pawn = verdict({'status': 'ok', 'loss_kind': 'exact', 'rank': 2,
                        'loss': 900})[2]
    check('杀棋那一档再小也压在兵数之上：慢一步杀要打得过差 9 兵的漏着',
          slow_mate > big_pawn, f'{slow_mate} vs {big_pawn}')
    check('兵数那一档内部还是同一把尺：差 140cp 打得过差 40cp',
          verdict({'status': 'ok', 'loss_kind': 'exact', 'rank': 2, 'loss': 140})[2]
          > verdict({'status': 'ok', 'loss_kind': 'exact', 'rank': 2, 'loss': 40})[2])

    # ---- 真投影 → 真聚合：一批都落在**同一个局面**上 --------------------- #

    path = os.path.join(_ARCHIVE_DIR, 'N.sqlite')
    store = Store(path)
    start_fen = nt.to_fen(core.initial, True)
    games = [(_EXACT_40, 'rank2'), (_EXACT_140, 'rank2'), (_EXACT_40, 'rank1'),
             (_AT_LEAST, 'rank2'), (_AT_MOST, 'rank2'), (_UNCERTAIN, 'rank2'),
             (_MATE_MISS, 'rank2')]
    made = []
    for plan, which in games:
        sess, _ = _mistake_game(store, plan, played=which)
        made.append(sess)
    check('七局都用公开动词落库（判分确实经 sync_game 进了存档）',
          len({s.game_id for s in made}) == 7 and store.errors == 0,
          str([s.game_id for s in made])[:160])

    # 对照组：先摆两手（判分还关着 —— 这两行 review 是 NULL，其中一手还是引擎走的），
    # 再打开判分、替人录第三手。这一手落在**另一个局面**上，且只带 at_most：
    # 它判过分、一次没错，不该进这本账。
    quiet_sess, _ = _mistake_game(store, _AT_MOST, played='rank2',
                                  moves=['h2e2', 'h9g7'])
    quiet_idx = next(i for i, r in enumerate(quiet_sess.game.records)
                     if r.get('review'))
    quiet_fen = nt.to_fen(quiet_sess.game.boards[quiet_idx],
                          quiet_sess.game.sides[quiet_idx])
    check('对照组只有被人录下的那一手带判分，且落在**另一个**局面上',
          quiet_idx == 2 and len(quiet_sess.game.records) == 3
          and quiet_fen != start_fen,
          f'{quiet_fen} records={len(quiet_sess.game.records)}')

    before = _db_snapshot(_open_reader(path))
    book = store.mistake_book(limit=0)
    after = _db_snapshot(_open_reader(path))
    entry = next((e for e in book['mistakes'] if e['fen_before'] == start_fen), None)

    check('错题本只读：跑一遍之前之后整本库逐字节相同',
          before == after, f'{before[:12]} → {after[:12]}')
    check('跨局按局面聚合：同一个初始局面攒了 7 次判分（不是只数最后一局）',
          entry is not None and entry['graded_plies'] == 7
          and entry['games'] == 7, str(entry)[:200])
    check('错过次数 = exact 2 + at_least 1 + mate 1 = 4；判清 1；看不准 2',
          entry['misses'] == 4 and entry['clean'] == 1 and entry['blurred'] == 2,
          f"misses={entry['misses']} clean={entry['clean']} "
          f"blurred={entry['blurred']}")
    check('错的那一档按 loss_kind 分开门类（杀棋单算，不和兵数混一把尺）',
          entry['exact_misses'] == 2 and entry['at_least_misses'] == 1
          and entry['mate_misses'] == 1, str(entry)[:200])
    check('没证出来的比较如实报出来，但没被算进 misses',
          entry['blurred_kinds'] == {'at_most': 1, 'uncertain': 1},
          str(entry['blurred_kinds']))
    check('四档加起来就是判分次数（一笔都不许丢）',
          entry['misses'] + entry['clean'] + entry['blurred'] + entry['unreadable']
          == entry['graded_plies'], str(entry)[:200])
    check('排序按错过次数优先：七次那题排在前面',
          book['mistakes'][0]['fen_before'] == start_fen, str(book['mistakes'][0])[:120])

    # below_top 也要在库里走一遍：它是「连自己的分都没有」那一种。
    outside_sess, outside_iccs = _mistake_game(store, _EXACT_40, played='outside')
    book2 = store.mistake_book(limit=0)
    entry2 = next((e for e in book2['mistakes'] if e['fen_before'] == start_fen), None)
    check('掉出前几名不计入错题，但计进「看不准」',
          entry2['graded_plies'] == 8 and entry2['misses'] == 4
          and entry2['blurred'] == 3
          and entry2['blurred_kinds'].get('below_top') == 1, str(entry2)[:200])

    check('最差那次挑的是杀棋那一手：性质变了比程度变了更值得重做',
          entry2['worst_loss_kind'] == 'mate' and entry2['worst_rank'] == 2,
          f"{entry2['worst_loss_kind']} rank={entry2['worst_rank']}")
    worst = entry2['worst_review'] or {}
    check('最差那次整份判分原样带回来（措辞由 format.ts 决定，这里只给事实）',
          worst.get('played_iccs') == entry2['worst_iccs']
          and bool(worst.get('lines')) and worst['loss_kind'] == 'mate',
          str(worst)[:180])
    check('正解那手给得出 ICCS 与中文记谱（讲题要能报出该走哪）',
          entry2['best_iccs'] and entry2['best_chinese'],
          f"{entry2['best_iccs']} {entry2['best_chinese']}")

    # 新键必须经得住「整份判分进库、再整份读回来」这一趟：错题本是把 review 的
    # JSON 原文交给界面的，`dump_review` 用 sort_keys=True 序列化 —— 键一旦被
    # 序列化吃掉、或被就地改写成别的形状，界面就只能对着一句「为什么更差」的
    # 空缺编话。所以这里拿**实况那份 dict** 比，而不是比一个抄出来的形状。
    worst_sess = next(s for s in made if s.game_id == entry2['worst_game_id'])
    live_review = worst_sess.game.records[entry2['worst_ply'] - 1]['review']
    check('「为什么更差」那份事实经 dump_review 进库、经错题本原样回到 worst_review',
          'reason' in live_review and 'reason' in worst
          and worst['reason'] == live_review['reason']
          and set(live_review['reason']) == {'side', 'pv_plies', 'best', 'played'},
          f"存档={str(worst.get('reason'))[:110]} 实况={str(live_review.get('reason'))[:110]}")

    conn = _open_reader(path)
    row = conn.execute('SELECT review FROM plies WHERE game_id=? AND ply=?',
                       (entry2['worst_game_id'], entry2['worst_ply'])).fetchone()
    check('worst 指的就是库里那一行的判分（不是另算了一份）',
          row is not None and json.loads(row['review']) == worst,
          str(row)[:120] if row else 'no row')
    last = conn.execute('SELECT g.updated_at FROM plies p JOIN games g '
                        'ON g.game_id=p.game_id WHERE p.game_id=? AND p.ply=?',
                        (entry2['last_game_id'], entry2['last_ply'])).fetchone()
    newest = conn.execute(
        'SELECT MAX(g.updated_at) FROM plies p JOIN games g ON g.game_id=p.game_id '
        "WHERE p.by='opponent' AND p.review IS NOT NULL AND p.fen_before=?",
        (start_fen,)).fetchone()[0]
    check('最近一次指的是这批里最晚那一手（题要能翻回出处）',
          last is not None and abs(last['updated_at'] - newest) < 1e-6,
          f"{entry2['last_game_id']} ply={entry2['last_ply']}")
    engine_rows = conn.execute(
        "SELECT COUNT(*) FROM plies WHERE fen_before=? AND (by!='opponent' "
        'OR review IS NULL)', (start_fen,)).fetchone()[0]
    check('引擎那一步与没判分的手都不进这本账（学习只挑人的那部分）',
          engine_rows > 0 and entry2['graded_plies'] == 8,
          f'盘外行 {engine_rows} 行没被算进去')
    conn.close()

    # 判过分、一次没错的局面：不进错题列表，但总数不许被抹掉。
    check('一题没错的局面不混进错题本，只在总数里如实待着',
          all(e['fen_before'] != quiet_fen for e in book2['mistakes'])
          and book2['summary']['positions'] == 2
          and book2['summary']['miss_positions'] == 1,
          str(book2['summary'])[:200])

    # ---- 坏数据、封顶、以及「不许挡住下棋」 ------------------------------ #

    broken = Store(os.path.join(_ARCHIVE_DIR, 'N-broken.sqlite'))
    _mistake_game(broken, _EXACT_40, played='rank2')
    with broken._lock, broken._conn:
        broken._conn.execute(
            "INSERT INTO games(game_id,start_fen,engine_side,source,opened_at,"
            'updated_at,ply_count,fen_now,state) VALUES(?,?,?,?,?,?,?,?,?)',
            ('junk', start_fen, 'black', 'play', 1.0, 2.0, 1, start_fen, 'playing'))
        broken._conn.execute(
            'INSERT INTO plies(game_id,ply,side,by,iccs,chinese,gives_check,mate,'
            "fen_before,review) VALUES('junk',1,'red','opponent','h2e2','炮二平五',"
            '0,0,?,?)', (start_fen, '{"loss_kind": 这不是 JSON'))
    bad_book = broken.mistake_book(limit=0)
    bad_entry = next(e for e in bad_book['mistakes'] if e['fen_before'] == start_fen)
    check('读不出一份判分时整本账不崩：那一手计进 unreadable，不冒充错题',
          bad_entry['unreadable'] == 1 and bad_entry['graded_plies'] == 2
          and bad_entry['misses'] == 1, str(bad_entry)[:200])
    broken.close()

    capped = store.mistake_book(limit=1)
    check('limit 只切列表，summary 的总数照实报（limit 不是藏数据的地方）',
          len(capped['mistakes']) == 1
          and capped['summary']['listed'] == 1
          and capped['summary']['misses'] == book2['summary']['misses'],
          str(capped['summary'])[:200])

    # ---- 只读的读侧不许挡住下棋：会话锁被人占着时也要立刻回来 ------------- #

    # 与 I2 同一个道理，反着问一次：拉对手走法那次证明「发请求不持 self.lock」，
    # 这里证明「读错题本也不持 self.lock」。它一旦持了，「有人在改棋」就会把
    # 「有人在看错题」堵住 —— 而看错题根本不改任何东西。
    busy = made[0]
    held = threading.Event()
    release = threading.Event()

    def _hold_session_lock():
        with busy.lock:
            held.set()
            release.wait(timeout=5)

    thief = threading.Thread(target=_hold_session_lock, daemon=True)
    thief.start()
    held.wait(timeout=5)
    t0 = time.time()
    locked_book = store.mistake_book(limit=0)
    dt = time.time() - t0
    release.set()
    thief.join(timeout=5)

    check('会话锁被别的线程占着时，错题本照样立刻回来（它一根手指都不碰 self.lock）',
          dt < 0.2 and locked_book['summary'] == book2['summary'],
          f'耗时 {dt * 1000:.0f}ms，锁被占了 {release.is_set()}')
    check('空档（EF_STORE=off）时错题本给空账，不抛异常',
          Store(None).mistake_book()['summary']['store_enabled'] is False
          and Store(None).mistake_book()['mistakes'] == [])

    store.close()


# --------------------------------------------------------------------------- #
# O. 逐手回放的读路径：光靠存档就能把整局一手手摆回来（只读）
# --------------------------------------------------------------------------- #
#
# 错题本答的是「这个局面你错过几次」，这一节答的是它答不了的另一半：
# 「**那一局**是怎么走到那个局面的」。人要把一次漏着重新摆上盘，靠的必须是
# 存档本身 —— ``games.start_fen`` + 有序 ``plies.iccs``，那正是当初把真值存成
# 这两个的理由。所以本节最强的那条断言不是「字段齐不齐」，而是**拿真规则把
# 存档交回来的每一手重放一遍**：从 start_fen 出发逐手落子，要求算出的局面与
# 那一行存的 ``fen_before`` 逐字符相同，而且那一手在当时那个局面里确实合法。
# 这条不过，「每手都能摆回盘上」这句话就是空话 —— 对不上不会报错，它只会让
# 回放里每一步都差一个子，而人正是要靠这些局面对自己讲「你当时该走哪」。

def _replay_chain(game_row, plies):
    """把 ``plies`` 按顺序落在 ``game_row['start_fen']`` 上，与存档逐手对账。

    返回不一致的说明（空列表就是整局都能一手手摆回来）。**第一处不合就停**：
    那一手之后盘面就歪了，继续比下去报出来的一屏红全都是它的回声，
    反而看不出真正断掉的地方在哪。
    """
    problems = []
    board, red, _h, _m = nt.from_fen(game_row['start_fen'])
    for row in plies:
        got = nt.to_fen(board, red)
        if got != row['fen_before']:
            return [f'第 {row["ply"]} 手：重放出的局面 {got} ≠ 存档 '
                    f'fen_before {row["fen_before"]}']
        move = nt.from_iccs(row['iccs'])
        if move is None:
            return [f'第 {row["ply"]} 手的 iccs {row["iccs"]!r} 根本不是走法']
        if move not in core.legal_moves(board, red):
            return [f'第 {row["ply"]} 手 {row["iccs"]} 在它自己那个局面里不合法'
                    f'（摆不上盘）']
        board = core.apply_move(board, red, move)
        red = not red
    final = nt.to_fen(board, red)
    if final != game_row['fen_now']:
        problems.append(f'最后一手之后重放出的局面 {final} ≠ games.fen_now '
                        f'{game_row["fen_now"]}')
    return problems


def _replay_game(store, plan, rounds=4, engine_side=BLACK):
    """开一局真走完的棋（假引擎，不起搜索），替人录好几手，让判分与棋谱都落库。

    与 ``_mistake_game`` 的分别是「手数」：那一个只录一手，够错题本用；回放要问
    的是**整局**，所以这里 ``auto_reply`` 打开 —— 引擎替对方落的那几手也经 worker
    里的 ``sync_game`` 进了库，``by`` 是 ``engine``、``review`` 是 NULL，它们正是
    「graded_plies 只数带判分的那些手」这条断言的对照物。
    中途真的将死/困毙就停下来（``submit_move`` 在对局结束后会 400），别把
    「这一局恰好没走完」当成被测行为写进期望里。
    """
    settings = {**session_mod.DEFAULT_SETTINGS, 'auto_reply': True, 'analyze': True,
                'analyze_ms': 300, 'analyze_depth': 4, 'max_depth': 4,
                'think_ms': 120, 'analyze_width': len(plan)}
    sess = GameSession(engines=EngineSet(builtin=_ScriptedLines(plan),
                                         pikafish=None),
                       settings=settings, store=store)
    sess.new_game({**payload_side(engine_side), 'auto_reply': True, 'analyze': True,
                   'think_ms': 120, 'max_depth': 4})
    played = 0
    for _ in range(rounds):
        if sess.game.is_over():
            break
        analysis = _wait_analysis(sess)
        lines = (analysis or {}).get('lines') or []
        want = (lines[1]['iccs'] if len(lines) >= 2
                else nt.to_iccs(sess.game.legal_moves()[-1]))
        reply = sess.submit_move({'move': want})
        if reply.status != 200:
            break
        played += 1
        _wait_task(sess)                      # 等引擎那一手落地并写完档
    return sess, played


def test_replay_read_path():
    section('O. 逐手回放的读路径：光靠存档就能把整局一手手摆回来')

    path = os.path.join(_ARCHIVE_DIR, 'O.sqlite')
    store = Store(path)

    # ---- 先给「重放」这件事本身立规矩：它必须报得出坏行 ------------------ #
    # 这条不是走形式：``_replay_chain`` 是本节最强那条断言的判据，它自己不响，
    # 后面全是假绿。所以先拿一副**故意做坏**的行喂它，要求两种坏都报出来。
    head_fen = nt.to_fen(core.initial, True)
    good = [{'ply': 1, 'iccs': 'h2e2', 'fen_before': head_fen}]
    check('重放判据认好行：合法的一手落在开局局面上没有意见',
          _replay_chain({'start_fen': head_fen,
                         'fen_now': nt.to_fen(core.apply_move(
                             core.initial, True, nt.from_iccs('h2e2')), False)},
                        good) == [])
    bad_fen = _replay_chain({'start_fen': head_fen, 'fen_now': head_fen},
                            [{'ply': 1, 'iccs': 'h2e2',
                              'fen_before': head_fen.replace('1c5c1', '1c4c1')}])
    check('重放判据有牙齿：fen_before 被改一位就报出是第几手（不是闷声通过）',
          bool(bad_fen) and '第 1 手' in bad_fen[0], str(bad_fen)[:150])
    bad_legal = _replay_chain({'start_fen': head_fen, 'fen_now': head_fen},
                              [{'ply': 1, 'iccs': 'a0a9', 'fen_before': head_fen}])
    check('重放判据有牙齿：那一手摆不上盘（不合法）时报「不合法」',
          bool(bad_legal) and '不合法' in bad_legal[0], str(bad_legal)[:150])

    # ---- 一局真棋：整局一手手摆回来 ------------------------------------- #

    sess, played = _replay_game(store, _EXACT_40, rounds=4)
    records = sess.game.records
    check('这一局真的走了几个来回（替人录的手与引擎那一手都进了库）',
          played >= 2 and len(records) >= 2 * played - 1 and store.errors == 0,
          f'录 {played} 手，实况 {len(records)} 手，存档错误 {store.errors}')

    replay = store.game_replay(sess.game_id)
    check('game_replay 交回的那局就是它（found / store_enabled 都是真话）',
          replay.get('found') is True and replay.get('store_enabled') is True
          and replay['game']['game_id'] == sess.game_id, str(replay)[:120])

    chain = _replay_chain(replay['game'], replay['plies'])
    check('整局能光靠存档一手手摆回盘上：每一手重放出的局面 == 存档的 fen_before',
          not chain and len(replay['plies']) == len(records),
          f'{len(replay["plies"])} 手；{"；".join(chain)[:200]}')
    live_fens = [nt.to_fen(sess.game.boards[i], sess.game.sides[i])
                 for i in range(len(records))]
    check('存档的 fen_before 与实况逐手相同：live == 存档 == 重放，三角对得上',
          [row['fen_before'] for row in replay['plies']] == live_fens,
          str([(i + 1, row['fen_before'][:18])
               for i, row in enumerate(replay['plies'])
               if row['fen_before'] != live_fens[i]][:1]))
    check('ply 升序且连续 1..n（回放的光标就是它，跳号就摆不下去）',
          [row['ply'] for row in replay['plies']] == list(
              range(1, len(replay['plies']) + 1)),
          str([row['ply'] for row in replay['plies']][:8]))
    check('ply_count 就是行数，fen_now 就是重放完的局面（派生列没走偏）',
          replay['game']['ply_count'] == len(replay['plies'])
          == replay['summary']['plies'], str(replay['summary']))
    check('回放行的字段就是约定的那些（不多不少，也不夹带会话快照）',
          all(set(row) == set(store_mod.PLY_COLUMNS) for row in replay['plies']),
          str(sorted(replay['plies'][0]) if replay['plies'] else '空'))
    check('局头的字段就是 games 那 12 列（界面不会拿到一份 state 快照）',
          set(replay['game']) == set(store_mod.GAME_HEAD_COLUMNS),
          str(sorted(set(replay['game']))))

    # 判分是**原样搬运**的：里面有什么键由写的那一侧决定，读侧一概不看。
    # 另一条线正在往 review 里加键，这条断言保证那件事不必经过这里。
    conn = _open_reader(path)
    verbatim = True
    for row in replay['plies']:
        raw = conn.execute('SELECT review FROM plies WHERE game_id=? AND ply=?',
                           (sess.game_id, row['ply'])).fetchone()['review']
        want = json.loads(raw) if raw else None
        if want is not None and isinstance(want, dict) and want != row['review']:
            verbatim = False
    check('review 整份原样交回（解析后的 dict 与库里那行 JSON 一模一样）',
          verbatim and any(r['review'] for r in replay['plies']),
          str([(r['ply'], bool(r['review'])) for r in replay['plies']][:6]))
    conn.close()

    graded_rows = _open_reader(path).execute(
        'SELECT COUNT(*) FROM plies WHERE game_id=? AND review IS NOT NULL',
        (sess.game_id,)).fetchone()[0]
    check('graded_plies 就是「带判分的手」，不数引擎那一手，也不数没判分的手',
          replay['summary']['graded_plies'] == graded_rows
          and 0 < graded_rows < len(replay['plies']),
          f"接口 {replay['summary']['graded_plies']}，库 {graded_rows}，"
          f"共 {len(replay['plies'])} 手")

    # ---- 列表：挑一局要靠它 ---------------------------------------------- #

    listing = store.recent_games(limit=0)
    check('列表一行的字段 = games 的 12 列 + graded_plies（graded_plies 是算出来的）',
          all(set(row) == set(store_mod.GAME_HEAD_COLUMNS) | {'graded_plies'}
              for row in listing['games']),
          str(sorted(set(listing['games'][0]))))
    stamps = [row['updated_at'] for row in listing['games']]
    check('按 updated_at 从新到旧：刚下的那局在最前面（挑局不用翻页找）',
          stamps == sorted(stamps, reverse=True)
          and listing['games'][0]['game_id'] == sess.game_id,
          str(stamps[:3]))
    per_game = {row['game_id']: row['graded_plies'] for row in listing['games']}
    counted = dict(_open_reader(path).execute(
        'SELECT game_id, COUNT(review) FROM plies GROUP BY game_id').fetchall())
    check('每行的 graded_plies 与库里逐行数出来的一致（来自一条聚合，不是猜的）',
          all(value == counted.get(gid, 0) for gid, value in per_game.items())
          and listing['summary']['graded_plies'] == sum(counted.values()),
          f"列表 {per_game} / 库 {counted}")

    # 排局（补棋）那一局不是「下过的一局」，但它也是存档里的一局：列出来，
    # 并带着 source 让界面自己能分。藏起来是最坏的那种省事。
    setup = GameSession(engines=EngineSet(builtin=_FakeEngine(), pikafish=None),
                        settings={**session_mod.DEFAULT_SETTINGS,
                                  'auto_reply': False},
                        store=store)
    setup.load({'fen': '4k4/9/9/9/9/9/9/9/8K/R8 w - - 0 1',
                'engine_side': BLACK, 'moves': ['a0a5', 'e9d9']})
    listed = store.recent_games(limit=0)
    row_setup = next((r for r in listed['games'] if r['game_id'] == setup.game_id),
                     None)
    check('source=setup 那局照样列出来，且 source 一眼可辨（界面自己贴标签）',
          row_setup is not None and row_setup['source'] == 'setup'
          and listed['summary']['setup_games'] >= 1,
          str(row_setup)[:160])
    check('它不是 play 那一局，两局的胜负不混进同一本账',
          all(r['source'] in ('play', 'setup') for r in listed['games'])
          and listed['summary']['play_games'] >= 1
          and listed['summary']['setup_games'] == 1, str(listed['summary']))
    replay_setup = store.game_replay(setup.game_id)
    check('排局那一局也整局摆得回来（start_fen 是摆出来的局面，不是标准开局）',
          replay_setup['found'] and not _replay_chain(replay_setup['game'],
                                                      replay_setup['plies'])
          and replay_setup['game']['start_fen'] != head_fen,
          str(_replay_chain(replay_setup['game'], replay_setup['plies'])[:1])[:160])

    # limit 只切列表，不切总账 —— 与错题本同一条纪律。
    capped = store.recent_games(limit=1)
    uncapped = store.recent_games(limit=0)
    check('limit 只切列表：truncated 与 total_games 照实说，不许悄悄少给',
          len(capped['games']) == 1 and capped['summary']['listed'] == 1
          and capped['summary']['truncated'] is True
          and capped['summary']['total_games'] == listed['summary']['total_games']
          and capped['summary']['graded_plies'] == listed['summary']['graded_plies'],
          str(capped['summary']))
    check('limit=0 不封顶；缺省 limit 就是那个常量（响应体量有上界，界面不必自己传）',
          len(uncapped['games']) == uncapped['summary']['total_games']
          and uncapped['summary']['truncated'] is False
          and len(uncapped['games']) > 1
          and store.recent_games()['summary']['limit']
          == store_mod.GAMES_LIMIT_DEFAULT,
          f"不封顶 {len(uncapped['games'])} 行，缺省 "
          f"{store.recent_games()['summary']['limit']}")

    # ---- 坏数据与「不存在」：两种没有，说法不一样 ------------------------ #

    missing = store.game_replay('ffffffffffff')
    check('不认识的 game_id 明确报「没有这一局」：found=False，且不交回空棋谱',
          missing.get('found') is False and missing.get('store_enabled') is True
          and 'plies' not in missing and 'game' not in missing,
          str(sorted(missing)))

    broken_path = os.path.join(_ARCHIVE_DIR, 'O-broken.sqlite')
    broken = Store(broken_path)
    b_sess, b_played = _replay_game(broken, _EXACT_40, rounds=3)
    b_conn = _open_reader(broken_path)
    reviewed = [row['ply'] for row in b_conn.execute(
        'SELECT ply FROM plies WHERE game_id=? AND review IS NOT NULL ORDER BY ply',
        (b_sess.game_id,)).fetchall()]
    # 另一条线正在往判分里加键（reason），这里要的就是「读侧不看内容」。
    # 所以先立一条前置：这一局至少有两手带判分，一手拿来弄坏、一手拿来塞生键。
    check('这一局至少有两手带着判分（一手用来弄坏，一手用来塞一个谁都不认识的键）',
          len(reviewed) >= 2 and b_played >= 2, f'{reviewed}')

    with broken._lock, broken._conn:
        # 一手改成读不动的 JSON，另一手塞进一个读侧绝不认识的键。
        broken._conn.execute(
            "UPDATE plies SET review='{\"loss_kind\": 这不是 JSON' "
            'WHERE game_id=? AND ply=?', (b_sess.game_id, reviewed[0]))
        broken._conn.execute(
            "UPDATE plies SET review='{\"reason\": \"别的线加的键\", "
            '"probe": {"嵌套": [1, 2]}}\' WHERE game_id=? AND ply=?',
            (b_sess.game_id, reviewed[-1]))
    b_conn.close()

    b_replay = broken.game_replay(b_sess.game_id)
    b_chain = _replay_chain(b_replay['game'], b_replay['plies'])
    by_ply = {row['ply']: row for row in b_replay['plies']}
    check('一行判分读不动：整局照样一手手摆回来，那一手 review=None，不抛异常',
          not b_chain and by_ply[reviewed[0]]['review'] is None,
          f'{"；".join(b_chain)[:150]}')
    check('坏行不悄悄消失：计进 unreadable，graded_plies 仍按「带着判分的行」数',
          b_replay['summary']['unreadable'] == 1
          and b_replay['summary']['graded_plies'] == len(reviewed),
          str(b_replay['summary']))
    check('判分是原样搬运的：读侧不认识也不看里面的键，生键照样整份回来',
          by_ply[reviewed[-1]]['review'] == {'reason': '别的线加的键',
                                             'probe': {'嵌套': [1, 2]}},
          str(by_ply[reviewed[-1]]['review'])[:120])
    broken.close()

    off = Store(None)
    check('EF_STORE=off：列表给空账 + store_enabled=False（诚实，不是「你没下过棋」）',
          off.recent_games()['games'] == []
          and off.recent_games()['summary']['store_enabled'] is False
          and off.recent_games()['summary']['total_games'] == 0)
    off_replay = off.game_replay(sess.game_id)
    check('EF_STORE=off：回放说清「没有档可查」，与「库里没这一局」是两句话',
          off_replay.get('found') is False
          and off_replay.get('store_enabled') is False
          and 'plies' not in off_replay, str(sorted(off_replay)))

    # ---- 只读这件事：两条路都不许动存档，也不许碰会话的锁 ---------------- #

    before = _db_snapshot(_open_reader(path))
    read_once = store.recent_games(limit=0)
    read_twice = store.game_replay(sess.game_id)
    after = _db_snapshot(_open_reader(path))
    check('读历史前后整本库逐字节相同（这两个方法一根手指都不写）',
          before == after and read_once == store.recent_games(limit=0)
          and read_twice == store.game_replay(sess.game_id),
          f'{before[:12]} → {after[:12]}')

    # 与 I2 / N 同一个道理反着问：这里要证的是「读历史不持 sess.lock」。
    # 它一旦持了，「有人在改棋」就把「有人在看历史」堵住 —— 而看历史不改任何东西。
    busy = sess
    held = threading.Event()
    release = threading.Event()

    def _hold_session_lock():
        with busy.lock:
            held.set()
            release.wait(timeout=5)

    thief = threading.Thread(target=_hold_session_lock, daemon=True)
    thief.start()
    held.wait(timeout=5)
    t0 = time.time()
    locked_list = store.recent_games(limit=0)
    locked_replay = store.game_replay(sess.game_id)
    dt = time.time() - t0
    release.set()
    thief.join(timeout=5)
    check('会话锁被别的线程占着时，列表与回放照样立刻回来（不碰 self.lock）',
          dt < 0.2 and locked_list == read_once
          and locked_replay == read_twice,
          f'耗时 {dt * 1000:.0f}ms')

    # ---- 这两个读接口到底发了哪几句 SQL：只读、且不逐局一问 ---------------- #
    #
    # 「不许 N+1」与「不许写」都是会被**后来一次好意的优化**破坏的事：给每个局
    # 补一次查询看起来人畜无害，几百局之后「挑一局」那个请求就变成几百句；在读
    # 路径里顺手记一笔统计也完全想得出理由。所以这里不靠注释，靠 trace 回调把
    # 真的发出去的语句数出来 —— 那句写一进 SQL 列表，这两条立刻红。
    def _traced_statements(gid):
        seen = []
        store._conn.set_trace_callback(seen.append)
        try:
            store.recent_games(limit=0)
            store.game_replay(gid)
        finally:
            store._conn.set_trace_callback(None)
        return [s.strip().upper().split()[0] for s in seen if s.strip()]

    verbs_two = _traced_statements(sess.game_id)
    extra = GameSession(engines=EngineSet(builtin=_ScriptedLines(_EXACT_40),
                                          pikafish=None),
                        settings={**session_mod.DEFAULT_SETTINGS,
                                  'auto_reply': False, 'analyze': False},
                        store=store)
    for _ in range(3):
        extra.new_game({'engine_side': BLACK, 'analyze': False, 'auto_reply': False})
        extra.submit_move({'move': nt.to_iccs(extra.game.legal_moves()[0])})
    verbs_many = _traced_statements(sess.game_id)
    check('两个读方法一句写都不发（全是 SELECT / 没有 INSERT、UPDATE、DELETE）',
          all(v in ('SELECT',) for v in verbs_two + verbs_many), str(verbs_two))
    check('SQL 句数与库里有几局无关：一局与四局都是同样几句（不是逐局一问）',
          len(verbs_two) == len(verbs_many) and len(verbs_two) <= 5,
          f'{len(verbs_two)} vs {len(verbs_many)} 句')

    store.close()


# --------------------------------------------------------------------------- #
# M. 对局度量台 arena2
# --------------------------------------------------------------------------- #
def test_arena2(lite: bool):
    """M. 对局度量台的自检 —— 断言在这里，牙齿在 arena2 里，一处一份。

    为什么不把 arena2 的判据抄进 verify：抄一遍就有两份，两份迟早分叉，
    分叉那天 verify 绿的、尺子却是坏的。所以这里只做「接进同一台计数器」。
    默认走 lite（不下真棋，只验机械与账本）；``--arena2-full`` 才连基准工作树
    和真对局一起跑，那一段要几分钟。
    """
    section('M. 对局度量台 arena2（同刻度 A/B + WDL/Elo + 节点预算 + 牙齿检验）'
            + ('' if not lite else ' —— lite'))
    try:
        import arena2
    except Exception as exc:                              # noqa: BLE001
        return check('tools/arena2.py 导入成功', False, f'{type(exc).__name__}: {exc}')
    try:
        results = arena2.selftest(lite=lite)
    except Exception as exc:                              # noqa: BLE001
        return check('arena2 自检跑完（没半路抛）', False,
                     f'{type(exc).__name__}: {exc}')
    if not results:
        return check('arena2 自检真的产出了断言（空列表不算通过）', False)
    failed = [label for label, ok, _ in results if not ok]
    for label, ok, detail in results:
        # 详情截一下：arena2 的每条形如「数值 + 区间 + 上界」，全量打印会把
        # verify 这一屏冲掉，而失败清单（末尾那份）用的是标签，不受影响。
        check(label, ok, detail[:90])
    return check(f'arena2 自检汇总：{len(results)} 条，失败 {len(failed)} 条',
                 not failed, '；'.join(failed)[:200])


# --------------------------------------------------------------------------- #
# 入口
# --------------------------------------------------------------------------- #

def test_tactics_and_compiler():
    """P. 棋理特征提取引擎与自动教案编译器（tactics.py）。"""
    section('P. 棋理与战术特征提取引擎 + 自动教案编译器（engine/tactics.py）')
    from engine import tactics
    from server.training import TrainingController

    # 1. 开局攻防图：双马有双车作根，仅双车双炮为无根大子，且无受攻悬空子
    g0 = tactics.analyze_board_graph(core.initial)
    check('开局攻防图：红黑双方无受攻悬空子，且双马有车保护、仅双车双炮为无根大子',
          g0['hanging'] == {'red': [], 'black': []}
          and {u['square'] for u in g0['unprotected']['red']} == {'a0', 'i0', 'b2', 'h2'}
          and {u['square'] for u in g0['unprotected']['black']} == {'a9', 'i9', 'b7', 'h7'},
          str(g0['unprotected']))

    # 2. 贪吃失先诊断：红方开局炮二进七(h2h9)贪吃黑马，自身暴露在黑车攻击下
    rev_greedy = {
        'rank': 4, 'status': 'outside', 'loss': 450, 'loss_kind': 'cp',
        'best_iccs': 'h2e2',
        'lines': [{
            'rank': 1, 'iccs': 'h2e2', 'chinese': '炮二平五', 'score': 30,
            'pv': [
                {'iccs': 'h2e2', 'chinese': '炮二平五'},
                {'iccs': 'h9g7', 'chinese': '马8进7'},
                {'iccs': 'h0g2', 'chinese': '马二进三'},
            ],
        }],
    }
    diag_greedy = tactics.diagnose_review(core.initial, True, 'h2h9', rev_greedy)
    check('棋理诊断：炮二进七吃马但暴露无根炮，准确归因为 greedy_capture（#贪吃失先）',
          diag_greedy['primary_motif'] == 'greedy_capture'
          and diag_greedy['severity'] == 'critical'
          and 'h9' in diag_greedy['visual_clues']['weakness_squares'],
          str(diag_greedy))

    # 3. 错失必杀诊断：best_mate_in 有值而实走非杀棋
    rev_mate = {
        'rank': 2, 'status': 'ok', 'loss': None, 'loss_kind': 'mate',
        'best_iccs': 'h2e2', 'best_mate_in': 2, 'played_mate_in': None,
        'lines': [{'rank': 1, 'iccs': 'h2e2', 'chinese': '炮二平五', 'score': 10000, 'pv': []}],
    }
    diag_mate = tactics.diagnose_review(core.initial, True, 'a3a4', rev_mate)
    check('棋理诊断：错过 2 步杀棋准确归因为 missed_mate（#错失必杀）',
          diag_mate['primary_motif'] == 'missed_mate'
          and diag_mate['severity'] == 'critical',
          str(diag_mate))

    # 4. 自动教案编译器：错题记录直接编译为含三段式变式 exam_fen、solution_tree、traps 的完整关卡
    mistake_item = {
        'fen_before': nt.to_fen(core.initial, True),
        'side': 'red',
        'worst_game_id': 'testgame01',
        'worst_ply': 1,
        'best_iccs': 'h2e2',
        'best_chinese': '炮二平五',
        'worst_iccs': 'h2h9',
        'worst_chinese': '炮二进七',
        'worst_loss': 450,
        'worst_review': {**rev_greedy, 'tactics': diag_greedy},
    }
    compiled = tactics.compile_mistake_to_puzzle(mistake_item, 0)
    check('自动教案编译器：从实战错题生成含多步 solution_tree、traps 与变式 exam_fen 的教案',
          compiled is not None
          and 'h2e2' in compiled['solution_tree']
          and 'h2h9' in compiled['traps']
          and compiled['exam_fen'] != compiled['fen']
          and compiled['motif'] == 'greedy_capture',
          str(compiled and compiled['title']))

    # 5. 无状态复盘沙盒（What-If Sandbox）：只读推演不污染存档
    tc = TrainingController(store=None, engines=default_engines(prefer=BUILTIN))
    sb_reply = tc.sandbox_reply({'fen': nt.to_fen(core.initial, True), 'move': 'h2e2'})
    check('复盘沙盒接口：GET /api/sandbox 无状态推演返回棋理诊断与引擎应手',
          sb_reply.status == 200
          and sb_reply.body.get('ok') is True
          and sb_reply.body['user_move']['iccs'] == 'h2e2'
          and isinstance(sb_reply.body.get('tactics'), dict)
          and sb_reply.body['game']['ply'] == 2
          and len(sb_reply.body.get('bad_steps') or []) >= 2
          and len(sb_reply.body.get('good_steps') or []) >= 1
          and len(sb_reply.body.get('opponent_threat_steps') or []) >= 1
          and isinstance(sb_reply.body.get('pros_cons'), dict)
          and isinstance(sb_reply.body.get('thinking_guide'), dict),
          str(sb_reply.body.get('tactics')))


def main():
    ap = argparse.ArgumentParser(description='elephantfish 引擎一致性回归自检')
    ap.add_argument('--quick', action='store_true', help='少跑几局，快速冒烟')
    ap.add_argument('--games', type=int, default=None, help='随机对局局数')
    ap.add_argument('--pv-time', type=float, default=3.0, help='主变搜索的时限（秒）')
    ap.add_argument('--no-arena2', dest='arena2', action='store_false',
                    help='跳过 M 段（对局度量台自检）；只想快跑规则层时用')
    ap.add_argument('--arena2-full', action='store_true',
                    help='M 段连真对局与基准工作树一起跑（默认 lite，那一段要几分钟）')
    args = ap.parse_args()

    games = args.games if args.games else (40 if args.quick else 400)

    print('elephantfish 引擎一致性自检')
    print(f'  Python {sys.version.split()[0]}   root={ROOT}')

    t_start = time.time()

    positions = test_move_generation(games)
    total_moves = test_notation(games)
    test_stalemate()
    test_king_facing()
    test_resign_undo()
    test_scoreboard()
    test_pv(args.pv_time)
    test_snapshot()
    test_engine_seam(min(args.pv_time, 1.5))
    test_engine_replacement()
    test_multipv(min(args.pv_time, 1.5))
    test_score_unit()
    test_session_races()
    test_opponent_poll_not_under_lock()
    test_start_fen_roundtrip()
    test_archive()
    test_grading()
    test_mistake_book()
    test_replay_read_path()
    test_tactics_and_compiler()
    if args.arena2:
        test_arena2(lite=not args.arena2_full)
    else:
        section('M. 对局度量台 arena2 —— 已用 --no-arena2 跳过')

    elapsed = time.time() - t_start
    section('汇总')
    print(f'  断言 {_CHECKS} 条，失败 {len(_FAILURES)} 条，'
          f'耗时 {elapsed:.1f}s')
    print(f'  覆盖局面 {positions:,} 个、合法走法 {total_moves:,} 步')
    if _FAILURES:
        print('  失败清单：')
        for name in _FAILURES:
            print(f'    - {name}')
        print()
        return 1
    print('  —— 全部通过 ——')
    print()
    return 0


if __name__ == '__main__':
    sys.exit(main())
