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
)

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

        key = pos.board
        if key in self.path_set:
            return 0

        stand = pos.score
        if stand >= beta:
            return stand
        if stand > alpha:
            alpha = stand

        self.path.append(key)
        self.path_set.add(key)
        try:
            board = pos.board
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
                score = -self._qsearch(pos.move(m), -beta, -alpha, ply + 1)
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

    def _negamax(self, pos, depth, alpha, beta, ply):
        self.nodes += 1
        if not (self.nodes & 1023):
            self._tick()
        if self.stop:
            return alpha

        if pos.score <= -MATE_LOWER:
            return -MATE_UPPER + ply

        key = pos.board
        # 搜索路径上出现重复局面 -> 判和，免得引擎在均势里空转
        if key in self.path_set:
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

        if depth <= 0:
            return self._qsearch(pos, alpha, beta, ply)

        self.path.append(key)
        self.path_set.add(key)
        try:
            # ---- 空着裁剪：假设我白让一手对方都拿我没办法，那我更输不了 ----
            # 用零窗口（-beta, -beta+1）验证，所以宽窗口下也安全。
            if depth >= 3 and any(c in pos.board for c in 'RNC'):
                val = -self._negamax(pos.nullmove(), depth - 3, -beta, -beta + 1, ply + 1)
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
                score = -self._negamax(pos.move(tt_move), depth - 1, -beta, -alpha, ply + 1)
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
                        score = -self._negamax(pos.move(m), nd, -beta, -alpha, ply + 1)
                        first = False
                    else:
                        # 无效着法裁剪：深度只剩一层，且当前静态分已经远低于
                        # 窗口下界，那么任何不吃子、不将军的走法都救不回来。
                        if depth == 1 and not capture and pos.score + 180 <= alpha \
                                and alpha > -MATE_LOWER:
                            continue
                        # PVS：零窗口试探
                        r = 0
                        if not capture and depth >= 3 and idx >= 4:
                            r = 1 + (idx >= 8) + (depth >= 6)
                            if r >= nd:
                                r = max(0, nd - 1)
                        score = -self._negamax(pos.move(m), nd - r, -alpha - 1, -alpha, ply + 1)
                        # 削减之后还超出窗口，可能被误伤，老老实实重搜
                        if score > alpha and r:
                            score = -self._negamax(pos.move(m), nd, -alpha - 1, -alpha, ply + 1)
                        if alpha < score < beta:
                            score = -self._negamax(pos.move(m), nd, -beta, -alpha, ply + 1)

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
               game_history=(), external_stop=None, root_is_red=True):
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
              root_is_red=True):
        """一次性拿到最好的一步，返回 ``(move, info)``。"""
        last = None
        for info in self.search(pos, max_depth=max_depth, time_limit=time_limit,
                                game_history=game_history, root_is_red=root_is_red):
            last = info
        return (last['move'] if last else None), (last or {})
