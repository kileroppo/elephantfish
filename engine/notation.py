# -*- coding: utf-8 -*-
"""记谱与局面描述：中文记谱 / ICCS 坐标 / FEN。

中文记谱不只是展示用的，它同时是 **一种输入方式**——对手模型给你一串
「炮二平五」，直接敲进去比在棋盘上点两下快得多。所以这里双向都要能用：

    >>> to_chinese(board, move)      # 走法 -> "炮二平五"
    >>> from_chinese(board, "炮二平五", True)   # "炮二平五" -> 走法

规则要点（中国象棋通行记法）：

* 纵线编号各自从本方右侧起数，红用汉字「一~九」，黑用阿拉伯数字「1~9」，
  所以红方的「二路」和黑方的「2 路」指的是不同一侧的同一列镜像。
* 进 / 退 / 平：同一横线为「平」；车炮兵将帅这类直线走子报 **步数**，
  马相仕这类斜走子报 **目标纵线**。
* 同一纵线上有两个同种棋子时，改用「前 / 后」代替纵线号。
"""

from .core import parse, render, PIECE_NAME, ROWS, COLS

CN_DIGITS = '一二三四五六七八九'
CN_TO_NUM = {c: i + 1 for i, c in enumerate(CN_DIGITS)}
CN_TO_NUM.update({str(i + 1): i + 1 for i in range(9)})

# 红黑双方的字形差异：解析时两种写法都接受
NAME_TO_TYPE = {}
for _type, _names in {
    'R': '车車俥', 'N': '马馬傌', 'B': '相象', 'A': '仕士',
    'K': '帅帥将將', 'C': '炮砲', 'P': '兵卒',
}.items():
    for _n in _names:
        NAME_TO_TYPE[_n] = _type

STRAIGHT = set('RCPK')       # 直线走子：进/退报步数
DIAGONAL = set('NBA')        # 斜走子：进/退报目标纵线


# --------------------------------------------------------------------------- #
# 基础换算
# --------------------------------------------------------------------------- #

def file_number(fil, is_red):
    """纵线在记谱里的编号。红方从右往左数（右=1），黑方也从未方视角从右数。"""
    return (9 - fil) if is_red else (fil + 1)


def file_label(num, is_red):
    if not 1 <= num <= 9:
        return str(num)
    return CN_DIGITS[num - 1] if is_red else str(num)


# --------------------------------------------------------------------------- #
# 走法 -> 中文记谱
# --------------------------------------------------------------------------- #

def to_chinese(board, move):
    """把绝对坐标走法翻译成中文记谱。``board`` 必须是绝对棋盘（红在下）。"""
    src, dst = move
    name_src = render(src)
    name_dst = render(dst)
    fi, ri = ord(name_src[0]) - 97, int(name_src[1])
    fj, rj = ord(name_dst[0]) - 97, int(name_dst[1])

    piece = board[src]
    is_red = piece.isupper()
    kind = piece.upper()
    name = PIECE_NAME[piece]

    # ---- 同一纵线上的同种棋子：改用 前/中/后 ----
    same = [r for r in range(ROWS) if board[parse(chr(ord('a') + fi) + str(r))] == piece]
    if len(same) >= 2:
        # 前 = 离对方最近的那颗
        order = sorted(same, reverse=is_red)
        idx = order.index(ri)
        if len(order) == 2:
            prefix = '前' if idx == 0 else '后'
        elif len(order) == 3:
            prefix = ('前', '中', '后')[idx]
        else:
            prefix = ('前' if idx == 0 else '后' if idx == len(order) - 1 else '中')
        head = prefix + name
    else:
        head = name + file_label(file_number(fi, is_red), is_red)

    # ---- 进 / 退 / 平 ----
    if ri == rj:
        return head + '平' + file_label(file_number(fj, is_red), is_red)

    forward = (rj > ri) if is_red else (rj < ri)
    verb = '进' if forward else '退'
    if kind in STRAIGHT:
        return head + verb + file_label(abs(rj - ri), is_red)
    return head + verb + file_label(file_number(fj, is_red), is_red)


# --------------------------------------------------------------------------- #
# 中文记谱 -> 走法
# --------------------------------------------------------------------------- #

