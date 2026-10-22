# -*- coding: utf-8 -*-
"""象棋棋理与战术特征提取引擎 + 自动教案编译器（Tactical Lens & Auto-Drill Compiler）。

从第一性原理出发，弥合「引擎标量分数（cp / PV）」与「人类棋理认知」之间的断层：
1. 子力攻防图（Attack / Defense Graph）：
   - 精确遵循中国象棋规则（含蹩马腿、塞象眼、炮隔一架、九宫限制、过河兵），
     毫秒级算出盘面每一格的攻防关系；
   - 识别「无根子（Hanging）」「受攻大子」「以小换大威胁」「一子双捉 / 抽将」。
2. 九宫命门与王安全度（King Safety & Palace Control）：
   - 统计老将合法逃生格、九宫受攻点、中路与肋道（d/e/f 线）及底线封锁状态。
3. 走前 / 走后 / 正解三态差分诊断（Move Tactical Diagnosis）：
   - 将冰冷的评分损益转化为可验证的棋理病因标签（Motifs）：
     * ``missed_mate``      （#错失必杀：手握杀棋未走，放虎归山）
     * ``walked_into_mate`` （#漏防杀棋：走后暴露九宫命门，遭敌绝杀或叫杀）
     * ``greedy_capture``   （#贪吃失先：贪吃小利而致大子受攻或防线崩溃）
     * ``fork_or_skewer``   （#遭抽将捉双：走后被敌方将军抽子或一子双捉）
     * ``left_hanging``     （#丢无根子：主力失去根保护或直接送吃）
     * ``missed_tactics``   （#漏看战术：敌方大子无根或有先手妙着而未取）
     * ``king_exposed``     （#九宫受逼：肋道/底线失守，老将活动受限）
     * ``lost_tempo``       （#缓手失先：行棋缺乏针对性，被敌抢占先机）
4. 自动教案编译器（Auto-Drill Compiler）：
   - 将实战中的任何错题或败着，自动编译为具备「三段式传功（演示/试炼/大考）」、
     「反击陷阱树（traps）」、「三阶法眼视觉线索（visual_clues）」的完整名师关卡。
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Set, Tuple

from engine import core
from engine import notation as nt

# 标准棋理子力刻度（centipawn，仅用于攻防交换得失权衡）
PIECE_CP: Dict[str, int] = {
    'R': 900, 'r': 900,
    'N': 450, 'n': 450,
    'C': 450, 'c': 450,
    'A': 200, 'a': 200,
    'B': 200, 'b': 200,
    'P': 120, 'p': 120,
    'K': 10000, 'k': 10000,
}

MAJOR_TYPES = frozenset({'R', 'N', 'C'})

# 病因分类词典（用于个人病因图谱聚合与展示）
MOTIF_CATALOG: Dict[str, Dict[str, str]] = {
    'missed_mate': {
        'id': 'missed_mate',
        'label': '错失必杀',
        'icon': '⚡',
        'desc': '局面已现连环绝杀良机，实战未能一锤定音。',
        'advice': '专项演练「实用绝杀心法」，养成每手先算「叫将、封肋、锁底」的算杀习惯。',
    },
    'walked_into_mate': {
        'id': 'walked_into_mate',
        'label': '漏防杀棋',
        'icon': '🛡️',
        'desc': '忽视敌方对九宫底线或肋道的致命杀胁，落子后即遭绝杀。',
        'advice': '落子前必先审视己方老将有几个逃生格、中路与底线是否有敌方车炮潜伏。',
    },
    'greedy_capture': {
        'id': 'greedy_capture',
        'label': '贪吃失先',
        'icon': '🪤',
        'desc': '贪图吃兵或次要子力，导致主力脱离防线或丢失关键先手。',
        'advice': '谨记“宁失一子，莫失一先”，吃子前先问：吃掉之后对方第一步反击打在哪里？',
    },
    'fork_or_skewer': {
        'id': 'fork_or_skewer',
        'label': '遭抽将捉双',
        'icon': '⚔️',
        'desc': '子力站位重叠或老将暴露，被敌方一子双捉、闪击或叫将抽子。',
        'advice': '避免车马炮与老将共线成为炮架，时刻警惕敌方马卧槽与炮闪击路线。',
    },
    'left_hanging': {
        'id': 'left_hanging',
        'label': '丢无根子',
        'icon': '🎯',
        'desc': '走子后己方车、马、炮失去根保护，或直接置入敌方攻击口。',
        'advice': '行棋讲究「子力连环、互为根护」，动子前检查原本由它保护的友军是否会变成无根孤子。',
    },
    'missed_tactics': {
        'id': 'missed_tactics',
        'label': '漏看妙手',
        'icon': '💡',
        'desc': '盘面存在先手得子或攻破弱点的战术打击，实战选择了平庸招法。',
        'advice': '多观察敌方「无根子」与「唯一保护子」，利用先手叫将或捉车顺势得子。',
    },
    'king_exposed': {
        'id': 'king_exposed',
        'label': '九宫受逼',
        'icon': '🏯',
        'desc': '士象防线松动或肋道门户洞开，导致老将受敌方重兵压迫。',
        'advice': '切忌轻率飞边象或支散联防之士，中路与四六路肋道需有强子镇守。',
    },
    'lost_tempo': {
        'id': 'lost_tempo',
        'label': '缓手失先',
        'icon': '⏳',
        'desc': '走出的棋步缺乏实质威胁，将局面主动权拱手让人。',
        'advice': '中局阶段每一手都应兼具「出动主力、限制敌子、埋伏先手」多重效率。',
    },
}

# 通俗大白话词典（将专业术语翻译为人人秒懂的直白语言）
PLAIN_MOTIF_DESC: Dict[str, Dict[str, str]] = {
    'missed_mate': {
        'plain_label': '错过绝杀（放跑对手老将）',
        'plain_why': '原本可以连续将军直接赢下比赛，走这步棋让对手老将逃过一劫。',
    },
    'walked_into_mate': {
        'plain_label': '没防杀棋（老将遇险）',
        'plain_why': '对手已经在瞄准你的老将准备绝杀，这步棋没有及时解危，马上会被将死。',
    },
    'greedy_capture': {
        'plain_label': '贪吃小利吃大亏',
        'plain_why': '只顾着吃对手一个子，结果自己的大子暴露或防线空虚，被对手反手痛击。',
    },
    'fork_or_skewer': {
        'plain_label': '被对手一箭双雕（抽将/捉双）',
        'plain_why': '走完这步后，你的两个棋子同时被对手盯上（或被将军抽吃），顾此失彼必丢一个。',
    },
    'left_hanging': {
        'plain_label': '棋子没保护白送吃',
        'plain_why': '走完这步后，你的车/马/炮失去了友军保护（变成无根孤子），成了对手白吃的靶子。',
    },
    'missed_tactics': {
        'plain_label': '错过白吃/抢攻好机会',
        'plain_why': '对手盘面上明明有没保护的弱点棋子或空虚将门，没去抓弱点反而走了普通棋。',
    },
    'king_exposed': {
        'plain_label': '老将防线露空当',
        'plain_why': '防守棋子离开要害位置，导致老将能安全逃生的格子大幅减少，九宫岌岌可危。',
    },
    'lost_tempo': {
        'plain_label': '走棋太慢白送先手',
        'plain_why': '这步棋既没有将军，也没有捉对手的棋子，等于白白送给对手一步免费的进攻机会。',
    },
}


# --------------------------------------------------------------------------- #
# 1. 盘面攻防图与九宫特征计算
# --------------------------------------------------------------------------- #

def _in_palace(idx: int, is_red_palace: bool) -> bool:
    """判断绝对坐标 idx 是否在红方或黑方九宫内。"""
    sq = core.SQUARE_NAME.get(idx)
    if not sq:
        return False
    file_ch, rank_ch = sq[0], sq[1]
    if file_ch not in ('d', 'e', 'f'):
        return False
    rank = int(rank_ch)
    return (0 <= rank <= 2) if is_red_palace else (7 <= rank <= 9)


def squares_controlled_by(board: str, idx: int) -> List[int]:
    """计算绝对棋盘上位于 idx 的棋子所控制/攻击/保护的所有真实格子索引。

    与 ``Position.gen_moves`` 的区别：
    1. 直接在绝对棋盘上运算，无需翻转；
    2. **包含己方棋子所在的格子**（用于判定「这颗子是否有根保护」）。
    """
    p = board[idx]
    if p == '.' or p.upper() not in PIECE_CP:
        return []

    is_red = p.isupper()
    up = p.upper()
    sq_name = core.SQUARE_NAME.get(idx, '')
    if not sq_name:
        return []
    rank = int(sq_name[1])
    res: List[int] = []

    if up == 'R':
        for d in (-16, 1, 16, -1):
            j = idx + d
            while True:
                q = board[j]
                if q < '.':
                    break
                res.append(j)
                if q != '.':
                    break
                j += d
        return res

    if up == 'C':
        for d in (-16, 1, 16, -1):
            cfoot = 0
            j = idx + d
            while True:
                q = board[j]
                if q < '.':
                    break
                if cfoot == 0:
                    if q != '.':
                        cfoot = 1
                else:
                    if q != '.':
                        res.append(j)
                        break
                j += d
        return res

    if up == 'N':
        knight_steps = (
            (-16, -33), (-16, -31),
            (1, -14), (1, 18),
            (16, 33), (16, 31),
            (-1, 14), (-1, -18),
        )
        for leg_d, jump_d in knight_steps:
            leg_idx = idx + leg_d
            dest_idx = idx + jump_d
            if not (0 <= leg_idx < len(board) and 0 <= dest_idx < len(board)):
                continue
            if board[leg_idx] != '.':
                continue
            if board[dest_idx] >= '.':
                res.append(dest_idx)
        return res

    if up == 'B':
        for d in (-34, -30, 30, 34):
            eye_idx = idx + d // 2
            dest_idx = idx + d
            if not (0 <= eye_idx < len(board) and 0 <= dest_idx < len(board)):
                continue
            if board[eye_idx] != '.' or board[dest_idx] < '.':
                continue
            dest_sq = core.SQUARE_NAME.get(dest_idx)
            if not dest_sq:
                continue
            dest_rank = int(dest_sq[1])
            if is_red and dest_rank <= 4:
                res.append(dest_idx)
            elif (not is_red) and dest_rank >= 5:
                res.append(dest_idx)
        return res

    if up == 'A':
        for d in (-17, -15, 15, 17):
            dest_idx = idx + d
            if 0 <= dest_idx < len(board) and board[dest_idx] >= '.':
                if _in_palace(dest_idx, is_red):
                    res.append(dest_idx)
        return res

    if up == 'K':
        for d in (-16, 1, 16, -1):
            dest_idx = idx + d
            if 0 <= dest_idx < len(board) and board[dest_idx] >= '.':
                if _in_palace(dest_idx, is_red):
                    res.append(dest_idx)
        # 帅将照面控制
        step = -16 if is_red else 16
        sp = idx + step
        while 0 <= sp < len(board) and board[sp] >= '.':
            q = board[sp]
            if q != '.':
                if q == ('k' if is_red else 'K'):
                    res.append(sp)
                break
            sp += step
        return res

    if up == 'P':
        forward = -16 if is_red else 16
        crossed = (rank >= 5) if is_red else (rank <= 4)
        dirs = (forward, -1, 1) if crossed else (forward,)
        for d in dirs:
            dest_idx = idx + d
            if 0 <= dest_idx < len(board) and board[dest_idx] >= '.':
                res.append(dest_idx)
        return res

    return res


def analyze_board_graph(board: str) -> Dict[str, Any]:
    """构建盘面完整攻防关系图。

    返回：
    - ``red_controls``: dict[target_idx -> list[attacker_idx]]
    - ``black_controls``: dict[target_idx -> list[attacker_idx]]
    - ``hanging``: {'red': [...], 'black': [...]} 受攻且无根或被小换大的棋子列表
    - ``unprotected``: {'red': [...], 'black': [...]} 无根大子列表
    """
    red_controls: Dict[int, List[int]] = {}
    black_controls: Dict[int, List[int]] = {}

    for idx in core._SQUARES:
        p = board[idx]
        if p == '.':
            continue
        targets = squares_controlled_by(board, idx)
        cmap = red_controls if p.isupper() else black_controls
        for t in targets:
            cmap.setdefault(t, []).append(idx)

    hanging: Dict[str, List[Dict[str, Any]]] = {'red': [], 'black': []}
    unprotected: Dict[str, List[Dict[str, Any]]] = {'red': [], 'black': []}

    for idx in core._SQUARES:
        p = board[idx]
        if p == '.' or p.upper() == 'K':
            continue
        is_red = p.isupper()
        side_key = 'red' if is_red else 'black'
        sq = core.SQUARE_NAME.get(idx, '')
        val = PIECE_CP.get(p, 100)
        name = core.PIECE_NAME.get(p, p)

        defenders = (red_controls if is_red else black_controls).get(idx, [])
        attackers = (black_controls if is_red else red_controls).get(idx, [])

        if p.upper() in MAJOR_TYPES and not defenders:
            unprotected[side_key].append({
                'square': sq,
                'piece': name,
                'value': val,
                'attacked': bool(attackers),
            })

        if attackers:
            min_attacker_val = min(PIECE_CP.get(board[a], 1000) for a in attackers)
            attacker_sq = core.SQUARE_NAME.get(attackers[0], '')
            attacker_name = core.PIECE_NAME.get(board[attackers[0]], '')
            # 无根受攻，或高价值大子（车/马/炮）被更低价值子力直接捉吃
            if not defenders or (val >= 450 and min_attacker_val < val):
                hanging[side_key].append({
                    'square': sq,
                    'piece': name,
                    'value': val,
                    'undefended': not defenders,
                    'attacker_square': attacker_sq,
                    'attacker_piece': attacker_name,
                })

    for k in ('red', 'black'):
        hanging[k].sort(key=lambda x: (-x['value'], x['square']))
        unprotected[k].sort(key=lambda x: (-x['value'], x['square']))

    return {
        'red_controls': red_controls,
        'black_controls': black_controls,
        'hanging': hanging,
        'unprotected': unprotected,
    }


def king_safety_report(board: str, is_red: bool, graph: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """评估指定一方老将的九宫安全度。"""
    if graph is None:
        graph = analyze_board_graph(board)
    king_char = 'K' if is_red else 'k'
    king_idx = board.find(king_char)
    if king_idx < 0:
        return {'king_square': '', 'escape_squares': 0, 'palace_threats': []}

    king_sq = core.SQUARE_NAME.get(king_idx, '')
    enemy_controls = graph['black_controls'] if is_red else graph['red_controls']

    escape = 0
    for d in (-16, 1, 16, -1):
        dest = king_idx + d
        if not (0 <= dest < len(board)) or not _in_palace(dest, is_red):
            continue
        q = board[dest]
        if q != '.' and (q.isupper() == is_red):
            continue
        if dest not in enemy_controls:
            escape += 1

    palace_threats: List[str] = []
    for sq_idx in core._SQUARES:
        if _in_palace(sq_idx, is_red) and sq_idx in enemy_controls:
            sq_name = core.SQUARE_NAME.get(sq_idx, '')
            if sq_name:
                palace_threats.append(sq_name)

    return {
        'king_square': king_sq,
        'escape_squares': escape,
        'palace_threats': palace_threats,
    }


def _is_playable_move(board: str, red_to_move: bool, mv: Optional[Tuple[int, int]]) -> bool:
    if not mv or len(mv) != 2:
        return False
    i, j = mv
    if not (0 <= i < len(board) and 0 <= j < len(board)) or i == j:
        return False
    p = board[i]
    if p == '.' or p.upper() not in PIECE_CP or (p.isupper() != red_to_move):
        return False
    q = board[j]
    if q != '.' and q.upper() in PIECE_CP and (q.isupper() == red_to_move):
        return False
    if p.upper() == 'C':
        if q == '.':
            for d in (-16, 1, 16, -1):
                cur = i + d
                while 0 <= cur < len(board) and board[cur] == '.':
                    if cur == j:
                        return True
                    cur += d
            return False
        return j in squares_controlled_by(board, i)
    return j in squares_controlled_by(board, i)


# --------------------------------------------------------------------------- #
# 1.5 关键位置几何与棋理特征解释器（Key Square Geometric Explainer）
# --------------------------------------------------------------------------- #

def explain_key_square(
    board_before: str,
    red_to_move: bool,
    move_or_iccs: Any,
    board_after: Optional[str] = None,
) -> Dict[str, Any]:
    """从第一性原理分析落点位置的几何棋理属性，回答「这为什么是关键位置」。

    返回：
    - dest_square: 'd4', 'c8' 等落点坐标
    - zone_name: 几何空间区域名（如 '四路肋道咽喉'、'卧槽绝杀要穴'、'河头巡河要道' 等）
    - role_summary: 简洁精辟的战术核心作用（用于卡片和字幕）
    - why_key: 详细的棋理解释（控制了谁、封锁了谁、解除了什么隐患）
    - tactical_tags: ['占肋控中', '别马腿', '联防生根'] 等标签
    - controlled_targets: 这一步新增瞄准或控制的目标坐标与子力名称
    - protected_targets: 这一步直接生根护住的友军坐标与子力名称
    - blocked_threats: 这一步阻断的对方走法或别马腿目标
    """
    if isinstance(move_or_iccs, tuple) and len(move_or_iccs) == 2:
        mv = move_or_iccs
        move_iccs = nt.to_iccs(mv)
    else:
        move_iccs = str(move_or_iccs or '').strip()
        mv = nt.from_iccs(move_iccs) if move_iccs else None

    if not mv or not _is_playable_move(board_before, red_to_move, mv):
        return {
            'dest_square': move_iccs[2:4] if len(move_iccs) >= 4 else '',
            'zone_name': '盘面要点',
            'role_summary': '抢占行棋主动权',
            'why_key': '占据盘面要点推进局势，压制对手活动空间。',
            'tactical_tags': ['争夺先手'],
            'controlled_targets': [],
            'protected_targets': [],
            'blocked_threats': [],
        }

    dest_sq = move_iccs[2:4]
    p_char = board_before[mv[0]]
    piece_name = core.PIECE_NAME.get(p_char, '子力')
    is_red = red_to_move
    mover_side = 'red' if is_red else 'black'
    enemy_side = 'black' if is_red else 'red'
    opp_name = '黑方' if is_red else '红方'

    if board_after is None:
        board_after = core.apply_move(board_before, red_to_move, mv)

    file_ch = dest_sq[0]
    rank_num = int(dest_sq[1])

    # 1. 区域与空间几何命名
    zone_name = '盘面要点'
    tactical_tags: List[str] = []

    # 绝对九宫坐标判断
    in_enemy_palace = _in_palace(mv[1], not is_red)
    in_my_palace = _in_palace(mv[1], is_red)

    # 典型几何阵位判断
    # 卧槽马点：黑宫 (c8, g8) / 红宫 (c1, g1)
    is_wocao = (p_char.upper() == 'N') and (
        (is_red and dest_sq in ('c8', 'g8')) or
        ((not is_red) and dest_sq in ('c1', 'g1'))
    )
    # 挂角马点：黑宫 (d7, f7) / 红宫 (d2, f2)
    is_guajiao = (p_char.upper() == 'N') and (
        (is_red and dest_sq in ('d7', 'f7')) or
        ((not is_red) and dest_sq in ('d2', 'f2'))
    )
    # 钓鱼马点：黑宫 (c7, g7) / 红宫 (c2, g2)
    is_diaoyu = (p_char.upper() == 'N') and (
        (is_red and dest_sq in ('c7', 'g7')) or
        ((not is_red) and dest_sq in ('c2', 'g2'))
    )

    if is_wocao:
        zone_name = '卧槽绝杀要穴'
        tactical_tags.append('卧槽马势')
    elif is_guajiao:
        zone_name = '挂角锁喉要津'
        tactical_tags.append('挂角逼宫')
    elif is_diaoyu:
        zone_name = '钓鱼马黄金支点'
        tactical_tags.append('钓鱼马控将')
    elif file_ch == 'e':
        if (is_red and rank_num >= 7) or ((not is_red) and rank_num <= 2):
            zone_name = '中宫心脏地带'
            tactical_tags.append('直捣黄龙')
        else:
            zone_name = '五路中线主干道'
            tactical_tags.append('中路控盘')
    elif file_ch in ('d', 'f'):
        if (is_red and rank_num >= 7) or ((not is_red) and rank_num <= 2):
            zone_name = '九宫肋道命门'
            tactical_tags.append('肋道破防')
        else:
            zone_name = f'{"四" if file_ch == "d" else "六"}路肋道要津'
            tactical_tags.append('肋道争先')
    elif (is_red and rank_num == 9) or ((not is_red) and rank_num == 0):
        zone_name = '敌方九宫底线'
        tactical_tags.append('沉底铁锁')
    elif (is_red and rank_num == 8) or ((not is_red) and rank_num == 1):
        zone_name = '敌方九宫二楼'
        tactical_tags.append('平腰锁将')
    elif (is_red and rank_num == 4) or ((not is_red) and rank_num == 5):
        zone_name = '己方河口巡河线'
        tactical_tags.append('巡河控局')
    elif (is_red and rank_num == 5) or ((not is_red) and rank_num == 4):
        zone_name = '敌方河沿骑河线'
        tactical_tags.append('骑河压制')
    elif (is_red and rank_num == 6) or ((not is_red) and rank_num == 3):
        zone_name = '敌方卒林枢纽线'
        tactical_tags.append('卒林横扫')

    # 2. 攻防图差分：这一步究竟新控制了谁、保护了谁、解除了什么威胁
    graph_before = analyze_board_graph(board_before)
    graph_after = analyze_board_graph(board_after)

    # A. 保护友军（生根）
    before_my_unprot = {u['square']: u for u in graph_before['unprotected'][mover_side]}
    after_my_unprot = {u['square']: u for u in graph_after['unprotected'][mover_side]}
    newly_rooted = [
        before_my_unprot[sq] for sq in before_my_unprot
        if sq not in after_my_unprot and sq != move_iccs[:2]
    ]

    # B. 控制/瞄准敌方大子或要穴
    before_enemy_hanging = {h['square'] for h in graph_before['hanging'][enemy_side]}
    new_threats = [
        h for h in graph_after['hanging'][enemy_side]
        if h['square'] not in before_enemy_hanging
    ]

    # C. 别马腿/塞象眼
    xray_after = extract_xiangqi_xray(board_after, red_to_move)
    blocked_by_me = [
        b for b in xray_after['blocked_legs']
        if b['leg_square'] == dest_sq
    ]

    # D. 炮架
    cannon_mount_roles = [
        m for m in xray_after['cannon_mounts']
        if m['mount_square'] == dest_sq and m['side'] == mover_side
    ]

    # E. 封锁老将逃生格
    ks_before = king_safety_report(board_before, not is_red, graph_before)
    ks_after = king_safety_report(board_after, not is_red, graph_after)
    escapes_cut = ks_before['escape_squares'] - ks_after['escape_squares']

    why_reasons: List[str] = []
    controlled_targets: List[str] = []
    protected_targets: List[str] = []
    blocked_threats: List[str] = []

    if is_wocao:
        why_reasons.append(f'进占{zone_name}，直接锁死{opp_name}将门中枢，并阻断其老将回中路径')
    elif is_guajiao:
        why_reasons.append(f'跃入{zone_name}，一子兼顾控制九宫两翼逃生格，逼其老将移位')
    elif is_diaoyu:
        why_reasons.append(f'抢占{zone_name}，同时封死老将平移与登楼两条退路')

    if escapes_cut > 0:
        why_reasons.append(f'封锁{opp_name}老将 {escapes_cut} 个逃生格（只剩 {ks_after["escape_squares"]} 格可走）')
        tactical_tags.append('封锁将门')

    if newly_rooted:
        for r_item in newly_rooted[:2]:
            protected_targets.append(f'{r_item["piece"]}({r_item["square"]})')
        p_desc = '与'.join(protected_targets)
        why_reasons.append(f'联防生根：为原本无保护的己方 {p_desc} 提供稳固根护')
        tactical_tags.append('联防生根')

    if new_threats:
        for t_item in new_threats[:2]:
            controlled_targets.append(f'{t_item["piece"]}({t_item["square"]})')
        t_desc = '与'.join(controlled_targets)
        why_reasons.append(f'前出控盘：直接瞄准捉击{opp_name}无保护的 {t_desc}')
        tactical_tags.append('牵制捉子')

    if blocked_by_me:
        for b_item in blocked_by_me[:2]:
            blocked_threats.append(f'{b_item["label"]}({b_item["piece_square"]})')
        b_desc = '、'.join(blocked_threats)
        why_reasons.append(f'卡位反制：正好占据敌方 {b_desc}，瘫痪其进攻路线')
        tactical_tags.append('精准卡位')

    if cannon_mount_roles:
        m0 = cannon_mount_roles[0]
        why_reasons.append(f'架炮生威：为己方红炮架起瞄准{m0["target_piece"]}({m0["target_square"]})的重型炮架')
        tactical_tags.append('充当铁炮架')

    if not why_reasons:
        if file_ch in ('d', 'e', 'f'):
            why_reasons.append(f'牢牢控制{zone_name}，扼守攻防必经咽喉，压制{opp_name}主力出动')
        elif '河' in zone_name or '卒林' in zone_name:
            why_reasons.append(f'进占{zone_name}，封死横向通道，阻止{opp_name}子力过河渗透')
        else:
            why_reasons.append(f'出动{piece_name}抢占{zone_name}，开拓火力视野并压制局部阵型')

    role_summary = f'抢占{zone_name}（{dest_sq}）'
    why_key = '；'.join(why_reasons) + '。'

    return {
        'dest_square': dest_sq,
        'zone_name': zone_name,
        'role_summary': role_summary,
        'why_key': why_key,
        'tactical_tags': list(dict.fromkeys(tactical_tags))[:3],
        'controlled_targets': controlled_targets,
        'protected_targets': protected_targets,
        'blocked_threats': blocked_threats,
    }



# --------------------------------------------------------------------------- #
# 2. 走前 / 走后 / 正解 三态差分诊断（Diagnose Review）
# --------------------------------------------------------------------------- #

def diagnose_review(
    board_before: str,
    red_to_move: bool,
    played_iccs: str,
    review: Dict[str, Any],
) -> Dict[str, Any]:
    """基于走前盘面与引擎排名线，生成结构化棋理诊断（Motifs + 教练批注 + 三阶法眼线索）。

    此函数纯本地确定性计算，耗时 < 2ms，不依赖外部网络，且只陈述盘面真实发生的棋理。
    """
    side_str = 'red' if red_to_move else 'black'
    opp_name = '黑方' if red_to_move else '红方'

    best_iccs = review.get('best_iccs') or ''
    lines = review.get('lines') or []
    best_line = lines[0] if lines and isinstance(lines[0], dict) else {}
    best_chinese = best_line.get('chinese') or ''
    mv_best = nt.from_iccs(best_iccs) if best_iccs else None
    if not best_chinese and _is_playable_move(board_before, red_to_move, mv_best):
        best_chinese = nt.to_chinese(board_before, mv_best)

    mv_played = nt.from_iccs(played_iccs)
    played_chinese = ''
    captured_before = None
    if _is_playable_move(board_before, red_to_move, mv_played):
        played_chinese = nt.to_chinese(board_before, mv_played)
        dest_ch = board_before[mv_played[1]]
        if dest_ch != '.' and dest_ch.upper() in core.PIECE_NAME:
            captured_before = core.PIECE_NAME[dest_ch]

    loss = review.get('loss')
    loss_kind = review.get('loss_kind')
    rank = review.get('rank')
    status = review.get('status')
    best_mate_in = review.get('best_mate_in')
    played_mate_in = review.get('played_mate_in')
    best_score = best_line.get('score')

    # 计算走前、实走后、正解后的攻防图
    graph_before = analyze_board_graph(board_before)
    board_after_played = (
        core.apply_move(board_before, red_to_move, mv_played)
        if _is_playable_move(board_before, red_to_move, mv_played)
        else board_before
    )
    graph_after_played = analyze_board_graph(board_after_played)

    board_after_best = (
        core.apply_move(board_before, red_to_move, mv_best)
        if _is_playable_move(board_before, red_to_move, mv_best)
        else board_before
    )
    graph_after_best = analyze_board_graph(board_after_best)

    # 提取对方反击步（来自 played_line.pv[1] 或 refute_pv[0]）
    played_line = next((l for l in lines if isinstance(l, dict) and l.get('iccs') == played_iccs), None)
    played_pv = (played_line.get('pv') or []) if played_line else []
    punish_step = played_pv[1] if len(played_pv) >= 2 else None

    # 视觉线索（薄弱格 / 关键主攻子 / 路线）
    weakness_squares: List[str] = []
    key_pieces: List[str] = []
    route: List[str] = []
    if len(best_iccs) == 4:
        key_pieces.append(best_iccs[:2])
        route = [best_iccs[:2], best_iccs[2:4]]
        weakness_squares.append(best_iccs[2:4])

    for h in graph_after_played['hanging'][side_str][:2]:
        if h['square'] not in weakness_squares:
            weakness_squares.append(h['square'])

    # 若走的就是第 1 名正着
    if rank == 1 and (loss_kind == 'mate' or (loss is not None and loss <= 0)):
        return {
            'primary_motif': 'best_move',
            'motif_label': '正着控盘',
            'motifs': [{'id': 'best_move', 'label': '正着控盘', 'severity': 'good'}],
            'severity': 'good',
            'coach_summary': f'好棋！「{played_chinese or played_iccs}」与引擎首选一致，牢牢把握盘面主动。',
            'visual_clues': {
                'weakness_squares': weakness_squares[:3],
                'key_pieces': key_pieces[:2],
                'route': route,
            },
            'punish_move': None,
        }

    motifs: List[Dict[str, str]] = []
    explanations: List[str] = []

    # 1. 杀棋维度诊断
    if loss_kind == 'mate':
        if best_score is not None and best_score > 0 and rank != 1:
            if played_mate_in is None and best_mate_in is not None:
                motifs.append({'id': 'missed_mate', 'label': '错失必杀', 'severity': 'critical'})
                explanations.append(
                    f'盘面本有 {best_mate_in} 步绝杀良机（正着「{best_chinese or best_iccs}」），实战走「{played_chinese or played_iccs}」放虎归山。'
                )
            elif played_mate_in is not None and best_mate_in is not None and played_mate_in > best_mate_in:
                motifs.append({'id': 'missed_mate', 'label': '错失快杀', 'severity': 'warn'})
                explanations.append(
                    f'正着「{best_chinese or best_iccs}」可 {best_mate_in} 步速胜，实战走了 {played_mate_in} 步慢杀。'
                )
        elif best_score is not None and best_score < 0:
            motifs.append({'id': 'walked_into_mate', 'label': '漏防杀棋', 'severity': 'critical'})
            explanations.append(
                f'九宫告急！唯有走「{best_chinese or best_iccs}」方能顽强延缓攻势，实战「{played_chinese or played_iccs}」令防线速溃。'
            )

    # 2. 检查走后是否新增己方受攻无根大子（丢无根子 / 遭捉双）
    before_hanging_sqs = {h['square'] for h in graph_before['hanging'][side_str]}
    after_hanging = graph_after_played['hanging'][side_str]
    new_hanging = [h for h in after_hanging if h['square'] not in before_hanging_sqs]

    # 检查是否一子捉双（同一个敌子同时攻击两个己方高价值子或将抽）
    in_check_after = core.is_in_check(board_after_played, not red_to_move)
    if len(after_hanging) >= 2:
        motifs.append({'id': 'fork_or_skewer', 'label': '遭抽将捉双', 'severity': 'critical'})
        targets_desc = '、'.join(f"{h['piece']}({h['square']})" for h in after_hanging[:2])
        explanations.append(f'走后己方 {targets_desc} 同时受攻，陷入首尾难顾之境。')
    elif new_hanging:
        h0 = new_hanging[0]
        if captured_before:
            motifs.append({'id': 'greedy_capture', 'label': '贪吃失先', 'severity': 'critical'})
            explanations.append(
                f'贪吃失先：实战「{played_chinese or played_iccs}」虽吃掉{captured_before}，却导致己方{h0["piece"]}({h0["square"]})暴露受攻！'
            )
        else:
            motifs.append({'id': 'left_hanging', 'label': '丢无根子', 'severity': 'critical'})
            explanations.append(
                f'疏于根护：走「{played_chinese or played_iccs}」后，己方{h0["piece"]}({h0["square"]})处于无根受攻险地（被{opp_name}{h0["attacker_piece"]}瞄准）。'
            )

    # 3. 检查贪吃失先（吃了子却亏分 >= 120cp）
    if captured_before and not any(m['id'] == 'greedy_capture' for m in motifs):
        if (loss is not None and loss >= 120) or status == 'outside':
            motifs.append({'id': 'greedy_capture', 'label': '贪吃失先', 'severity': 'high'})
            explanations.append(
                f'实战贪吃对方{captured_before}，脱离主战场而丢失关键先手；此时当走「{best_chinese or best_iccs}」争先控局。'
            )

    # 4. 检查正解是否吃掉敌方受攻子或先手叫将（漏看战术）
    if mv_best and not motifs:
        best_dest_ch = board_before[mv_best[1]]
        best_gives_check = core.is_in_check(board_after_best, not red_to_move)
        if best_dest_ch != '.' and PIECE_CP.get(best_dest_ch, 0) >= 450:
            victim_name = core.PIECE_NAME.get(best_dest_ch, '大子')
            motifs.append({'id': 'missed_tactics', 'label': '漏看妙手', 'severity': 'high'})
            explanations.append(
                f'错失战机：{opp_name}{victim_name}({best_iccs[2:4]})正值薄弱，正着「{best_chinese or best_iccs}」可果断得子！'
            )
        elif best_gives_check and ((loss or 0) >= 120 or status == 'outside'):
            motifs.append({'id': 'missed_tactics', 'label': '漏看妙手', 'severity': 'high'})
            explanations.append(
                f'漏看先手：正着「{best_chinese or best_iccs}」带将抢先，直接打乱{opp_name}阵脚。'
            )

    # 5. 检查九宫受逼
    ks_before = king_safety_report(board_before, red_to_move, graph_before)
    ks_after = king_safety_report(board_after_played, red_to_move, graph_after_played)
    if (len(ks_after['palace_threats']) > len(ks_before['palace_threats'])
            or (ks_after['escape_squares'] < ks_before['escape_squares'] and ks_after['escape_squares'] <= 1)):
        if not any(m['id'] == 'walked_into_mate' for m in motifs):
            motifs.append({'id': 'king_exposed', 'label': '九宫受逼', 'severity': 'high'})
            explanations.append(
                f'走后九宫防线吃紧（老将仅余 {ks_after["escape_squares"]} 格回旋），正着当走「{best_chinese or best_iccs}」稳固城池。'
            )
            if ks_after['king_square'] and ks_after['king_square'] not in weakness_squares:
                weakness_squares.append(ks_after['king_square'])

    # 6. 兜底：缓手失先
    if not motifs:
        motifs.append({'id': 'lost_tempo', 'label': '缓手失先', 'severity': 'warn'})
        # 计算最佳正着落点的关键位置几何棋理
        key_sq_info = explain_key_square(board_before, red_to_move, mv_best, board_after_best) if mv_best else None
        why_dest = key_sq_info.get('why_key', '') if key_sq_info else ''
        role_sum = key_sq_info.get('role_summary', '') if key_sq_info else ''

        if punish_step:
            punish_iccs = punish_step.get('iccs') or ''
            opp_key = explain_key_square(board_after_played, not red_to_move, punish_iccs) if punish_iccs else None
            opp_why = f"（{opp_key['why_key']}）" if (opp_key and opp_key.get('why_key')) else ""
            explanations.append(
                f'缓手失先：实战「{played_chinese or played_iccs}」未能针对敌方命门，遭{opp_name}抢先走「{punish_step.get("chinese") or punish_step.get("iccs")}」反击{opp_why}；正着当走「{best_chinese or best_iccs}」{role_sum}：{why_dest}'
            )
        elif best_chinese or best_iccs:
            explanations.append(
                f'此手「{played_chinese or played_iccs}」行棋效率不足；正着宜走「{best_chinese or best_iccs}」{role_sum}：{why_dest}'
            )

    # 补充对方反击提示
    if punish_step and len(explanations) == 1 and '抢先反制' not in explanations[0]:
        explanations.append(f'{opp_name}可紧接以「{punish_step.get("chinese") or punish_step.get("iccs")}」反击。')

    # 计算严重度档位
    is_critical = (
        loss_kind == 'mate'
        or status == 'outside'
        or (isinstance(loss, int) and loss >= 200)
        or any(m['severity'] == 'critical' for m in motifs)
    )
    is_warn = (isinstance(loss, int) and loss >= 80) or any(m['severity'] == 'high' for m in motifs)
    severity = 'critical' if is_critical else ('warn' if is_warn else 'minor')

    primary = motifs[0]
    return {
        'primary_motif': primary['id'],
        'motif_label': primary['label'],
        'motifs': motifs,
        'severity': severity,
        'coach_summary': ' '.join(explanations),
        'visual_clues': {
            'weakness_squares': weakness_squares[:3],
            'key_pieces': key_pieces[:2],
            'route': route,
        },
        'punish_move': punish_step,
    }


# --------------------------------------------------------------------------- #
# 2.5 大白话单步因果解说与「第一性原理 · 逆向思维 · 对抗三问」生成器
# --------------------------------------------------------------------------- #

def explain_step_plain(
    board_before: str,
    red_to_move: bool,
    move_or_iccs: Any,
    step_num: int = 1,
    is_user_side: bool = True,
    is_wrong_first_step: bool = False,
    custom_comment: str = '',
    *,
    step_idx: Optional[int] = None,
    is_user: Optional[bool] = None,
    mode: str = '',
) -> Dict[str, Any]:
    """将单步走法转化为通俗直白的大白话解说、得失标签与盘面高光坐标。"""
    if step_idx is not None:
        step_num = step_idx
    if is_user is not None:
        is_user_side = is_user
    if mode == 'bad' and step_num == 1 and is_user_side:
        is_wrong_first_step = True

    if isinstance(move_or_iccs, tuple) and len(move_or_iccs) == 2:
        mv = move_or_iccs
        move_iccs = nt.to_iccs(mv)
    else:
        move_iccs = str(move_or_iccs or '').strip()
        mv = nt.from_iccs(move_iccs) if move_iccs else None

    mover_side = 'red' if red_to_move else 'black'
    enemy_side = 'black' if red_to_move else 'red'
    actor = '我方' if is_user_side else '对手'
    actor_name = '你' if is_user_side else ('黑方' if mover_side == 'black' else '红方')
    opp_name = '黑方' if mover_side == 'red' else '红方'

    if not mv or not _is_playable_move(board_before, red_to_move, mv):
        fallback_text = custom_comment or f'走「{move_iccs}」推进局势。'
        return {
            'step': step_num,
            'move': move_iccs,
            'iccs': move_iccs,
            'chinese': move_iccs,
            'side': mover_side,
            'actor': actor,
            'role_label': f'第 {step_num} 步 · {"我方" if is_user_side else "对手"}',
            'plain': fallback_text,
            'comment': fallback_text,
            'captured': None,
            'gives_check': False,
            'is_mate': False,
            'threat_squares': [move_iccs[2:4]] if len(move_iccs) >= 4 else [],
            'gains': [],
            'losses': [],
        }

    chinese = nt.to_chinese(board_before, mv)
    dest_ch = board_before[mv[1]]
    captured_name = core.PIECE_NAME.get(dest_ch) if (dest_ch != '.' and dest_ch.upper() in core.PIECE_NAME) else None
    if captured_name in ('将', '帅'):
        captured_name = None

    board_after = core.apply_move(board_before, red_to_move, mv)
    graph_before = analyze_board_graph(board_before)
    graph_after = analyze_board_graph(board_after)

    gives_check = core.is_in_check(board_after, not red_to_move)
    enemy_legal = core.legal_moves(board_after, not red_to_move)
    is_mate = len(enemy_legal) == 0

    before_enemy_hanging = {h['square'] for h in graph_before['hanging'][enemy_side]}
    newly_threatened = [
        h for h in graph_after['hanging'][enemy_side]
        if h['square'] not in before_enemy_hanging
    ]

    before_my_hanging = {h['square'] for h in graph_before['hanging'][mover_side]}
    newly_exposed = [
        h for h in graph_after['hanging'][mover_side]
        if h['square'] not in before_my_hanging
    ]

    gains: List[str] = []
    losses: List[str] = []
    threat_squares: List[str] = [move_iccs[2:4]]

    if is_mate:
        gains.append(f'直接将死{opp_name}老将')
    elif gives_check:
        gains.append(f'直接将军！逼迫{opp_name}必须立刻救老将')
    if captured_name:
        gains.append(f'直接吃掉{opp_name}{captured_name}')
    for nt_item in newly_threatened[:2]:
        gains.append(f'瞄准捉击{opp_name}无保护的{nt_item["piece"]}({nt_item["square"]})')
        if nt_item['square'] not in threat_squares:
            threat_squares.append(nt_item['square'])
    for ex_item in newly_exposed[:2]:
        losses.append(f'导致己方{ex_item["piece"]}({ex_item["square"]})失去保护，面临被吃风险')
        if ex_item['square'] not in threat_squares:
            threat_squares.append(ex_item['square'])

    if is_wrong_first_step:
        role_label = f'第 {step_num} 步 · 你的失误手'
        if not losses and not gives_check and not captured_name and not newly_threatened:
            losses.append('既没将军也没捉大子，白白把出手机会让给对手')
    elif mode == 'threat':
        if step_num == 1:
            role_label = '第 1 步 · 对手出招'
        elif is_user_side:
            role_label = f'第 {step_num} 步 · 我方应对'
        else:
            role_label = f'第 {step_num} 步 · 后续变化'
    elif is_user_side:
        role_label = f'第 {step_num} 步 · {"我方正着" if step_num == 1 else "我方后续"}'
    else:
        role_label = f'第 {step_num} 步 · 对手反击' if step_num in (2, 4) else f'第 {step_num} 步 · 对手应招'

    key_sq_info = explain_key_square(board_before, red_to_move, mv, board_after) if mv else None

    # 生成大白话解释与落点漫画气泡
    short_bubble = ''
    if mode == 'threat':
        if is_mate:
            short_bubble = '叫杀'
        elif gives_check:
            short_bubble = '叫将' if not captured_name else f'吃{captured_name}将'
        elif captured_name:
            short_bubble = f'吃{captured_name}'
        elif newly_threatened:
            short_bubble = '捉子'
        elif key_sq_info and key_sq_info.get('tactical_tags'):
            short_bubble = key_sq_info['tactical_tags'][0]
        else:
            short_bubble = '应对' if is_user_side else '出招'
    elif is_mate:
        short_bubble = '一击绝杀！'
    elif gives_check:
        short_bubble = '叫将逼应！' if not captured_name else f'带将吃{captured_name}！'
    elif captured_name:
        short_bubble = f'吃掉{captured_name}！'
    elif is_wrong_first_step:
        short_bubble = '露出破绽！'
    elif newly_threatened:
        short_bubble = '抢先捉子！'
    elif not is_user_side and step_num in (2, 4):
        short_bubble = '乘虚反击！'
    elif key_sq_info and key_sq_info.get('tactical_tags'):
        short_bubble = key_sq_info['tactical_tags'][0]
    else:
        short_bubble = '抢占要道' if is_user_side else '被迫应付'

    if mode == 'threat':
        # 就事论事、客观平实的实战大白话解说，拒绝夸张戏剧化词汇
        if is_mate:
            comment = f'{actor_name}走「{chinese}」直接叫将绝杀。' if not is_user_side else f'我方走「{chinese}」化解杀招。'
        elif gives_check:
            if captured_name:
                comment = f'{actor_name}走「{chinese}」吃{captured_name}同时叫将。'
            elif newly_threatened:
                t0 = newly_threatened[0]
                target_p = f'我方{t0["piece"]}' if not is_user_side else f'{opp_name}{t0["piece"]}'
                comment = f'{actor_name}走「{chinese}」叫将，顺带抽打{target_p}。'
            else:
                comment = f'{actor_name}走「{chinese}」叫将逼应。' if not is_user_side else f'我方走「{chinese}」叫将。'
        elif captured_name:
            comment = f'{actor_name}走「{chinese}」吃掉{opp_name}{captured_name}。'
        elif newly_threatened:
            if len(newly_threatened) >= 2:
                t0, t1 = newly_threatened[0], newly_threatened[1]
                p0 = f'我方{t0["piece"]}' if not is_user_side else f'{opp_name}{t0["piece"]}'
                p1 = f'我方{t1["piece"]}' if not is_user_side else f'{opp_name}{t1["piece"]}'
                comment = f'{actor_name}走「{chinese}」双捉{p0}和{p1}。'
            else:
                t0 = newly_threatened[0]
                target_p = f'我方{t0["piece"]}' if not is_user_side else f'{opp_name}{t0["piece"]}'
                comment = f'{actor_name}走「{chinese}」瞄准捉{target_p}({t0["square"]})。'
        else:
            if is_user_side:
                comment = f'我方走「{chinese}」防守应对。'
            else:
                comment = f'{actor_name}走「{chinese}」展开攻势。' if step_num == 1 else f'{actor_name}走「{chinese}」跟进。'
    elif custom_comment and not custom_comment.endswith('乘虚反扑，夺走局部主动权！') and custom_comment != f'{actor_name}乘虚反扑':
        comment = custom_comment
    elif is_mate:
        if is_user_side:
            comment = f'【一击必杀】走「{chinese}」后，{opp_name}老将所有逃路全部封死，当场获胜！'
        else:
            comment = f'【致命恶果】{actor_name}走「{chinese}」直接将死你的老将，防线彻底崩溃！'
    elif gives_check:
        if newly_threatened:
            t0 = newly_threatened[0]
            comment = f'【抽将捉子】{actor_name}走「{chinese}」一边叫将逼退老将，一边瞄准{t0["piece"]}({t0["square"]})，一箭双雕！'
        elif captured_name:
            comment = f'【带将吃子】{actor_name}走「{chinese}」吃掉{captured_name}并直接将军，逼迫对方只能先救老将！'
        else:
            comment = f'【先手叫将】{actor_name}走「{chinese}」直接将军！对方没有工夫反击，必须先保老将。'
    elif captured_name:
        if is_wrong_first_step and newly_exposed:
            e0 = newly_exposed[0]
            comment = f'【贪小失大】你走「{chinese}」虽然吃了{captured_name}，但让自己的{e0["piece"]}({e0["square"]})失去保护，马上遭对手反扑！'
        else:
            comment = f'【实利得子】{actor_name}走「{chinese}」直接吃掉{opp_name}的{captured_name}，实实在在赚到子力优势！'
    elif newly_threatened:
        if len(newly_threatened) >= 2:
            t0, t1 = newly_threatened[0], newly_threatened[1]
            comment = f'【一子捉双】{actor_name}走「{chinese}」同时捉死{t0["piece"]}({t0["square"]})和{t1["piece"]}({t1["square"]})，救了一个必丢另一个！'
        else:
            t0 = newly_threatened[0]
            comment = f'【抢先捉子】{actor_name}走「{chinese}」直接捉击没保护的{t0["piece"]}({t0["square"]})，逼对方被动逃命！'
    elif is_wrong_first_step:
        if newly_exposed:
            e0 = newly_exposed[0]
            comment = f'【露出破绽】你走「{chinese}」后，自己的{e0["piece"]}({e0["square"]})失去保护成了活靶子，给了对手可乘之机！'
        else:
            comment = f'【走棋太慢】你走「{chinese}」没有威胁到对手要害，等于白送给对手一步免费抢攻的机会！'
    else:
        why_key_text = key_sq_info.get('why_key', '') if key_sq_info else ''
        role_label_text = key_sq_info.get('role_summary', '抢占要道') if key_sq_info else '抢占要道'
        if is_user_side:
            if step_num >= 3:
                comment = f'【被动招架】面对对手紧逼，你只能走「{chinese}」勉强防守，彻底失去主动权。'
            elif why_key_text:
                comment = f'【{role_label_text}】你走「{chinese}」：{why_key_text}'
            else:
                comment = f'【抢占要道】你走「{chinese}」卡住关键位置，牢牢掌握主动。'
        else:
            if step_num in (2, 4):
                if why_key_text:
                    comment = f'【趁虚抢攻】因为你上一手太慢，{actor_name}立刻走「{chinese}」{role_label_text}：{why_key_text}'
                else:
                    comment = f'【趁虚抢攻】因为你上一手太慢，{actor_name}立刻走「{chinese}」抢占要害，反客为主压制你的阵型！'
            else:
                comment = f'【被迫应付】{actor_name}只能走「{chinese}」被动招架，完全抢不到先手。'

    # 将几何关键位置分析结果一并写入 step 结构体中
    return {
        'step': step_num,
        'move': move_iccs,
        'iccs': move_iccs,
        'chinese': chinese,
        'side': mover_side,
        'actor': actor,
        'role_label': role_label,
        'plain': comment,
        'comment': comment,
        'short_bubble': short_bubble,
        'captured': captured_name,
        'gives_check': gives_check,
        'is_mate': is_mate,
        'threat_squares': threat_squares[:3],
        'gains': gains,
        'losses': losses,
        'board_after': board_after,
        'key_square_info': key_sq_info,
    }


def build_thinking_guide(
    board: str,
    red_to_move: bool,
    best_iccs: Optional[str] = '',
    wrong_iccs: Optional[str] = '',
    motif: str = '',
) -> Dict[str, Any]:
    """用「第一性原理 + 逆向思维 + 对抗式提问」为当前盘面生成可操作的算路指南。"""
    best_iccs = best_iccs or ''
    wrong_iccs = wrong_iccs or ''
    my_side = 'red' if red_to_move else 'black'
    enemy_side = 'black' if red_to_move else 'red'
    opp_name = '黑方' if red_to_move else '红方'
    my_name = '红方' if red_to_move else '黑方'

    graph = analyze_board_graph(board)
    ks_enemy = king_safety_report(board, not red_to_move, graph)
    ks_my = king_safety_report(board, red_to_move, graph)

    enemy_hanging = graph['hanging'][enemy_side]
    enemy_unprot = graph['unprotected'][enemy_side]
    my_hanging = graph['hanging'][my_side]

    best_mv = nt.from_iccs(best_iccs) if best_iccs else None
    best_cn = nt.to_chinese(board, best_mv) if _is_playable_move(board, red_to_move, best_mv) else best_iccs
    wrong_mv = nt.from_iccs(wrong_iccs) if wrong_iccs else None
    wrong_cn = nt.to_chinese(board, wrong_mv) if _is_playable_move(board, red_to_move, wrong_mv) else wrong_iccs

    # 1. 第一性原理（抓本质：盘面只有将死、白吃、先手逼应三件事）
    fp_points: List[str] = []
    if ks_enemy['escape_squares'] <= 1:
        fp_points.append(
            f'【老将安全度】：{opp_name}老将现在只剩 {ks_enemy["escape_squares"]} 个安全逃生格，重点看能不能直接叫将或锁死底线/中路！'
        )
    if enemy_hanging:
        desc = '、'.join(f'{h["piece"]}({h["square"]})' for h in enemy_hanging[:2])
        fp_points.append(f'【白吃与受攻】：{opp_name}的 {desc} 正处于受攻/无保护状态，可直接吃掉或借机抢先！')
    elif enemy_unprot:
        desc = '、'.join(f'{u["piece"]}({u["square"]})' for u in enemy_unprot[:2])
        fp_points.append(f'【无根子靶子】：{opp_name}的 {desc} 没有友军保护（无根子），是捉双和闪击的最佳靶子！')
    if my_hanging:
        desc = '、'.join(f'{h["piece"]}({h["square"]})' for h in my_hanging[:2])
        fp_points.append(f'【己方隐患】：小心！我方 {desc} 正在被{opp_name}盯上，如果不先手叫将就必须设防！')
    if not fp_points:
        fp_points.append(f'【先手效率】：双方阵型平稳，优先出动大子（车/马/炮）抢占中路与肋道要津，绝不走无威胁的闲棋。')

    # 2. 逆向思维（从3步后的终局倒推回现在）
    if ks_enemy['escape_squares'] <= 1 and best_cn:
        inversion_tip = (
            f'【从绝杀画面倒推】：不要漫无目的看全盘！{opp_name}老将被困在 {ks_enemy["king_square"]}，'
            f'只要把火力送到 {best_iccs[2:4] if len(best_iccs) >= 4 else "九宫要害"} 就能锁死他——倒推回来，现在第一步就该走「{best_cn}」！'
        )
    elif best_cn:
        inversion_tip = (
            f'【从3步后得失倒推】：先想象3步后的画面——如果走慢棋{f"（如{wrong_cn}）" if wrong_cn else ""}，'
            f'{opp_name}就会抢先打穿防线；反过来，想让3步后我方占优，现在第一步必须走「{best_cn}」先发制人！'
        )
    else:
        inversion_tip = (
            f'【从结果倒推】：别从第1步往后硬算几十种分支！先问自己：3步后我最想吃掉{opp_name}哪颗子，或者封死他老将哪条路？再倒推哪颗子能走到那里。'
        )

    # 3. 对抗式提问（落子前灵魂三问：站在对手角度找自己的茬）
    adversarial_qa = [
        {
            'q': '第1问【看穿对手】：如果这步我不设防（随便走一步闲棋），对手下一步最狠会干嘛？',
            'a': (
                f'{opp_name}正盯着你的 {my_hanging[0]["piece"]}({my_hanging[0]["square"]}) 准备吃子反击！'
                if my_hanging else
                (f'{opp_name}正在威胁你的九宫（老将仅剩 {ks_my["escape_squares"]} 格可走），绝不能走闲棋！'
                 if ks_my['escape_squares'] <= 1 else
                 f'点击上方「👁️ 对手想干嘛」，用动画直接看对手接下来 3 步想怎么进攻你。')
            ),
            'focus': my_hanging[0]['square'] if my_hanging else (ks_my['king_square'] or ''),
        },
        {
            'q': '第2问【换位找茬】：假如我走完这步棋，我现在立刻变成对手，我怎么反击最爽？',
            'a': (
                f'如果你走「{wrong_cn}」这种没有强制力的棋，对手不用防守，会立刻反手抢攻你！'
                if wrong_cn else
                '只要你这步棋既不叫将、也不捉对手大子，对手就能腾出手来揍你！'
            ),
            'focus': wrong_iccs[2:4] if len(wrong_iccs) >= 4 else '',
        },
        {
            'q': '第3问【检查根护】：我把这颗子移走后，原本靠它保护的棋子会不会变成没人管的孤子？',
            'a': f'动子前看一眼它身后：确保走完后自己的车、马、炮都有根保护，不给{opp_name}白吃或一子捉双的机会。',
            'focus': best_iccs[:2] if len(best_iccs) >= 2 else '',
        },
    ]

    return {
        'first_principles': fp_points,
        'inversion_tip': inversion_tip,
        'adversarial_qa': adversarial_qa,
    }


def extract_xiangqi_xray(board: str, red_to_move: bool, last_move_iccs: str = '') -> Dict[str, Any]:
    """提取中国象棋专属空间几何透视特征：
    1. cannon_mounts: 活跃炮架坐标列表（借哪颗子为架瞄准敌子或将门）
    2. blocked_legs: 别马腿/塞象眼受阻坐标（哪些子受阻影响攻防）
    3. hanging_badges: 无根且受攻的大子（车马炮）列表
    """
    if isinstance(board, str) and ('/' in board or ' ' in board):
        try:
            board, _, _, _ = nt.from_fen(board)
        except Exception:
            pass

    cannon_mounts: List[Dict[str, Any]] = []
    blocked_legs: List[Dict[str, Any]] = []
    hanging_badges: List[Dict[str, Any]] = []

    graph = analyze_board_graph(board)

    # 1. 扫描盘上所有炮，找出它们的炮架
    for idx in core._SQUARES:
        ch = board[idx]
        if ch not in ('C', 'c'):
            continue
        is_red = ch.isupper()
        enemy_is_red = not is_red
        c_sq = core.SQUARE_NAME.get(idx, '')
        for d in (-16, 1, 16, -1):
            mount_idx = -1
            target_idx = -1
            sp = idx + d
            while 0 <= sp < len(board) and board[sp] >= '.':
                q = board[sp]
                if q != '.':
                    if mount_idx < 0:
                        mount_idx = sp
                    else:
                        target_idx = sp
                        break
                sp += d
            if mount_idx >= 0 and target_idx >= 0:
                t_ch = board[target_idx]
                if t_ch != '.' and (t_ch.isupper() == enemy_is_red):
                    m_sq = core.SQUARE_NAME.get(mount_idx, '')
                    t_sq = core.SQUARE_NAME.get(target_idx, '')
                    is_king = t_ch.upper() == 'K'
                    cannon_mounts.append({
                        'cannon_square': c_sq,
                        'mount_square': m_sq,
                        'target_square': t_sq,
                        'is_check': is_king,
                        'mount_piece': core.PIECE_NAME.get(board[mount_idx], ''),
                        'target_piece': core.PIECE_NAME.get(t_ch, ''),
                        'side': 'red' if is_red else 'black',
                    })

    # 2. 扫描被别马腿的马 / 塞象眼的象
    knight_steps = (
        (-16, -33), (-16, -31),
        (1, -14), (1, 18),
        (16, 33), (16, 31),
        (-1, 14), (-1, -18),
    )
    for idx in core._SQUARES:
        ch = board[idx]
        if ch in ('N', 'n'):
            n_sq = core.SQUARE_NAME.get(idx, '')
            for leg_d, jump_d in knight_steps:
                leg_idx = idx + leg_d
                dest_idx = idx + jump_d
                if not (0 <= leg_idx < len(board) and 0 <= dest_idx < len(board)):
                    continue
                if board[leg_idx] != '.' and board[dest_idx] >= '.':
                    dest_ch = board[dest_idx]
                    # 如果跳跃目标格有敌子或者九宫要穴，而马腿被挡住
                    if dest_ch != '.' and (dest_ch.isupper() != ch.isupper()):
                        l_sq = core.SQUARE_NAME.get(leg_idx, '')
                        d_sq = core.SQUARE_NAME.get(dest_idx, '')
                        if not any(b['leg_square'] == l_sq and b['piece_square'] == n_sq for b in blocked_legs):
                            blocked_legs.append({
                                'piece_square': n_sq,
                                'leg_square': l_sq,
                                'target_square': d_sq,
                                'kind': 'knight',
                                'label': '别马腿',
                            })
        elif ch in ('B', 'b'):
            b_sq = core.SQUARE_NAME.get(idx, '')
            for d in (-34, -30, 30, 34):
                eye_idx = idx + d // 2
                dest_idx = idx + d
                if not (0 <= eye_idx < len(board) and 0 <= dest_idx < len(board)):
                    continue
                if board[eye_idx] != '.' and board[dest_idx] >= '.':
                    e_sq = core.SQUARE_NAME.get(eye_idx, '')
                    if not any(b['leg_square'] == e_sq and b['piece_square'] == b_sq for b in blocked_legs):
                        blocked_legs.append({
                            'piece_square': b_sq,
                            'leg_square': e_sq,
                            'target_square': core.SQUARE_NAME.get(dest_idx, ''),
                            'kind': 'elephant',
                            'label': '塞象眼',
                        })

    # 3. 双方无根且受攻的大子
    for side in ('red', 'black'):
        for h in graph['hanging'][side]:
            if h['value'] >= 450:
                hanging_badges.append({
                    'square': h['square'],
                    'piece': h['piece'],
                    'side': side,
                    'label': '无根受攻',
                })

    return {
        'cannon_mounts': cannon_mounts[:4],
        'blocked_legs': blocked_legs[:4],
        'hanging_badges': hanging_badges[:4],
    }


def mirror_file_char(ch: str) -> str:
    """中国象棋横向坐标字符对称变换 (a<->i, b<->h, c<->g, d<->f, e<->e)。"""
    mapping = {'a': 'i', 'b': 'h', 'c': 'g', 'd': 'f', 'e': 'e',
               'f': 'd', 'g': 'c', 'h': 'b', 'i': 'a'}
    return mapping.get(ch, ch)


def mirror_iccs_horizontal(iccs: str) -> str:
    """将四位 ICCS 走法坐标水平镜像对称翻转。"""
    if len(iccs) != 4:
        return iccs
    f1, r1, f2, r2 = iccs[0], iccs[1], iccs[2], iccs[3]
    return f"{mirror_file_char(f1)}{r1}{mirror_file_char(f2)}{r2}"


def mirror_fen_horizontal(fen: str) -> str:
    """将 FEN 棋盘左右水平镜像翻转（棋理100%等价，视觉空间镜像秒测）。"""
    parts = fen.strip().split()
    if not parts:
        return fen
    ranks = parts[0].split('/')
    mirrored_ranks: List[str] = []
    for r in ranks:
        # 将空位数字展开为点
        expanded = []
        for ch in r:
            if ch.isdigit():
                expanded.extend(['.'] * int(ch))
            else:
                expanded.append(ch)
        # 左右反转
        expanded.reverse()
        # 重新压缩连续空位
        compressed = []
        empty = 0
        for ch in expanded:
            if ch == '.':
                empty += 1
            else:
                if empty > 0:
                    compressed.append(str(empty))
                    empty = 0
                compressed.append(ch)
        if empty > 0:
            compressed.append(str(empty))
        mirrored_ranks.append(''.join(compressed))

    mirrored_board = '/'.join(mirrored_ranks)
    rest = ' '.join(parts[1:])
    return f"{mirrored_board} {rest}"


def mirror_puzzle(puzzle: Dict[str, Any]) -> Dict[str, Any]:
    """为指定题目生成左右水平对称的镜像变式题（用于举一反三快速检验）。"""
    pz = dict(puzzle)
    pz['is_mirror'] = True
    title = pz.get('title', '')
    pz['title'] = f"{title} (左右镜像变式)" if title else '左右镜像变式'
    if pz.get('fen'):
        pz['fen'] = mirror_fen_horizontal(pz['fen'])
    if pz.get('exam_fen'):
        pz['exam_fen'] = mirror_fen_horizontal(pz['exam_fen'])
    if pz.get('best_iccs'):
        pz['best_iccs'] = mirror_iccs_horizontal(pz['best_iccs'])
    if pz.get('wrong_iccs'):
        pz['wrong_iccs'] = mirror_iccs_horizontal(pz['wrong_iccs'])

    # 镜像 demo_line
    if pz.get('demo_line'):
        new_demo = []
        for d in pz['demo_line']:
            m_move = mirror_iccs_horizontal(d.get('move') or '')
            new_demo.append({
                'move': m_move,
                'iccs': m_move,
                'chinese': d.get('chinese') or '',
                'comment': d.get('comment') or '',
            })
        pz['demo_line'] = new_demo

    # 镜像 solution_tree
    def _mirror_tree(node: Any) -> Any:
        if not isinstance(node, dict):
            return node
        res: Dict[str, Any] = {}
        for k, v in node.items():
            mk = mirror_iccs_horizontal(k)
            new_v = dict(v) if isinstance(v, dict) else v
            if isinstance(new_v, dict):
                if new_v.get('reply'):
                    new_v['reply'] = mirror_iccs_horizontal(new_v['reply'])
                if new_v.get('children'):
                    new_v['children'] = _mirror_tree(new_v['children'])
            res[mk] = new_v
        return res

    if pz.get('solution_tree'):
        pz['solution_tree'] = _mirror_tree(pz['solution_tree'])

    # 镜像 traps
    if pz.get('traps'):
        new_traps: Dict[str, Any] = {}
        for k, v in pz['traps'].items():
            mk = mirror_iccs_horizontal(k)
            tv = dict(v) if isinstance(v, dict) else v
            if isinstance(tv, dict):
                if tv.get('punish_move'):
                    tv['punish_move'] = mirror_iccs_horizontal(tv['punish_move'])
                if tv.get('refute_line'):
                    tv['refute_line'] = [
                        {**rf, 'move': mirror_iccs_horizontal(rf.get('move') or '')}
                        for rf in tv['refute_line']
                    ]
            new_traps[mk] = tv
        pz['traps'] = new_traps

    # 镜像 visual_clues
    if pz.get('visual_clues'):
        vc = pz['visual_clues']
        pz['visual_clues'] = {
            'weakness_squares': [mirror_iccs_horizontal(sq + sq)[:2] for sq in (vc.get('weakness_squares') or [])],
            'key_pieces': [mirror_iccs_horizontal(sq + sq)[:2] for sq in (vc.get('key_pieces') or [])],
            'route': [mirror_iccs_horizontal(sq + sq)[:2] for sq in (vc.get('route') or [])],
        }

    return pz


# --------------------------------------------------------------------------- #
# 3. 自动教案编译器（Auto-Drill Compiler）
# --------------------------------------------------------------------------- #

def build_exam_variant_fen(fen: str) -> str:
    """为实战错题生成第三阶段「变式大考（exam_fen）」盘面。

    在不改变核心交战子力与将帅安全的前提下，若边路（a/i 线）有未参与核心攻杀的兵卒，
    微调一格作为实战变式，防止学员仅凭死记硬背视觉位置通关；若无可安全微调的边兵则保持原 FEN。
    """
    try:
        board, red_to_move, halfmove, fullmove = nt.from_fen(fen)
    except Exception:
        return fen

    graph = analyze_board_graph(board)
    # 尝试寻找 a 线或 i 线未受攻也未攻人的兵/卒，前进或后退一格作为非对称变式
    for sq_name in ('a3', 'i3', 'a6', 'i6'):
        idx = core.index_of(sq_name)
        ch = board[idx]
        if ch == 'P' and sq_name in ('a3', 'i3'):
            up_idx = idx - 16
            if board[up_idx] == '.' and idx not in graph['black_controls'] and up_idx not in graph['black_controls']:
                nb = board[:up_idx] + 'P' + board[up_idx + 1:]
                nb = nb[:idx] + '.' + nb[idx + 1:]
                if not core.is_in_check(nb, True) and not core.is_in_check(nb, False):
                    return nt.to_fen(nb, red_to_move, halfmove, fullmove)
        elif ch == 'p' and sq_name in ('a6', 'i6'):
            dn_idx = idx + 16
            if board[dn_idx] == '.' and idx not in graph['red_controls'] and dn_idx not in graph['red_controls']:
                nb = board[:dn_idx] + 'p' + board[dn_idx + 1:]
                nb = nb[:idx] + '.' + nb[idx + 1:]
                if not core.is_in_check(nb, True) and not core.is_in_check(nb, False):
                    return nt.to_fen(nb, red_to_move, halfmove, fullmove)
    return fen


def compile_mistake_to_puzzle(item: Dict[str, Any], idx: int = 0) -> Optional[Dict[str, Any]]:
    """把错题本中的一条记录自动编译为完整的「三段式名师实训教案」。"""
    fen = item.get('fen_before')
    if not fen:
        return None
    try:
        board, red_to_move, _h, _m = nt.from_fen(fen)
    except Exception:
        return None

    fen_side = 'red' if red_to_move else 'black'
    user_side = item.get('side') or fen_side
    opp_name = '黑方' if user_side == 'red' else '红方'
    my_name = '红方' if user_side == 'red' else '黑方'

    best_iccs = item.get('best_iccs') or ''
    best_chinese = item.get('best_chinese') or '正着'
    worst_chinese = item.get('worst_chinese') or '前次劣着'
    worst_iccs = item.get('worst_iccs') or ''
    worst_review = item.get('worst_review') or {}
    worst_loss = item.get('worst_loss') or 120

    # 提取或现算棋理诊断
    tactics = worst_review.get('tactics')
    if not isinstance(tactics, dict) and worst_iccs:
        tactics = diagnose_review(board, red_to_move, worst_iccs, worst_review)
    tactics = tactics or {}

    motif_label = tactics.get('motif_label') or '实战盲区'
    coach_summary = tactics.get('coach_summary') or f'原谱误走「{worst_chinese}」，正着当走「{best_chinese}」。'
    visual_clues = tactics.get('visual_clues') or {
        'weakness_squares': [best_iccs[2:4]] if len(best_iccs) >= 4 else [],
        'key_pieces': [best_iccs[0:2]] if len(best_iccs) >= 2 else [],
        'route': [best_iccs[0:2], best_iccs[2:4]] if len(best_iccs) >= 4 else [],
    }

    pz_id = f"mistake_{item.get('worst_game_id') or item.get('game_id', 'hist')}_{item.get('worst_ply') or item.get('ply', idx)}"
    loss_text = (
        f"错过 {worst_review.get('best_mate_in')} 步杀"
        if worst_review.get('loss_kind') == 'mate' and worst_review.get('best_mate_in')
        else f"比最优差 {round(abs(worst_loss) / 100.0, 1)} 兵"
    )

    lines = worst_review.get('lines') or []
    best_line = lines[0] if lines and isinstance(lines[0], dict) else {}
    best_pv = best_line.get('pv') or []
    if not best_iccs and best_line.get('iccs'):
        best_iccs = best_line['iccs']
        best_chinese = best_line.get('chinese', '正着')

    # 编译多步定式正解树与名师示范线
    solution_tree: Dict[str, Any] = {}
    demo_line: List[Dict[str, str]] = []
    if best_pv and len(best_pv) >= 3:
        p0, p1, p2 = best_pv[0], best_pv[1], best_pv[2]
        solution_tree[p0['iccs']] = {
            'comment': f'好！走出正着「{p0.get("chinese", best_chinese)}」，精准化解【{motif_label}】心魔！',
            'reply': p1['iccs'],
            'children': {
                p2['iccs']: {
                    'comment': f'算路深远！紧接「{p2.get("chinese", "")}」一举锁定胜势！',
                    'solved': True,
                }
            },
        }
        demo_line = [
            {'move': p0['iccs'], 'chinese': p0.get('chinese', ''), 'comment': f'【名师起手】：走「{p0.get("chinese", "")}」直击要害，避免「{worst_chinese}」之失。'},
            {'move': p1['iccs'], 'chinese': p1.get('chinese', ''), 'comment': f'【敌方应手】：{opp_name}被迫走「{p1.get("chinese", "")}」招架。'},
            {'move': p2['iccs'], 'chinese': p2.get('chinese', ''), 'comment': f'【连环追击】：再走「{p2.get("chinese", "")}」彻底确立优势！'},
        ]
    elif best_iccs:
        solution_tree[best_iccs] = {
            'comment': f'破除心魔！走出正着「{best_chinese}」，{coach_summary}',
            'solved': True,
        }
        demo_line.append({
            'move': best_iccs,
            'chinese': best_chinese,
            'comment': f'【名师正着】：当走「{best_chinese}」，{coach_summary}',
        })

    # 编译陷阱反击树（包含用户实战走错的那手 + 排名线中差值较大的诱惑手）
    traps: Dict[str, Any] = {}
    played_line = next((l for l in lines if isinstance(l, dict) and l.get('iccs') == worst_iccs), None)
    played_pv = (played_line.get('pv') or []) if played_line else []
    punish_iccs = None
    punish_chinese = ''
    refute_line: List[Dict[str, str]] = []

    if len(played_pv) >= 2:
        punish_iccs = played_pv[1].get('iccs')
        punish_chinese = played_pv[1].get('chinese', '')
        cur_b = board
        cur_r = red_to_move
        mv_w = nt.from_iccs(worst_iccs) if worst_iccs else None
        if mv_w and _is_playable_move(cur_b, cur_r, mv_w):
            cur_b = core.apply_move(cur_b, cur_r, mv_w)
            cur_r = not cur_r
        for s_idx, s in enumerate(played_pv[1:4], start=2):
            s_iccs = s.get('iccs', '')
            s_info = explain_step_plain(
                cur_b, cur_r, s_iccs, step_num=s_idx, is_user_side=(s_idx % 2 == 1)
            )
            refute_line.append({
                'move': s_iccs,
                'chinese': s.get('chinese') or s_info['chinese'],
                'comment': s_info['comment'],
            })
            if s_info.get('board_after'):
                cur_b = s_info['board_after']
                cur_r = not cur_r
    elif worst_review.get('punish_move'):
        pm = worst_review['punish_move']
        mv_p = nt.from_iccs(pm)
        if mv_p:
            punish_iccs = pm
            punish_chinese = pm

    primary_motif = tactics.get('primary_motif', 'lost_tempo')
    plain_info = PLAIN_MOTIF_DESC.get(primary_motif, PLAIN_MOTIF_DESC['lost_tempo'])

    if worst_iccs and worst_iccs != best_iccs:
        punish_desc = f"，结果被{opp_name}走「{punish_chinese}」反击" if punish_chinese else ""
        traps[worst_iccs] = {
            'punish_move': punish_iccs,
            'comment': f'【{plain_info["plain_label"]}】实战中你走了「{worst_chinese}」（{loss_text}）{punish_desc}。{plain_info["plain_why"]} 正着应走「{best_chinese}」。',
            'refute_line': refute_line or [
                {'move': worst_iccs, 'chinese': worst_chinese, 'comment': f'重走实战败招「{worst_chinese}」，白白丢失优势！'},
            ],
        }

    # 若排名线第 2/3 名也比第 1 名显著差（> 150cp），一并编译为次生诱惑陷阱
    for alt in lines[1:]:
        if not isinstance(alt, dict):
            continue
        alt_iccs = alt.get('iccs') or ''
        if not alt_iccs or alt_iccs in traps or alt_iccs == best_iccs:
            continue
        alt_loss = (best_line.get('score') or 0) - (alt.get('score') or 0)
        if alt_loss >= 160:
            alt_pv = alt.get('pv') or []
            alt_punish = alt_pv[1].get('iccs') if len(alt_pv) >= 2 else None
            alt_punish_cn = alt_pv[1].get('chinese', '') if len(alt_pv) >= 2 else ''
            traps[alt_iccs] = {
                'punish_move': alt_punish,
                'comment': f'【次优陷阱】走「{alt.get("chinese") or alt_iccs}」会亏 {round(alt_loss / 100.0, 1)} 兵优势' + (f'，{opp_name}会趁机走「{alt_punish_cn}」反击！' if alt_punish_cn else '！'),
                'refute_line': [
                    {'move': s.get('iccs', ''), 'chinese': s.get('chinese', ''), 'comment': f'{opp_name}趁机走「{s.get("chinese") or s.get("iccs")}」扩大战果'}
                    for s in alt_pv[1:3]
                ],
            }

    goal_type = 'checkmate' if worst_review.get('loss_kind') == 'mate' and (best_line.get('score') or 0) > 0 else 'win_advantage'
    exam_fen = build_exam_variant_fen(fen)
    thinking_guide = build_thinking_guide(board, red_to_move, best_iccs=best_iccs, wrong_iccs=worst_iccs)

    # 提取正着关键位置几何属性
    mv_best_pz = nt.from_iccs(best_iccs) if best_iccs else None
    key_sq_data = explain_key_square(board, red_to_move, mv_best_pz) if mv_best_pz else None

    # 将所属对局信息原样注入，方便单局拆解特训
    game_id_val = item.get('worst_game_id') or item.get('game_id') or ''
    ply_val = item.get('worst_ply') or item.get('ply')

    return {
        'id': pz_id,
        'title': f'实战纠错 #{idx + 1} · 别走「{worst_chinese}」（{plain_info["plain_label"]}）',
        'plain_subtitle': f'你实战曾在此处走错「{worst_chinese}」（{loss_text}）：{plain_info["plain_why"]}',
        'category': 'mistake_replay',
        'difficulty': 3 if worst_loss >= 200 else 2,
        'side': user_side,
        'target': f'请执{my_name[0]}走出最佳好棋（改正「{worst_chinese}」的失误）',
        'goal_type': goal_type,
        'motif': primary_motif,
        'motif_label': motif_label,
        'plain_motif_label': plain_info['plain_label'],
        'fen': fen,
        'exam_fen': exam_fen,
        'game_id': game_id_val,
        'ply': ply_val,
        'best_iccs': best_iccs,
        'wrong_iccs': worst_iccs,
        'key_square_info': key_sq_data,
        'master_quote': f'【通俗点拨】{plain_info["plain_why"]} {coach_summary}',
        'demo_line': demo_line,
        'solution_tree': solution_tree,
        'traps': traps,
        'visual_clues': visual_clues,
        'thinking_guide': thinking_guide,
        'hints': [
            f'【第1步提示 · 看问题在哪】：{plain_info["plain_why"]} {coach_summary}',
            f'【第2步提示 · 该动哪颗子】：看棋盘上高亮标出的主力棋子（{", ".join(visual_clues.get("key_pieces", []))}）与目标落点（{", ".join(visual_clues.get("weakness_squares", []))}）。',
            f'【第3步提示 · 直接看答案】：直接走「{best_chinese}」（{best_iccs}），就能保住优势！',
        ],
        'explanation': f'【为什么之前走错了】{plain_info["plain_why"]} {coach_summary}（你当时走了：{worst_chinese}，{loss_text}；最佳走法：{best_chinese}）。',
    }


# --------------------------------------------------------------------------- #
# 4. 特定对局全盘拆解引擎（Specific Game Breakdown Engine）
# --------------------------------------------------------------------------- #

def breakdown_specific_game(game_replay_data: Dict[str, Any]) -> Dict[str, Any]:
    """对单局对局进行开/中/残三阶段深度拆解，提取关键转折点并编译为闯关题单。

    输入 game_replay_data: Store.game_replay(game_id) 返回的 dict
    输出包含：
    - game_id, engine_side, ply_count, winner, outcome, reason
    - phases: {
        'opening': {'plies': [1..16], 'accuracy': 90, 'mistakes_count': 0, 'summary': '开局平稳'},
        'midgame': {'plies': [17..40], 'accuracy': 65, 'mistakes_count': 2, 'summary': '中盘遭抢攻失先'},
        'endgame': {'plies': [41..], 'accuracy': 40, 'mistakes_count': 1, 'summary': '残局漏防崩溃'}
      }
    - turning_points: [
        {
          'ply': 14,
          'side': 'red',
          'played_iccs': 'b2b5',
          'played_chinese': '车八进三',
          'best_iccs': 'b2b6',
          'best_chinese': '车八进四',
          'loss': 180,
          'loss_pawn': 1.8,
          'phase': 'midgame',
          'motif': 'lost_tempo',
          'motif_label': '缓手失先',
          'severity': 'critical',
          'key_square_info': {...},
          'summary': '未能抢先占肋封锁，遭对方反击',
          'puzzle_id': 'game_xxxx_ply_14'
        }
      ]
    - puzzles: List[Dict] (可直接供精训营加载闯关的教案列表)
    """
    if not game_replay_data or not game_replay_data.get('found'):
        return {
            'ok': False,
            'message': '未找到该对局数据',
            'game_id': (game_replay_data or {}).get('game_id', ''),
            'turning_points': [],
            'puzzles': [],
            'phases': {},
        }

    head = game_replay_data.get('game', {})
    plies = game_replay_data.get('plies', [])
    game_id = head.get('game_id', '')

    turning_points: List[Dict[str, Any]] = []
    puzzles: List[Dict[str, Any]] = []

    opening_graded = 0
    opening_misses = 0
    midgame_graded = 0
    midgame_misses = 0
    endgame_graded = 0
    endgame_misses = 0

    puzzle_counter = 0

    for p in plies:
        ply_num = p.get('ply', 1)
        by = p.get('by')
        review = p.get('review')
        fen_before = p.get('fen_before')
        played_iccs = p.get('iccs', '')
        played_chinese = p.get('chinese', '')

        # 划分阶段
        if ply_num <= 16:
            curr_phase = 'opening'
            curr_phase_name = '开局争先阶段'
        elif ply_num <= 40:
            curr_phase = 'midgame'
            curr_phase_name = '中局搏杀阶段'
        else:
            curr_phase = 'endgame'
            curr_phase_name = '残局攻守阶段'

        if by == 'engine' or not review or not isinstance(review, dict):
            continue

        rank = review.get('rank')
        loss = review.get('loss')
        loss_kind = review.get('loss_kind')
        status = review.get('status')

        # 统计阶段判分
        if curr_phase == 'opening':
            opening_graded += 1
        elif curr_phase == 'midgame':
            midgame_graded += 1
        else:
            endgame_graded += 1

        is_miss = (
            (rank is not None and rank > 1 and ((isinstance(loss, int) and loss >= 80) or loss_kind == 'mate' or status == 'outside'))
        )

        if is_miss:
            if curr_phase == 'opening':
                opening_misses += 1
            elif curr_phase == 'midgame':
                midgame_misses += 1
            else:
                endgame_misses += 1

            # 诊断棋理
            try:
                b_fen, r_fen, _h, _m = nt.from_fen(fen_before)
                diag = review.get('tactics')
                if not isinstance(diag, dict):
                    diag = diagnose_review(b_fen, r_fen, played_iccs, review)
            except Exception:
                diag = {}

            best_line = (review.get('lines') or [{}])[0]
            best_iccs = best_line.get('iccs') or review.get('best_iccs') or review.get('best') or ''
            best_chinese = best_line.get('chinese') or review.get('best_chinese') or ''
            if not best_chinese and best_iccs:
                try:
                    mv = nt.from_iccs(best_iccs)
                    best_chinese = nt.to_chinese(b_fen, r_fen, mv)
                except Exception:
                    best_chinese = best_iccs

            mv_best = nt.from_iccs(best_iccs) if best_iccs else None
            key_sq_data = explain_key_square(b_fen, r_fen, mv_best) if (mv_best and 'b_fen' in locals()) else None

            loss_val = loss if isinstance(loss, int) else (300 if loss_kind == 'mate' else 120)
            pawn_val = round(abs(loss_val) / 100.0, 1)

            turning_point = {
                'ply': ply_num,
                'phase': curr_phase,
                'phase_name': curr_phase_name,
                'side': p.get('side', 'red'),
                'played_iccs': played_iccs,
                'played_chinese': played_chinese,
                'best_iccs': best_iccs,
                'best_chinese': best_chinese,
                'loss': loss_val,
                'loss_pawn': pawn_val,
                'loss_kind': loss_kind,
                'rank': rank,
                'motif': diag.get('primary_motif', 'lost_tempo'),
                'motif_label': diag.get('motif_label', '缓手失先'),
                'severity': diag.get('severity', 'warn'),
                'coach_summary': diag.get('coach_summary', ''),
                'key_square_info': key_sq_data,
                'fen_before': fen_before,
                'puzzle_id': f'mistake_{game_id}_{ply_num}',
            }
            turning_points.append(turning_point)

            # 编译为单局专属实训题目
            mistake_item = {
                'fen_before': fen_before,
                'side': p.get('side', 'red'),
                'best_iccs': best_iccs,
                'best_chinese': best_chinese,
                'worst_chinese': played_chinese,
                'worst_iccs': played_iccs,
                'worst_review': review,
                'worst_loss': loss_val,
                'worst_game_id': game_id,
                'worst_ply': ply_num,
            }
            pz = compile_mistake_to_puzzle(mistake_item, idx=puzzle_counter)
            if pz:
                puzzle_counter += 1
                pz['category'] = 'game_breakdown'
                pz['game_id'] = game_id
                pz['ply'] = ply_num
                pz['phase_name'] = curr_phase_name
                pz['title'] = f'第 {ply_num} 手（{curr_phase_name}）· 别走「{played_chinese}」'
                puzzles.append(pz)

    # 阶段总结
    def calc_phase_acc(graded, misses):
        if graded == 0:
            return 100
        return max(0, int(round((1.0 - misses / graded) * 100)))

    phases = {
        'opening': {
            'name': '开局阶段 (1~16手)',
            'graded_count': opening_graded,
            'misses_count': opening_misses,
            'accuracy': calc_phase_acc(opening_graded, opening_misses),
            'verdict': '出子迅速抢占先手' if opening_misses == 0 else f'出现 {opening_misses} 处失先缓着',
        },
        'midgame': {
            'name': '中局阶段 (17~40手)',
            'graded_count': midgame_graded,
            'misses_count': midgame_misses,
            'accuracy': calc_phase_acc(midgame_graded, midgame_misses),
            'verdict': '攻防协调战术敏锐' if midgame_misses == 0 else f'出现 {midgame_misses} 处战术漏洞',
        },
        'endgame': {
            'name': '残局阶段 (41手+)',
            'graded_count': endgame_graded,
            'misses_count': endgame_misses,
            'accuracy': calc_phase_acc(endgame_graded, endgame_misses),
            'verdict': '算路严密稳操胜券' if endgame_misses == 0 else f'出现 {endgame_misses} 处防守失误',
        },
    }

    # 提炼本局最核心的溃败转折点
    critical_turning_point = None
    if turning_points:
        critical_turning_point = max(
            turning_points,
            key=lambda tp: (1 if tp['severity'] == 'critical' else 0, tp['loss'])
        )

    return {
        'ok': True,
        'game_id': game_id,
        'engine_side': head.get('engine_side'),
        'ply_count': head.get('ply_count', len(plies)),
        'winner': head.get('winner'),
        'outcome': head.get('outcome'),
        'reason': head.get('reason', ''),
        'phases': phases,
        'turning_points': turning_points,
        'critical_turning_point': critical_turning_point,
        'puzzles': puzzles,
    }

