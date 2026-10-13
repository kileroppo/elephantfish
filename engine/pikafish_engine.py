# -*- coding: utf-8 -*-
"""Pikafish UCI 引擎封装。

将官方 Pikafish (皮卡鱼) 二进制通过 UCI 协议接入象鱼平台。
"""

import atexit
import os
import platform
import subprocess
import threading
import time
from typing import Optional, List, Dict, Any, Generator

from . import notation as nt, core

# 默认参数
DEFAULT_THREADS = 2
DEFAULT_HASH_MB = 64


def find_pikafish_binary(custom_path: Optional[str] = None) -> Optional[str]:
    """自动探测 Pikafish 可执行文件路径。"""
    if custom_path and os.path.isfile(custom_path) and os.access(custom_path, os.X_OK):
        return os.path.abspath(custom_path)

    env_path = os.environ.get('PIKAFISH_PATH')
    if env_path and os.path.isfile(env_path) and os.access(env_path, os.X_OK):
        return os.path.abspath(env_path)

    base_dir = os.path.dirname(os.path.abspath(__file__))
    candidates = []

    sys_name = platform.system().lower()
    if 'darwin' in sys_name:
        candidates.append(os.path.join(base_dir, 'pikafish', 'Pikafish-MacOS-universal'))
        candidates.append('pikafish')
    elif 'windows' in sys_name:
        candidates.append(os.path.join(base_dir, 'pikafish', 'Pikafish-Windows-x86-64-universal.exe'))
        candidates.append(os.path.join(base_dir, 'pikafish', 'pikafish.exe'))
        candidates.append('pikafish.exe')
    else:  # Linux / Unix
        candidates.append(os.path.join(base_dir, 'pikafish', 'Pikafish-Linux-x86-64-universal'))
        candidates.append('pikafish')

    for cand in candidates:
        if os.path.isfile(cand):
            try:
                # 确保有执行权限
                if not os.access(cand, os.X_OK):
                    os.chmod(cand, 0o755)
            except Exception:
                pass
            return os.path.abspath(cand)

    # 尝试系统 PATH
    import shutil
    path_bin = shutil.which('pikafish') or shutil.which('pikafish.exe')
    if path_bin:
        return os.path.abspath(path_bin)

    return None


