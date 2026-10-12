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

    # ------------------------------------------------------------------ #
    # 时间与中断
    # ------------------------------------------------------------------ #

    def _tick(self):
        """每 1024 个节点查一次时间，别把时间浪费在 time() 上。"""
        if self.deadline is not None and time.time() > self.deadline:
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
        self.nodes += 1
        if not (self.nodes & 1023):
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
        self.nodes += 1
        if not (self.nodes & 1023):
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
               use_book=True):
        """迭代加深搜索，每完成一层 yield 一次快照。

        产出字段：
            depth  已完成的深度
            move   引擎视角坐标的走法 ``(from_idx, to_idx)``
            score  侧方视角评分（正=对走子方有利）
            mate   是否为杀棋分数
            nodes  累计节点数
            time   累计耗时（秒）
            nps    每秒节点数
            pv     主变（引擎视角坐标列表）
        """
        self.gen += 1
        self.nodes = 0
        self.stop = False
        self.external_stop = external_stop
        self._start = time.time()
        self.deadline = (self._start + time_limit) if time_limit else None

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
            while True:
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
            yield {
                'depth': depth,
                'move': best_move,
                'score': best_score,
                'mate': abs(best_score) >= MATE_LOWER,
                'nodes': self.nodes,
                'time': elapsed,
                'nps': int(self.nodes / elapsed) if elapsed > 0 else 0,
                'pv': self.principal_variation(pos, root_is_red),
            }

            if self.deadline and time.time() > self.deadline:
                break

    # ------------------------------------------------------------------ #
    # 便利方法
    # ------------------------------------------------------------------ #

    def think(self, pos, max_depth=8, time_limit=2.0, game_history=(),
              root_is_red=None, use_book=True):
        """一次性拿到最好的一步，返回 ``(move, info)``。"""
        if root_is_red is None:
            root_is_red = (len(game_history) % 2 == 1) if game_history else True
        last = None
        for info in self.search(pos, max_depth=max_depth, time_limit=time_limit,
                                game_history=game_history, root_is_red=root_is_red,
                                use_book=use_book):
            last = info
        return (last['move'] if last else None), (last or {})
