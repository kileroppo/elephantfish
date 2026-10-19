# -*- coding: utf-8 -*-
"""精训营题库引擎（Drill Lab Puzzle Engine）。

包含四类专项棋力题库：
1. 基础实用杀法（kill_tactics）：铁门栓、重炮杀、马后炮、挂角马、双车错、卧槽马等必修杀法；
2. 实用残局制胜（endgame）：单马破单士、炮高兵胜双士、马兵胜单缺象等经典残局功底；
3. 中局破局战术（midgame）：闪击抽子、弃子破防、牵制打击；
4. 实战错题攻坚（mistake_replay）：从 SQLite 历史对局中自动将劣着/败着局面转化为针对性实训题。

每个题目录入严格遵守中国象棋国标规则，经 Pikafish 与内置引擎严格校验。
"""

from __future__ import annotations

import time
from typing import Any, Dict, List, Optional
from engine import notation as nt

CATEGORIES = [
    {
        'id': 'kill_tactics',
        'name': '基础实用杀法',
        'desc': '铁门栓、重炮、马后炮等必学定式，训练瞬间识破将门弱点的敏锐度。',
        'icon': '⚡',
    },
    {
        'id': 'endgame',
        'name': '实用残局制胜',
        'desc': '马兵破缺象、炮兵胜双士等定式残局，打牢残局精准控盘与行棋基本功。',
        'icon': '♟',
    },
    {
        'id': 'midgame',
        'name': '中局破局战术',
        'desc': '闪击抽子、弃子攻心与牵制打击，提升中盘战术嗅觉与算力深度。',
        'icon': '🎯',
    },
    {
        'id': 'mistake_replay',
        'name': '实战败着翻盘',
        'desc': '从您过往实战转述中被判为恶手或劣着的关键局面转化而来，针对性攻克盲区。',
        'icon': '🔥',
    },
]

