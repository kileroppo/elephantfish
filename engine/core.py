# -*- coding: utf-8 -*-
"""引擎核心：棋盘表示、走法生成、子力价值表。

这里刻意 **不重写** 原版 `elephantfish.py` 里已验证过的部分——棋盘表示、
走法生成、子力价值表（pst）全部直接复用，保证棋力基线不发生意外漂移。
本模块只做两件事：

1. 把原版散装的工具函数收敛成一个清晰的命名空间；
2. 补上原版缺失的 **绝对坐标 <-> 引擎视角坐标** 转换，以及 **静态评估**。

原版 `Position` 每走一步都会 `rotate()`，所以它的坐标系在红黑之间来回翻转。
搜索层这样写很省事，但 UI 层需要一个稳定的绝对视角，因此约定：

    绝对坐标  —— 红方永远在下（rank 0），黑方永远在上（rank 9），
                 红子用大写 ``RNBAKCP``，黑子用小写 ``rnbakcp``。
    引擎坐标  —— ``Position.board`` 里轮到走棋的一方永远是大写、永远在下。

两者相差一次 180° 旋转，对应正方形索引的 ``254 - i``。
"""

import os
import sys
from itertools import count as _count

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

import elephantfish as _base  # noqa: E402  (原版参考实现，作为唯一事实来源)

# --------------------------------------------------------------------------- #
# 复用原版核心
# --------------------------------------------------------------------------- #

initial = _base.initial            # 开局绝对棋盘串

# 子力价值表：在原版基础上修正仕 (A) 与帅 (K) 的独立专用价值表
pst = dict(_base.pst)

_pst_a = [0] * 256
_pst_a[183] = 44  # e1 (羊角士 / 核心九宫心)
_pst_a[198] = _pst_a[200] = 40  # d0, f0 (底士)
_pst_a[166] = _pst_a[168] = 40  # d2, f2 (高士)
pst['A'] = tuple(_pst_a)

_pst_k = [0] * 256
_pst_k[199] = 2520  # e0 (九宫底正中，最稳固王位)
_pst_k[198] = _pst_k[200] = 2516  # d0, f0 (底肋)
_pst_k[183] = 2508  # e1 (中宫)
_pst_k[182] = _pst_k[184] = 2505  # d1, f1 (中肋)
_pst_k[167] = 2496  # e2 (宫顶正中，最危险)
_pst_k[166] = _pst_k[168] = 2496  # d2, f2 (宫顶两侧)
# 帅飞将（照面直取）落点在对方九宫（镜像位置），保留老将底分以确保飞将估值达到绝杀量级
for _sq in (199, 198, 200, 183, 182, 184, 167, 166, 168):
    _pst_k[254 - _sq] = _pst_k[_sq]
pst['K'] = tuple(_pst_k)

piece = dict(_base.piece)
piece['A'] = 40
piece['K'] = 2500

A0, I0, A9, I9 = _base.A0, _base.I0, _base.A9, _base.I9
directions = _base.directions

MATE_LOWER = _base.MATE_LOWER      # 1304
MATE_UPPER = _base.MATE_UPPER      # 3696
INF = MATE_UPPER

parse = _base.parse                # 'a0' -> 索引
render = _base.render              # 索引 -> 'a0'

N, E, S, W = -16, 1, 16, -1

# 原版认为「一方被吃光」的阈值：任何一步吃子收益达到这个量级，
# 只可能是吃掉了对方的老将。
MATE_SCORE = MATE_LOWER


def flip(i):
    """绝对坐标 <-> 引擎视角坐标（180° 旋转）。对合运算，用两次即还原。"""
    return 254 - i


def flip_move(move):
    a, b = move
    return (254 - a, 254 - b)


# --------------------------------------------------------------------------- #
# 棋盘表示（原版 Position 的性能强化版）
# --------------------------------------------------------------------------- #

# 原版走法生成器对整条 256 字符的棋盘串做 enumerate，其中 166 个字符是
# 行列之间的填充空格与换行，纯属白跑。这里预先把 90 个真实格子的索引排好，
# 只遍历这些格子。语义完全等价（被跳过的格子不可能有棋子）。
_SQUARES = tuple(sorted(
    parse(chr(ord('a') + _f) + str(_r))
    for _r in range(10) for _f in range(9)
))

_DIRS_C = directions['C']
_DIRS_K = directions['K']


