# -*- coding: utf-8 -*-
"""Pikafish 引擎端到端集成测试。"""

import os
import sys

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from engine import Game, RED, BLACK, core, notation as nt
from engine.pikafish_engine import PikafishEngine, find_pikafish_binary


def test_pikafish_discovery():
    bin_path = find_pikafish_binary()
    assert bin_path is not None, "未找到 Pikafish 二进制文件"
    assert os.path.isfile(bin_path), f"文件不存在: {bin_path}"
    print(f"  [ok] 找到二进制: {bin_path}")


def test_pikafish_search():
    eng = PikafishEngine(threads=2, hash_mb=32)
    assert eng.is_available, "Pikafish 不可用"

    # 1. 初始局面红方走子
    results = list(eng.search(core.initial, True, time_limit=0.5))
    assert len(results) > 0, "搜索未返回结果"
    last = results[-1]
    assert "move" in last and last["move"] is not None
    assert "depth" in last and last["depth"] >= 10
    assert last["nodes"] > 10000
    iccs = nt.to_iccs(last["move"])
    print(f"  [ok] 初始局面思考完毕: depth={last['depth']}, move={iccs}, nodes={last['nodes']}, score={last['score']}")

    # 2. 模拟黑方应手（接 红方中炮 h2e2）
    board_after_red = core.apply_move(core.initial, True, nt.from_iccs("h2e2"))
    black_results = list(eng.search(
        board_after_red,
        False,
        move_history_iccs=["h2e2"],
        time_limit=0.5,
    ))
    assert len(black_results) > 0
    b_last = black_results[-1]
    b_iccs = nt.to_iccs(b_last["move"])
    print(f"  [ok] 黑方应手思考完毕: depth={b_last['depth']}, move={b_iccs}, nodes={b_last['nodes']}, score={b_last['score']}")

    # 3. 动态调整参数与重置
    eng.set_options(threads=1, hash_mb=16)
    eng.new_game()
    print("  [ok] set_options 与 new_game 正常执行")

    eng.quit()
    print("  [ok] 进程正常退出")


if __name__ == '__main__':
    print("==================================================")
    print("  Pikafish 引擎集成验证")
    print("==================================================")
    test_pikafish_discovery()
    test_pikafish_search()
    print("==================================================")
    print("  所有 Pikafish 测试通过！")
    print("==================================================")
