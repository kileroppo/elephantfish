# -*- coding: utf-8 -*-
"""精训营国手名师传功控制器（Drill Lab Master Training Controller）。

核心职责：
1. 三段式实训状态机管理：
   - demo（演示）：只播放名师正解示范，支持单步/连播
   - drill（试炼）：标准骨架盘面，启用三阶法眼提示，双轨判招
   - exam（大考）：加载实战变式局面（exam_fen），锁死提示，必须零失误一气呵成方可获得「精通」认证
2. 「棋谱定式树 + 引擎法眼」双轨判招：
   - 优先比对名师教案树（solution_tree），命中即给出国手经典批注；
   - 命中预设陷阱（traps）立即触发当场反击惩罚态（rebuttal），并交出 refute_line（惩罚推演线）；
   - 谱外招法对比走前走后评分损益（eval_drop），避免缓手被误判为好棋；
3. 悔棋与分支回溯时严格基于已走棋谱重建定式树游标（tree_cursor），杜绝第 2 步悔棋后游标失效；
4. 当场反击惩罚（Rebuttal）状态机、知错撤回与一键推演受罚变例；
5. 阶段性目标达成判定（绝杀 checkmate、净得大子 win_material、胜定超阈值 win_advantage）；
6. 盘面三阶法眼视觉点拨数据分发（弱点盲区、关键子力、主变路线）。
"""

from __future__ import annotations

import logging
import threading
import time
from typing import Any, Dict, List, Optional, Tuple

from engine import notation as nt
from engine import tactics
from engine.engine import EngineSet, SearchRequest
from engine.game import Game
from engine import puzzles as ep
from server.session import Reply

logger = logging.getLogger(__name__)


class MasterDrillSession:
    """单个题目的名师带教实训会话。"""

    def __init__(self, puzzle: Dict[str, Any], stage: str = 'drill'):
        self.puzzle = dict(puzzle)
        self.puzzle_id = puzzle['id']
        self.stage = stage  # 'demo' | 'drill' | 'exam'
        start_fen = puzzle.get('exam_fen') if stage == 'exam' and puzzle.get('exam_fen') else puzzle['fen']
        self.start_fen = start_fen
        fen_side = 'red' if ' w ' in (start_fen or '') else 'black'
        self.user_side = puzzle.get('side', fen_side)
        self.engine_side = 'black' if self.user_side == 'red' else 'red'
        self.game = Game(engine_side=self.engine_side, start_fen=start_fen)
        self.hints_used = 0
        self.attempts = 0
        self.first_try = True
        self.solved = False
        self.sandbox = False

        # 当前在定式树中的游标节点
        self.tree_cursor: Optional[Dict[str, Any]] = puzzle.get('solution_tree')

        # 反击惩罚态（Rebuttal State）
        self.in_rebuttal = False
        self.last_punish_comment = ''
        self.last_wrong_move: Optional[str] = None
        self.last_punish_move: Optional[str] = None
        self.last_refute_line: List[Dict[str, Any]] = []

        self.started_at = time.time()
        self.logs: List[Dict[str, Any]] = []

    def reset(self, stage: Optional[str] = None):
        """重置回初始局面或切换阶段。"""
        if stage:
            self.stage = stage
        start_fen = self.puzzle.get('exam_fen') if self.stage == 'exam' and self.puzzle.get('exam_fen') else self.puzzle['fen']
        self.start_fen = start_fen
        fen_side = 'red' if ' w ' in (start_fen or '') else 'black'
        self.user_side = self.puzzle.get('side', fen_side)
        self.engine_side = 'black' if self.user_side == 'red' else 'red'
        self.game = Game(engine_side=self.engine_side, start_fen=start_fen)
        self.solved = False
        self.first_try = True
        self.attempts = 0
        self.hints_used = 0
        self.tree_cursor = self.puzzle.get('solution_tree')
        self.in_rebuttal = False
        self.last_punish_comment = ''
        self.last_wrong_move = None
        self.last_punish_move = None
        self.last_refute_line = []

    def rebuild_tree_cursor(self):
        """根据当前对局已走记录，重新从根节点推导树游标。"""
        curr = self.puzzle.get('solution_tree')
        if not curr or not isinstance(curr, dict):
            self.tree_cursor = None
            return

        # 遍历已走的对局手，只针对红方着法导航树
        for rec in self.game.records:
            if rec['by'] == 'opponent':
                iccs = rec['iccs']
                if iccs in curr:
                    node = curr[iccs]
                    curr = node.get('children', {})
                else:
                    curr = None
                    break
        self.tree_cursor = curr