def from_chinese(board, text, is_red, legal=None):
    """把中文记谱解析成绝对坐标走法；解析不出来或不合规返回 ``None``。

    ``legal`` 传当前合法走法列表时会做一次校验，避免解析出「看起来对但走不了」
    的结果。
    """
    if not text:
        return None
    s = ''.join(text.split())
    if len(s) < 3:
        return None

    i = 0
    prefix = None
    if s[0] in '前中后':
        prefix = s[0]
        i = 1
    if i >= len(s):
        return None

    name_ch = s[i]
    i += 1
    kind = NAME_TO_TYPE.get(name_ch)
    if kind is None:
        return None

    piece = kind if is_red else kind.lower()

    file_num = None
    if prefix is None:
        if i >= len(s) or s[i] not in CN_TO_NUM:
            return None
        file_num = CN_TO_NUM[s[i]]
        i += 1

    if i >= len(s):
        return None
    verb = s[i]
    i += 1
    if verb == '回':          # 少数棋谱写「回」，等同于「平」
        verb = '平'
    if verb not in '平进退回':
        return None

    rest = s[i:]
    if not rest or rest[0] not in CN_TO_NUM:
        return None
    num = CN_TO_NUM[rest[0]]

    # ---- 找出所有候选棋子 ----
    cands = []
    for fil in range(COLS):
        for rank in range(ROWS):
            sq = parse(chr(ord('a') + fil) + str(rank))
            if board[sq] == piece:
                cands.append((fil, rank, sq))
    if not cands:
        return None

    if prefix is not None:
        # 「前/中/后」只在同一纵线上有多个同种棋子时才有意义
        by_file = {}
        for fil, rank, sq in cands:
            by_file.setdefault(fil, []).append((rank, sq))
        picked = None
        for fil, group in sorted(by_file.items()):
            if len(group) < 2:
                continue
            order = sorted(group, key=lambda t: t[0], reverse=is_red)
            if prefix == '前':
                pick = 0
            elif prefix == '后':
                pick = len(order) - 1
            else:                       # 中
                pick = len(order) // 2
            picked = (fil, order[pick][0], order[pick][1])
            break
        if picked is None:
            return None
        cands = [picked]
    else:
        cands = [c for c in cands if file_number(c[0], is_red) == file_num]
        if not cands:
            return None

    # ---- 推出目标格 ----
    target_fil = (9 - num) if is_red else (num - 1)
    forward = (verb == '进') if is_red else (verb == '退')

    exact = []
    for fil, rank, sq in cands:
        if verb == '平':
            dr = rank
        elif kind in STRAIGHT:
            dr = rank + num if forward else rank - num
            if not 0 <= dr < ROWS:
                continue
            dst = parse(chr(ord('a') + fil) + str(dr))
            exact.append((sq, dst))
            continue
        else:
            continue                     # 斜走子交给下面按合法走法反查
        if 0 <= target_fil < COLS:
            exact.append((sq, parse(chr(ord('a') + target_fil) + str(dr))))

    if legal is not None:
        exact = [m for m in exact if m in legal]
    if exact:
        return exact[0]
    if legal is None:
        return None

    # ---- 斜走子（马相仕）：目标纵线已知，方向由「进/退」确定 ----
    cand_srcs = {c[2] for c in cands}
    for src, dst in legal:
        if src not in cand_srcs:
            continue
        dname = render(dst)
        if ord(dname[0]) - ord('a') != target_fil:
            continue
        srank, drank = int(render(src)[1]), int(dname[1])
        if (drank > srank) != forward:
            continue
        return (src, dst)
    return None


# --------------------------------------------------------------------------- #
# ICCS
# --------------------------------------------------------------------------- #

def to_iccs(move):
    return render(move[0]) + render(move[1])


def from_iccs(text):
    """``'h2e2'`` -> ``(索引, 索引)``；格式不对返回 ``None``。"""
    if not text:
        return None
    s = ''.join(text.split()).lower()
    if len(s) != 4:
        return None
    for ch in (s[0], s[2]):
        if not ('a' <= ch <= 'i'):
            return None
    for ch in (s[1], s[3]):
        if not ('0' <= ch <= '9'):
            return None
    return (parse(s[0:2]), parse(s[2:4]))


# --------------------------------------------------------------------------- #
# FEN
# --------------------------------------------------------------------------- #

def to_fen(board, red_to_move=True, halfmove=0, fullmove=1):
    """导出象棋标准 FEN（自黑方底线起逐行向下）。"""
    rows = []
    for rank in range(ROWS - 1, -1, -1):
        row = ''
        empty = 0
        for fil in range(COLS):
            ch = board[parse(chr(ord('a') + fil) + str(rank))]
            if ch == '.':
                empty += 1
                continue
            if empty:
                row += str(empty)
                empty = 0
            row += ch
        if empty:
            row += str(empty)
        rows.append(row)
    side = 'w' if red_to_move else 'b'
    return '/'.join(rows) + f' {side} - - {halfmove} {fullmove}'


def from_fen(fen):
    """解析 FEN，返回 ``(board, red_to_move, halfmove, fullmove)``。"""
    from .core import initial as _initial

    parts = fen.strip().split()
    if not parts:
        raise ValueError('FEN 为空')
    rows = parts[0].split('/')
    if len(rows) != ROWS:
        raise ValueError(f'FEN 应有 {ROWS} 行，实际 {len(rows)} 行')

    chars = list(_initial)
    for r in range(ROWS):
        for f in range(COLS):
            chars[parse(chr(ord('a') + f) + str(r))] = '.'
    for r, row in enumerate(rows):
        rank = ROWS - 1 - r          # 第一行是黑方底线 = rank 9
        fil = 0
        for ch in row:
            if ch.isdigit():
                fil += int(ch)
                continue
            if fil >= COLS:
                raise ValueError('FEN 某行超出 9 列')
            chars[parse(chr(ord('a') + fil) + str(rank))] = ch
            fil += 1
        if fil > COLS:
            raise ValueError('FEN 某行超出 9 列')

    side = parts[1] if len(parts) > 1 else 'w'
    halfmove = int(parts[4]) if len(parts) > 4 else 0
    fullmove = int(parts[5]) if len(parts) > 5 else 1
    return ''.join(chars), side.lower() != 'b', halfmove, fullmove
