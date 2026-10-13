# -*- coding: utf-8 -*-
"""引擎一致性回归自检。

跑这个脚本的目的只有一个：**证明重写过的引擎和原版 elephantfish 在规则层面
逐条对齐**，并且 UI 依赖的那几条不变量确实成立。它不测界面，只测棋。

    python tools/verify.py            # 完整跑一遍
    python tools/verify.py --quick    # 少跑几局，改代码时快速冒烟

覆盖的断言：

    A  走法生成与原版逐位对齐（含顺序），随机 400 局逐局面比对
    B  中文记谱 / ICCS 往返无损，覆盖随机局面里每一步合法走法
    C  困毙（无子可动而非被将）判负 —— 原版当和棋处理，是错的
    D  认输之后悔棋能撤销认输，回到「等对方出招」
    E  累计战绩：认输计入、悔棋撤回，走公开动词不打内部
    F  主变每一步都合法、记谱往返一致，红黑两个视角都验
    G  快照性能（前端每 130ms 轮询一次的那个接口）
    H  引擎接缝：两个 adapter 产出同一套字段与参考系（含黑方走棋时的坐标翻转）
    H2 引擎接缝可替换：注入假引擎，EngineSet 照着用，降级与校验只有一份
    I  会话并发：搜索在飞时换局 / 认输，那一步不该落地；排队的一步该落地
    I2 拉对手走法时发请求不持锁（否则一次网络超时会把整个服务堵住）

任何一条不过就以非零码退出，方便挂在提交钩子上。
"""

import argparse
import os
import random
import sys
import threading
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

import elephantfish as base                                    # noqa: E402
from engine import (                                           # noqa: E402
    core, notation as nt, Game, RED, BLACK,
    SearchRequest, EngineInfo, EngineSet,
    BuiltinEngine, PikafishAdapter, PIKAFISH, BUILTIN,
)
from engine.search import Searcher                              # noqa: E402
import server.session as session_mod                            # noqa: E402
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


def _seam_check(label, adapter, board, red_to_move, history, time_limit):
    """把一个 adapter 跑一遍，验证它产出的每一层都守着接缝的约定。

    真正的判据是 ``move`` 落在**绝对坐标**的合法着法集合里：如果 adapter
    忘了按走子方翻转（或翻多了），这条立刻就红 —— 而且只在其中一个走子方下红，
    正是原来那段代码容易漏掉的情形。
    """
    req = SearchRequest(board=board, red_to_move=red_to_move,
                        move_history_iccs=tuple(history),
                        max_depth=6, time_limit=time_limit)
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

    return check(f'{label} 守着接缝的约定 —— {len(infos)} 层', not bad,
                 '；'.join(bad))


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

    # 皮卡鱼是第二个 adapter。它没装就跳过 —— 但接缝本身不依赖它装没装。
    pikafish = PikafishAdapter(threads=1, hash_mb=16)
    if not pikafish.available:
        check('皮卡鱼 adapter（未安装二进制，跳过）', True, 'PIKAFISH_PATH 未设置')
    else:
        try:
            for label, board, red_to_move, history in cases:
                ok_all &= _seam_check(f'皮卡鱼·{label.split("·")[1]}', pikafish,
                                      board, red_to_move, history, time_limit)
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
    release2 = _release_after(fake, 1)

    release1.set()
    task1.thread.join(timeout=5)
    check('旧搜索的结果被丢弃（没往新对局上落子）',
          (task1.result or {}).get('status') == 'discarded',
          f'result={task1.result} error={task1.error}')

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
# 入口
# --------------------------------------------------------------------------- #

def main():
    ap = argparse.ArgumentParser(description='elephantfish 引擎一致性回归自检')
    ap.add_argument('--quick', action='store_true', help='少跑几局，快速冒烟')
    ap.add_argument('--games', type=int, default=None, help='随机对局局数')
    ap.add_argument('--pv-time', type=float, default=3.0, help='主变搜索的时限（秒）')
    args = ap.parse_args()

    games = args.games if args.games else (40 if args.quick else 400)

    print('elephantfish 引擎一致性自检')
    print(f'  Python {sys.version.split()[0]}   root={ROOT}')

    t_start = time.time()

    positions = test_move_generation(games)
    total_moves = test_notation(games)
    test_stalemate()
    test_resign_undo()
    test_scoreboard()
    test_pv(args.pv_time)
    test_snapshot()
    test_engine_seam(min(args.pv_time, 1.5))
    test_engine_replacement()
    test_session_races()
    test_opponent_poll_not_under_lock()

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
