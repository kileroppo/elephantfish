# -*- coding: utf-8 -*-
"""搜索层：PVS / negamax + 渴求窗口 + 迭代加深。

原版用 MTD(f) 二分搜索。它每加一层深度都要在 ``[-3696, 3696]`` 这个巨大的
分数区间上二分十来个来回，而每一轮二分都是一次完整搜索——层数越深越亏。
实测有效分支因子高达 17，这就是「深度 7 要 12.8 秒」的元凶。

这里换成对纯 Python 友好得多的组合：

* **PVS / negamax + alpha-beta**：一层只搜一遍，零窗口试探失败才重搜；
* **渴求窗口（aspiration）**：以上一层分数为中心开小窗，命中率很高；
* **置换表（带世代号）**：命中即剪枝；用世代号代替整表清空，成本 O(1)；
* **走法排序**：置换表走法 > 吃子（MVV-LVA）> 杀手走法 > 历史启发；
* **LMR 后期走法削减 + 空着裁剪 + 静态搜索**。

性能上最要紧的一条：**置换表走法必须单独先试**。大多数节点第一步就能
剪掉，若先老老实实把四十来个走法全生成、全算分、再排序，等于白烧一遍。
所以这里是「先试表项走法 → 没剪掉再懒生成其余走法并排序」。

对外只暴露一个生成器 ``Searcher.search()``，每搜完一层就 ``yield`` 一次，
调用方可以边搜边把进度推给前端，也可以随时掐表收手。
"""

import time

from .core import (
    MATE_LOWER, MATE_UPPER, INF, flip_move, opponent_can_take_king,
    fast_is_check, evaluate,
)
from .opening import GLOBAL_BOOK

EXACT, LOWER, UPPER = 0, 1, 2

# 静态搜索门槛：收益低于这个值的走法不算「吃子」，不值得继续算。
QS_LIMIT = 219

TABLE_SIZE = 1_500_000
HISTORY_CAP = 1 << 22
MAX_PLY = 256

# 「没有节点预算」的哨兵值。不能用 core.INF —— 那是 3696，是给分数用的量级，
# 拿它当节点上限等于把搜索砍到 3696 个节点。这里要的是「永远碰不到」。
NO_BUDGET = 1 << 62

# 吃子排序用的子力档位（MVV-LVA：优先吃大子、用小子去吃）
RANK = {'P': 1, 'A': 2, 'B': 2, 'N': 4, 'C': 5, 'R': 9, 'K': 64}


def _to_tt(score, ply):
    """把「距根节点的杀棋步数」换算成相对当前节点的形式再存表。"""
    if score >= MATE_LOWER:
        return score + ply
    if score <= -MATE_LOWER:
        return score - ply
    return score


def _from_tt(score, ply):
    if score >= MATE_LOWER:
        return score - ply
    if score <= -MATE_LOWER:
        return score + ply
    return score


def _mate_in(score):
    """把杀棋分翻成「还有几步杀」（非负），不是杀棋分就给 None。

    搜索里的杀棋分一律写作 ``±(MATE_UPPER - ply)``，ply 是**距根节点的层数**。
    人读的是「步」：ply=1 是我一步成杀，ply=2 是对手一步杀我，ply=3 是我两步
    成杀 —— 所以 步 = (ply + 1) // 2。方向不在这里带，接缝约定看 score 的符号。
    """
    if abs(score) < MATE_LOWER:
        return None
    ply = max(0, MATE_UPPER - abs(score))
    return (ply + 1) // 2