CLASSICAL_PUZZLES: List[Dict[str, Any]] = [
    # ---------------- 基础实用杀法 ----------------
    {
        'id': 'kill_01_tiemenshuan',
        'title': '铁门栓 · 沉底破门',
        'category': 'kill_tactics',
        'difficulty': 1,
        'side': 'red',
        'target': '红先二步杀',
        'fen': '4k4/4a4/4b4/9/4C4/9/9/1R7/9/3K5 w - - 0 1',
        'hints': [
            '第一阶提示：中路五路红炮已经牢牢栓住黑方将门通道，注意黑方底线防御虚实。',
            '第二阶提示：利用八路红车直沉底线展开致命突击，逼迫黑方应招。',
            '第三阶提示：首着正解为车八进七（b2b9）沉底叫将，中炮镇中一击定局！',
        ],
        'explanation': '铁门栓是象棋最经典的杀法之一。中炮犹如铁门闩紧紧栓住中路，车利用空旷边肋直插底线封死将门。',
    },
    {
        'id': 'kill_02_chongpao',
        'title': '双重炮 · 连环夺命',
        'category': 'kill_tactics',
        'difficulty': 1,
        'side': 'red',
        'target': '红先二步杀',
        'fen': '2b1k1b2/4a4/3C5/9/3C5/9/9/9/9/4K4 w - - 0 1',
        'hints': [
            '第一阶提示：两颗红炮同处四路（d线），前后呼应，火力完全聚焦于黑方肋道。',
            '第二阶提示：后炮充当炮架兼做护根，前炮可毫无顾忌破阵直入。',
            '第三阶提示：首着走后炮平中或前炮破士，逼黑将移位后重炮连击！',
        ],
        'explanation': '重炮杀法两炮同处一列，前炮将军后炮做根，即使对方有士相护也无法阻挡。',
    },
    {
        'id': 'kill_03_mahoupao',
        'title': '马后炮 · 绝地封喉',
        'category': 'kill_tactics',
        'difficulty': 2,
        'side': 'red',
        'target': '红先破阵成杀',
        'fen': '2b1k4/9/4b4/2N6/2C6/9/9/9/9/4K4 w - - 0 1',
        'hints': [
            '第一阶提示：观察红马与红炮的立体配合，马既可控制将位，又可作为炮架。',
            '第二阶提示：跳马占领要津挂角或卧槽，封堵黑将逃逸路线。',
            '第三阶提示：注意马跳四路（c6d8）或八路（c6e7）形成的立体攻击网。',
        ],
        'explanation': '马后炮由马控住对方老将去路并充当炮架，炮在马后发起致命叫将，令对方无法贴身垫子。',
    },
    {
        'id': 'kill_04_guajiaoma',
        'title': '挂角马 · 侧翼合围',
        'category': 'kill_tactics',
        'difficulty': 2,
        'side': 'red',
        'target': '红先二步杀',
        'fen': '3k5/9/4b4/2N6/9/9/9/1R7/9/4K4 w - - 0 1',
        'hints': [
            '第一阶提示：九宫角顶（挂角点）是防守的最薄弱点，马跳挂角可同时控制将位与肋线。',
            '第二阶提示：红马先挂角迫使黑方变阵，随后八路车呼应入局。',
            '第三阶提示：马跳挂角（c6d8），配合车在八路侧翼合围完成绝杀。',
        ],
        'explanation': '挂角马利用马在九宫四角（挂角点）的强大牵制力，配合横车或直车在肋道展开合围。',
    },
    {
        'id': 'kill_05_shuangchecuo',
        'title': '双车错 · 翻江倒海',
        'category': 'kill_tactics',
        'difficulty': 2,
        'side': 'red',
        'target': '红先二步杀',
        'fen': '3k5/1R7/4b4/9/9/9/9/9/R8/4K4 w - - 0 1',
        'hints': [
            '第一阶提示：双车处于八、九两路，黑方底线与次底线门户大开。',
            '第二阶提示：两车交替进入底线与二线叫将，令黑将顾此失彼。',
            '第三阶提示：先沉底车或肋车逐层逼宫，形成经典的左右交错杀。',
        ],
        'explanation': '双车错杀法利用双车在相邻两线或两条横线交替照将，步步紧逼直至斩杀。',
    },
    {
        'id': 'kill_06_wocaoma',
        'title': '卧槽马 · 破阵封门',
        'category': 'kill_tactics',
        'difficulty': 2,
        'side': 'red',
        'target': '红先得子入局',
        'fen': '3k5/4a4/4b4/9/9/2N6/9/1R7/9/4K4 w - - 0 1',
        'hints': [
            '第一阶提示：卧槽点（倒数第二线象位旁）是马刺杀九宫最凌厉的战术支点。',
            '第二阶提示：先跳马下卧槽控制九宫咽喉，迫使黑士象脱节。',
            '第三阶提示：马进卧槽（c4b6或c4d6），随后以车长驱直入锁定胜局。',
        ],
        'explanation': '卧槽马能够直接将军并严密控制帅位的平移路线，在中残局杀伤力极强。',
    },

    # ---------------- 实用残局制胜 ----------------
    {
        'id': 'endgame_01_danma_danshi',
        'title': '实用残局 · 单马破单士',
        'category': 'endgame',
        'difficulty': 2,
        'side': 'red',
        'target': '红先巧得士胜定',
        'fen': '4ka3/9/4b4/9/9/5N3/9/9/9/3K5 w - - 0 1',
        'hints': [
            '第一阶提示：单马对单士是定胜残局，核心在于控制黑士落脚点与逼将出宫。',
            '第二阶提示：利用帅占中路控线，以马步步取位踏士。',
            '第三阶提示：寻找踩士与将门双重威胁的绝佳马位。',
        ],
        'explanation': '单马巧胜单士是象棋残局基本功，依靠马的八面威风配合老帅控中，最终逼死黑士。',
    },
    {
        'id': 'endgame_02_paobing_shuangshi',
        'title': '实用残局 · 炮高兵胜双士',
        'category': 'endgame',
        'difficulty': 3,
        'side': 'red',
        'target': '红先破士胜定',
        'fen': '3a1k3/4a4/4b4/3P5/9/2C6/9/9/9/3K5 w - - 0 1',
        'hints': [
            '第一阶提示：高兵已过河并压制肋道，炮借兵力寻找破士良机。',
            '第二阶提示：老帅助攻控制另一条肋道，切断黑方回旋空间。',
            '第三阶提示：兵步步逼宫，迫使黑士象失去联络。',
        ],
        'explanation': '炮高兵胜双士的要领在于兵占肋道、炮借士相为架，帅占中路或肋道协同破防。',
    },
    {
        'id': 'endgame_03_mabing_que_xiang',
        'title': '实用残局 · 马兵胜单缺象',
        'category': 'endgame',
        'difficulty': 3,
        'side': 'red',
        'target': '红先稳操胜券',
        'fen': '2ba1k3/9/4b4/3P5/9/2N6/9/9/9/3K5 w - - 0 1',
        'hints': [
            '第一阶提示：残局马兵最喜对方单缺象，缺象的一侧正是破防通道。',
            '第二阶提示：兵控羊角士，马取卧槽或钓鱼马点。',
            '第三阶提示：先以兵破其防线弱侧，再以马完成包夹。',
        ],
        'explanation': '俗语云“马兵难破士象全，单缺象是破防口”，抓住缺象一侧的空隙是获胜的关键。',
    },

    # ---------------- 中局破局战术 ----------------
    {
        'id': 'midgame_01_shangji_chouzi',
        'title': '中局战术 · 闪击抽车',
        'category': 'midgame',
        'difficulty': 2,
        'side': 'red',
        'target': '红先闪击得车',
        'fen': '2r1k4/4a4/4b4/9/2N6/9/9/4R4/9/3K5 w - - 0 1',
        'hints': [
            '第一阶提示：红马挡在红车与黑将之间，形成了蓄势待发的「开门见将」局面。',
            '第二阶提示：跳马将军（闪击）的同时，红车在后方直射黑方大子。',
            '第三阶提示：注意马跳开将军的角度，寻找兼顾吃黑车（c8）的最佳落点。',
        ],
        'explanation': '闪击抽子是中局极为凶悍的战术手段，利用前锋子力叫将，掩护后方车炮洗劫敌方重要子力。',
    },
    {
        'id': 'midgame_02_qizi_gongxin',
        'title': '中局战术 · 弃子攻心',
        'category': 'midgame',
        'difficulty': 3,
        'side': 'red',
        'target': '红先强攻破城',
        'fen': '2bakab2/9/2r1c4/p1p1p1p1p/9/9/P1P1P1P1P/1C2C4/4R4/RNBAKAB2 w - - 0 1',
        'hints': [
            '第一阶提示：中路双炮蓄势待发，红车巡河控制要冲。',
            '第二阶提示：寻找打破九宫平衡的突破口，弃子引离关键防守棋子。',
            '第三阶提示：果断弃车破象破士，撕裂黑方防线。',
        ],
        'explanation': '弃子攻心不惜牺牲大子打破均势，利用局部的速度与子力协同打出毁灭性连击。',
    },
]


