# -*- coding: utf-8 -*-
"""精训营业务控制器（Drill Lab Controller）。

负责实训对弈的核心交互：
1. 题目状态机管理（初始盘面、走子验证、悔棋与分支推演）；
2. 引擎动态顽强防守计算（使用 Pikafish / Elephantfish 提供最顽强反击）；
3. 阶梯启发式提示（战术线索 -> 关键子力 -> 正解主变）；
4. 学员棋力精通度与通关档案持久化更新。
"""

from __future__ import annotations

import logging
import threading
import time
from typing import Any, Dict, List, Optional, Tuple

from engine import notation as nt
from engine.engine import EngineSet, SearchRequest
from engine.game import Game
from engine import puzzles as ep
from server.session import Reply

logger = logging.getLogger(__name__)


class DrillSession:
    """单个题目的实训会话。"""

    def __init__(self, puzzle: Dict[str, Any]):
        self.puzzle = dict(puzzle)
        self.puzzle_id = puzzle['id']
        self.game = Game(engine_side='black', start_fen=puzzle['fen'])
        self.hints_used = 0
        self.attempts = 0
        self.first_try = True
        self.solved = False
        self.sandbox = False
        self.sandbox_backup: Optional[str] = None
        self.started_at = time.time()
        self.logs: List[Dict[str, Any]] = []

    def reset(self):
        """重置回初始局面。"""
        self.game = Game(engine_side='black', start_fen=self.puzzle['fen'])
        self.solved = False
        self.first_try = False  # 已经不是首发了
        self.sandbox = False
        self.sandbox_backup = None
        self.logs = []


