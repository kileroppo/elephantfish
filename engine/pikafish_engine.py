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
        # Pikafish 是控制台程序：父进程若没有控制台（后台启动、服务托管），
        # Windows 会给它新开一个黑色控制台窗口。这里显式要求不创建窗口。
        extra: Dict[str, Any] = {}
        if platform.system() == 'Windows':
            extra['creationflags'] = getattr(
                subprocess, 'CREATE_NO_WINDOW', 0x08000000)
            si = subprocess.STARTUPINFO()
            si.dwFlags |= subprocess.STARTF_USESHOWWINDOW
            si.wShowWindow = subprocess.SW_HIDE
            extra['startupinfo'] = si
        self.proc = subprocess.Popen(
            [self.binary_path],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
            cwd=cwd,
            **extra,
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

    def _kill_locked(self):
        """丢掉当前子进程。调用方必须已持有 self.lock（quit 会自己拿锁，不能在这里调）。"""
        proc, self.proc = self.proc, None
        self._is_ready = False
        if proc is None:
            return
        try:
            if proc.poll() is None:
                proc.kill()
        except Exception:
            pass
        try:
            proc.wait(timeout=1.0)
        except Exception:
            pass

    def _restart_locked(self):
        """进程死了就换一个新的。上一轮把引擎弄崩之后，这一手是唯一的活路。"""
        self._kill_locked()
        self._ensure_proc()

    def quit(self):
        """退出引擎进程。"""
        with self.lock:
            proc, self.proc = self.proc, None
            self._is_ready = False
            if proc is None:
                return
            try:
                if proc.poll() is None:
                    try:
                        proc.stdin.write("quit\n")
                        proc.stdin.flush()
                    except Exception:
                        pass
                    proc.wait(timeout=1.0)
            except Exception:
                try:
                    proc.kill()
                except Exception:
                    pass

    def search(
        self,
        board: str,
        red_to_move: bool,
        move_history_iccs: List[str] = None,
        max_depth: int = 30,
        time_limit: float = 2.5,
        external_stop=None,
        start_fen: Optional[str] = None,
        multipv: int = 1,
        max_nodes: Optional[int] = None,
    ) -> Generator[Dict[str, Any], None, None]:
        """执行搜索并逐步 yield 每一层的评估结果。

        ``max_nodes``：节点预算，发成 UCI 的 ``go nodes N``。对局度量只认这个
        刻度 —— ``movetime`` 在同一台机器上会随负载漂 2~3 倍，跨机器更没法比，
        拿它当预算等于把结果绑在「当时这台电脑忙不忙」上。给了预算时
        ``time_limit`` 不取消，退化成看门狗（子进程卡死总得有个收手的钟）。

        字段名与 ``Searcher.search`` 一致，**但「分」不是同一个单位**：
        这里是 UCI 惯例的 centipawn（一兵 = 100），内置引擎是它自己价值表
        的分（一兵 = 44）。折算成接缝唯一的单位由 ``engine._normalize``
        完成，别在这里、更别在下游做任何一次「顺手除一下」。

            depth: 已完成搜索深度
            move: 绝对坐标走法 (from_idx, to_idx)
            score: 侧方视角评分，centipawn（正=对当前走子方有利）；杀棋时无意义
            mate: 是否杀棋
            mate_in: 杀棋还有几步（非负）；None = 这不是杀棋
            mate_sign: 杀棋方向（+1 走子方成杀 / -1 走子方被杀）
            nodes: 累计节点
            time: 耗时秒数
            nps: 每秒节点数
            pv: 主变绝对坐标列表 [(from, to), ...]
            pv_iccs: 主变 ICCS 走法列表 ['h2e2', ...]
            multipv: 根着法排名，1 起
            bound: 'exact' / 'lowerbound' / 'upperbound'
        """
        with self.lock:
            # 上一轮把引擎喂崩了的话，这里先换一个新的：
            # 否则后面每一次 _send 都是 Errno 22，整局再也出不了招。
            if self.proc is not None and self.proc.poll() is not None:
                self._kill_locked()
            self._ensure_proc()

            # MultiPV 是**持久**选项，每次搜索都显式设一遍：不设的话上一次多线
            # 搜索的宽度会悄悄渗进这一次单线搜索 —— 皮卡鱼照样每层吐 N 条，
            # 而调用方以为自己要的是第 1 名。
            self._send(f"setoption name MultiPV value {max(1, int(multipv))}")

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

            # 组装 go 命令。UCI 里多个限度同时给 = 按**先到**的那个收手，所以：
            # 带 max_nodes 时 movetime 只是看门狗（子进程卡死总得有个收手的钟），
            # 不带预算才让时间主导（产品走棋的老行为，一行都没变）。
            # time_limit 为 None 就不发 movetime —— 纯节点预算的度量要的是
            # 「一个时间刻度都不掺」；顺手把老的 int(None * 1000) 会炸的坑填了。
            go_cmd = "go"
            if time_limit:
                go_cmd += f" movetime {int(time_limit * 1000)}"
            if max_nodes:
                go_cmd += f" nodes {int(max_nodes)}"
            if max_depth and max_depth < 100:
                go_cmd += f" depth {max_depth}"
            if go_cmd == "go":
                # 「go」光杆 = 一直搜到外部 stop。度量台走到这里只可能是参数写错，
                # 静默无上限搜下去会把整轮结果绑在时钟上，正是这套尺子要避免的。
                raise ValueError(
                    'go 命令没有任何限度：max_nodes / time_limit / max_depth 至少要有一个')

            try:
                self._send(pos_cmd)
                self._send(go_cmd)
            except OSError:
                # 发命令的时候进程刚好死了（比如它认为 position 里的着法非法）：
                # 换一个进程重来一次，别把「引擎已死」这个状态带出这一手。
                self._restart_locked()
                self._send(pos_cmd)
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
                    # 进程死了（最典型的原因：position 里给了它认为非法的着法，
                    # pikafish 会直接 exit(1)）。这时必须把死进程丢掉并**报错**，
                    # 不能装作「无着可走」—— 那会让对局静默停摆。
                    code = self.proc.poll()
                    detail = ''
                    try:
                        detail = (self.proc.stderr.read() or '').strip().splitlines()[-1][:160]
                    except Exception:
                        pass
                    self._kill_locked()
                    raise RuntimeError(
                        '皮卡鱼进程异常退出（code=%s）%s' % (code, ('：' + detail) if detail else ''))
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
                        # bestmove 只该盖在**排名第一**那条线上：多线时最后读到的
                        # 一条往往是 rank 2 / rank 3，把最终决出的那手挪到它头上，
                        # 报出去的排名就是错位的（分数没错，棋不是那支的棋）。
                        if int(parsed.get("multipv") or 1) <= 1:
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
                    # 不再折算成 ±(30000−n) 那种自造大数。它既不是 centipawn
                    # 也不是内置引擎的分，下游按任何一种分母去除它都会得出
                    # 离谱的数；而「几步杀」这个真相在折算里被丢掉了。
                    # 距离用 mate_in（UCI 的 mate n 本来就是步数，正=走子方
                    # 成杀、负=走子方被杀），score 只剩方向，由接缝换成锚点分。
                    data["mate"] = True
                    data["mate_in"] = abs(score_val)
                    data["mate_sign"] = 1 if score_val > 0 else -1
                i += 3
                # upperbound / lowerbound 不是噪声，是这条线分数的**可信程度**：
                # 截断来的分数只能当边界用。当精确值报出去，讲解层就会拿一个
                # 界去算「你这一手比最优差多少」，说出来的数没有依据。
                if i < n and tokens[i] in ("upperbound", "lowerbound"):
                    data["bound"] = tokens[i]
                    i += 1
            elif tok == "multipv" and i + 1 < n:
                data["multipv"] = int(tokens[i + 1])
                i += 2
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
            # 杀棋的距离与方向各走各的：mate_in 是「还有几步」（非负），
            # mate_sign 是方向（+1 走子方成杀 / -1 走子方被杀）。原始 cp 分在
            # 杀棋时压根不存在，所以方向不能靠 score 的数值去猜 —— 这一点
            # 由 adapter 声明，接缝负责换成锚点分（见 engine._normalize）。
            "mate_in": data.get("mate_in"),
            "mate_sign": data.get("mate_sign"),
            "nodes": data.get("nodes", 0),
            "time": data.get("time", 0.0),
            "nps": data.get("nps", 0),
            "pv": pv_tuples,
            "pv_iccs": pv_moves_iccs,
            # 单线模式皮卡鱼也带 ``multipv 1``，真没带就是 1；bound 同理。
            "multipv": data.get("multipv", 1),
            "bound": data.get("bound", "exact"),
        }