class Searcher:
    """有状态的搜索引擎。

    一个实例持有置换表、杀手走法与历史启发，可以跨多步复用（历史与杀手是
    纯启发式，不受对局历史影响，跨步复用安全）。置换表带世代号，每次
    ``search()`` 世代自增，等价于整表清空但成本为 O(1)。
    """

    def __init__(self):
        self.tt = {}
        self.gen = 0
        self.killers = [[None, None] for _ in range(MAX_PLY)]
        self.history = [0] * (256 * 256)
        self.nodes = 0
        self.stop = False
        self.deadline = None
        self.node_budget = NO_BUDGET
        self.external_stop = None
        self._start = 0.0
        self.path = []
        self.path_set = set()

    def reset(self):
        """完全重置搜索引擎内部状态（新对局开局使用）。"""
        self.tt.clear()
        self.gen = 0
        self.killers = [[None, None] for _ in range(MAX_PLY)]
        self.history = [0] * (256 * 256)
        self.nodes = 0
        self.stop = False
        self.node_budget = NO_BUDGET

    # ------------------------------------------------------------------ #
    # 时间与中断
    # ------------------------------------------------------------------ #

    def _tick(self):
        """每 1024 个节点查一次时间，别把时间浪费在 time() 上。

        节点预算判在**最前面**：它是 ``tools/arena2.py`` 那把 A/B 尺子的唯一刻度。
        时间会随机器负载漂、深度会随战术漂（一个连将就能把深度顶满），
        只有「一共展开了多少个节点」两边都可数、都复现得了。
        预算这一路不进 ``elif`` 链：收手顺序是「先预算、再时限、再外部叫停」，
        这样带预算跑时 ``time_limit`` 只可能扮演看门狗，不可能反过来主导结果。
        """
        if self.nodes >= self.node_budget:
            self.stop = True
        elif self.deadline is not None and time.time() > self.deadline:
            self.stop = True
        elif self.external_stop is not None and self.external_stop():
            self.stop = True

    # ------------------------------------------------------------------ #
    # 走法排序（懒生成：只在需要时才把所有走法摊开排序）
    # ------------------------------------------------------------------ #

    def _ordered_rest(self, pos, tt_move, ply):
        board = pos.board
        k0, k1 = self.killers[ply]
        hist = self.history
        scored = []
        for m in pos.gen_moves():
            if m == tt_move:
                continue
            victim = board[m[1]]
            if victim != '.':
                # MVV-LVA：吃子永远排在最前，且按「大子优先、小子去吃」排
                s = (1 << 30) + (RANK[victim.upper()] << 8) - RANK[board[m[0]].upper()]
            elif m == k0:
                s = 1 << 20
            elif m == k1:
                s = (1 << 20) - 1
            else:
                s = hist[m[0] * 256 + m[1]]
            scored.append((s, m))
        scored.sort(reverse=True)
        return scored

    # ------------------------------------------------------------------ #
    # 静态搜索
    # ------------------------------------------------------------------ #

    def _qsearch(self, pos, alpha, beta, ply):
        # 收手之后再进来的调用，一个节点都不许记 —— 否则退栈途中还会往计数器里加，
        # 「nodes 恒 <= 预算」就漏了上界（实测漏 2）。判在自增前面才是硬的。
        if self.stop:
            return alpha
        self.nodes += 1
        # 预算越线的那一拍必须马上问一次，不能等 1024 的整拍：自增是 +1，
        # 于是在「展开的正是第 budget 个节点」这里就地收手，nodes 恒 <= budget
        # —— arena2 的节点预算断言全靠这个上界是硬的。
        if self.nodes >= self.node_budget or not (self.nodes & 1023):
            self._tick()
        if self.stop:
            return alpha

        if pos.score <= -MATE_LOWER:
            return -MATE_UPPER + ply

        in_check = fast_is_check(pos)
        if in_check:
            # 象棋规则：若当前局面处于被将军状态，必须立即应将，绝无 stand-pat
            # 若无任何合法应将着法，判定为绝杀死棋
            has_legal = False
            for m in pos.gen_moves():
                if not opponent_can_take_king(pos.move(m)):
                    has_legal = True
                    break
            if not has_legal:
                return -MATE_UPPER + ply

        key = pos.board
        if key in self.path_set:
            if in_check:
                return MATE_UPPER - ply
            s = evaluate(pos)
            if s > 30:
                return -min(260, max(50, int(s * 0.7)))
            if s < -60:
                return min(200, int(-s * 0.5))
            return 0

        stand = evaluate(pos)
        if stand >= beta:
            return stand
        if stand > alpha:
            alpha = stand

        self.path.append(key)
        self.path_set.add(key)
        try:
            value = pos.value
            caps = []
            for m in pos.gen_moves():
                v = value(m)
                if v >= QS_LIMIT:
                    caps.append((v, m))
            if not caps:
                return stand
            caps.sort(reverse=True)

            best = stand
            for _, m in caps:
                nxt = pos.move(m)
                if opponent_can_take_king(nxt):
                    continue
                score = -self._qsearch(nxt, -beta, -alpha, ply + 1)
                if self.stop:
                    return best
                if score > best:
                    best = score
                if score > alpha:
                    alpha = score
                if alpha >= beta:
                    break
            return best
        finally:
            self.path.pop()
            self.path_set.discard(key)

    # ------------------------------------------------------------------ #
    # 主搜索
    # ------------------------------------------------------------------ #

    def _negamax(self, pos, depth, alpha, beta, ply, ext=0):
        # 同 ``_qsearch``：收手之后进来的调用不计节点，预算的上界才是硬的。
        if self.stop:
            return alpha
        self.nodes += 1
        # 预算越线的那一拍必须马上问一次，不能等 1024 的整拍：自增是 +1，
        # 于是在「展开的正是第 budget 个节点」这里就地收手，nodes 恒 <= budget
        # —— arena2 的节点预算断言全靠这个上界是硬的。
        if self.nodes >= self.node_budget or not (self.nodes & 1023):
            self._tick()
        if self.stop:
            return alpha

        if pos.score <= -MATE_LOWER:
            return -MATE_UPPER + ply

        key = pos.board
        if key in self.path_set:
            # 1. 象棋国标裁决：若重复局面伴随将军，造成重复的上一手行棋方（对手）单方长将犯规判负
            # 从当前被将方视角判定为胜（+MATE）；对手视角则反转为必败（-MATE），彻底根除自身长将
            if fast_is_check(pos):
                return MATE_UPPER - ply
            # 2. 动态自适应厌和（Contempt）：优势方视和棋为大劣，主动变招撕破防线拒绝和棋
            s = evaluate(pos)
            if s > 30:
                return -min(260, max(50, int(s * 0.7)))
            if s < -60:
                return min(200, int(-s * 0.5))
            return 0

        tt_move = None
        entry = self.tt.get(key)
        if entry is not None:
            if entry[0] == self.gen:
                _, e_depth, e_flag, e_score, e_move = entry
                tt_move = e_move
                if e_depth >= depth:
                    s = _from_tt(e_score, ply)
                    if e_flag == EXACT:
                        return s
                    if e_flag == LOWER and s >= beta:
                        return s
                    if e_flag == UPPER and s <= alpha:
                        return s
            else:
                # 上一世代的记录：分数不可信（局面历史可能不同），
                # 但那一步棋依然是最好的排序提示，白送的信息不用白不用。
                tt_move = entry[4]

        in_check = fast_is_check(pos)
        # 将军延伸（Check Extension）：单分支最多延伸 1 层，防止连续将军导致树爆炸
        if in_check and ext < 1 and ply < MAX_PLY - 10:
            depth += 1
            ext += 1

        if depth <= 0:
            return self._qsearch(pos, alpha, beta, ply)

        self.path.append(key)
        self.path_set.add(key)
        try:
            # ---- 空着裁剪：假设我白让一手对方都拿我没办法，那我更输不了 ----
            # 用零窗口（-beta, -beta+1）验证，仅在未被将军时有效
            if not in_check and depth >= 3 and any(c in pos.board for c in 'RNC'):
                val = -self._negamax(pos.nullmove(), depth - 3, -beta, -beta + 1, ply + 1, ext)
                if self.stop:
                    return alpha
                if val >= beta:
                    return beta

            best = -INF
            best_move = None
            flag = UPPER
            cutoff = False
            first = True

            # ---- 1) 先试置换表走法：命中就直接剪掉，省下整轮走法生成 ----
            if tt_move is not None:
                score = -self._negamax(pos.move(tt_move), depth - 1, -beta, -alpha, ply + 1, ext)
                if self.stop:
                    return alpha
                first = False
                best = score
                best_move = tt_move
                if score > alpha:
                    alpha = score
                    flag = EXACT
                if alpha >= beta:
                    cutoff = True
                    flag = LOWER

            # ---- 2) 没剪掉才生成并排序其余走法 ----
            if not cutoff:
                board = pos.board
                for idx, (_, m) in enumerate(self._ordered_rest(pos, tt_move, ply)):
                    capture = board[m[1]] != '.'
                    nd = depth - 1

                    if first:
                        score = -self._negamax(pos.move(m), nd, -beta, -alpha, ply + 1, ext)
                        first = False
                    else:
                        # 无效着法裁剪：未被将军、深度只剩一层、非将军且静态分远落后于下界
                        if depth == 1 and not capture and not in_check:
                            nxt_p = pos.move(m)
                            if not fast_is_check(nxt_p) and evaluate(pos) + 180 <= alpha and alpha > -MATE_LOWER:
                                continue
                        # PVS：零窗口试探
                        r = 0
                        if not in_check and not capture and depth >= 3 and idx >= 4:
                            r = 1 + (idx >= 8) + (depth >= 6)
                            if r >= nd:
                                r = max(0, nd - 1)
                        score = -self._negamax(pos.move(m), nd - r, -alpha - 1, -alpha, ply + 1, ext)
                        # 削减之后还超出窗口，可能被误伤，老老实实重搜
                        if score > alpha and r:
                            score = -self._negamax(pos.move(m), nd, -alpha - 1, -alpha, ply + 1, ext)
                        if alpha < score < beta:
                            score = -self._negamax(pos.move(m), nd, -beta, -alpha, ply + 1, ext)

                    if self.stop:
                        return alpha
                    if score > best:
                        best = score
                        best_move = m
                    if score > alpha:
                        alpha = score
                        flag = EXACT
                    if alpha >= beta:
                        flag = LOWER
                        cutoff = True
                        if not capture:
                            k = self.killers[ply]
                            if k[0] != m:
                                k[1] = k[0]
                                k[0] = m
                            ih = m[0] * 256 + m[1]
                            if self.history[ih] < HISTORY_CAP:
                                self.history[ih] += depth * depth
                        break

            # ---- 一条活路都没有：将死或困毙。象棋里两者都判负
            #      （原版把困毙当和棋，是错的中国象棋规则）
            if not cutoff and best <= -MATE_LOWER:
                return -MATE_UPPER + ply

            self.tt[key] = (self.gen, depth, flag, _to_tt(best, ply), best_move)
            return best
        finally:
            self.path.pop()
            self.path_set.discard(key)

    # ------------------------------------------------------------------ #
    # 根节点
    # ------------------------------------------------------------------ #

    def _search_root(self, pos, moves, depth, alpha, beta):
        best = -INF
        best_move = moves[0]
        for idx, m in enumerate(moves):
            nd = depth - 1
            if idx == 0:
                score = -self._negamax(pos.move(m), nd, -beta, -alpha, 1)
            else:
                score = -self._negamax(pos.move(m), nd, -alpha - 1, -alpha, 1)
                if alpha < score < beta:
                    score = -self._negamax(pos.move(m), nd, -beta, -alpha, 1)
            if self.stop:
                return best, best_move
            if score > best:
                best = score
                best_move = m
            if score > alpha:
                alpha = score
            if alpha >= beta:
                break
        return best, best_move

    def _search_root_multipv(self, pos, moves, depth, alpha, beta,
                             multipv, root_is_red):
        """根节点多线排名：把根着法逐一带窗搜一遍，按分数从好到差排回来。

        返回 ``[(分数, 走法, 界标, 主变)]``（名次由调用方按顺序给）。走法仍是
        引擎视角的相对坐标 —— 与 ``_search_root`` 一样，翻不翻交给接缝的 adapter；
        主变则和 ``principal_variation`` 一样，已经是绝对坐标。

        窗口纪律照抄单线那套：第一支全窗，其余先零窗试探，只有确实抬高了
        alpha 的才值得全窗复搜。差别只有一处 —— **不在 beta 截断处收手**：
        排名要的是每一支各值多少，砍掉后面那些就排不出来了。

        分数不能一律当成精确值报出去：对 alpha 试探失败的着法拿回来的只是
        **上界**（真值只会更差），把 beta 打穿的只是**下界**。讲解的时候把上界
        当精确分说给学员，等于谎报「你这一手比最优差多少」，所以界标必须一起交出去。
        """
        entries = []
        cur = alpha
        for idx, m in enumerate(moves):
            nd = depth - 1
            child = pos.move(m)
            if idx == 0:
                score = -self._negamax(child, nd, -beta, -cur, 1)
            else:
                score = -self._negamax(child, nd, -cur - 1, -cur, 1)
                if score > cur and score < beta:
                    # 零窗里冒头了：这一支要进排名，得全窗复搜拿精确值
                    score = -self._negamax(child, nd, -beta, -cur, 1)
            if self.stop:
                break
            if score > cur:
                bound = LOWER if score >= beta else EXACT
                cur = score
            else:
                # 连 alpha 都没越过：这个分数只是上界，别拿它当值比大小
                bound = UPPER

            # 主变必须趁现在提。晚一步就不行了：接着搜别的根着法会把子树里的
            # 置换表项覆盖掉，事后再回头拿到的是被别的线污染过的走法。
            # 长度与单线对齐 —— 根那一步算第 1 手，所以子树只取 9 手。
            head = flip_move(m) if not root_is_red else m
            entries.append((score, m, bound,
                            [head] + self.principal_variation(child,
                                                              not root_is_red, 9)))
            if cur >= beta:
                # 整扇窗口都不够用了：这一趟的排名没有意义，
                # 让外面的渴求窗口循环放宽 beta 重来。
                break

        # 稳定排序：同分的保持搜索顺序，上一局排在前面的不会莫名其妙掉到后面
        entries.sort(key=lambda e: -e[0])
        return entries[:multipv]

    # ------------------------------------------------------------------ #
    # 主变提取
    # ------------------------------------------------------------------ #

    def principal_variation(self, pos, root_is_red=True, max_len=10):
        """沿置换表回溯主变，返回 **绝对坐标** 的走法列表。

        引擎视角每走一步就翻转一次，所以第 k 步是否需要翻转回来取决于
        根节点是不是红方走棋。
        """
        pv = []
        seen = set()
        cur = pos
        for k in range(max_len):
            key = cur.board
            if key in seen:
                break
            seen.add(key)
            entry = self.tt.get(key)
            if entry is None or entry[0] != self.gen:
                break
            m = entry[4]
            if m is None:
                break
            legal = None
            for lm in cur.gen_moves():
                if lm == m:
                    legal = lm
                    break
            if legal is None:
                break
            # 送给对方吃老将的走法不该出现在展示用的主变里
            if opponent_can_take_king(cur.move(legal)):
                break
            flipped = (root_is_red == (k % 2 == 1))
            pv.append(flip_move(legal) if flipped else legal)
            cur = cur.move(legal)
        return pv

    # ------------------------------------------------------------------ #
    # 对外入口
    # ------------------------------------------------------------------ #

    def search(self, pos, max_depth=32, time_limit=None,
               game_history=(), external_stop=None, root_is_red=True,
               use_book=True, multipv=1, max_nodes=None):
        """迭代加深搜索，每完成一层 yield 一次快照（多线时每层 yield N 次）。

        ``max_nodes``：节点预算。到了就停，**而且保证 ``nodes`` 不超过它**
        （见 ``_tick`` 与两处自增）。对局度量只能用这个刻度：时间预算在
        同一台机器上都会因为负载漂 2~3 倍，深度预算会因为战术漂（连将把
        深度顶满），只有展开的节点数在两侧都同口径。

        产出字段（**这里的 score 还是内置价值表自己的分，一兵 44**，
        翻成接缝的 centipawn 由 ``engine.BuiltinEngine`` 去做）：
            depth    已完成的深度
            move     引擎视角坐标的走法 ``(from_idx, to_idx)``
            score    侧方视角评分（正=对走子方有利）
            mate     是否为杀棋分数
            mate_in  杀棋还有几步（非负；None = 不是杀棋）
            nodes    累计节点数
            time     累计耗时（秒）
            nps      每秒节点数
            pv       主变（绝对坐标列表）
            multipv  根着法排名，1 起
            bound    分数是精确值还是界（``EXACT`` / ``LOWER`` / ``UPPER``）

        ``multipv=1`` 就是原来那套单线输出：每层一次、rank 恒为 1、界标恒为精确。
        """
        self.gen += 1
        self.nodes = 0
        self.stop = False
        self.external_stop = external_stop
        self._start = time.time()
        self.deadline = (self._start + time_limit) if time_limit else None
        # 预算为 None 时给一个永远碰不到的哨兵，省掉热路径上的 None 判断
        self.node_budget = int(max_nodes) if max_nodes else NO_BUDGET

        # 世代号让旧记录失效，但旧记录仍占内存，超限时整表回收一次
        if len(self.tt) > TABLE_SIZE:
            self.tt.clear()

        # 若为全新对局（棋谱历史为空或仅1步），自动清空杀手走法与历史启发，杜绝前序对局残留污染
        if len(game_history) <= 1:
            self.killers = [[None, None] for _ in range(MAX_PLY)]
            self.history = [0] * (256 * 256)

        # 把真实对局走过的局面喂进路径集合，让重复检测同时覆盖棋谱
        seed = [b if isinstance(b, str) else b.board for b in game_history]
        self.path = list(seed)
        self.path_set = set(seed)

        # 根节点先剔掉送将的走法
        moves = [m for m in pos.gen_moves() if not opponent_can_take_king(pos.move(m))]
        if not moves:
            yield {
                'depth': 0, 'move': None, 'score': -MATE_UPPER, 'mate': True,
                'mate_in': _mate_in(-MATE_UPPER),
                'nodes': 0, 'time': 0.0, 'nps': 0, 'pv': [],
            }
            return

        value = pos.value
        moves.sort(key=value, reverse=True)

        # 优先查询开局库
        if use_book:
            abs_board = pos.board if root_is_red else pos.rotate().board
            abs_m, pv_line = GLOBAL_BOOK.get_book_move(abs_board, root_is_red)
            if abs_m is not None:
                engine_m = abs_m if root_is_red else flip_move(abs_m)
                if engine_m in moves:
                    # 开局库只有一条推荐着法，没有「第 2 名」可排，
                    # 所以 multipv 要几条都只交回 rank 1 这一条（分数是库给的占位分）。
                    elapsed = time.time() - self._start
                    yield {
                        'depth': 1,
                        'move': engine_m,
                        'score': 20,
                        'mate': False,
                        'nodes': 1,
                        'time': max(0.001, elapsed),
                        'nps': 1000,
                        'pv': pv_line,
                        'book': True,
                    }
                    return

        best_move = moves[0]
        best_score = -INF
        delta = 35

        for depth in range(1, max_depth + 1):
            if depth >= 3 and abs(best_score) < MATE_LOWER:
                alpha = best_score - delta
                beta = best_score + delta
            else:
                alpha, beta = -INF, INF

            widen = delta
            ranked = None
            while True:
                if multipv > 1:
                    ranked = self._search_root_multipv(
                        pos, moves, depth, alpha, beta, multipv, root_is_red)
                    if not ranked:
                        # 只可能是停表打断在第一支之前 —— 那就没有什么可排的，
                        # 下面的 self.stop 分支会把这一层整个丢掉。
                        break
                    score, move = ranked[0][0], ranked[0][1]
                else:
                    score, move = self._search_root(pos, moves, depth, alpha, beta)
                if self.stop:
                    break
                if score <= alpha:
                    alpha = max(-INF, score - widen)
                    widen *= 3
                    continue
                if score >= beta:
                    beta = min(INF, score + widen)
                    widen *= 3
                    continue
                break

            if self.stop:
                break

            best_score = score
            best_move = move
            # 根节点的搜索结果不入表（_search_root 不调用 _negamax），
            # 但主变提取要靠它起头，所以这里手动补一条记录。
            self.tt[pos.board] = (
                self.gen, depth, EXACT, _to_tt(best_score, 0), best_move)
            # 把上层的首选挪到最前，下一层第一刀就砍在最有希望的地方
            if best_move in moves:
                moves.remove(best_move)
                moves.insert(0, best_move)

            elapsed = time.time() - self._start
            if ranked is None:
                # 单线：一层一条，分数是全窗搜出来的精确值，排名就是第 1
                ranked = [(best_score, best_move, EXACT,
                           self.principal_variation(pos, root_is_red))]
            for rank, (r_score, r_move, bound, pv) in enumerate(ranked, 1):
                yield {
                    'depth': depth,
                    'move': r_move,
                    'score': r_score,
                    'mate': abs(r_score) >= MATE_LOWER,
                    'mate_in': _mate_in(r_score),
                    'nodes': self.nodes,
                    'time': elapsed,
                    'nps': int(self.nodes / elapsed) if elapsed > 0 else 0,
                    'pv': pv,
                    'multipv': rank,
                    'bound': bound,
                }

            if self.deadline and time.time() > self.deadline:
                break

    # ------------------------------------------------------------------ #
    # 便利方法
    # ------------------------------------------------------------------ #

    def think(self, pos, max_depth=8, time_limit=2.0, game_history=(),
              root_is_red=None, use_book=False, max_nodes=None):
        """一次性拿到最好的一步，返回 ``(move, info)``。

        ``use_book`` 的默认值从 ``True`` 翻成了 ``False``：便利方法替调用方
        做主吃开局库，老 ``tools/arena.py`` 就被这一手坑了 —— 带书的一侧
        开局即中定式，不带书的一侧照旧搜索，量出来的 Elo 差大半是开局库的，
        不是被测改动。开局库必须是调用方**显式点**的变量，不能是默认。
        ``search()`` 的默认值没动：产品走棋（``server/session.py`` 经接缝
        传 ``use_book``）与既有直调方的行为要维持原样。
        """
        if root_is_red is None:
            root_is_red = (len(game_history) % 2 == 1) if game_history else True
        last = None
        for info in self.search(pos, max_depth=max_depth, time_limit=time_limit,
                                game_history=game_history, root_is_red=root_is_red,
                                use_book=use_book, max_nodes=max_nodes):
            last = info
        return (last['move'] if last else None), (last or {})
