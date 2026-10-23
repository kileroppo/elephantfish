# -*- coding: utf-8 -*-
"""精训营题库与国手名师教案引擎（Drill Lab Puzzle & Master Curriculum Engine）。

包含四大篇章专项实训课程（15门经典名师功法 + 实战心魔攻坚）：
1. 实用绝杀心法（kill_tactics）：铁门栓、重炮杀、马后炮、卧槽马、挂角马、双车错、钓鱼马、白脸将；
2. 经典残局功底（endgame）：单马破单士、炮高兵胜双士、马兵胜单缺象、车兵破单缺士；
3. 中盘破局战术（midgame）：闪击抽车、弃子攻心、牵制串打；
4. 实战心魔攻坚（mistake_replay）：从 SQLite 历史对局恶手/漏着局面中自动转化。

每个名师教案完整支持「三段式传功」体系：
- fen: 标准定式试炼盘面（第二阶段 drill 使用）
- exam_fen: 变式与实战大考盘面（第三阶段 exam 使用，加入干扰子、防守变式或逆转反抗）
- demo_line: 名师示范行棋列表（只包含红方主攻着法序列，支持单步演示）
- solution_tree: 定式走法树（包含红方正解、黑方对应顽抗、分支批注）
- traps: 预设学员常见贪吃/缓手/漏着陷阱，包含反击步 punish_move 与完整受罚推演 refute_line
- master_quote: 宗师传功心法与精要棋谚
- visual_clues: 三阶视觉指点数据（薄弱格 / 关键主攻子 / 主变路线）
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional


MOTIF_FALLBACK_CATEGORY: Dict[str, str] = {
    'missed_mate': 'kill_tactics',
    'walked_into_mate': 'kill_tactics',
    'king_exposed': 'kill_tactics',
    'greedy_capture': 'midgame',
    'fork_or_skewer': 'midgame',
    'left_hanging': 'midgame',
    'missed_tactics': 'midgame',
    'lost_tempo': 'endgame',
}

CATEGORIES = [
    {
        'id': 'kill_tactics',
        'name': '第一篇 · 实用绝杀心法',
        'desc': '“宁失一子，莫失一先”。精通铁门栓、马后炮、卧槽马等必杀定式，瞬间勘破九宫命门。',
        'icon': '⚡',
    },
    {
        'id': 'endgame',
        'name': '第二篇 · 经典残局功底',
        'desc': '“残局要精，步步扣心”。马兵破缺象、炮高兵制胜，打牢老将控线与子力压制基本功。',
        'icon': '♟',
    },
    {
        'id': 'midgame',
        'name': '第三篇 · 中盘破局战术',
        'desc': '“开门见将，暗度陈仓”。闪击抽子、弃子攻心与牵制串打，培养国手级的战术嗅觉与深度算力。',
        'icon': '🎯',
    },
    {
        'id': 'game_breakdown',
        'name': '第四篇 · 特定对局拆解特训',
        'desc': '“单局透视，起死回生”。针对您刚下完或指定的某盘实战，按开局/中局/残局连贯重练胜负手。',
        'icon': '⚔️',
    },
    {
        'id': 'mistake_replay',
        'name': '第五篇 · 历史心魔靶向攻坚',
        'desc': '“知耻后勇，复盘长棋”。从您过往实战的劣着与漏杀局面靶向转化，逐一攻克技术盲区。',
        'icon': '🔥',
    },
]

CLASSICAL_PUZZLES: List[Dict[str, Any]] = [
    # =========================================================================
    # 第一篇：实用绝杀心法 (kill_tactics · 8门)
    # =========================================================================
    {
        'id': 'kill_01_tiemenshuan',
        'title': '铁门栓 · 沉底破门',
        'category': 'kill_tactics',
        'motif': 'missed_mate',
        'motif_label': '错失必杀',
        'difficulty': 1,
        'side': 'red',
        'target': '红先一步沉底绝杀',
        'goal_type': 'checkmate',
        'fen': '4k4/4a4/4b4/9/4C4/9/9/1R7/9/3K5 w - - 0 1',
        'exam_fen': '4k1b2/4a4/4b4/9/4C4/9/7p1/1R7/9/3K5 w - - 0 1',
        'master_quote': '“中炮好比铁闩门，车入底线定乾坤。” 中炮镇住将门通道，底线只要空虚，车沉底即是一击毙命。',
        'demo_line': [
            {'move': 'b2b9', 'chinese': '车八进七', 'comment': '名师拆解：红车长驱直入沉底锁将！中炮牢牢钉死中路，黑将贴中无门，一击毙命！'},
        ],
        'solution_tree': {
            'b2b9': {
                'comment': '好！沉底破门，直取咽喉！中炮镇中令其上天无路！',
                'solved': True,
            }
        },
        'traps': {
            'b2e2': {
                'punish_move': 'e9f9',
                'comment': '俗手！平车中路看似叠炮叫将，实则放黑将从容出宫走六路，错失沉底一击必杀！',
                'refute_line': [
                    {'move': 'e9f9', 'chinese': '将5平6', 'comment': '黑将从容出宫避开中路锋芒，红方错失一步绝杀良机！'},
                ],
            },
            'd0d1': {
                'punish_move': 'e9f9',
                'comment': '闲着无谋！大敌当前妄动老帅，黑将趁机出宫避开中炮控制，铁门栓不攻自破！',
                'refute_line': [
                    {'move': 'e9f9', 'chinese': '将5平6', 'comment': '黑将从容出宫走六路，红车再难一击必杀！'},
                ],
            },
        },
        'visual_clues': {
            'weakness_squares': ['b9', 'e9'],
            'key_pieces': ['b2', 'e5'],
            'route': ['b2', 'b9'],
        },
        'hints': [
            '【观势】：注意观察黑方九宫底线门户大开，且中路已被红方五路中炮严密封锁，老帅亦控死四路肋道！',
            '【点将】：八路红车（b2）蓄势待发，是撕裂黑方底线的绝对主力！',
            '【授招】：首着果断走车八进七（b2b9）沉底绝杀！',
        ],
        'explanation': '铁门栓乃中国象棋最凌厉之基础杀法定式。当五路中炮封锁九宫中线、老帅控住肋道时，敌方老将失去全部回旋空间，底线车只要贴身切入，即可形成不可阻挡的锁门绝杀。',
    },
    {
        'id': 'kill_02_chongpao',
        'title': '连环双重炮 · 势如破竹',
        'category': 'kill_tactics',
        'motif': 'missed_mate',
        'motif_label': '错失必杀',
        'difficulty': 1,
        'side': 'red',
        'target': '红先二步连环重炮绝杀',
        'goal_type': 'checkmate',
        'fen': '2b1ka3/3P5/4b4/9/9/9/9/1CC6/9/3K5 w - - 0 1',
        'exam_fen': '2b1ka3/3P5/4b4/9/9/9/7p1/1CC6/9/3K5 w - - 0 1',
        'master_quote': '“一炮充架一炮轰，重炮连击鬼神惊。” 双炮同线前后相随，前炮借子逼宫，后炮跟进叠击成杀。',
        'demo_line': [
            {'move': 'b2b9', 'chinese': '炮八进七', 'comment': '八路炮率先沉底，借黑方底象为炮架悍然叫将！'},
            {'move': 'c2c9', 'chinese': '炮七进七', 'comment': '七路炮紧随沉底，双炮同居底线构成连环重炮，绝杀！'},
        ],
        'solution_tree': {
            'b2b9': {
                'comment': '痛快！八路炮率先沉底借象叫将，逼黑方飞象拆架！',
                'reply': 'c9a7',
                'reply_comment': '黑方无奈飞象逃避炮架。',
                'children': {
                    'c2c9': {'comment': '七路炮乘虚沉底，双炮一线叠击，连环重炮绝杀！', 'solved': True},
                },
            }
        },
        'traps': {
            'c2c8': {
                'punish_move': 'c9a7',
                'comment': '次序颠倒！先走七路炮巡8线并未叫将，黑方先手飞象拆架，底线重炮化为泡影！',
                'refute_line': [
                    {'move': 'c9a7', 'chinese': '象3进1', 'comment': '黑方提前飞开底象拆掉炮架，红方双炮再无借力之机！'},
                ],
            }
        },
        'visual_clues': {
            'weakness_squares': ['b9', 'c9'],
            'key_pieces': ['b2', 'c2'],
            'route': ['b2', 'b9', 'c2', 'c9'],
        },
        'hints': [
            '【观势】：黑将受六路高兵（d8）与红帅（d0）夹击，困守九宫顶线動弹不得。',
            '【点将】：八路炮（b2）与七路炮（c2）可先后沉底，构筑底线连环重炮！',
            '【授招】：先走炮八进七（b2b9）借象叫将，待黑方飞象后，再走炮七进七（c2c9）重炮绝杀！',
        ],
        'explanation': '双重炮利用两门火炮在同一条直线上的立体火力配置，一炮充当炮架，另一炮远程轰击，敌方无法通过拆架化解，杀力极强。',
    },
    {
        'id': 'kill_03_mahoupao',
        'title': '马后炮 · 绝地封喉',
        'category': 'kill_tactics',
        'motif': 'missed_mate',
        'motif_label': '错失必杀',
        'difficulty': 2,
        'side': 'red',
        'target': '红先二步马后炮绝杀',
        'goal_type': 'checkmate',
        'fen': '3k5/1R7/b8/2N6/9/9/9/2C6/9/4K4 w - - 0 1',
        'exam_fen': '3k5/1R7/b8/2N6/9/9/7p1/2C6/9/4K4 w - - 0 1',
        'master_quote': '“马跳中宫控两肋，炮隐马后发雷霆。” 马踏咽喉锁死老将左右去路并化身为架，令敌方望炮兴叹。',
        'demo_line': [
            {'move': 'c6e7', 'chinese': '马七进五', 'comment': '红马跃入中宫象位照将，同时牢牢锁死d9与f9两翼！'},
            {'move': 'c2e2', 'chinese': '炮七平五', 'comment': '红炮平中隐于马后，借马为架直轰黑将，马后炮绝杀！'},
        ],
        'solution_tree': {
            'c6e7': {
                'comment': '神来之笔！跃马中宫照将，逼黑将入中且锁死左右两肋！',
                'reply': 'd9e9',
                'reply_comment': '二路横车封住八线，黑将被迫平中。',
                'children': {
                    'c2e2': {'comment': '炮移马后，借马为架，标准中路马后炮绝杀达成！', 'solved': True},
                },
            }
        },
        'traps': {
            'c2e2': {
                'punish_move': 'a7c5',
                'comment': '缓着失先！马尚未入位控将便急于平炮，黑方从容走子，错失连将战机！',
                'refute_line': [
                    {'move': 'a7c5', 'chinese': '象1进3', 'comment': '黑方飞象活动子力，红方先手顿失！'},
                ],
            }
        },
        'visual_clues': {
            'weakness_squares': ['e7', 'e9'],
            'key_pieces': ['c6', 'c2'],
            'route': ['c6', 'e7', 'c2', 'e2'],
        },
        'hints': [
            '【观势】：八路横车（b8）已封锁黑宫二楼，黑将仅剩顶线活动空间。',
            '【点将】：七路红马（c6）跃入中宫象位（e7），既能将军又能控死九宫两翼（d9、f9）！',
            '【授招】：首招马七进五（c6e7）逼黑将平中，随后炮七平五（c2e2）借马成杀！',
        ],
        'explanation': '马后炮定式是象棋中马炮协同作战的典范。马居中宫象位时正好控制九宫顶线两角（d9、f9），并充当五路中炮的天然炮架，配合横车控住二楼即成绝杀。',
    },
    {
        'id': 'kill_04_wocaoma',
        'title': '卧槽马 · 锁死将门',
        'category': 'kill_tactics',
        'motif': 'missed_mate',
        'motif_label': '错失必杀',
        'difficulty': 2,
        'side': 'red',
        'target': '红先二步卧槽马绝杀',
        'goal_type': 'checkmate',
        'fen': '4ka3/4a4/3P5/1N7/9/9/9/R8/9/5K3 w - - 0 1',
        'exam_fen': '4ka3/4a4/3P5/1N7/9/9/7p1/R8/9/5K3 w - - 0 1',
        'master_quote': '“卧槽一跃九宫寒，车马联袂破关山。” 卧槽马控死将门中枢，逼将出宫后长车沉底一剑封喉。',
        'demo_line': [
            {'move': 'b6c8', 'chinese': '马八进七', 'comment': '跳马卧槽！直接叫将并锁死黑将回中路径！'},
            {'move': 'a2a9', 'chinese': '车九进七', 'comment': '九路车长驱沉底，配合卧槽马与六路高兵锁定胜局！'},
        ],
        'solution_tree': {
            'b6c8': {
                'comment': '雄骏！卧槽马直刺九宫心窝，逼黑将偏离中路！',
                'reply': 'e9d9',
                'reply_comment': '黑将无奈平出四路肋道。',
                'children': {
                    'a2a9': {'comment': '车马兵三子联袂，沉底一击绝杀，恭喜通关！', 'solved': True},
                },
            }
        },
        'traps': {
            'a2a9': {
                'punish_move': 'e8d9',
                'comment': '单车冒进沉底，卧槽马尚未就位，黑方从容退士护底化解攻势！',
                'refute_line': [
                    {'move': 'e8d9', 'chinese': '士5退4', 'comment': '黑方退士挡住底车锋芒，红方攻势受阻！'},
                ],
            }
        },
        'visual_clues': {
            'weakness_squares': ['c8', 'a9'],
            'key_pieces': ['b6', 'a2'],
            'route': ['b6', 'c8', 'a2', 'a9'],
        },
        'hints': [
            '【观势】：黑将受双士羁绊，c8卧槽点空虚无防，且六路高兵（d7）已锁死d8退路。',
            '【点将】：八路红马（b6）是开路先锋，跳入卧槽点（c8）可直接逼黑将出宫。',
            '【授招】：果断跳马八进七（b6c8）卧槽叫将，逼黑将平四后走车九进七（a2a9）沉底绝杀！',
        ],
        'explanation': '卧槽马能够直接将军并严密控制五路帅位，逼迫对方老将偏离中宫。此时配合底车与高兵锁住上下门户，即可打出势如破竹的连续杀局。',
    },
    {
        'id': 'kill_05_guajiaoma',
        'title': '挂角马 · 侧翼合围',
        'category': 'kill_tactics',
        'motif': 'missed_mate',
        'motif_label': '错失必杀',
        'difficulty': 2,
        'side': 'red',
        'target': '红先二步挂角绝杀',
        'goal_type': 'checkmate',
        'fen': '3ak4/4a4/9/9/2N6/9/9/7R1/9/3K5 w - - 0 1',
        'exam_fen': '2bak4/4a4/9/9/2N6/9/1p7/7R1/9/3K5 w - - 0 1',
        'master_quote': '“挂角马跃九宫角，长车呼应鬼神愁。” 占领挂角要津，同时封锁老将中路与二楼，长车沉底一锤定音。',
        'demo_line': [
            {'move': 'c5d7', 'chinese': '马七进六', 'comment': '马跳挂角照将！一子兼控e9中宫与f8二楼要道！'},
            {'move': 'h2h9', 'chinese': '车二进七', 'comment': '二路红车长驱沉底，车马遥相呼应，绝杀！'},
        ],
        'solution_tree': {
            'c5d7': {
                'comment': '妙！挂角马锁住将门，迫使黑将偏出六路！',
                'reply': 'e9f9',
                'reply_comment': '黑将被迫平出六路。',
                'children': {
                    'h2h9': {'comment': '二路车沉底锁喉，挂角马兼控e9与f8，绝杀功成！', 'solved': True},
                },
            }
        },
        'traps': {
            'h2h9': {
                'punish_move': 'e8f9',
                'comment': '先动车打草惊蛇，未以挂角马逼宫，黑方退士护底从容化解！',
                'refute_line': [
                    {'move': 'e8f9', 'chinese': '士5退6', 'comment': '黑方退士稳守底线，红车无功而返！'},
                ],
            }
        },
        'visual_clues': {
            'weakness_squares': ['d7', 'h9'],
            'key_pieces': ['c5', 'h2'],
            'route': ['c5', 'd7', 'h2', 'h9'],
        },
        'hints': [
            '【观势】：黑方九宫左翼挂角点（d7）空虚，跃马挂角可同时控制e9与f8两处命门。',
            '【点将】：七路红马（c5）先跃挂角点逼宫，二路红车（h2）伺机沉底。',
            '【授招】：走马七进六（c5d7）挂角叫将，待黑将平六后，走车二进七（h2h9）绝杀！',
        ],
        'explanation': '挂角马利用马在九宫四角（d7或f7）的斜向控制力，一子同时锁住中宫（e9）与另一侧二楼（f8），配合长车沉底即可完成无解合围。',
    },
    {
        'id': 'kill_06_shuangchecuo',
        'title': '双车错 · 翻江倒海',
        'category': 'kill_tactics',
        'motif': 'missed_mate',
        'motif_label': '错失必杀',
        'difficulty': 2,
        'side': 'red',
        'target': '红先二步交错斩将',
        'goal_type': 'checkmate',
        'fen': '4k4/9/4b4/9/9/9/9/1R7/R8/4K4 w - - 0 1',
        'exam_fen': '4k4/9/4b4/9/9/9/7p1/1R7/R8/4K4 w - - 0 1',
        'master_quote': '“双车错位如剪刀，上下翻飞无可逃。” 两车相邻交替照将，步步逼宫令敌将首尾不能相顾。',
        'demo_line': [
            {'move': 'a1a9', 'chinese': '车九进八', 'comment': '九路车直沉底线率先叫将，封锁整个九宫顶线！'},
            {'move': 'b2b8', 'chinese': '车八进六', 'comment': '八路车跟进二楼交错照将，黑象自塞退路，绝杀！'},
        ],
        'solution_tree': {
            'a1a9': {
                'comment': '雷霆万钧！九路车率先沉底锁死顶线，步步进逼！',
                'reply': 'e9e8',
                'reply_comment': '黑将无奈登楼避让。',
                'children': {
                    'b2b8': {'comment': '双车交错翻江倒海，二楼横扫绝杀定乾坤！', 'solved': True},
                },
            }
        },
        'traps': {
            'b2b9': {
                'punish_move': 'e9e8',
                'comment': '次序颠倒！八路车先沉底挡住九路车通道，黑将上楼后九路车无法直达二楼成杀！',
                'refute_line': [
                    {'move': 'e9e8', 'chinese': '将5进1', 'comment': '黑将上二楼后，红方两车路线互相掣肘，错失速杀！'},
                ],
            }
        },
        'visual_clues': {
            'weakness_squares': ['a9', 'b8'],
            'key_pieces': ['a1', 'b2'],
            'route': ['a1', 'a9', 'b2', 'b8'],
        },
        'hints': [
            '【观势】：双车同占左翼通头大路，黑将中象（e7）反成其退路阻碍。',
            '【点将】：注意双车分工次序——外侧九路车（a1）宜直取最远端底线，内侧八路车（b2）取二楼！',
            '【授招】：先走车九进八（a1a9）沉底叫将，再走车八进六（b2b8）交错绝杀！',
        ],
        'explanation': '双车错杀法利用双车在相邻两线分工控制九宫两条横线，讲究“远车取底、近车取肋”，次序分明则一击必杀。',
    },
    {
        'id': 'kill_07_diaoyuma',
        'title': '钓鱼马 · 借车破防',
        'category': 'kill_tactics',
        'motif': 'missed_mate',
        'motif_label': '错失必杀',
        'difficulty': 2,
        'side': 'red',
        'target': '红先一步钓鱼马成杀',
        'goal_type': 'checkmate',
        'fen': '4ka3/9/2N1b4/9/9/9/9/1R7/9/4K4 w - - 0 1',
        'exam_fen': '4ka3/9/2N1b4/9/9/9/7p1/1R7/9/4K4 w - - 0 1',
        'master_quote': '“钓鱼马占三三位，横车直车任驱驰。” 钓鱼马锁住将门出宫与登楼两道命门，借车沉底即可封喉。',
        'demo_line': [
            {'move': 'b2b9', 'chinese': '车八进七', 'comment': '红车长驱沉底！钓鱼马（c7）牢牢控住d9与e8，黑将插翅难飞！'},
        ],
        'solution_tree': {
            'b2b9': {
                'comment': '一针见血！钓鱼马锁死d9与e8两处生门，红车沉底一剑封喉！',
                'solved': True,
            }
        },
        'traps': {
            'c7a8': {
                'punish_move': 'e9e8',
                'comment': '舍本逐末！妄动钓鱼马跳离三三要津，黑将立刻登楼脱困！',
                'refute_line': [
                    {'move': 'e9e8', 'chinese': '将5进1', 'comment': '失去钓鱼马控位，黑将轻松登楼化险为夷！'},
                ],
            }
        },
        'visual_clues': {
            'weakness_squares': ['b9', 'e8'],
            'key_pieces': ['c7', 'b2'],
            'route': ['b2', 'b9'],
        },
        'hints': [
            '【观势】：红马牢牢占据钓鱼马（c7）标准点位，一子同时封死黑将平四（d9）与登楼（e8）两条退路！',
            '【点将】：钓鱼马切莫轻动，八路红车（b2）才是终结比赛的利刃！',
            '【授招】：果断走车八进七（b2b9）沉底绝杀！',
        ],
        'explanation': '钓鱼马定式指红马占据对方三三（c7或g7）位置，一子同时控制九宫顶角（d9）与二楼中心（e8），配合底线车形成滴水不漏的绝杀网。',
    },
    {
        'id': 'kill_08_bailianjiang',
        'title': '白脸将 · 帅威助战',
        'category': 'kill_tactics',
        'motif': 'missed_mate',
        'motif_label': '错失必杀',
        'difficulty': 2,
        'side': 'red',
        'target': '红先一步借帅绝杀',
        'goal_type': 'checkmate',
        'fen': '3k5/9/9/9/9/9/9/4R4/9/4K4 w - - 0 1',
        'exam_fen': '3k5/9/9/9/9/9/7p1/4R4/9/4K4 w - - 0 1',
        'master_quote': '“王不见王千古训，借帅助攻鬼神惊。” 老帅居中雄视敌宫，红车闪开中路直取肋道，帅车合力封门。',
        'demo_line': [
            {'move': 'e2d2', 'chinese': '车五平六', 'comment': '平车六路肋道照将！同时亮出五路红帅天威，黑将无法回中，绝杀！'},
        ],
        'solution_tree': {
            'e2d2': {
                'comment': '好棋！闪车亮帅，五路老帅控死中线，六路长车锁死肋道，白脸将绝杀！',
                'solved': True,
            }
        },
        'traps': {
            'e2e9': {
                'punish_move': 'd9d8',
                'comment': '鲁莽沉底！黑将进位（d9d8）从容脱离照将，红车失去肋道控制，痛失良机！',
                'refute_line': [
                    {'move': 'd9d8', 'chinese': '将4进1', 'comment': '黑将进位脱离中车锋芒，红方失去一击必杀机会！'},
                ],
            }
        },
        'visual_clues': {
            'weakness_squares': ['d2', 'd9'],
            'key_pieces': ['e2', 'e0'],
            'route': ['e2', 'd2'],
        },
        'hints': [
            '【观势】：红帅居中（e0）与黑宫遥遥相对，一旦五路中线清空，黑将便无法踏入中路半步！',
            '【点将】：五路红车（e2）横移一步，即可兼收“平车照将”与“亮帅控中”双重奇效！',
            '【授招】：走车五平六（e2d2）切断四路肋线，一击绝杀！',
        ],
        'explanation': '白脸将（对面笑）杀法利用中国象棋中将帅不能在同一直线无遮挡对视的规则，以己方老帅充当“半座车”封锁一路，再以车或炮完成致命一击。',
    },

    # =========================================================================
    # 第二篇：经典残局功底 (endgame · 4门)
    # =========================================================================
    {
        'id': 'endgame_01_danma_danshi',
        'title': '单马破单士 · 挂角抽士',
        'category': 'endgame',
        'motif': 'lost_tempo',
        'motif_label': '缓手失先',
        'difficulty': 2,
        'side': 'red',
        'target': '红先巧踏黑士必胜',
        'goal_type': 'win_advantage',
        'fen': '3k5/4a4/9/9/3N5/9/9/9/9/4K4 w - - 0 1',
        'exam_fen': '3k5/4a4/8b/9/3N5/9/9/9/9/4K4 w - - 0 1',
        'master_quote': '“单马擒单士，全凭老帅争中路。” 帅占中路迫敌将偏安，红马一跃三三点将抽士，单士必破。',
        'demo_line': [
            {'move': 'd5c7', 'chinese': '马六进七', 'comment': '跃马c7钓鱼点！一子双扑，同时照将d9并捉死中宫黑士e8！'},
            {'move': 'c7e8', 'chinese': '马七进五', 'comment': '顺势踏碎黑士！单马净吃单士，残局必胜之势已成！'},
        ],
        'solution_tree': {
            'd5c7': {
                'comment': '妙着！马跃c7要津，一举照将兼抽中心黑士，黑方首尾难顾！',
                'reply': 'd9d8',
                'reply_comment': '黑将无奈登楼避将。',
                'children': {
                    'c7e8': {'comment': '干净利落踏去黑士！黑方光杆老将再无屏障，胜局已定！', 'solved': True},
                },
            }
        },
        'traps': {
            'd5e7': {
                'punish_move': 'd9d8',
                'comment': '选点偏差！跳马中象位虽能叫将，却未踩中黑士要害，黑将登楼顺势护住中士！',
                'refute_line': [
                    {'move': 'd9d8', 'chinese': '将4进1', 'comment': '黑将上楼贴身护士，红马无机可乘！'},
                ],
            }
        },
        'visual_clues': {
            'weakness_squares': ['c7', 'e8'],
            'key_pieces': ['d5', 'e0'],
            'route': ['d5', 'c7', 'c7', 'e8'],
        },
        'hints': [
            '【观势】：红帅镇中（e0），黑将偏居d9，中士（e8）与黑将（d9）恰好处于马蹄双扑的几何距离上！',
            '【点将】：六路红马（d5）需找准既能照将d9、又能抽吃e8黑士的黄金支点。',
            '【授招】：先走马六进七（d5c7）照将抽士，待黑将避让后走马七进五（c7e8）净吃黑士！',
        ],
        'explanation': '单马破单士是象棋残局必修基本功。核心在于红帅占中限制黑将，再利用马的“日”字八面威风寻找叫将抽士的双重支点（如c7同时攻击d9与e8）。',
    },
    {
        'id': 'endgame_02_paobing_shuangshi',
        'title': '炮高兵胜双士 · 借兵破士',
        'category': 'endgame',
        'motif': 'missed_tactics',
        'motif_label': '漏看妙手',
        'difficulty': 3,
        'side': 'red',
        'target': '红先破士奠定胜势',
        'goal_type': 'win_advantage',
        'fen': '3aka3/9/4P4/9/9/2C6/9/9/9/3K5 w - - 0 1',
        'exam_fen': '2baka3/9/4P4/9/9/2C6/7p1/9/9/3K5 w - - 0 1',
        'master_quote': '“炮兵破双士，高兵占宫借炮轰。” 兵居九宫咽喉充当铁炮架，诱敌撑士再以兵破之，双士土崩瓦解。',
        'demo_line': [
            {'move': 'c4e4', 'chinese': '炮七平五', 'comment': '平炮中路！借五路高兵（e7）为铁架直接照将，逼黑方撑士垫架！'},
            {'move': 'e7e8', 'chinese': '兵五进一', 'comment': '高兵顺势拱掉中心黑士并继续叫将，黑方双士防线彻底瓦解！'},
        ],
        'solution_tree': {
            'c4e4': {
                'comment': '老辣！平炮借高兵为架当头一击，黑将左右被羊角士锁死，唯有撑士自救！',
                'reply': 'f9e8',
                'reply_comment': '黑方被迫撑士垫中。',
                'children': {
                    'e7e8': {'comment': '高兵一举破去中士！双士被破其一，炮高兵必胜单士，通关！', 'solved': True},
                },
            }
        },
        'traps': {
            'e7e8': {
                'punish_move': 'e9e8',
                'comment': '鲁莽拱兵！后方红炮尚未平中助威，单兵孤身闯宫惨遭黑将白吃，顿时成和！',
                'refute_line': [
                    {'move': 'e9e8', 'chinese': '将5进1', 'comment': '黑将直接吃掉孤兵，单炮难胜双士，功亏一篑！'},
                ],
            }
        },
        'visual_clues': {
            'weakness_squares': ['e4', 'e8'],
            'key_pieces': ['c4', 'e7'],
            'route': ['c4', 'e4', 'e7', 'e8'],
        },
        'hints': [
            '【观势】：五路高兵（e7）已深入九宫心腹，黑将受羊角双士（d9、f9）自身阻挡，无法左右平移。',
            '【点将】：切莫急于拱兵送吃，先调七路红炮（c4）平中借兵发力！',
            '【授招】：先走炮七平五（c4e4）借兵叫将，逼黑方士6进5（f9e8）后，再走兵五进一（e7e8）破士胜定！',
        ],
        'explanation': '炮高兵破双士的精髓在于“以兵为架、诱士入彀”。利用黑方双士阻碍老将活动的弱点，先平炮叫将逼其撑士，再以高兵吃士，令其防线不攻自破。',
    },
    {
        'id': 'endgame_03_mabing_que_xiang',
        'title': '马兵胜单缺象 · 挂角夺象',
        'category': 'endgame',
        'motif': 'left_hanging',
        'motif_label': '丢无根子',
        'difficulty': 3,
        'side': 'red',
        'target': '红先破象奠定胜势',
        'goal_type': 'win_advantage',
        'fen': '3aka3/9/4bP3/9/2N6/9/9/9/9/4K4 w - - 0 1',
        'exam_fen': '3aka3/9/4bP3/9/2N6/9/7p1/9/9/4K4 w - - 0 1',
        'master_quote': '“马兵难破士象全，单缺象是破防口。” 先以挂角马逼将塞宫，再以高兵借帅威斩其孤象，胜券在握。',
        'demo_line': [
            {'move': 'c5d7', 'chinese': '马七进六', 'comment': '跃马挂角照将！逼迫黑将下二楼（e8），阻断双士护中之路！'},
            {'move': 'f7e7', 'chinese': '兵四平五', 'comment': '高兵横扫中象并借五路红帅之威叫将，净夺孤象胜定！'},
        ],
        'solution_tree': {
            'c5d7': {
                'comment': '精准！挂角马率先发难，逼黑将下二楼自塞士路！',
                'reply': 'e9e8',
                'reply_comment': '黑将被迫进一登楼。',
                'children': {
                    'f7e7': {'comment': '妙手平兵斩掉中象！五路老帅遥相护兵，黑将不敢吃兵，大局已定！', 'solved': True},
                },
            }
        },
        'traps': {
            'f7e7': {
                'punish_move': 'f9e8',
                'comment': '操之过急！未先跳马逼将，贸然平兵吃象，黑方从容撑士巩固防线！',
                'refute_line': [
                    {'move': 'f9e8', 'chinese': '士6进5', 'comment': '黑方撑起中心士，双士联防稳固！'},
                ],
            }
        },
        'visual_clues': {
            'weakness_squares': ['d7', 'e7'],
            'key_pieces': ['c5', 'f7'],
            'route': ['c5', 'd7', 'f7', 'e7'],
        },
        'hints': [
            '【观势】：黑方仅存一象居于中宫（e7），旁侧高兵（f7）虎视眈眈，五路红帅（e0）正对中线。',
            '【点将】：先用七路红马（c5）跳入挂角（d7），逼黑将占据e8中心点！',
            '【授招】：首着马七进六（c5d7）叫将逼黑将进一，再走兵四平五（f7e7）借帅威净吃中象！',
        ],
        'explanation': '马兵攻单缺象时，切忌单兵盲目兑换。先用挂角马逼迫黑将移位阻塞双士联络，再以高兵借老帅中路威慑夺取孤象，即可转化为马兵破双士的必胜残局。',
    },
    {
        'id': 'endgame_04_chebing_que_shi',
        'title': '车兵破单缺士 · 沉底催杀',
        'category': 'endgame',
        'motif': 'missed_mate',
        'motif_label': '错失必杀',
        'difficulty': 3,
        'side': 'red',
        'target': '红先二步破士绝杀',
        'goal_type': 'checkmate',
        'fen': '2b1k4/4aP3/4b4/9/9/9/9/7R1/9/3K5 w - - 0 1',
        'exam_fen': '2b1k4/4aP3/4b4/9/9/9/1p7/7R1/9/3K5 w - - 0 1',
        'master_quote': '“单缺士畏车兵催，低头咽喉一剑摧。” 高兵锁住二楼咽喉，长车沉底逼士归边，车兵合击瞬间破城。',
        'demo_line': [
            {'move': 'h2h9', 'chinese': '车二进七', 'comment': '二路红车疾沉底线照将！逼迫黑方孤士退守底线！'},
            {'move': 'h9f9', 'chinese': '车二平四', 'comment': '红车借四路高兵护卫，横扫底士贴身绝杀！'},
        ],
        'solution_tree': {
            'h2h9': {
                'comment': '凌厉！长车沉底逼宫，黑将受红帅控肋无法平四，唯有退士！',
                'reply': 'e8f9',
                'reply_comment': '黑方被迫退士遮挡底车。',
                'children': {
                    'h9f9': {'comment': '车借兵威直取底士，四路高兵兼锁e8退路，绝杀无解！', 'solved': True},
                },
            }
        },
        'traps': {
            'f8e8': {
                'punish_move': 'e9e8',
                'comment': '盲目弃兵！红车尚未沉底到位，贸然平兵换士反令黑将吃兵脱困！',
                'refute_line': [
                    {'move': 'e9e8', 'chinese': '将5进1', 'comment': '黑将吃掉高兵，红方痛失锁喉支点！'},
                ],
            }
        },
        'visual_clues': {
            'weakness_squares': ['h9', 'f9'],
            'key_pieces': ['h2', 'f8'],
            'route': ['h2', 'h9', 'h9', 'f9'],
        },
        'hints': [
            '【观势】：四路高兵（f8）不仅控制f9底士位，更横向锁死了黑将下二楼（e8）的退路！',
            '【点将】：二路红车（h2）沉底可逼迫黑方中心孤士退守f9。',
            '【授招】：先走车二进七（h2h9）沉底叫将，待黑方退士后走车二平四（h9f9）借兵砍士绝杀！',
        ],
        'explanation': '车兵攻单缺士时，“低兵（二楼兵）”的作用极为关键：一子兼顾护车与控将，配合沉底车即可强行砍士完成贴身绝杀。',
    },

    # =========================================================================
    # 第三篇：中盘破局战术 (midgame · 3门)
    # =========================================================================
    {
        'id': 'midgame_01_shangji_chouzi',
        'title': '闪击抽车 · 开门见将',
        'category': 'midgame',
        'motif': 'fork_or_skewer',
        'motif_label': '遭抽将捉双',
        'difficulty': 2,
        'side': 'red',
        'target': '红先闪击净吃黑车',
        'goal_type': 'win_material',
        'fen': '1r1aka3/9/9/4N4/9/9/9/4R4/9/3K5 w - - 0 1',
        'exam_fen': '1r1aka3/9/9/4N4/9/9/7p1/4R4/9/3K5 w - - 0 1',
        'master_quote': '“开门见将风雷动，暗度陈仓抽大子。” 前马跃开亮出中车锋芒，敌将忙于护驾，后蹄顺势踏车。',
        'demo_line': [
            {'move': 'e6d8', 'chinese': '马五进六', 'comment': '跃马挂角亮出五路红车开门见将，同时马蹄直指黑方b9底车！'},
            {'move': 'd8b9', 'chinese': '马六进八', 'comment': '趁黑方撑士应将之机，红马顺势踏吃黑方底车，大获全胜！'},
        ],
        'solution_tree': {
            'e6d8': {
                'comment': '好一记闪击！马跃d8亮出中车叫将，同时瞄准黑方b9大车！',
                'reply': 'f9e8',
                'reply_comment': '黑方被迫撑士遮挡中车。',
                'children': {
                    'd8b9': {'comment': '手起刀落踏吃黑车！闪击战术净赚大车，胜定通关！', 'solved': True},
                },
            }
        },
        'traps': {
            'e6g7': {
                'punish_move': 'f9e8',
                'comment': '闪击方向选错！跃马三路未能瞄准黑方b9大车，黑方从容撑士挡中，白白放走胜机！',
                'refute_line': [
                    {'move': 'f9e8', 'chinese': '士6进5', 'comment': '黑方从容撑士应将，二路大车安然无恙！'},
                ],
            }
        },
        'visual_clues': {
            'weakness_squares': ['d8', 'b9'],
            'key_pieces': ['e6', 'e2'],
            'route': ['e6', 'd8', 'd8', 'b9'],
        },
        'hints': [
            '【观势】：五路红马（e6）恰好挡在五路红车（e2）与黑将（e9）之间，构成经典的“开门见将”阵势。',
            '【点将】：红马跳开即可亮车叫将，关键在于选择能同时捉死黑方b9底车的落脚点！',
            '【授招】：走马五进六（e6d8）闪击叫将，待黑方撑士后走马六进八（d8b9）净吃黑车！',
        ],
        'explanation': '闪击抽子是中局极具杀伤力的战术组合。前子移开形成直接将军（开门见将），令对方必须优先应将，移动之子则趁机掠取对方无根大子。',
    },
    {
        'id': 'midgame_02_qizi_gongxin',
        'title': '弃子攻心 · 强撕将门',
        'category': 'midgame',
        'motif': 'missed_tactics',
        'motif_label': '漏看妙手',
        'difficulty': 3,
        'side': 'red',
        'target': '红先弃车引将绝杀',
        'goal_type': 'checkmate',
        'fen': '3aka3/2P6/9/5N3/9/9/9/1R1R5/9/5K3 w - - 0 1',
        'exam_fen': '3aka3/2P6/9/5N3/9/9/7p1/1R1R5/9/5K3 w - - 0 1',
        'master_quote': '“舍车引将离金殿，八路长车定乾坤。” 不惜牺牲一车轰碎羊角士引蛇出洞，后车沉底一击绝杀。',
        'demo_line': [
            {'move': 'd2d9', 'chinese': '车六进七', 'comment': '气吞山河！悍然弃掉六路车强砍羊角士，将黑将引出中宫！'},
            {'move': 'b2b9', 'chinese': '车八进七', 'comment': '八路车紧随沉底！七路高兵（c8）锁死d8退路，绝杀！'},
        ],
        'solution_tree': {
            'd2d9': {
                'comment': '气吞山河！弃车砍士引蛇出洞，四路马控住e8令黑将别无选择！',
                'reply': 'e9d9',
                'reply_comment': '黑将被迫平四吃车。',
                'children': {
                    'b2b9': {'comment': '八路车沉底一锤定音！高兵控死d8，黑将无路可逃，绝杀！', 'solved': True},
                },
            }
        },
        'traps': {
            'b2b9': {
                'punish_move': 'f9e8',
                'comment': '畏首畏尾！不肯弃车破士而先沉八路车，黑方从容撑士固守，错失绝杀！',
                'refute_line': [
                    {'move': 'f9e8', 'chinese': '士6进5', 'comment': '黑方补厚中路防线，红方再难强行破门！'},
                ],
            }
        },
        'visual_clues': {
            'weakness_squares': ['d9', 'b9'],
            'key_pieces': ['d2', 'b2'],
            'route': ['d2', 'd9', 'b2', 'b9'],
        },
        'hints': [
            '【观势】：黑将居中受羊角双士护卫，但四路红马（f6）已控死e8，七路高兵（c8）已控死d8！',
            '【点将】：六路红车（d2）若敢舍身砍去d9羊角士，黑将被引到d9即入绝境！',
            '【授招】：先走车六进七（d2d9）弃车引将，待黑将平四吃车后，走车八进七（b2b9）沉底绝杀！',
        ],
        'explanation': '弃子攻心战术重在“算清终局杀形，果断舍弃重子”。通过弃车强行摧毁防守铁士并将敌将引入预设包围圈，是国手撕裂铁桶阵的标志性手段。',
    },
    {
        'id': 'midgame_03_qianzhi_chuanda',
        'title': '牵制串打 · 骑河捉双',
        'category': 'midgame',
        'motif': 'fork_or_skewer',
        'motif_label': '遭抽将捉双',
        'difficulty': 2,
        'side': 'red',
        'target': '红先骑河捉双得子',
        'goal_type': 'win_material',
        'fen': '4k4/4a4/4b4/9/9/2n3c2/9/3R5/9/3K5 w - - 0 1',
        'exam_fen': '4k1b2/4a4/4b4/9/9/2n3c2/7p1/3R5/9/3K5 w - - 0 1',
        'master_quote': '“车占河头威四方，一车双捉必失伤。” 敏锐捕捉敌方双子同线无根之机，一车切入中枢左右开弓。',
        'demo_line': [
            {'move': 'd2d4', 'chinese': '车六进二', 'comment': '红车进占骑河要道（d4），横向一箭双雕，同时捉死c4黑马与g4黑炮！'},
        ],
        'solution_tree': {
            'd2d4': {
                'comment': '好眼力！车骑河沿居中切入，黑方马炮同线无根，首尾难顾必丢一子！',
                'solved': True,
            }
        },
        'traps': {
            'd2d8': {
                'punish_move': 'g4d4',
                'comment': '舍近求远！盲目深入八线扑空，反让黑方平炮挡路，痛失骑河捉双良机！',
                'refute_line': [
                    {'move': 'g4d4', 'chinese': '炮7平4', 'comment': '黑炮平占肋道与黑马联络，红方空手而归！'},
                ],
            }
        },
        'visual_clues': {
            'weakness_squares': ['c4', 'g4'],
            'key_pieces': ['d2'],
            'route': ['d2', 'd4'],
        },
        'hints': [
            '【观势】：观察黑方三路马（c4）与七路炮（g4）同处骑河四线，且均无根保护！',
            '【点将】：六路红车（d2）进占两子之间的枢纽点（d4），即可左右开弓！',
            '【授招】：走车六进二（d2d4）骑河串打，黑方马炮必丢其一！',
        ],
        'explanation': '骑河捉双（串打）是中局赚取子力的核心基本功。当敌方两个无根子力处在同一横线或直线时，切入两子之间的交叉点即可必得一子。',
    },
]


def list_categories() -> List[Dict[str, Any]]:
    """返回教案四大篇章。"""
    return list(CATEGORIES)


def list_puzzles(category: Optional[str] = None, store: Any = None, motif: Optional[str] = None, game_id: Optional[str] = None) -> List[Dict[str, Any]]:
    """列出题目列表（包含名师经典教案、特定对局拆解题与实战心魔转化题）。"""
    res = []
    for pz in CLASSICAL_PUZZLES:
        if category and category != pz.get('category'):
            continue
        if motif and motif != pz.get('motif'):
            continue
        res.append(dict(pz))

    # 特定对局拆解特训题
    if store is not None and (category is None or category == 'game_breakdown'):
        from engine import tactics
        # 若指定了 game_id，提取该局；若未指定，默认提取最近一局有判分的对局
        target_gid = game_id
        if not target_gid and hasattr(store, 'recent_games'):
            recent = store.recent_games(limit=10)
            graded_games = [g for g in recent.get('games', []) if g.get('graded_plies', 0) > 0]
            if graded_games:
                target_gid = graded_games[0].get('game_id')
        if target_gid and hasattr(store, 'game_replay'):
            g_replay = store.game_replay(target_gid)
            breakdown = tactics.breakdown_specific_game(g_replay)
            for pz in breakdown.get('puzzles', []):
                if motif and motif != pz.get('motif'):
                    continue
                res.append(pz)

    # 动态实战心魔转换题
    if store is not None and (category is None or category == 'mistake_replay'):
        dynamic_mistakes = extract_mistake_puzzles(store)
        for pz in dynamic_mistakes:
            if motif and motif != pz.get('motif'):
                continue
            res.append(pz)

    return res


def get_puzzle(puzzle_id: str, store: Any = None) -> Optional[Dict[str, Any]]:
    """根据 ID 获取题目详情。"""
    for pz in CLASSICAL_PUZZLES:
        if pz['id'] == puzzle_id:
            return dict(pz)

    if puzzle_id.startswith('mistake_') and store is not None:
        # 首先尝试从 puzzle_id 解析出特定对局（格式: mistake_{game_id}_{ply}）
        parts = puzzle_id.split('_')
        if len(parts) >= 3 and hasattr(store, 'game_replay'):
            gid = parts[1]
            try:
                ply_req = int(parts[2])
            except ValueError:
                ply_req = None
            g_replay = store.game_replay(gid)
            if g_replay.get('found'):
                from engine import tactics
                breakdown = tactics.breakdown_specific_game(g_replay)
                for pz in breakdown.get('puzzles', []):
                    if pz['id'] == puzzle_id or (ply_req is not None and pz.get('ply') == ply_req):
                        return dict(pz)

        dynamic_mistakes = extract_mistake_puzzles(store)
        for pz in dynamic_mistakes:
            if pz['id'] == puzzle_id:
                return dict(pz)

    return None


def extract_mistake_puzzles(store: Any) -> List[Dict[str, Any]]:
    """从 SQLite 的 mistake_book 中提取典型失误，经由自动教案编译器转化为名师考校题。"""
    if not hasattr(store, 'mistake_book'):
        return []
    try:
        book = store.mistake_book(limit=30)
        items = book.get('mistakes', [])
    except Exception:
        return []

    from engine import tactics
    puzzles = []
    for idx, item in enumerate(items):
        pz = tactics.compile_mistake_to_puzzle(item, idx)
        if pz:
            puzzles.append(pz)
    return puzzles