class PikafishEngine:
    """Pikafish 引擎长驻进程管理器。"""

    def __init__(self, binary_path: Optional[str] = None, threads: int = DEFAULT_THREADS, hash_mb: int = DEFAULT_HASH_MB):
        self.binary_path = binary_path or find_pikafish_binary()
        self.threads = threads
        self.hash_mb = hash_mb
        self.proc: Optional[subprocess.Popen] = None
        self.lock = threading.Lock()
        self._is_ready = False

        if self.binary_path:
            atexit.register(self.quit)

    @property
    def is_available(self) -> bool:
        return bool(self.binary_path and os.path.isfile(self.binary_path))

    def _ensure_proc(self):
        """确保子进程已启动且完成 UCI 握手。"""
        if self.proc is not None and self.proc.poll() is None:
            return

        if not self.is_available:
            raise RuntimeError(f"Pikafish 二进制文件未找到: {self.binary_path}")

        cwd = os.path.dirname(self.binary_path)
        self.proc = subprocess.Popen(
            [self.binary_path],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
            cwd=cwd,
        )

        # 握手
        self._send("uci")
        while True:
            line = self.proc.stdout.readline()
            if not line:
                break
            if line.strip() == "uciok":
                break

        # 设置参数
        self._send(f"setoption name Threads value {self.threads}")
        self._send(f"setoption name Hash value {self.hash_mb}")

        # 检查同目录下 pikafish.nnue
        nnue_path = os.path.join(cwd, "pikafish.nnue")
        if os.path.isfile(nnue_path):
            self._send(f"setoption name EvalFile value {nnue_path}")

        self._send("isready")
        while True:
            line = self.proc.stdout.readline()
            if not line or "readyok" in line:
                break
        self._is_ready = True

    def _send(self, cmd: str):
        if self.proc and self.proc.stdin:
            self.proc.stdin.write(cmd.strip() + "\n")
            self.proc.stdin.flush()

    def set_options(self, threads: Optional[int] = None, hash_mb: Optional[int] = None):
        """更新线程与哈希大小配置。"""
        with self.lock:
            need_update = False
            if threads is not None and threads != self.threads:
                self.threads = threads
                need_update = True
            if hash_mb is not None and hash_mb != self.hash_mb:
                self.hash_mb = hash_mb
                need_update = True

            if need_update and self.proc and self.proc.poll() is None:
                self._send(f"setoption name Threads value {self.threads}")
                self._send(f"setoption name Hash value {self.hash_mb}")
                self._send("isready")
                while True:
                    line = self.proc.stdout.readline()
                    if not line or "readyok" in line:
                        break

    def new_game(self):
        """通知引擎开始新对局并清空哈希表。"""
        with self.lock:
            if self.proc and self.proc.poll() is None:
                self._send("ucinewgame")
                self._send("isready")
                while True:
                    line = self.proc.stdout.readline()
                    if not line or "readyok" in line:
                        break

    def quit(self):
        """退出引擎进程。"""
        with self.lock:
            if self.proc is not None:
                try:
                    if self.proc.poll() is None:
                        self._send("quit")
                        self.proc.wait(timeout=1.0)
                except Exception:
                    try:
                        self.proc.kill()
                    except Exception:
                        pass
                finally:
                    self.proc = None
                    self._is_ready = False

    def search(
        self,
        board: str,
        red_to_move: bool,
        move_history_iccs: List[str] = None,
        max_depth: int = 30,
        time_limit: float = 2.5,
        external_stop=None,
        start_fen: Optional[str] = None,
    ) -> Generator[Dict[str, Any], None, None]:
        """执行搜索并逐步 yield 每一层的评估结果。

        yield 字段格式与 Searcher.search 保持一致：
            depth: 已完成搜索深度
            move: 绝对坐标走法 (from_idx, to_idx)
            score: 侧方视角评分（正=对当前走子方有利，单位分）
            mate: 是否杀棋
            nodes: 累计节点
            time: 耗时秒数
            nps: 每秒节点数
            pv: 主变绝对坐标列表 [(from, to), ...]
            pv_iccs: 主变 ICCS 走法列表 ['h2e2', ...]
        """
        with self.lock:
            self._ensure_proc()

            # 组装 position 命令
            # 如果是从初始局面开局且有走子历史，使用 position startpos moves ...
            # 这样引擎能获知全部历史局面、吃子计数与长打状态。
            #
            # 注意 ``move_history_iccs`` 非空这个条件是必须的：局面不是初始局面
            # 却拿不到棋谱时，拼出来的 ``position startpos moves`` 着法表是空的，
            # 引擎会以为自己在**初始局面**上搜 —— 返回一手对不上局面的棋，
            # 而且不报任何错。这种情况下宁可退回 ``position fen``。
            if ((not start_fen or start_fen == nt.to_fen(core.initial, True))
                    and move_history_iccs and board != core.initial):
                moves_str = " ".join(move_history_iccs or [])
                pos_cmd = f"position startpos moves {moves_str}".strip()
            elif start_fen and start_fen != nt.to_fen(core.initial, True):
                moves_str = " ".join(move_history_iccs or [])
                pos_cmd = f"position fen {start_fen} moves {moves_str}".strip()
            else:
                # 初始局面或独立局面
                fen = nt.to_fen(board, red_to_move)
                pos_cmd = f"position fen {fen}"

            self._send(pos_cmd)

            # 组装 go 命令：使用 movetime (毫秒)
            movetime_ms = int(time_limit * 1000)
            go_cmd = f"go movetime {movetime_ms}"
            if max_depth and max_depth < 100:
                go_cmd += f" depth {max_depth}"

            self._send(go_cmd)

            last_info = None
            stop_sent = False
            start_time = time.time()

            while True:
                # 检查外部中断信号
                if external_stop and external_stop() and not stop_sent:
                    self._send("stop")
                    stop_sent = True

                line = self.proc.stdout.readline()
                if not line:
                    break
                line = line.strip()

                if line.startswith("bestmove"):
                    parts = line.split()
                    bm_iccs = parts[1] if len(parts) > 1 else None
                    if bm_iccs and bm_iccs != "(none)":
                        bm_move = nt.from_iccs(bm_iccs)
                        if last_info:
                            last_info["move"] = bm_move
                            yield last_info
                        else:
                            # 极端情况：一层都没出就出了 bestmove
                            yield {
                                "depth": 1,
                                "move": bm_move,
                                "score": 0,
                                "mate": False,
                                "nodes": 100,
                                "time": round(time.time() - start_time, 3),
                                "nps": 100000,
                                "pv": [bm_move],
                                "pv_iccs": [bm_iccs],
                            }
                    break

                if line.startswith("info depth"):
                    parsed = self._parse_info_line(line)
                    if parsed:
                        last_info = parsed
                        yield parsed

    def _parse_info_line(self, line: str) -> Optional[Dict[str, Any]]:
        """解析 Pikafish 的 info 字符串。"""
        tokens = line.split()
        data = {}
        i = 1
        n = len(tokens)

        pv_moves_iccs = []

        while i < n:
            tok = tokens[i]
            if tok == "depth" and i + 1 < n:
                data["depth"] = int(tokens[i + 1])
                i += 2
            elif tok == "score" and i + 2 < n:
                score_type = tokens[i + 1]
                score_val = int(tokens[i + 2])
                if score_type == "cp":
                    data["score"] = score_val
                    data["mate"] = False
                elif score_type == "mate":
                    data["mate"] = True
                    # 换算成类似 MATE_UPPER 的大分
                    mate_sign = 1 if score_val > 0 else -1
                    data["score"] = mate_sign * (30000 - abs(score_val))
                i += 3
                # 跳过 upperbound / lowerbound 标志
                if i < n and tokens[i] in ("upperbound", "lowerbound"):
                    i += 1
            elif tok == "nodes" and i + 1 < n:
                data["nodes"] = int(tokens[i + 1])
                i += 2
            elif tok == "nps" and i + 1 < n:
                data["nps"] = int(tokens[i + 1])
                i += 2
            elif tok == "time" and i + 1 < n:
                data["time"] = round(int(tokens[i + 1]) / 1000.0, 3)
                i += 2
            elif tok == "pv":
                # pv 之后的所有 token 都是着法
                pv_moves_iccs = tokens[i + 1 :]
                break
            else:
                i += 1

        if "depth" not in data or not pv_moves_iccs:
            return None

        # 将 pv 转换为绝对坐标元组
        pv_tuples = []
        for m_str in pv_moves_iccs:
            m_tup = nt.from_iccs(m_str)
            if m_tup:
                pv_tuples.append(m_tup)

        if not pv_tuples:
            return None

        best_move = pv_tuples[0]

        return {
            "depth": data.get("depth", 1),
            "move": best_move,
            "score": data.get("score", 0),
            "mate": data.get("mate", False),
            "nodes": data.get("nodes", 0),
            "time": data.get("time", 0.0),
            "nps": data.get("nps", 0),
            "pv": pv_tuples,
            "pv_iccs": pv_moves_iccs,
        }
