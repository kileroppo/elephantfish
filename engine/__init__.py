# -*- coding: utf-8 -*-
"""elephantfish 引擎包。

    core      棋盘表示 / 走法生成 / 子力价值表（复用原版已验证实现）
    search    PVS 搜索（重写，取代原版 MTD 二分）
    notation  中文记谱 / ICCS / FEN
    game      对局状态机与规则判定
    engine    引擎接缝：把「内置搜索」与「皮卡鱼 UCI」统一成一个接口
"""

from .core import (          # noqa: F401
    Position, initial, pst, piece, parse, render, flip, flip_move,
    eval_abs, make_position, legal_moves, is_in_check, fast_is_check,
    evaluate, apply_move, PIECE_CHAR, PIECE_NAME, SQUARE_NAME, index_of,
    board_grid, grid_to_board, pieces_of,
    MATE_LOWER, MATE_UPPER, INF, ROWS, COLS,
)
from .search import Searcher          # noqa: F401
from .opening import GLOBAL_BOOK, OpeningBook  # noqa: F401
from .pikafish_engine import PikafishEngine, find_pikafish_binary  # noqa: F401
from . import notation                # noqa: F401
from . import tactics                 # noqa: F401
from .game import Game, RED, BLACK    # noqa: F401
from .engine import (                 # noqa: F401
    Engine, EngineInfo, EngineSet, SearchRequest,
    BuiltinEngine, PikafishAdapter, default_engines,
    PIKAFISH, BUILTIN, PREFERENCE_NAMES,
    BOUND_EXACT, BOUND_LOWER, BOUND_UPPER, BOUND_NAMES,
)

__all__ = [
    'Position', 'initial', 'parse', 'render', 'flip', 'flip_move',
    'eval_abs', 'make_position', 'legal_moves', 'is_in_check', 'fast_is_check',
    'evaluate', 'apply_move', 'PIECE_CHAR', 'PIECE_NAME', 'SQUARE_NAME', 'index_of',
    'board_grid', 'grid_to_board', 'pieces_of',
    'MATE_LOWER', 'MATE_UPPER', 'INF', 'ROWS', 'COLS',
    'Searcher', 'PikafishEngine', 'find_pikafish_binary',
    'GLOBAL_BOOK', 'OpeningBook', 'notation', 'Game', 'RED', 'BLACK',
    # 引擎接缝
    'Engine', 'EngineInfo', 'EngineSet', 'SearchRequest',
    'BuiltinEngine', 'PikafishAdapter', 'default_engines',
    'PIKAFISH', 'BUILTIN', 'PREFERENCE_NAMES',
    'BOUND_EXACT', 'BOUND_LOWER', 'BOUND_UPPER', 'BOUND_NAMES',
]

