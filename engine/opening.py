# -*- coding: utf-8 -*-
"""中国象棋经典开局库。

包含当头炮（中炮对屏风马、反宫马、单提马、顺炮、列炮）、飞相局、仙人指路、
起马局、过宫炮、士角炮等主流定式。

支持权重随机选择开局变例，兼顾开局质量与对局丰富度。开局阶段毫秒级出招，
建立坚实阵形优势。
"""

import random
from . import core
from .core import flip_move
from . import notation as nt
from .opening_data import OPENING_SEQUENCES


class OpeningBook:
    """开局库管理器。

    索引键格式为 ``(board_str, red_to_move)``，映射到候选走法列表：
    ``{ (board, red_to_move): [(move_tuple, weight, pv_list), ...] }``
    """

    def __init__(self):
        self.table = {}
        self._build_table()

    def _build_table(self):
        for moves, weight in OPENING_SEQUENCES:
            cur_b = core.initial
            cur_r = True
            parsed_moves = [nt.from_iccs(m) for m in moves]

            for idx, m in enumerate(parsed_moves):
                key = (cur_b, cur_r)
                pv_rest = parsed_moves[idx:]
                if key not in self.table:
                    self.table[key] = []
                exists = False
                for i, (em, ew, epv) in enumerate(self.table[key]):
                    if em == m:
                        self.table[key][i] = (
                            em, ew + weight,
                            epv if len(epv) >= len(pv_rest) else pv_rest
                        )
                        exists = True
                        break
                if not exists:
                    self.table[key].append((m, weight, pv_rest))

                cur_b = core.apply_move(cur_b, cur_r, m)
                cur_r = not cur_r

    def get_book_move(self, board, red_to_move, rng=None):
        """查询当前局面是否有开局库应手。

        返回 ``(abs_move, pv_moves)`` 或 ``(None, None)``。
        """
        key = (board, red_to_move)
        candidates = self.table.get(key)
        if not candidates:
            return None, None

        if rng is None:
            rng = random

        total_weight = sum(w for _, w, _ in candidates)
        pick = rng.randint(1, total_weight)
        cur = 0
        for m, w, pv in candidates:
            cur += w
            if cur >= pick:
                return m, pv

        m, _, pv = candidates[0]
        return m, pv


# 全局单例
GLOBAL_BOOK = OpeningBook()