class TrainingController:
    """精训营国手名师控制器。"""

    def __init__(self, store=None, engines: Optional[EngineSet] = None):
        self.store = store
        self.engines = engines
        self._lock = threading.Lock()
        self._sessions: Dict[str, MasterDrillSession] = {}

    def _get_or_create_session(self, puzzle_id: str, stage: str = 'drill') -> Optional[MasterDrillSession]:
        with self._lock:
            if puzzle_id not in self._sessions:
                pz = ep.get_puzzle(puzzle_id, store=self.store)
                if pz is None:
                    return None
                self._sessions[puzzle_id] = MasterDrillSession(pz, stage=stage)
            return self._sessions[puzzle_id]

    # ------------------------------------------------------------------ #
    # 题目列表与师门档案概况
    # ------------------------------------------------------------------ #

    def list_puzzles_reply(self, category: Optional[str] = None) -> Reply:
        all_puzzles = ep.list_puzzles(category=category, store=self.store)
        progress_map = self.store.get_training_progress() if self.store else {}
        summary = self.store.get_training_summary() if self.store else {}

        merged_puzzles = []
        for pz in all_puzzles:
            p_data = dict(pz)
            prog = progress_map.get(pz['id'])
            if prog:
                p_data['status'] = prog['status']
                p_data['attempts'] = prog['attempts']
                p_data['hints_used'] = prog['hints_used']
                p_data['first_try_pass'] = prog['first_try_pass']
                p_data['last_cleared_at'] = prog['last_cleared_at']
            else:
                p_data['status'] = 'unattempted'
                p_data['attempts'] = 0
                p_data['hints_used'] = 0
                p_data['first_try_pass'] = False
                p_data['last_cleared_at'] = None
            merged_puzzles.append(p_data)

        return Reply({
            'ok': True,
            'categories': ep.list_categories(),
            'puzzles': merged_puzzles,
            'summary': summary,
        })

    # ------------------------------------------------------------------ #
    # 进入实训 / 加载局面
    # ------------------------------------------------------------------ #

    def start_drill_reply(self, payload: Dict[str, Any]) -> Reply:
        puzzle_id = str(payload.get('puzzle_id') or '').strip()
        stage = str(payload.get('stage') or 'drill').strip()
        if not puzzle_id:
            return Reply({'ok': False, 'message': '缺少 puzzle_id 参数'}, 400)

        pz = ep.get_puzzle(puzzle_id, store=self.store)
        if pz is None:
            return Reply({'ok': False, 'message': f'题目不存在：{puzzle_id}'}, 404)

        pz_data = dict(pz)
        if self.store:
            prog_map = self.store.get_training_progress()
            prog = prog_map.get(puzzle_id)
            if prog:
                pz_data['status'] = prog['status']
                pz_data['attempts'] = prog['attempts']
                pz_data['hints_used'] = prog['hints_used']
                pz_data['first_try_pass'] = bool(prog['first_try_pass'])
                pz_data['last_cleared_at'] = prog['last_cleared_at']
            else:
                pz_data['status'] = 'unattempted'
                pz_data['attempts'] = 0
                pz_data['hints_used'] = 0
                pz_data['first_try_pass'] = False
                pz_data['last_cleared_at'] = None

        with self._lock:
            sess = MasterDrillSession(pz, stage=stage)
            self._sessions[puzzle_id] = sess

        base_snap = sess.game.snapshot()
        good_steps = self._build_good_steps(sess.start_fen, sess.user_side, pz_data)
        opp_threat_steps = self._build_opponent_threat_steps(sess.start_fen, sess.user_side)

        # 如果题目自带典型错着（如实战心魔题的 wrong_iccs 或定式题的第一个 trap），预生成错着分步动画与优劣对比
        default_wrong_iccs = pz_data.get('wrong_iccs') or ''
        default_trap_comment = ''
        default_preset_refute = pz_data.get('refute_line') or []
        traps_dict = pz_data.get('traps') or {}
        if not default_wrong_iccs and isinstance(traps_dict, dict) and traps_dict:
            default_wrong_iccs = next(iter(traps_dict.keys()))
            t_info = traps_dict[default_wrong_iccs] or {}
            default_trap_comment = t_info.get('comment', '')
            default_preset_refute = t_info.get('refute_line') or []

        default_bad_steps: List[Dict[str, Any]] = []
        if default_wrong_iccs:
            default_bad_steps = self._build_bad_steps(
                sess.start_fen,
                sess.user_side,
                default_wrong_iccs,
                preset_refute=default_preset_refute,
                trap_comment=default_trap_comment,
                fast=True,
            )

        best_iccs = pz_data.get('best_iccs') or (good_steps[0]['iccs'] if good_steps else '')
        thinking_guide = pz_data.get('thinking_guide') or tactics.build_thinking_guide(
            sess.game.board,
            sess.game.red_to_move,
            best_iccs=best_iccs,
            wrong_iccs=default_wrong_iccs or None,
            motif=pz_data.get('motif', 'tactical_oversight'),
        )
        pros_cons = self._build_pros_cons(
            board_before=sess.game.board,
            red_before=sess.game.red_to_move,
            user_side=sess.user_side,
            wrong_iccs=default_wrong_iccs or None,
            best_iccs=best_iccs or None,
            eval_before_red=None,
            eval_after_red=None,
            bad_steps=default_bad_steps,
            good_steps=good_steps,
            loss_override=pz_data.get('loss'),
            trap_comment=default_trap_comment,
        )

        return Reply({
            'ok': True,
            'puzzle': pz_data,
            'game': base_snap,
            'base_game': base_snap,
            'hints_used': sess.hints_used,
            'solved': sess.solved,
            'stage': sess.stage,
            'in_rebuttal': sess.in_rebuttal,
            'master_quote': pz.get('master_quote', ''),
            'demo_line': pz.get('demo_line', []),
            'visual_clues': pz.get('visual_clues', {}),
            'sandbox': sess.sandbox,
            'good_steps': good_steps,
            'default_bad_steps': default_bad_steps,
            'opponent_threat_steps': opp_threat_steps,
            'pros_cons': pros_cons,
            'thinking_guide': thinking_guide,
        })

    # ------------------------------------------------------------------ #
    # 国手名师双轨判招与当场反击
    # ------------------------------------------------------------------ #

    def step_drill_reply(self, payload: Dict[str, Any]) -> Reply:
        puzzle_id = str(payload.get('puzzle_id') or '').strip()
        move_text = str(payload.get('move') or '').strip()
        sandbox = bool(payload.get('sandbox', False))

        if not puzzle_id or not move_text:
            return Reply({'ok': False, 'message': '缺少 puzzle_id 或 move 参数'}, 400)

        sess = self._get_or_create_session(puzzle_id)
        if sess is None:
            return Reply({'ok': False, 'message': f'题目不存在：{puzzle_id}'}, 404)

        game = sess.game
        if game.turn != sess.user_side:
            turn_name = '红方' if game.turn == 'red' else '黑方'
            return Reply({'ok': False, 'message': f'当前轮到{turn_name}走棋，请等待'}, 400)

        # 着法解析
        move = nt.from_iccs(move_text)
        if move is None:
            move = nt.from_chinese(game.board, move_text, game.red_to_move, legal=game.legal_moves())
        if move is None or not game.is_legal(move):
            return Reply({'ok': False, 'message': f'着法不合法：{move_text}'}, 400)

        user_chinese = nt.to_chinese(game.board, move)
        user_iccs = nt.to_iccs(move)
        opp_name = '黑方' if sess.user_side == 'red' else '红方'
        sign = 1 if sess.user_side == 'red' else -1

        # 记录走前盘面与快照（用于分步动画和优劣势对比）
        board_before = game.board
        red_before = game.red_to_move
        fen_before = nt.to_fen(board_before, red_before, 0, max(1, (len(game.records) // 2) + 1))
        base_game_before = game.snapshot()

        # 走前评估基准（用于计算损益，避免缓手误判好棋）
        before_engine_move, before_eval = self._calc_best_engine_move(game)

        # 1. 定式树（Solution Tree）优先比对（防止次序颠倒类陷阱误伤第 2 手正解）
        node = None
        tree = sess.tree_cursor if sess.tree_cursor is not None else sess.puzzle.get('solution_tree', {})
        if isinstance(tree, dict) and user_iccs in tree:
            node = tree[user_iccs]

        best_tree_iccs = next(iter(tree.keys()), '') if isinstance(tree, dict) and tree else (
            nt.to_iccs(before_engine_move) if before_engine_move else ''
        )

        # 2. 检查是否命中预设陷阱 (Traps：仅在初始盘面且非当前定式正解时触发)
        traps = sess.puzzle.get('traps', {}) if len(game.records) == 0 else {}
        if node is None and user_iccs in traps:
            trap_info = traps[user_iccs]
            game.push(move, by='opponent')
            sess.attempts += 1
            sess.first_try = False

            punish_iccs = trap_info.get('punish_move')
            punish_move = None
            punish_chinese = ''
            if punish_iccs:
                punish_move = nt.from_iccs(punish_iccs)
            if punish_move is None or not game.is_legal(punish_move):
                punish_move, after_trap_eval = self._calc_best_engine_move(game)
            else:
                _, after_trap_eval = self._calc_best_engine_move(game)

            if punish_move and game.is_legal(punish_move):
                punish_chinese = nt.to_chinese(game.board, punish_move)
                punish_iccs = nt.to_iccs(punish_move)
                game.push(punish_move, by='engine')

            trap_comment = trap_info.get('comment', f'这步棋露出了破绽，{opp_name}立刻抓住机会反击！')
            bad_steps = self._build_bad_steps(
                fen_before,
                sess.user_side,
                user_iccs,
                punish_iccs=punish_iccs,
                preset_refute=trap_info.get('refute_line', []),
                trap_comment=trap_comment,
            )
            good_steps = self._build_good_steps(
                fen_before,
                sess.user_side,
                sess.puzzle if len(base_game_before['records']) == 0 else None,
            )
            pros_cons = self._build_pros_cons(
                board_before=board_before,
                red_before=red_before,
                user_side=sess.user_side,
                wrong_iccs=user_iccs,
                best_iccs=best_tree_iccs,
                eval_before_red=before_eval,
                eval_after_red=after_trap_eval,
                bad_steps=bad_steps,
                good_steps=good_steps,
                trap_comment=trap_comment,
            )
            thinking_guide = tactics.build_thinking_guide(
                board_before,
                red_before,
                best_iccs=best_tree_iccs,
                wrong_iccs=user_iccs,
                motif=sess.puzzle.get('motif', 'tactical_oversight'),
            )

            sess.in_rebuttal = True
            sess.last_wrong_move = user_iccs
            sess.last_punish_move = punish_iccs
            sess.last_punish_comment = trap_comment
            sess.last_refute_line = trap_info.get('refute_line') or [
                {'move': s['iccs'], 'iccs': s['iccs'], 'chinese': s['chinese'], 'comment': s['plain']}
                for s in bad_steps[1:]
            ]

            return Reply({
                'ok': True,
                'outcome': 'bad_move',
                'rebuttal': True,
                'message': f'【走错连锁后果】{sess.last_punish_comment}',
                'user_move': {'iccs': user_iccs, 'chinese': user_chinese},
                'engine_move': {'iccs': punish_iccs, 'chinese': punish_chinese} if punish_move else None,
                'game': game.snapshot(),
                'base_game': base_game_before,
                'solved': False,
                'bad_steps': bad_steps,
                'good_steps': good_steps,
                'pros_cons': pros_cons,
                'thinking_guide': thinking_guide,
                'punish_detail': {
                    'comment': sess.last_punish_comment,
                    'wrong_move': user_iccs,
                    'punish_move': punish_iccs,
                    'refute_line': sess.last_refute_line,
                    'bad_steps': bad_steps,
                    'good_steps': good_steps,
                    'pros_cons': pros_cons,
                    'thinking_guide': thinking_guide,
                }
            })

        # 执行用户走子
        game.push(move, by='opponent')
        sess.attempts += 1

        # 3. 判定是否绝杀或达成阶段性目标
        status = game.status()
        goal_type = sess.puzzle.get('goal_type', 'checkmate')

        # 判定 A: 直接绝杀
        if status['state'] in ('checkmate', 'stalemate'):
            sess.solved = True
            if not sandbox and self.store:
                self.store.record_training_attempt(
                    puzzle_id=puzzle_id,
                    category=sess.puzzle['category'],
                    solved=True,
                    hints_used=sess.hints_used,
                    first_try=sess.first_try and sess.hints_used == 0 and sess.stage in ('drill', 'exam'),
                )
            comment = node.get('comment') if node else '绝杀成功！恭喜通关！'
            return Reply({
                'ok': True,
                'outcome': 'solved',
                'message': f'【一锤定音】{comment}',
                'user_move': {'iccs': user_iccs, 'chinese': user_chinese},
                'engine_move': None,
                'game': game.snapshot(),
                'solved': True,
                'explanation': sess.puzzle.get('explanation', ''),
            })

        # 判定 B: 定式树明确标明达成目标
        if node and node.get('solved'):
            sess.solved = True
            if not sandbox and self.store:
                self.store.record_training_attempt(
                    puzzle_id=puzzle_id,
                    category=sess.puzzle['category'],
                    solved=True,
                    hints_used=sess.hints_used,
                    first_try=sess.first_try and sess.hints_used == 0 and sess.stage in ('drill', 'exam'),
                )
            return Reply({
                'ok': True,
                'outcome': 'solved',
                'message': f'【目标达成】{node.get("comment", "算路精准，正中要害！目标达成！")}',
                'user_move': {'iccs': user_iccs, 'chinese': user_chinese},
                'engine_move': None,
                'game': game.snapshot(),
                'solved': True,
                'explanation': sess.puzzle.get('explanation', ''),
            })

        # 4. 定式树有预设应手
        if node and node.get('reply'):
            reply_iccs = node['reply']
            reply_move = nt.from_iccs(reply_iccs)
            if reply_move and game.is_legal(reply_move):
                def_chinese = nt.to_chinese(game.board, reply_move)
                game.push(reply_move, by='engine')
                sess.tree_cursor = node.get('children', {})
                return Reply({
                    'ok': True,
                    'outcome': 'continue',
                    'message': f'【走对第1步】{node.get("comment", "好棋！")} {opp_name}被迫走「{def_chinese}」防守，请继续走下一手。',
                    'user_move': {'iccs': user_iccs, 'chinese': user_chinese},
                    'engine_move': {'iccs': reply_iccs, 'chinese': def_chinese},
                    'game': game.snapshot(),
                    'solved': False,
                })

        # 5. 谱外招法：引擎 MultiPV 与法眼损益仲裁（统一转换为学员执子方视角）
        engine_move, after_eval = self._calc_best_engine_move(game)

        mover_before = (before_eval * sign) if before_eval is not None else 0
        mover_after = (after_eval * sign) if after_eval is not None else 0
        eval_drop = mover_before - mover_after

        # 如果树里有正解而学员走出非正解闲着，或者掉分超标
        if (tree and user_iccs not in tree and sess.stage == 'drill') or eval_drop > 200 or (after_eval is not None and mover_after < -50):
            if engine_move and game.is_legal(engine_move):
                punish_chinese = nt.to_chinese(game.board, engine_move)
                punish_iccs = nt.to_iccs(engine_move)
                synth_rev = {
                    'rank': 3,
                    'status': 'ok',
                    'loss': max(120, int(abs(eval_drop))),
                    'loss_kind': 'exact',
                    'best_iccs': best_tree_iccs,
                    'lines': [{
                        'rank': 1,
                        'iccs': best_tree_iccs,
                        'score': mover_before or 200,
                        'pv': [],
                    }],
                }
                diag = tactics.diagnose_review(board_before, red_before, user_iccs, synth_rev)
                game.push(engine_move, by='engine')

                bad_steps = self._build_bad_steps(
                    fen_before,
                    sess.user_side,
                    user_iccs,
                    punish_iccs=punish_iccs,
                )
                good_steps = self._build_good_steps(
                    fen_before,
                    sess.user_side,
                    sess.puzzle if len(base_game_before['records']) == 0 else None,
                )
                pros_cons = self._build_pros_cons(
                    board_before=board_before,
                    red_before=red_before,
                    user_side=sess.user_side,
                    wrong_iccs=user_iccs,
                    best_iccs=best_tree_iccs,
                    eval_before_red=before_eval,
                    eval_after_red=after_eval,
                    bad_steps=bad_steps,
                    good_steps=good_steps,
                    diag=diag,
                )
                thinking_guide = tactics.build_thinking_guide(
                    board_before,
                    red_before,
                    best_iccs=best_tree_iccs,
                    wrong_iccs=user_iccs,
                    motif=diag.get('motif', 'tactical_oversight'),
                )

                sess.in_rebuttal = True
                sess.first_try = False
                sess.last_wrong_move = user_iccs
                sess.last_punish_move = punish_iccs
                plain_label = diag.get('plain_motif_label') or diag.get('motif_label', '白送先手')
                plain_reason = diag.get('plain_reason') or diag.get('coach_summary', '')
                step2_plain = bad_steps[1]['plain'] if len(bad_steps) > 1 else f'{opp_name}顺势走「{punish_chinese}」反击！'
                sess.last_punish_comment = (
                    f'【{plain_label}】{plain_reason} 紧接着 {step2_plain}'
                ).strip()
                sess.last_refute_line = [
                    {'move': s['iccs'], 'iccs': s['iccs'], 'chinese': s['chinese'], 'comment': s['plain']}
                    for s in bad_steps[1:]
                ] or [
                    {'move': punish_iccs, 'iccs': punish_iccs, 'chinese': punish_chinese, 'comment': f'{opp_name}乘虚反扑，夺走局部主动权！'}
                ]

                return Reply({
                    'ok': True,
                    'outcome': 'bad_move',
                    'rebuttal': True,
                    'message': f'【走错连锁后果】{sess.last_punish_comment}',
                    'user_move': {'iccs': user_iccs, 'chinese': user_chinese},
                    'engine_move': {'iccs': punish_iccs, 'chinese': punish_chinese},
                    'game': game.snapshot(),
                    'base_game': base_game_before,
                    'solved': False,
                    'bad_steps': bad_steps,
                    'good_steps': good_steps,
                    'pros_cons': pros_cons,
                    'thinking_guide': thinking_guide,
                    'punish_detail': {
                        'comment': sess.last_punish_comment,
                        'wrong_move': user_iccs,
                        'punish_move': punish_iccs,
                        'refute_line': sess.last_refute_line,
                        'bad_steps': bad_steps,
                        'good_steps': good_steps,
                        'pros_cons': pros_cons,
                        'thinking_guide': thinking_guide,
                    }
                })

        # 检查阶段性目标（净吃大车或大幅胜定 > +750cp）
        if goal_type in ('win_material', 'win_advantage') and after_eval is not None and mover_after >= 750 and eval_drop <= 50:
            sess.solved = True
            if not sandbox and self.store:
                self.store.record_training_attempt(
                    puzzle_id=puzzle_id,
                    category=sess.puzzle['category'],
                    solved=True,
                    hints_used=sess.hints_used,
                    first_try=sess.first_try and sess.hints_used == 0 and sess.stage in ('drill', 'exam'),
                )
            return Reply({
                'ok': True,
                'outcome': 'solved',
                'message': '【目标达成】大局已定，已经稳稳赢下优势！恭喜通关！',
                'user_move': {'iccs': user_iccs, 'chinese': user_chinese},
                'engine_move': None,
                'game': game.snapshot(),
                'solved': True,
                'explanation': sess.puzzle.get('explanation', ''),
            })

        # 正常顽强防守走子
        if engine_move is not None and game.is_legal(engine_move):
            def_chinese = nt.to_chinese(game.board, engine_move)
            def_iccs = nt.to_iccs(engine_move)
            game.push(engine_move, by='engine')
            return Reply({
                'ok': True,
                'outcome': 'continue',
                'message': f'【继续追击】{opp_name}走「{def_chinese}」顽强防守，请继续抓住优势进攻。',
                'user_move': {'iccs': user_iccs, 'chinese': user_chinese},
                'engine_move': {'iccs': def_iccs, 'chinese': def_chinese},
                'game': game.snapshot(),
                'solved': False,
                'eval_red': after_eval,
            })
        else:
            sess.solved = True
            if not sandbox and self.store:
                self.store.record_training_attempt(
                    puzzle_id=puzzle_id,
                    category=sess.puzzle['category'],
                    solved=True,
                    hints_used=sess.hints_used,
                    first_try=sess.first_try and sess.hints_used == 0 and sess.stage in ('drill', 'exam'),
                )
            return Reply({
                'ok': True,
                'outcome': 'solved',
                'message': f'【目标达成】{opp_name}已无棋可走，恭喜通关！',
                'user_move': {'iccs': user_iccs, 'chinese': user_chinese},
                'engine_move': None,
                'game': game.snapshot(),
                'solved': True,
                'explanation': sess.puzzle.get('explanation', ''),
            })

    def _search_line(
        self,
        game: Game,
        max_depth: int = 7,
        time_limit: float = 0.35,
    ) -> Tuple[Optional[Tuple[int, int]], int, List[Tuple[int, int]]]:
        """搜索当前局面的最佳着法、红方视角评分及主变序列（PV）。"""
        engine_move = None
        eval_score = 0
        pv_moves: List[Tuple[int, int]] = []
        if self.engines:
            active = getattr(self.engines, 'active_engine', None) or self.engines.choose()
            req = SearchRequest(
                board=game.board,
                red_to_move=game.red_to_move,
                time_limit=time_limit,
                max_depth=max_depth,
            )
            for info in active.search(req):
                if info.move:
                    engine_move = info.move
                    eval_score = info.eval_red if info.eval_red is not None else 0
                if getattr(info, 'pv', None):
                    pv_moves = list(info.pv)
        if engine_move and (not pv_moves or pv_moves[0] != engine_move):
            pv_moves = [engine_move] + [m for m in pv_moves if m != engine_move]
        return engine_move, eval_score, pv_moves

    def _calc_best_engine_move(self, game: Game) -> Tuple[Optional[Tuple[int, int]], Optional[int]]:
        mv, score, _ = self._search_line(game, max_depth=8, time_limit=0.45)
        return mv, score

    # ------------------------------------------------------------------ #
    # 优劣势分步动画序列与直观对比构建器
    # ------------------------------------------------------------------ #

    def _build_good_steps(
        self,
        start_fen: str,
        user_side: str,
        puzzle: Optional[Dict[str, Any]] = None,
    ) -> List[Dict[str, Any]]:
        """生成『✅ 走对会怎样』的分步动画序列（每一步仅移动 1 枚棋子，配大白话好处解说）。"""
        try:
            temp = Game(start_fen=start_fen)
        except Exception:
            return []

        raw_seq: List[Tuple[str, str]] = []  # [(iccs, preset_comment)]
        if puzzle:
            # 优先从 solution_tree 提取完整的双方交替着法链（含对手预设应手 reply）
            curr_tree = puzzle.get('solution_tree')
            while isinstance(curr_tree, dict) and curr_tree and len(raw_seq) < 5:
                u_iccs = next(iter(curr_tree.keys()))
                u_node = curr_tree[u_iccs] or {}
                raw_seq.append((u_iccs, str(u_node.get('comment') or '').strip()))
                rep_iccs = str(u_node.get('reply') or '').strip()
                if rep_iccs:
                    raw_seq.append((rep_iccs, ''))
                curr_tree = u_node.get('children')

            if not raw_seq:
                demo_line = puzzle.get('demo_line') or []
                for item in demo_line:
                    iccs = str(item.get('move') or item.get('iccs') or '').strip()
                    if iccs:
                        raw_seq.append((iccs, str(item.get('comment') or '').strip()))

        if not raw_seq:
            _, _, pv_moves = self._search_line(temp, max_depth=6, time_limit=0.25)
            for mv in pv_moves[:4]:
                raw_seq.append((nt.to_iccs(mv), ''))
        elif len(raw_seq) < 3:
            # 如果 demo_line 只有 1 步（如实战错题），推演后续 2 步让学员看到走对后的连续优势
            sim = Game(start_fen=start_fen)
            ok_sim = True
            for iccs, _ in raw_seq:
                mv = nt.from_iccs(iccs)
                if mv and sim.is_legal(mv):
                    sim.push(mv)
                else:
                    ok_sim = False
                    break
            if ok_sim and sim.status()['state'] not in ('checkmate', 'stalemate'):
                _, _, extra_pv = self._search_line(sim, max_depth=6, time_limit=0.22)
                for mv in extra_pv[: max(0, 3 - len(raw_seq))]:
                    raw_seq.append((nt.to_iccs(mv), ''))

        steps: List[Dict[str, Any]] = []
        for idx, (iccs, preset_comment) in enumerate(raw_seq[:4]):
            mv = nt.from_iccs(iccs)
            if mv is None or not temp.is_legal(mv):
                break
            is_user = (temp.turn == user_side)
            info = tactics.explain_step_plain(
                temp.board,
                temp.red_to_move,
                mv,
                step_idx=idx + 1,
                is_user=is_user,
                mode='good',
            )
            if idx == 0 and is_user:
                tag = '✅ 第1步：最佳正着'
            elif not is_user:
                tag = f'🛡️ 第{idx + 1}步：对手被迫应付'
            else:
                tag = f'⚔️ 第{idx + 1}步：我方扩大优势'

            plain_text = info['plain']
            if preset_comment and preset_comment not in plain_text and len(preset_comment) < 48:
                plain_text = f"{plain_text}（{preset_comment}）"

            steps.append({
                'step': idx + 1,
                'move': info['iccs'],
                'iccs': info['iccs'],
                'chinese': info['chinese'],
                'side': info['side'],
                'actor': info['actor'],
                'tag': tag,
                'plain': plain_text,
                'comment': plain_text,
                'captured': info['captured'],
                'gains': info['gains'],
                'losses': info['losses'],
                'threat_squares': info['threat_squares'],
            })
            temp.push(mv)
            if temp.status()['state'] in ('checkmate', 'stalemate'):
                break
        return steps

    def _build_bad_steps(
        self,
        fen_before: str,
        user_side: str,
        wrong_iccs: str,
        punish_iccs: Optional[str] = None,
        preset_refute: Optional[List[Dict[str, Any]]] = None,
        trap_comment: str = '',
        fast: bool = False,
    ) -> List[Dict[str, Any]]:
        """生成『❌ 走错会怎样』的 3~4 步连锁后果动画序列。

        第 1 步：我方走错的那一步（展示暴露了什么破绽）
        第 2 步：对手立刻反击的那一步（展示怎么抓我们破绽）
        第 3 步：我方被迫应付的一步
        第 4 步：对手进一步吃子/破防/确立胜势的一步（解决“多走几步才发现当初不该走”的痛点）
        """
        try:
            temp = Game(start_fen=fen_before)
        except Exception:
            return []

        mv1 = nt.from_iccs(wrong_iccs)
        if mv1 is None or not temp.is_legal(mv1):
            return []

        steps: List[Dict[str, Any]] = []
        info1 = tactics.explain_step_plain(
            temp.board,
            temp.red_to_move,
            mv1,
            step_idx=1,
            is_user=True,
            mode='bad',
        )
        plain1 = info1['plain']
        if trap_comment and trap_comment not in plain1:
            plain1 = f"{plain1} —— {trap_comment}"

        steps.append({
            'step': 1,
            'move': info1['iccs'],
            'iccs': info1['iccs'],
            'chinese': info1['chinese'],
            'side': info1['side'],
            'actor': '我方',
            'tag': '❌ 第1步：我方走错（埋下祸根）',
            'plain': plain1,
            'comment': plain1,
            'captured': info1['captured'],
            'gains': info1['gains'],
            'losses': info1['losses'],
            'threat_squares': info1['threat_squares'],
        })
        temp.push(mv1)

        if temp.status()['state'] in ('checkmate', 'stalemate'):
            return steps

        follow_seq: List[Tuple[str, str]] = []
        if preset_refute:
            for item in preset_refute:
                iccs = str(item.get('move') or item.get('iccs') or '').strip()
                if iccs:
                    follow_seq.append((iccs, str(item.get('comment') or '').strip()))
        elif punish_iccs:
            follow_seq.append((punish_iccs, ''))

        # 如果预置反击不足 3 步（总共不足 4 步），让引擎继续往后推演到第 4 步，把几步后的亏损彻底演出来
        sim = Game(start_fen=nt.to_fen(temp.board, temp.red_to_move, 0, 1))
        for iccs, _ in follow_seq:
            mv = nt.from_iccs(iccs)
            if mv and sim.is_legal(mv):
                sim.push(mv)
            else:
                break

        if len(follow_seq) < 3 and sim.status()['state'] not in ('checkmate', 'stalemate'):
            _, _, extra_pv = self._search_line(
                sim,
                max_depth=5 if fast else 6,
                time_limit=0.18 if fast else 0.25,
            )
            for mv in extra_pv[: (3 - len(follow_seq))]:
                follow_seq.append((nt.to_iccs(mv), ''))

        for idx, (iccs, preset_c) in enumerate(follow_seq[:3]):
            mv = nt.from_iccs(iccs)
            if mv is None or not temp.is_legal(mv):
                break
            step_num = idx + 2
            is_user = (temp.turn == user_side)
            info = tactics.explain_step_plain(
                temp.board,
                temp.red_to_move,
                mv,
                step_idx=step_num,
                is_user=is_user,
                mode='bad',
            )
            if step_num == 2:
                tag = '⚡ 第2步：对手抓住破绽反击'
            elif is_user:
                tag = f'😰 第{step_num}步：我方被迫应付'
            else:
                tag = f'💥 第{step_num}步：对手乘胜追击（亏损兑现）'

            plain_text = info['plain']
            if preset_c and preset_c not in plain_text and '受罚拆解' not in preset_c:
                plain_text = f"{plain_text}（{preset_c}）"

            steps.append({
                'step': step_num,
                'move': info['iccs'],
                'iccs': info['iccs'],
                'chinese': info['chinese'],
                'side': info['side'],
                'actor': info['actor'],
                'tag': tag,
                'plain': plain_text,
                'comment': plain_text,
                'captured': info['captured'],
                'gains': info['gains'],
                'losses': info['losses'],
                'threat_squares': info['threat_squares'],
            })
            temp.push(mv)
            if temp.status()['state'] in ('checkmate', 'stalemate'):
                break

        return steps

    def _build_opponent_threat_steps(
        self,
        fen_now: str,
        user_side: str,
    ) -> List[Dict[str, Any]]:
        """生成『👁️ 对手想干嘛』分步动画：假设我方不设防（空过一手），演示对手接下来 2~3 步的杀招企图。"""
        parts = (fen_now or '').strip().split()
        if not parts:
            return []
        opp_char = 'b' if user_side == 'red' else 'w'
        opp_fen = f"{parts[0]} {opp_char} - - 0 1"
        try:
            temp = Game(start_fen=opp_fen)
        except Exception:
            return []

        if temp.status()['state'] in ('checkmate', 'stalemate'):
            return []

        _, _, pv_moves = self._search_line(temp, max_depth=6, time_limit=0.22)
        steps: List[Dict[str, Any]] = []
        for idx, mv in enumerate(pv_moves[:3]):
            if mv is None or not temp.is_legal(mv):
                break
            step_num = idx + 1
            is_user = (temp.turn == user_side)
            info = tactics.explain_step_plain(
                temp.board,
                temp.red_to_move,
                mv,
                step_idx=step_num,
                is_user=is_user,
                mode='threat',
            )
            if step_num == 1:
                tag = '👁️ 对手第1步企图：直接动手'
            elif is_user:
                tag = '🛡️ 如果我方勉强招架'
            else:
                tag = '💥 对手后续杀招：连续打击'

            steps.append({
                'step': step_num,
                'move': info['iccs'],
                'iccs': info['iccs'],
                'chinese': info['chinese'],
                'side': info['side'],
                'actor': info['actor'],
                'tag': tag,
                'plain': info['plain'],
                'comment': info['plain'],
                'captured': info['captured'],
                'gains': info['gains'],
                'losses': info['losses'],
                'threat_squares': info['threat_squares'],
            })
            temp.push(mv)
            if temp.status()['state'] in ('checkmate', 'stalemate'):
                break
        return steps

    def _build_pros_cons(
        self,
        board_before: str,
        red_before: bool,
        user_side: str,
        wrong_iccs: Optional[str],
        best_iccs: Optional[str],
        eval_before_red: Optional[int],
        eval_after_red: Optional[int],
        bad_steps: List[Dict[str, Any]],
        good_steps: List[Dict[str, Any]],
        diag: Optional[Dict[str, Any]] = None,
        loss_override: Optional[int] = None,
        trap_comment: str = '',
    ) -> Dict[str, Any]:
        """构建通俗直观的『📊 走错失去什么 vs 走对赢得什么』优劣势对比卡。"""
        sign = 1 if user_side == 'red' else -1
        best_cp = int((eval_before_red or 200) * sign)
        wrong_cp = int((eval_after_red or -120) * sign)
        if loss_override is not None:
            loss_cp = max(0, int(loss_override))
            wrong_cp = best_cp - loss_cp
        elif wrong_iccs and best_iccs and wrong_iccs == best_iccs:
            loss_cp = 0
            wrong_cp = best_cp
        else:
            loss_cp = max(120, best_cp - wrong_cp) if wrong_iccs else 0

        pawn_drop = round(loss_cp / 100.0, 1)

        wrong_chinese = ''
        if wrong_iccs:
            mv_w = nt.from_iccs(wrong_iccs)
            wrong_chinese = nt.to_chinese(board_before, mv_w) if mv_w else wrong_iccs

        best_chinese = ''
        if best_iccs:
            mv_b = nt.from_iccs(best_iccs)
            best_chinese = nt.to_chinese(board_before, mv_b) if mv_b else best_iccs

        if loss_cp >= 500:
            verdict_headline = f'走错这步相当于白丢约 {pawn_drop} 个兵（大子被吃或防线直接崩溃）'
        elif loss_cp >= 200:
            verdict_headline = f'走错这步亏损约 {pawn_drop} 个兵（原本的主动权拱手让人，变成被动挨打）'
        elif wrong_iccs:
            verdict_headline = f'走错这步错失战机（亏损约 {pawn_drop} 个兵，让对手缓过气来反扑）'
        else:
            verdict_headline = '走对抢占先手优势 vs 走错陷入被动挨打'

        wrong_losses: List[str] = []
        if trap_comment:
            wrong_losses.append(trap_comment)
        if diag and diag.get('plain_reason'):
            wrong_losses.append(diag['plain_reason'])
        for s in bad_steps:
            for item in s.get('losses', []):
                if item not in wrong_losses:
                    wrong_losses.append(item)
            if s['step'] >= 2 and s.get('plain') and len(wrong_losses) < 4:
                wrong_losses.append(f"第{s['step']}步后果：{s['plain']}")
        if not wrong_losses:
            wrong_losses.append('白白浪费一步棋的先手，让对手趁机组织反扑')

        best_gains: List[str] = []
        for s in good_steps:
            for item in s.get('gains', []):
                if item not in best_gains:
                    best_gains.append(item)
            if s['step'] <= 3 and s.get('plain') and len(best_gains) < 4:
                best_gains.append(f"第{s['step']}步收益：{s['plain']}")
        if not best_gains:
            best_gains.append('抢占关键攻防要点，逼迫对手被动招架')

        return {
            'wrong_iccs': wrong_iccs or '',
            'wrong_chinese': wrong_chinese,
            'best_iccs': best_iccs or '',
            'best_chinese': best_chinese,
            'best_cp': best_cp,
            'wrong_cp': wrong_cp,
            'loss_cp': loss_cp,
            'pawn_drop': pawn_drop,
            'verdict_headline': verdict_headline,
            'motif_label': (diag or {}).get('plain_motif_label') or (diag or {}).get('motif_label') or '失先受制',
            'wrong_summary': (diag or {}).get('plain_reason') or trap_comment or verdict_headline,
            'wrong_losses': wrong_losses[:4],
            'best_gains': best_gains[:4],
        }

    # ------------------------------------------------------------------ #
    # 悔棋撤销与定式树游标精准回溯
    # ------------------------------------------------------------------ #

    def undo_drill_reply(self, payload: Dict[str, Any]) -> Reply:
        puzzle_id = str(payload.get('puzzle_id') or '').strip()
        sess = self._get_or_create_session(puzzle_id)
        if sess is None:
            return Reply({'ok': False, 'message': '题目不存在'}, 404)

        game = sess.game
        if len(game.records) >= 2 and game.records[-1]['by'] == 'engine':
            game.undo(plies=2)
        elif len(game.records) >= 1:
            game.undo(plies=1)

        sess.solved = False
        sess.in_rebuttal = False
        sess.first_try = False
        sess.rebuild_tree_cursor()  # 严格根据剩余棋谱重建树游标

        return Reply({
            'ok': True,
            'message': '师傅已为你回拨盘面，凝神深思后再落子。',
            'in_rebuttal': False,
            'game': game.snapshot(),
        })

    # ------------------------------------------------------------------ #
    # 盘面三阶法眼求教与点拨（大考模式禁用）
    # ------------------------------------------------------------------ #

    def hint_drill_reply(self, payload: Dict[str, Any]) -> Reply:
        puzzle_id = str(payload.get('puzzle_id') or '').strip()
        level = int(payload.get('level') or 1)
        sess = self._get_or_create_session(puzzle_id)
        if sess is None:
            return Reply({'ok': False, 'message': '题目不存在'}, 404)

        if sess.stage == 'exam':
            return Reply({
                'ok': False,
                'message': '大考重在自悟与实战考验，师门法眼已闭，请凭真实力通关！',
            }, 400)

        hints = sess.puzzle.get('hints', [])
        idx = max(0, min(level - 1, len(hints) - 1))
        hint_text = hints[idx] if hints else '仔细观察敌方将门弱点与子力配合。'

        sess.hints_used = max(sess.hints_used, level)
        sess.first_try = False

        if self.store:
            self.store.record_training_attempt(
                puzzle_id=puzzle_id,
                category=sess.puzzle['category'],
                solved=False,
                hints_used=sess.hints_used,
                first_try=False,
            )

        clues = sess.puzzle.get('visual_clues', {})
        visual_data = {}
        if level >= 1:
            visual_data['weakness_squares'] = clues.get('weakness_squares', [])
        if level >= 2:
            visual_data['key_pieces'] = clues.get('key_pieces', [])
        if level >= 3:
            visual_data['route'] = clues.get('route', [])

        return Reply({
            'ok': True,
            'level': level,
            'hint': hint_text,
            'hints_used': sess.hints_used,
            'visual_data': visual_data,
        })

    # ------------------------------------------------------------------ #
    # 重置题目 / 切换阶段
    # ------------------------------------------------------------------ #

    def reset_drill_reply(self, payload: Dict[str, Any]) -> Reply:
        puzzle_id = str(payload.get('puzzle_id') or '').strip()
        stage = str(payload.get('stage') or 'drill').strip()
        sess = self._get_or_create_session(puzzle_id)
        if sess is None:
            return Reply({'ok': False, 'message': '题目不存在'}, 404)

        sess.reset(stage=stage)
        base_snap = sess.game.snapshot()
        return Reply({
            'ok': True,
            'message': '已重整棋盘！',
            'game': base_snap,
            'base_game': base_snap,
            'hints_used': sess.hints_used,
            'solved': False,
            'stage': sess.stage,
            'in_rebuttal': False,
        })

    # ------------------------------------------------------------------ #
    # 无状态回放沙盒推演（What-If Sandbox，只读零副作用）
    # ------------------------------------------------------------------ #

    def sandbox_reply(self, query: Dict[str, Any]) -> Reply:
        """在任意历史回放 FEN 上试走一步分支并获取棋理诊断 + 引擎应手 + 分步动画。

        完全无状态（只读 GET）：不触碰主对局 SESSION，也不写入 SQLite 存档，
        确保回放台（ReplayDesk）的只读契约不被打破。
        """
        fen = str(query.get('fen') or '').strip()
        move_text = str(query.get('move') or '').strip()
        if not fen:
            return Reply({'ok': False, 'message': '缺少 fen 参数'}, 400)
        try:
            temp = Game(start_fen=fen)
        except Exception as exc:
            return Reply({'ok': False, 'message': f'无效的 FEN：{exc}'}, 400)

        base_snap = temp.snapshot()
        user_side = 'red' if temp.red_to_move else 'black'

        if not move_text:
            good_steps = self._build_good_steps(fen, user_side)
            opp_threat_steps = self._build_opponent_threat_steps(fen, user_side)
            best_iccs = good_steps[0]['iccs'] if good_steps else ''
            thinking_guide = tactics.build_thinking_guide(
                temp.board,
                temp.red_to_move,
                best_iccs=best_iccs,
            )
            return Reply({
                'ok': True,
                'game': base_snap,
                'base_game': base_snap,
                'good_steps': good_steps,
                'opponent_threat_steps': opp_threat_steps,
                'thinking_guide': thinking_guide,
            })

        mv = nt.from_iccs(move_text)
        if mv is None:
            mv = nt.from_chinese(temp.board, move_text, temp.red_to_move, legal=temp.legal_moves())
        if mv is None or not temp.is_legal(mv):
            return Reply({'ok': False, 'message': f'非法走法：{move_text}'}, 400)

        board_before = temp.board
        red_before = temp.red_to_move
        user_iccs = nt.to_iccs(mv)
        user_chinese = nt.to_chinese(board_before, mv)

        best_mv, before_eval = self._calc_best_engine_move(temp)
        best_iccs = nt.to_iccs(best_mv) if best_mv else user_iccs
        best_chinese = nt.to_chinese(board_before, best_mv) if best_mv else user_chinese

        temp.push(mv, by='opponent')
        reply_mv, after_eval = self._calc_best_engine_move(temp)

        # 统一到走子方视角的得失差值
        sign = 1 if red_before else -1
        mover_before = (before_eval or 0) * sign
        mover_after = (after_eval or 0) * sign
        loss = max(0, mover_before - mover_after) if best_iccs != user_iccs else 0
        rank = 1 if best_iccs == user_iccs else (2 if loss < 180 else 4)

        reply_iccs = nt.to_iccs(reply_mv) if (reply_mv and temp.is_legal(reply_mv)) else None
        reply_chinese = nt.to_chinese(temp.board, reply_mv) if (reply_mv and temp.is_legal(reply_mv)) else ''

        synth_rev = {
            'rank': rank,
            'status': 'ok' if rank <= 3 else 'outside',
            'loss': loss,
            'loss_kind': 'exact',
            'best_iccs': best_iccs,
            'lines': [
                {
                    'rank': 1,
                    'iccs': best_iccs,
                    'chinese': best_chinese,
                    'score': mover_before,
                    'pv': [{'iccs': best_iccs, 'chinese': best_chinese}],
                },
                {
                    'rank': rank,
                    'iccs': user_iccs,
                    'chinese': user_chinese,
                    'score': mover_after,
                    'pv': (
                        [{'iccs': user_iccs, 'chinese': user_chinese},
                         {'iccs': reply_iccs, 'chinese': reply_chinese}]
                        if reply_iccs else [{'iccs': user_iccs, 'chinese': user_chinese}]
                    ),
                },
            ],
        }
        diag = tactics.diagnose_review(board_before, red_before, user_iccs, synth_rev)

        bad_steps = self._build_bad_steps(
            fen,
            user_side,
            user_iccs,
            punish_iccs=reply_iccs,
            fast=True,
        )
        good_steps = self._build_good_steps(fen, user_side)
        opp_threat_steps = self._build_opponent_threat_steps(fen, user_side)
        pros_cons = self._build_pros_cons(
            board_before=board_before,
            red_before=red_before,
            user_side=user_side,
            wrong_iccs=user_iccs if user_iccs != best_iccs else None,
            best_iccs=best_iccs,
            eval_before_red=before_eval,
            eval_after_red=after_eval,
            bad_steps=bad_steps,
            good_steps=good_steps,
            diag=diag,
            loss_override=loss,
        )
        thinking_guide = tactics.build_thinking_guide(
            board_before,
            red_before,
            best_iccs=best_iccs,
            wrong_iccs=user_iccs if user_iccs != best_iccs else None,
            motif=diag.get('motif', 'tactical_oversight'),
        )

        if reply_mv and temp.is_legal(reply_mv):
            temp.push(reply_mv, by='engine')

        return Reply({
            'ok': True,
            'fen_before': fen,
            'base_game': base_snap,
            'user_move': {'iccs': user_iccs, 'chinese': user_chinese},
            'best_move': {'iccs': best_iccs, 'chinese': best_chinese},
            'loss': loss,
            'tactics': diag,
            'engine_reply': {'iccs': reply_iccs, 'chinese': reply_chinese} if reply_iccs else None,
            'game': temp.snapshot(),
            'bad_steps': bad_steps,
            'good_steps': good_steps,
            'opponent_threat_steps': opp_threat_steps,
            'pros_cons': pros_cons,
            'thinking_guide': thinking_guide,
        })

    # ------------------------------------------------------------------ #
    # 实战与训练通用：走前预演 & 对手企图分步动画接口（GET /api/preview）
    # ------------------------------------------------------------------ #

    def preview_reply(self, query: Dict[str, Any]) -> Reply:
        """无状态预演接口：
        1. 不传 move 时：给出当前局面的『👁️ 对手想干嘛（2~3步企图动画）』、『✅ 我方最佳走法动画』、『🧠 逆向对抗三问』
        2. 传入 move 时：额外给出『❌ 走这步会怎样（3~4步连锁后果动画）』与『📊 优劣势直观对比』
        """
        return self.sandbox_reply(query)
