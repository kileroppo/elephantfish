# -*- coding: utf-8 -*-
"""elephantfish 引擎包。

    core      棋盘表示 / 走法生成 / 子力价值表（复用原版已验证实现）
    search    PVS 搜索（重写，取代原版 MTD 二分）
    notation  中文记谱 / ICCS / FEN
    game      对局状态机与规则判定
"""

from .core import (          # noqa: F401
    Position, initial, pst, piece, parse, render, flip, flip_move,
    eval_abs, make_position, legal_moves, is_in_check, apply_move,
    PIECE_CHAR, PIECE_NAME, SQUARE_NAME, index_of,
    board_grid, grid_to_board, pieces_of,
    MATE_LOWER, MATE_UPPER, INF, ROWS, COLS,
)
from .search import Searcher          # noqa: F401
from . import notation                # noqa: F401
from .game import Game, RED, BLACK    # noqa: F401

__all__ = [
    'Position', 'initial', 'parse', 'render', 'flip', 'flip_move',
    'eval_abs', 'make_position', 'legal_moves', 'is_in_check', 'apply_move',
    'PIECE_CHAR', 'PIECE_NAME', 'SQUARE_NAME', 'index_of',
    'board_grid', 'grid_to_board', 'pieces_of',
    'MATE_LOWER', 'MATE_UPPER', 'INF', 'ROWS', 'COLS',
    'Searcher', 'notation', 'Game', 'RED', 'BLACK',
]