class TrainingController:
    """精训营控制器。"""

    def __init__(self, store=None, engines: Optional[EngineSet] = None):
        self.store = store
        self.engines = engines
        self._lock = threading.Lock()
        self._sessions: Dict[str, DrillSession] = {}

    def _get_or_create_session(self, puzzle_id: str) -> Optional[DrillSession]:
        with self._lock:
            if puzzle_id not in self._sessions:
                pz = ep.get_puzzle(puzzle_id, store=self.store)
                if pz is None:
                    return None
                self._sessions[puzzle_id] = DrillSession(pz)
            return self._sessions[puzzle_id]

    # ------------------------------------------------------------------ #
    # 题目列表与档案概况
    # ------------------------------------------------------------------ #

    def list_puzzles_reply(self, category: Optional[str] = None) -> Reply:
        all_puzzles = ep.list_puzzles(category=category, store=self.store)
        progress_map = self.store.get_training_progress() if self.store else {}
        summary = self.store.get_training_summary() if self.store else {}

        # 合并学员进度
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
            # 开启新会话或重置
            sess = DrillSession(pz)
            self._sessions[puzzle_id] = sess

        return Reply({
            'ok': True,
            'puzzle': pz_data,
            'game': sess.game.snapshot(),
            'hints_used': sess.hints_used,
            'solved': sess.solved,
            'sandbox': sess.sandbox,
        })

    # ------------------------------------------------------------------ #
    # 实训走子与动态防守
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
        if game.turn != 'red':
            return Reply({'ok': False, 'message': '当前轮到黑方走棋，请等待'}, 400)

        # 尝试解析着法
        move = nt.from_iccs(move_text)
        if move is None:
            move = nt.from_chinese(game.board, move_text, True, legal=game.legal_moves())
        if move is None or not game.is_legal(move):
            return Reply({'ok': False, 'message': f'着法不合法：{move_text}'}, 400)

        # 执行用户走子
        user_chinese = nt.to_chinese(game.board, move)
        user_iccs = nt.to_iccs(move)
        game.push(move, by='opponent')
        sess.attempts += 1

        # 检查是否达成绝杀/终局
        status = game.status()
        if status['state'] in ('checkmate', 'stalemate'):
            # 达成绝杀！黑方无子可动
            sess.solved = True
            if not sandbox and self.store:
                self.store.record_training_attempt(
                    puzzle_id=puzzle_id,
                    category=sess.puzzle['category'],
                    solved=True,
                    hints_used=sess.hints_used,
                    first_try=sess.first_try and sess.attempts == 1,
                )

            return Reply({
                'ok': True,
                'outcome': 'solved',
                'message': f'绝杀！{status.get("reason", "目标达成！恭喜攻克此题！")}',
                'user_move': {'iccs': user_iccs, 'chinese': user_chinese},
                'engine_move': None,
                'game': game.snapshot(),
                'solved': True,
                'explanation': sess.puzzle.get('explanation', ''),
            })

        # 未直接绝杀，由引擎进行动态评估与最顽强防守
        engine_move = None
        eval_score = 0
        if self.engines:
            active = self.engines.active_engine
            req = SearchRequest(
                board=game.board,
                red_to_move=game.red_to_move,
                time_limit=0.5,
                max_depth=8,
            )
            for info in active.search(req):
                if info.move:
                    engine_move = info.move
                    eval_score = info.eval_red if info.eval_red is not None else 0

        if engine_move is not None and game.is_legal(engine_move):
            # 引擎顽强防守走子
            def_chinese = nt.to_chinese(game.board, engine_move)
            def_iccs = nt.to_iccs(engine_move)
            game.push(engine_move, by='engine')

            # 走子后再看局面
            after_status = game.status()
            sess.first_try = False

            return Reply({
                'ok': True,
                'outcome': 'continue',
                'message': f'好棋！引擎顽强以「{def_chinese}」应对，请继续组织攻势。',
                'user_move': {'iccs': user_iccs, 'chinese': user_chinese},
                'engine_move': {'iccs': def_iccs, 'chinese': def_chinese},
                'game': game.snapshot(),
                'solved': False,
                'eval_red': eval_score,
            })
        else:
            # 引擎无防守走法或已困毙
            sess.solved = True
            if not sandbox and self.store:
                self.store.record_training_attempt(
                    puzzle_id=puzzle_id,
                    category=sess.puzzle['category'],
                    solved=True,
                    hints_used=sess.hints_used,
                    first_try=sess.first_try and sess.attempts == 1,
                )
            return Reply({
                'ok': True,
                'outcome': 'solved',
                'message': '黑方已无路可逃，恭喜通关！',
                'user_move': {'iccs': user_iccs, 'chinese': user_chinese},
                'engine_move': None,
                'game': game.snapshot(),
                'solved': True,
                'explanation': sess.puzzle.get('explanation', ''),
            })

    # ------------------------------------------------------------------ #
    # 悔棋撤销
    # ------------------------------------------------------------------ #

    def undo_drill_reply(self, payload: Dict[str, Any]) -> Reply:
        puzzle_id = str(payload.get('puzzle_id') or '').strip()
        sess = self._get_or_create_session(puzzle_id)
        if sess is None:
            return Reply({'ok': False, 'message': '题目不存在'}, 404)

        game = sess.game
        # 若刚走完一回合（人走了一步、引擎回防了一步），撤销两步
        if len(game.records) >= 2 and game.records[-1]['by'] == 'engine':
            game.undo(plies=2)
        elif len(game.records) >= 1:
            game.undo(plies=1)

        sess.solved = False
        return Reply({
            'ok': True,
            'message': '已撤回上一步走法',
            'game': game.snapshot(),
        })

    # ------------------------------------------------------------------ #
    # 获取启发提示
    # ------------------------------------------------------------------ #

    def hint_drill_reply(self, payload: Dict[str, Any]) -> Reply:
        puzzle_id = str(payload.get('puzzle_id') or '').strip()
        level = int(payload.get('level') or 1)
        sess = self._get_or_create_session(puzzle_id)
        if sess is None:
            return Reply({'ok': False, 'message': '题目不存在'}, 404)

        hints = sess.puzzle.get('hints', [])
        idx = max(0, min(level - 1, len(hints) - 1))
        hint_text = hints[idx] if hints else '仔细观察中路与底线防守的薄弱环节。'

        sess.hints_used = max(sess.hints_used, level)

        # 记录提示使用情况到库中
        if self.store:
            self.store.record_training_attempt(
                puzzle_id=puzzle_id,
                category=sess.puzzle['category'],
                solved=False,
                hints_used=sess.hints_used,
                first_try=False,
            )

        return Reply({
            'ok': True,
            'level': level,
            'hint': hint_text,
            'hints_used': sess.hints_used,
        })

    # ------------------------------------------------------------------ #
    # 重置题目
    # ------------------------------------------------------------------ #

    def reset_drill_reply(self, payload: Dict[str, Any]) -> Reply:
        puzzle_id = str(payload.get('puzzle_id') or '').strip()
        sess = self._get_or_create_session(puzzle_id)
        if sess is None:
            return Reply({'ok': False, 'message': '题目不存在'}, 404)

        sess.reset()
        return Reply({
            'ok': True,
            'message': '已重置回初始局面',
            'game': sess.game.snapshot(),
            'hints_used': sess.hints_used,
            'solved': False,
        })