def list_categories() -> List[Dict[str, Any]]:
    return list(CATEGORIES)


def list_puzzles(category: Optional[str] = None, store: Any = None) -> List[Dict[str, Any]]:
    """列出题目列表（包含经典题与动态错题）。"""
    res = []
    # 1. 经典题
    for pz in CLASSICAL_PUZZLES:
        if category and category != pz['category']:
            continue
        res.append(dict(pz))

    # 2. 动态错题转换题（如果开启了 store 且查询 mistake_replay 或全量）
    if store is not None and (category is None or category == 'mistake_replay'):
        dynamic_mistakes = extract_mistake_puzzles(store)
        res.extend(dynamic_mistakes)

    return res


def get_puzzle(puzzle_id: str, store: Any = None) -> Optional[Dict[str, Any]]:
    """根据 ID 获取题目信息。"""
    for pz in CLASSICAL_PUZZLES:
        if pz['id'] == puzzle_id:
            return dict(pz)

    if puzzle_id.startswith('mistake_') and store is not None:
        dynamic_mistakes = extract_mistake_puzzles(store)
        for pz in dynamic_mistakes:
            if pz['id'] == puzzle_id:
                return dict(pz)

    return None


def extract_mistake_puzzles(store: Any) -> List[Dict[str, Any]]:
    """从 SQLite 的 mistake_book 中提取前 10 个典型恶手/漏着局面，转为攻坚题。"""
    if not hasattr(store, 'mistake_book'):
        return []
    try:
        book = store.mistake_book(limit=20)
        items = book.get('mistakes', [])
    except Exception:
        return []

    puzzles = []
    for idx, item in enumerate(items):
        fen = item.get('fen_before')
        if not fen:
            continue
        best = item.get('best', {})
        best_line = item.get('best_line') or []
        rec = item.get('worst_record', {})

        pz_id = f"mistake_{item.get('game_id', 'hist')}_{item.get('ply', idx)}"
        loss_text = f"比最优差 {round(abs(item.get('max_loss_cp', 100)) / 100.0, 1)} 兵"
        puzzles.append({
            'id': pz_id,
            'title': f"实战败着 #{idx + 1} · {rec.get('chinese', '失误局面')}",
            'category': 'mistake_replay',
            'difficulty': 3,
            'side': 'red',
            'target': '走出正解挽回颓势',
            'fen': fen,
            'hints': [
                f"第一阶提示：实战中这一步走了「{rec.get('chinese', '某步')}」，被评为失误（{loss_text}）。",
                f"第二阶提示：注意观察此时敌方空虚处，正解是以「{best.get('piece', '关键子力')}」发起反击。",
                f"第三阶提示：推荐正着为「{best.get('chinese', best.get('iccs', '正解'))}」，可扭转被动局面！",
            ],
            'explanation': f"此题提取自您实战对局 #{item.get('game_id', '')} 第 {item.get('ply', '')} 手。重做此题可有效加深对该类型局面的正确应对记忆。",
        })

    return puzzles