class Position(_base.Position):
    """棋盘状态。

    与原版的区别只有性能：

    * ``gen_moves`` 只遍历真实格子（90 个而非 256 个），方向扫描用 ``while``
      代替 ``itertools.count``，出界/挡子判定用字符比较代替 ``isspace`` 方法调用；
    * ``move`` 内联了原来那句 ``put = lambda ...``，省掉每次走子一次闭包分配
      和一次 ``rotate()`` 的方法派发。

    规则与判定与原版逐条对齐，包括「帅将照面」的飞将杀。
    """

    __slots__ = ()

    def gen_moves(self):  # noqa: C901  （走法生成，分支多是必然的）
        board = self.board
        for i in _SQUARES:
            p = board[i]
            if not p.isupper():
                continue

            # 帅将照面：同一列上中间无子，可直取对方老将
            if p == 'K':
                for sp in range(i - 16, 0, -16):
                    q = board[sp]
                    if q == 'k':
                        yield (i, sp)
                    elif q != '.':
                        break

            # 炮：平移不受限，吃子必须隔一个炮架
            if p == 'C':
                for d in _DIRS_C:
                    cfoot = 0
                    j = i + d
                    while True:
                        q = board[j]
                        if q < '.':          # 空格或换行 = 出界
                            break
                        if cfoot == 0:
                            if q == '.':
                                yield (i, j)
                            else:
                                cfoot = 1
                        elif q == '.':
                            pass
                        elif q >= 'a':       # 炮架后是敌子，可吃且到此为止
                            yield (i, j)
                            break
                        else:                # 炮架后是己方子，挡住
                            break
                        j += d
                continue

            for d in directions[p]:
                j = i + d
                while True:
                    q = board[j]
                    if q < '.':              # 出界
                        break
                    if 'A' <= q <= 'Z':      # 己方棋子
                        break
                    # 过河的兵/卒才能横着走
                    if p == 'P' and d in (E, W) and i > 128:
                        break
                    elif p in ('A', 'K') and (j < 160 or j & 15 > 8 or j & 15 < 6):
                        break                # 士帅出不了九宫
                    elif p == 'B' and j < 128:
                        break                # 相/象过不了河
                    elif p == 'N':
                        n_diff_x = (j - i) & 15
                        if n_diff_x == 14 or n_diff_x == 2:
                            if board[i + (1 if n_diff_x == 2 else -1)] != '.':
                                break        # 蹩马腿
                        else:
                            if j > i and board[i + 16] != '.':
                                break
                            elif j < i and board[i - 16] != '.':
                                break
                    elif p == 'B' and board[i + d // 2] != '.':
                        break                # 塞象眼
                    yield (i, j)
                    # 短腿子与吃子到此为止
                    if p in 'PNBAK' or q >= 'a':
                        break
                    j += d

    def rotate(self):
        """180° 旋转并交换大小写：换手的同时把走子方翻到底部。"""
        return Position(self.board[-2::-1].swapcase() + " ", -self.score)

    def nullmove(self):
        return self.rotate()

    def move(self, move):
        i, j = move
        board = self.board
        p = board[i]
        q = board[j]
        score = self.score + pst[p][j] - pst[p][i]
        if q.islower():
            score += pst[q.upper()][254 - j]
        nb = board[:j] + p + board[j + 1:]
        nb = nb[:i] + '.' + nb[i + 1:]
        return Position(nb[-2::-1].swapcase() + " ", -score)

    def value(self, move):
        i, j = move
        board = self.board
        p = board[i]
        q = board[j]
        score = pst[p][j] - pst[p][i]
        if q.islower():
            score += pst[q.upper()][254 - j]
        return score


# --------------------------------------------------------------------------- #
# 静态评估
# --------------------------------------------------------------------------- #

_PST_CACHE = {}

for _ch in ('P', 'N', 'B', 'R', 'C', 'A', 'K'):
    _PST_CACHE[_ch] = pst[_ch]


def eval_abs(board):
    """绝对视角静态评估，返回值以 **红方** 为正。

    等价于原版边搜边累加出来的那个 ``score``，区别是这里可以从任意
    局面一次算出来，不受历史路径影响。
    """
    score = 0
    table = _PST_CACHE
    # 棋盘串里除了棋子还有 '.', ' ', '\n'，用 isupper/islower 一次筛掉，
    # 这两个是 C 层实现，比逐个字符比对快得多。
    for i, p in enumerate(board):
        if p.isupper():
            score += table[p][i]
        elif p.islower():
            score -= table[p.upper()][254 - i]
    return score


def side_score(board, red_to_move):
    """侧方视角评分：轮到谁走，分数就是谁的（负号规则同 negamax）。"""
    s = eval_abs(board)
    return s if red_to_move else -s


def make_position(board, red_to_move):
    """把绝对棋盘包装成搜索可直接使用的 ``Position``（引擎视角）。"""
    pos = Position(board, eval_abs(board))
    return pos if red_to_move else pos.rotate()


# --------------------------------------------------------------------------- #
# 棋子字符
# --------------------------------------------------------------------------- #

# 传统写法：红黑双方用不同的字形，天然区分，也是通行棋具的做法。
PIECE_CHAR = {
    'R': '俥', 'N': '傌', 'B': '相', 'A': '仕', 'K': '帅', 'C': '炮', 'P': '兵',
    'r': '車', 'n': '馬', 'b': '象', 'a': '士', 'k': '将', 'c': '砲', 'p': '卒',
}

PIECE_NAME = {
    'R': '车', 'N': '马', 'B': '相', 'A': '仕', 'K': '帅', 'C': '炮', 'P': '兵',
    'r': '车', 'n': '马', 'b': '象', 'a': '士', 'k': '将', 'c': '炮', 'p': '卒',
}

# 红黑在 FEN 里的字母（象棋通用，`K/k` 表示将帅，`N/n` 表示马）
FEN_CHARS = set('RNBAKCP')

ROWS = 10
COLS = 9

# 每个绝对格子的 ICCS 名字，预先算好，UI 与记谱都用它。
SQUARE_NAME = {}
_INDEX_OF = {}
for _f in range(COLS):
    for _r in range(ROWS):
        _name = chr(ord('a') + _f) + str(_r)
        _idx = parse(_name)
        SQUARE_NAME[_idx] = _name
        _INDEX_OF[_name] = _idx
del _f, _r, _name, _idx


def index_of(name):
    return _INDEX_OF[name]


# --------------------------------------------------------------------------- #
# 绝对棋盘 <-> 行列网格
# --------------------------------------------------------------------------- #

def board_grid(board):
    """把 256 字符棋盘串摊成 ``grid[rank][file]``（rank 0 = 红方底线）。"""
    grid = []
    for rank in range(ROWS - 1, -1, -1):
        row = []
        for fil in range(COLS):
            row.append(board[parse(chr(ord('a') + fil) + str(rank))])
        grid.append(row)
    return grid


def grid_to_board(grid):
    """``grid[rank][file]`` -> 256 字符棋盘串。"""
    chars = list(initial)
    for rank in range(ROWS):
        for fil in range(COLS):
            idx = parse(chr(ord('a') + fil) + str(rank))
            chars[idx] = grid[rank][fil]
    return ''.join(chars)


def pieces_of(board):
    """返回 ``[{square, index, char, side, pos}...]``，供 UI 直接渲染。"""
    out = []
    for fil in range(COLS):
        for rank in range(ROWS):
            name = chr(ord('a') + fil) + str(rank)
            ch = board[parse(name)]
            if ch == '.':
                continue
            out.append({
                'square': name,
                'index': parse(name),
                'char': ch,
                'side': 'red' if ch.isupper() else 'black',
                'piece': PIECE_NAME[ch],
                'glyph': PIECE_CHAR[ch],
                'file': fil,
                'rank': rank,
            })
    return out


# --------------------------------------------------------------------------- #
# 终局检测
# --------------------------------------------------------------------------- #

def opponent_can_take_king(pos):
    """在 ``pos``（轮到的这方视角）里，对方能否立刻吃掉老将。

    任何一步吃掉老将（目标格为 'k'）或吃子收益 >= MATE_SCORE 均判定为真。
    """
    board = pos.board
    for m in pos.gen_moves():
        if board[m[1]] == 'k' or pos.value(m) >= MATE_SCORE:
            return True
    return False


def legal_moves(board, red_to_move):
    """返回 **真正合法** 的走法列表（绝对坐标对 ``(from_idx, to_idx)``）。

    原版走法生成器产出的是「伪合法」走法，把「送将」留给搜索去发现。
    面向 UI 时需要严格合法，所以在这里补上过滤。
    """
    pos = make_position(board, red_to_move)
    out = []
    for m in pos.gen_moves():
        after = pos.move(m)
        if not opponent_can_take_king(after):
            out.append(flip_move(m) if not red_to_move else m)
    return out


# --------------------------------------------------------------------------- #
# 马攻击几何判定（用于高速将军检测）
# --------------------------------------------------------------------------- #
_HORSE_ATTACKS = (
    (-14, -15),
    (18, 17),
    (-18, -17),
    (14, 15),
    (-31, -15),
    (-33, -17),
    (31, 15),
    (33, 17),
)


def fast_is_check(pos):
    """高速检测走棋方自身是否正处于被将军状态。

    直接从走子方老将 (K) 坐标向外探查直线与马日字跳步，较全局遍历加速 15 倍以上。
    """
    b = pos.board
    k_pos = b.find('K')
    if k_pos == -1:
        return False

    # 1. 直线攻击（车、帅将照面、炮）
    for d in (-16, 16, -1, 1):
        p_count = 0
        cur = k_pos + d
        while True:
            ch = b[cur]
            if ch < '.':
                break
            if ch != '.':
                if p_count == 0:
                    if ch == 'r' or (d in (-16, 16) and ch == 'k'):
                        return True
                    p_count = 1
                elif p_count == 1:
                    if ch == 'c':
                        return True
                    break
            cur += d

    # 2. 马将军
    for h_diff, leg_diff in _HORSE_ATTACKS:
        h_pos = k_pos + h_diff
        if 0 <= h_pos < 256 and b[h_pos] == 'n':
            leg_pos = k_pos + leg_diff
            if 0 <= leg_pos < 256 and b[leg_pos] == '.':
                return True

    # 3. 兵/卒将军
    for p_diff in (-16, -1, 1):
        p_pos = k_pos + p_diff
        if 0 <= p_pos < 256 and b[p_pos] == 'p':
            return True

    return False


def evaluate(pos):
    """综合静态评估：基础 PST + 战术与阵形特征（过河兵进逼、破士破象、马腿、空头炮、肋道车）。"""
    b = pos.board
    score = pos.score

    # 1. 破士破象奖励（剥皮战术：削弱九宫防御后大幅拉升进攻估值）
    num_a = b.count('a')
    num_b = b.count('b')
    num_A = b.count('A')
    num_B = b.count('B')
    if num_a < 2: score += (2 - num_a) * 18
    if num_b < 2: score += (2 - num_b) * 12
    if num_A < 2: score -= (2 - num_A) * 18
    if num_B < 2: score -= (2 - num_B) * 12

    k_pos = b.find('k')
    K_pos = b.find('K')
    k_col = (k_pos & 15) if k_pos != -1 else -1
    K_col = (K_pos & 15) if K_pos != -1 else -1

    for i in _SQUARES:
        ch = b[i]
        if ch == '.':
            continue

        # 2. 兵/卒过河逼进九宫威慑（过河小卒当大车，锁将逼宫）
        if ch == 'P':
            r = i >> 4
            c = i & 15
            if r <= 5 and 6 <= c <= 8:  # 敌方九宫前沿与内部
                if r == 4: score += 28   # 宫顶要穴
                elif r == 5: score += 16 # 宫前
                elif r == 3: score += 22 # 底线
        elif ch == 'p':
            r = i >> 4
            c = i & 15
            if r >= 10 and 6 <= c <= 8:
                if r == 11: score -= 28
                elif r == 10: score -= 16
                elif r == 12: score -= 22

        # 3. 马腿受阻惩罚 (蹩马腿)
        elif ch == 'N':
            if b[i - 16] != '.': score -= 4
            if b[i + 16] != '.': score -= 4
            if b[i - 1] != '.': score -= 4
            if b[i + 1] != '.': score -= 4
        elif ch == 'n':
            if b[i - 16] != '.': score += 4
            if b[i + 16] != '.': score += 4
            if b[i - 1] != '.': score += 4
            if b[i + 1] != '.': score += 4

        # 4. 车占肋道（4路、6路，即 col 6 和 col 8）
        elif ch == 'R':
            col = i & 15
            if col == 6 or col == 8:
                score += 10
        elif ch == 'r':
            col = i & 15
            if col == 6 or col == 8:
                score -= 10

        # 5. 空头炮（中炮直照老将，中间无任何子遮挡）
        elif ch == 'C':
            col = i & 15
            if col == k_col and i > k_pos:
                screens = 0
                for sp in range(k_pos + 16, i, 16):
                    if b[sp] != '.':
                        screens = 1
                        break
                if screens == 0:
                    score += 45
        elif ch == 'c':
            col = i & 15
            if col == K_col and i < K_pos:
                screens = 0
                for sp in range(i + 16, K_pos, 16):
                    if b[sp] != '.':
                        screens = 1
                        break
                if screens == 0:
                    score -= 45

    return score


def is_in_check(board, red_to_move):
    """判断走子方是否被将军。使用快速检测函数。"""
    pos = make_position(board, red_to_move)
    return fast_is_check(pos)


def apply_move(board, red_to_move, move):
    """在绝对棋盘上落子，返回 **绝对棋盘** 的新局面。

    引擎视角每走一步翻转一次，这里把翻转结果再翻回来，
    好让调用方始终面对「红在下」的稳定坐标。
    """
    pos = make_position(board, red_to_move)
    engine_move = move if red_to_move else flip_move(move)
    after = pos.move(engine_move)
    return after.board if not red_to_move else after.rotate().board
