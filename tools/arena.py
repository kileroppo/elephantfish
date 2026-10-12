# -*- coding: utf-8 -*-
"""棋力回归对局：新版引擎 vs 原版 elephantfish。

速度优化最危险的地方在于「跑得更快但下得更烂」。这个脚本让两个引擎在
固定深度下交替先后手真刀真枪对下，用胜率确认新版没有退化。

    python tools/arena.py --games 20 --depth 5
"""

import argparse
import os
import random
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import elephantfish as old_engine          # noqa: E402
from engine import core, notation          # noqa: E402
from engine.search import Searcher         # noqa: E402

MATE = core.MATE_LOWER
OPENINGS = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                        'data', 'fen', 'random_openings.fen')


def load_openings(path):
    if not os.path.isfile(path):
        return []
    out = []
    with open(path, encoding='utf-8') as fh:
        for line in fh:
            line = line.strip()
            if line and '/' in line:
                out.append(line)
    return out


def play(red, black, start_fen=None, max_ply=200):
    """下一整局。``red``/``black`` 是 ``(名字, think_fn)``。"""
    board, red_to_move = core.initial, True
    if start_fen:
        board, red_to_move, _, _ = notation.from_fen(start_fen)
    pos = core.make_position(board, red_to_move)
    history = [pos.board]
    checks = []
    seen = {pos.board: 1}

    for ply in range(max_ply):
        name, think = red if red_to_move else black

        if pos.score <= -MATE:
            return ('black' if red_to_move else 'red'), ply, f'{name} 被将死'

        move = think(pos, history)
        if move is None:
            return ('black' if red_to_move else 'red'), ply, f'{name} 无着可走'

        pos = pos.move(move)
        history.append(pos.board)
        checks.append(core.fast_is_check(pos))
        red_to_move = not red_to_move

        seen[pos.board] = seen.get(pos.board, 0) + 1
        if seen[pos.board] >= 3:
            # 依中国象棋竞赛规则判定单方长将：
            # 找出最近一个循环周期内双方各自行棋的将军情况
            cur_key = pos.board
            prev_indices = [idx for idx, b in enumerate(history) if b == cur_key]
            if len(prev_indices) >= 2:
                start_i = prev_indices[-2]
                end_i = prev_indices[-1]
                cycle_checks = checks[start_i:end_i]
                red_checks = [cycle_checks[k - start_i] for k in range(start_i, end_i) if k % 2 == 0]
                black_checks = [cycle_checks[k - start_i] for k in range(start_i, end_i) if k % 2 == 1]
                red_perp = bool(red_checks and all(red_checks))
                black_perp = bool(black_checks and all(black_checks))

                if red_perp and not black_perp:
                    return 'black', ply, f'{red[0]} 单方长将犯规判负，{black[0]} 胜'
                elif black_perp and not red_perp:
                    return 'red', ply, f'{black[0]} 单方长将犯规判负，{red[0]} 胜'

            return 'draw', ply, '三次重复局面'

    return 'draw', max_ply, '到达步数上限'


def make_new(depth):
    searcher = Searcher()

    def think(pos, history):
        root_is_red = (len(history) % 2 == 1)
        move, _ = searcher.think(pos, max_depth=depth, time_limit=None,
                                 game_history=history, root_is_red=root_is_red)
        return move
    return think


def make_old(depth):
    def think(pos, history):
        searcher = old_engine.Searcher()
        best = None
        for d, move, score in searcher.search(pos, history):
            if move is not None:
                best = move
            if d >= depth:
                break
        return best
    return think


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--games', type=int, default=10)
    ap.add_argument('--depth', type=int, default=5)
    ap.add_argument('--openings', default=OPENINGS)
    ap.add_argument('--fresh', action='store_true', help='只用开局局面，不用随机开局库')
    ap.add_argument('--seed', type=int, default=20261009)
    args = ap.parse_args()

    rng = random.Random(args.seed)
    books = [] if args.fresh else load_openings(args.openings)

    tally = {'new': 0, 'old': 0, 'draw': 0}
    t0 = time.time()

    for g in range(args.games):
        new_fn = make_new(args.depth)
        old_fn = make_old(args.depth)
        if g % 2 == 0:
            red, black = ('new', new_fn), ('old', old_fn)
        else:
            red, black = ('old', old_fn), ('new', new_fn)

        fen = rng.choice(books) if books else None
        t = time.time()
        result, plies, note = play(red, black, start_fen=fen)
        if result == 'draw':
            tally['draw'] += 1
            winner = '和棋'
        elif (result == 'red') == (red[0] == 'new'):
            tally['new'] += 1
            winner = '新版胜'
        else:
            tally['old'] += 1
            winner = '原版胜'

        side = '红' if red[0] == 'new' else '黑'
        print(f'第 {g+1:2d} 局  新版执{side}  {winner:6s}  '
              f'{plies:3d} 回合  {time.time()-t:5.1f}s  {note}', flush=True)

    total = sum(tally.values())
    decided = tally['new'] + tally['old']
    print()
    print(f'总战绩 {total} 局：新版 {tally["new"]} 胜 / 原版 {tally["old"]} 胜 / '
          f'和 {tally["draw"]}')
    print(f'新版胜率 {tally["new"]/total:.0%}'
          f'，分出胜负的对局中胜率 {tally["new"]/max(1, decided):.0%}')
    if decided:
        # 简化的 Elo 差估算：胜率 -> 分数差
        import math
        wr = max(1e-6, min(1 - 1e-6, tally['new'] / decided))
        elo = -400 * math.log10(1 / wr - 1)
        print(f'相对原版的 Elo 差约 {elo:+.0f}')
    print(f'总耗时 {time.time()-t0:.1f}s，搜索深度 {args.depth}，'
          f'随机开局 {"开" if books else "关"}')


if __name__ == '__main__':
    main()
