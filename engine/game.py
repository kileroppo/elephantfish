# -*- coding: utf-8 -*-
"""对局状态机。

这个类不负责搜索，只负责「一局棋是什么状态」：局面、行棋方、棋谱、
终局判定、复盘撤销。搜索由调用方驱动，把结果回填进来。

终局判定按中国象棋规则，这里有一处和原版引擎不同、值得一提：
**困毙（无子可动但不是被将军）判负**，不是和棋。国际象棋里那是和棋，
中国象棋里是输棋，原版 elephantfish 沿用了前者的处理。
"""

from . import core
from .core import parse, render, PIECE_NAME, PIECE_CHAR, MATE_LOWER
from . import notation as nt

RED, BLACK = 'red', 'black'


def other(side):
    return BLACK if side == RED else RED


class Game:
    """一局对局。``engine_side`` 是引擎执子方。"""

    def __init__(self, engine_side=RED, start_fen=None):
        self.engine_side = engine_side if engine_side in (RED, BLACK) else RED
        self.board = core.initial
        self.red_to_move = True
        self.records = []            # 每步的详细记录
        self.boards = [core.initial]  # 每个局面（绝对坐标）
        self.sides = [True]           # 每个局面的行棋方（True=红）
        self.repetition = {core.initial: 1}
        self.halfmove = 0             # 距上次吃子的回合数
        self.resigned = None          # 认输方
        self.engine_meta = {}         # 上一步引擎思考的信息
        self.ids = {}                 # 格子索引 -> 棋子身份号
        self.id_stack = []            # 与 records 对齐的身份变更记录
        self._next_id = 1
        self._assign_fresh_ids()
        if start_fen:
            self.load_fen(start_fen)

    # ------------------------------------------------------------------ #
    # 棋子身份
    #
    # 前端要靠这个做平滑位移：只有知道「这颗子还是刚才那颗」，才能让它
    # 从旧格子滑到新格子，而不是「旧位置消失、新位置凭空出现」。
    # 让服务端跟踪最省事——它本来就知道每一步是什么。
    # ------------------------------------------------------------------ #

    def _assign_fresh_ids(self):
        self.ids = {}
        self._next_id = 1
        for p in core.pieces_of(self.board):
            self.ids[p['index']] = self._next_id
            self._next_id += 1

    def pieces(self):
        out = core.pieces_of(self.board)
        for p in out:
            p['id'] = self.ids.get(p['index'], 0)
        return out

    # ------------------------------------------------------------------ #
    # 基本信息
    # ------------------------------------------------------------------ #

    @property
    def turn(self):
        return RED if self.red_to_move else BLACK

    @property
    def engine_to_move(self):
        return self.turn == self.engine_side

    @property
    def opponent_side(self):
        return other(self.engine_side)

    @property
    def opponent_to_move(self):
        return self.turn == self.opponent_side

    @property
    def ply(self):
        return len(self.records)

    def legal_moves(self):
        return core.legal_moves(self.board, self.red_to_move)

    def in_check(self):
        return core.is_in_check(self.board, self.red_to_move)

    # ------------------------------------------------------------------ #
    # 走子与撤销
    # ------------------------------------------------------------------ #

    def is_legal(self, move):
        return move in self.legal_moves()

    def push(self, move, by=None, eval_red=None, depth=None, think_time=None):
        """落子并生成一条棋谱记录。

        ``by`` 取值 ``'engine'`` / ``'opponent'``，缺省按执子方推断。
        """
        mv = (move[0], move[1])
        side = self.turn
        if by is None:
            by = 'engine' if side == self.engine_side else 'opponent'

        captured = self.board[mv[1]]
        piece = self.board[mv[0]]
        chinese = nt.to_chinese(self.board, mv)
        iccs = nt.to_iccs(mv)

        # 身份号随棋子一起搬过去；被吃掉的棋子把身份号交出来
        moved_id = self.ids.pop(mv[0], None)
        captured_id = self.ids.pop(mv[1], None)
        if moved_id is None:
            moved_id = self._next_id
            self._next_id += 1
        self.ids[mv[1]] = moved_id
        self.id_stack.append({'moved_id': moved_id, 'captured_id': captured_id,
                              'from': mv[0], 'to': mv[1]})

        self.board = core.apply_move(self.board, self.red_to_move, mv)
        self.red_to_move = not self.red_to_move
        self.boards.append(self.board)
        self.sides.append(self.red_to_move)

        key = self.board
        self.repetition[key] = self.repetition.get(key, 0) + 1
        self.halfmove = 0 if captured != '.' else self.halfmove + 1

        record = {
            'ply': len(self.records) + 1,
            'side': side,
            'by': by,
            'iccs': iccs,
            'chinese': chinese,
            'from': render(mv[0]),
            'to': render(mv[1]),
            'piece': PIECE_NAME.get(piece, piece),
            'glyph': PIECE_CHAR.get(piece, piece),
            'captured': PIECE_NAME.get(captured, None) if captured != '.' else None,
            'captured_glyph': PIECE_CHAR.get(captured, None) if captured != '.' else None,
            'check': self.in_check(),
            'mate': False,
            'eval': eval_red,
            'depth': depth,
            'time': think_time,
        }
        status = self.status()
        record['mate'] = status['state'] in ('checkmate', 'stalemate')
        record['state'] = status['state']
        self.records.append(record)
        return record

    def undo(self, plies=1):
        """撤销最近 ``plies`` 步，返回实际撤销的步数。"""
        removed = 0
        for _ in range(plies):
            if not self.records:
                break
            key = self.boards.pop()
            self.sides.pop()
            self.repetition[key] = self.repetition.get(key, 1) - 1
            if self.repetition[key] <= 0:
                self.repetition.pop(key, None)
            self.records.pop()
            self.board = self.boards[-1]
            self.red_to_move = self.sides[-1]

            info = self.id_stack.pop()
            self.ids.pop(info['to'], None)
            self.ids[info['from']] = info['moved_id']
            if info['captured_id'] is not None:
                self.ids[info['to']] = info['captured_id']
            removed += 1
        # 重算限着计数
        self.halfmove = 0
        for rec in reversed(self.records):
            if rec['captured']:
                break
            self.halfmove += 1
        self.resigned = None
        return removed

    def undo_round(self):
        """回退到「轮到对手走、且刚撤掉的是对手那一步」的状态。

        也就是：先退一步，若不是对手该走就继续退。这样不管当前停在哪，
        撤销后都回到「等对手出招」的界面状态，转述者可以重新录入。
        认输也要一并撤销，否则「退回去接着下」点了没反应。
        """
        self.resigned = None
        if not self.records:
            # 一步没走过就认输的情况：没有棋步可退，但认输必须撤销掉
            return 0
        n = self.undo(1)
        while self.records and self.turn != self.opponent_side:
            n += self.undo(1)
        return n

    # ------------------------------------------------------------------ #
    # 终局判定
    # ------------------------------------------------------------------ #

    def status(self):
        return self._status(self.legal_moves(), self.in_check())

    def _status(self, moves, checking):
        """终局判定。moves / checking 由调用方传进来，避免一次快照算三遍。"""
        if self.resigned:
            return {'state': 'resign', 'winner': other(self.resigned),
                    'reason': f'{self._cn(self.resigned)}方认输'}

        if not moves:
            return {
                'state': 'checkmate' if checking else 'stalemate',
                'winner': other(self.turn),
                'reason': ('将死' if checking else '困毙') + f'，{self._cn(self.turn)}方负',
            }
        if self.repetition.get(self.board, 0) >= 3:
            return {'state': 'draw_repetition', 'winner': None, 'reason': '三次重复局面，判和'}
        if self.halfmove >= 120:
            return {'state': 'draw_moves', 'winner': None, 'reason': '连续 60 回合无吃子，判和'}

        return {
            'state': 'playing',
            'winner': None,
            'reason': ('将军！' if checking else ''),
        }

    @staticmethod
    def _cn(side):
        return '红' if side == RED else '黑'

    def is_over(self):
        return self.status()['state'] != 'playing'

    def resign(self, side):
        self.resigned = side if side in (RED, BLACK) else self.turn

    # ------------------------------------------------------------------ #
    # 序列化
    # ------------------------------------------------------------------ #

    def snapshot(self):
        """给前端的完整状态快照。

        这个接口会被前端每 130ms 轮询一次，所以合法着法、将军判定这些
        贵一点的量只算一遍，往下复用。
        """
        moves = self.legal_moves()
        checking = core.is_in_check(self.board, self.red_to_move)
        status = self._status(moves, checking)
        legal = []
        for m in moves:
            legal.append({
                'iccs': nt.to_iccs(m),
                'chinese': nt.to_chinese(self.board, m),
                'from': render(m[0]),
                'to': render(m[1]),
            })
        last = self.records[-1] if self.records else None
        return {
            'board': self.board,
            'pieces': self.pieces(),
            'turn': self.turn,
            'engine_side': self.engine_side,
            'opponent_side': self.opponent_side,
            'engine_to_move': self.engine_to_move,
            'opponent_to_move': self.opponent_to_move,
            'ply': self.ply,
            'in_check': checking,
            'legal_moves': legal,
            'last_move': ({'from': last['from'], 'to': last['to'],
                           'iccs': last['iccs'], 'by': last['by'],
                           'captured': last['captured']} if last else None),
            'records': self.records,
            'status': status,
            'fen': nt.to_fen(self.board, self.red_to_move),
            'halfmove': self.halfmove,
            'is_start': self.board == core.initial,
        }

    # ------------------------------------------------------------------ #
    # 载入
    # ------------------------------------------------------------------ #

    def load_fen(self, fen):
        board, red_to_move, halfmove, _ = nt.from_fen(fen)
        # 载入的局面可能根本不合法（比如老将已经没了），这里温和地挡一下
        self.board = board
        self.red_to_move = red_to_move
        self.boards = [board]
        self.sides = [red_to_move]
        self.records = []
        self.repetition = {board: 1}
        self.halfmove = halfmove
        self.resigned = None
        self.id_stack = []
        self._assign_fresh_ids()
        return self

    def load_moves(self, move_texts):
        """按顺序重放一串走法（ICCS 或中文记谱混用都能认）。"""
        applied, failed = [], []
        for raw in move_texts:
            text = raw.strip()
            if not text:
                continue
            move = nt.from_iccs(text)
            if move is None:
                move = nt.from_chinese(self.board, text, self.red_to_move,
                                       legal=self.legal_moves())
            if move is None or not self.is_legal(move):
                failed.append(raw)
                break
            self.push(move, by='engine' if self.engine_to_move else 'opponent')
            applied.append(raw)
        return applied, failed
