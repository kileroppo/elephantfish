# -*- coding: utf-8 -*-
"""引擎任务协调器 (EngineCoordinator)。

专职承载单线出招搜索 (engine-move) 与多线局势判分 (analyze) 的启停、
互斥等待与生命周期维护。

解耦目标：
- 终结原 session.py 中 1340+ 行混杂状态
- 统一管理内置搜索与皮卡鱼 UCI 子进程的 _engine_io 互斥锁与管道叫停
- 对外部 GameSession 暴露清晰的异步任务调度与回调接口
"""

from __future__ import annotations

import threading
import time
import traceback
import uuid
from typing import Any, Callable, Dict, List, Optional, Tuple

from engine import core, notation as nt
from engine.engine import EngineInfo, EngineSet, SearchRequest

REVIEW_PV_PLIES = 6
LOSS_KINDS = ('exact', 'at_least', 'at_most', 'uncertain', 'mate', 'below_top')


# --------------------------------------------------------------------------- #
# 一次后台搜索任务
# --------------------------------------------------------------------------- #

class SearchTask:
    """一次后台搜索。前端靠轮询它拿到实时的深度与评分。

    kind='engine-move' 的那次会落子，kind='analyze' 的那次不落子、只把
    排名线攒在 lines 里给人那一步打分。
    """

    def __init__(self, kind: str = 'engine-move'):
        self.id = uuid.uuid4().hex[:12]
        self.kind = kind            # engine-move / analyze
        self.status = 'running'     # running / done / error / skipped / discarded
        self.progress: Optional[Dict[str, Any]] = None
        self.result: Optional[Dict[str, Any]] = None
        self.error: Optional[str] = None
        self.started = time.time()
        self.stop_event = threading.Event()
        self.thread: Optional[threading.Thread] = None
        self.move: Optional[str] = None
        self.lines: List[Dict[str, Any]] = []
        self.subject: Optional[Dict[str, Any]] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            'id': self.id,
            'kind': self.kind,
            'status': self.status,
            'progress': self.progress,
            'result': self.result,
            'error': self.error,
            'elapsed': time.time() - self.started,
            'lines': list(self.lines),
            'subject': dict(self.subject) if self.subject else None,
        }


# --------------------------------------------------------------------------- #
# 主变推演与着法评分纯函数（无副作用，可独立测试）
# --------------------------------------------------------------------------- #

def _piece_at(board: str, i: int) -> Optional[str]:
    """第 i 格上的棋子字符；空格、越界、棋盘串里的填充格都算「没有子」。"""
    if not (0 <= i < len(board)):
        return None
    c = board[i]
    if c == '.' or c.upper() not in core.piece:
        return None
    return c


def _pv_playable(board: str, red_to_move: bool, m: Tuple[int, int]) -> bool:
    """这一手能不能落在 board 上 —— 只验起点有该方的子、落点不是自己的子。"""
    p = _piece_at(board, m[0])
    if p is None or (p.isupper() != red_to_move):
        return False
    q = _piece_at(board, m[1])
    return q is None or (q.isupper() != red_to_move)


def pv_detail(board: str, red_to_move: bool, pv_moves: Tuple[Tuple[int, int], ...]) -> List[Dict[str, str]]:
    """把主变翻译成前端能直接展示的样子（ICCS + 中文记谱）。"""
    out = []
    b, red = board, red_to_move
    for m in pv_moves:
        if not _pv_playable(b, red, m):
            break
        out.append({'iccs': nt.to_iccs(m), 'chinese': nt.to_chinese(b, m)})
        b = core.apply_move(b, red, m)
        red = not red
    return out


def _pv_first_capture(board: str, red_to_move: bool, pv: List[Dict[str, str]]) -> Optional[Dict[str, Any]]:
    """沿一条主变推到「第一次吃到子」为止；窗口里没吃到子就返回 None。"""
    b, red = board, red_to_move
    for ply, step in enumerate(pv or (), 1):
        if not isinstance(step, dict):
            break
        iccs, chinese = step.get('iccs') or '', step.get('chinese') or ''
        if not iccs or not chinese:
            break
        m = nt.from_iccs(iccs)
        if m is None or not _pv_playable(b, red, m):
            break
        victim = _piece_at(b, m[1])
        if victim is not None:
            if victim.upper() == 'K':
                return None
            return {
                'ply': ply,
                'iccs': iccs,
                'chinese': chinese,
                'by': 'red' if red else 'black',
                'captured': nt.PIECE_NAME[victim],
            }
        b = core.apply_move(b, red, m)
        red = not red
    return None


def pv_reason(board: str, red_to_move: bool, best_pv: List[Dict[str, str]], played_pv: List[Dict[str, str]]) -> Dict[str, Any]:
    """两条主变各自「第一次吃到子」的那一手。"""
    return {
        'best': _pv_first_capture(board, red_to_move, best_pv),
        'played': _pv_first_capture(board, red_to_move, played_pv),
    }


def _progress(info: EngineInfo, board: str, red_to_move: bool) -> Dict[str, Any]:
    """一层搜索结果 → 前端每 130ms 轮询读的那份进度。"""
    return {
        'depth': info.depth,
        'multipv': info.multipv,
        'bound': info.bound,
        'score': info.score,
        'eval_red': info.eval_red,
        'mate': info.mate,
        'mate_in': info.mate_in,
        'book': info.book,
        'nodes': info.nodes,
        'time': round(info.time, 3),
        'nps': info.nps,
        'pv': list(info.pv_iccs),
        'pv_detail': pv_detail(board, red_to_move, info.pv),
    }


def _line_record(info: EngineInfo, board: str, red_to_move: bool) -> Dict[str, Any]:
    """一条排名线 → 判分与界面共用的那一份 dict。"""
    mv = info.move
    return {
        'rank': int(info.multipv or 1),
        'iccs': nt.to_iccs(mv) if mv else '',
        'chinese': nt.to_chinese(board, mv) if mv else '',
        'score': info.score,
        'eval_red': info.eval_red,
        'mate': info.mate,
        'mate_in': info.mate_in,
        'bound': info.bound,
        'depth': info.depth,
        'nodes': info.nodes,
        'time': round(info.time, 3),
        'pv': pv_detail(board, red_to_move, info.pv),
    }


def _subject_of(game: Any, epoch: int) -> Dict[str, Any]:
    """「哪一局的哪一个局面」—— 判分要挂回去的那把键。"""
    return {
        'epoch': epoch,
        'board': game.board,
        'red_to_move': game.red_to_move,
        'ply': len(game.records),
        'fen': nt.to_fen(game.board, game.red_to_move),
    }


def _matches(subject: Optional[Dict[str, Any]], want: Dict[str, Any]) -> bool:
    """want 里那几个字段对不对得上（want 可以只带子集）。"""
    if not subject:
        return False
    return all(subject.get(k) == v for k, v in want.items())


def _bound_dir(bound: Optional[str]) -> set[str]:
    """这个分数能把真值顶到哪一边：'floor' = 真值不低于它，'ceil' = 不高于它。"""
    if bound == 'lowerbound':
        return {'floor'}
    if bound == 'upperbound':
        return {'ceil'}
    return {'floor', 'ceil'}


def grade_move(move_iccs: str, lines: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """把人走的这一手，对着同一个局面的排名线打个分。"""
    if not lines:
        return None
    best = lines[0]
    played = next((l for l in lines if l['iccs'] == move_iccs), None)

    out = {
        'status': 'ok' if played else 'outside',
        'depth': max(int(l.get('depth') or 0) for l in lines),
        'nodes': max(int(l.get('nodes') or 0) for l in lines),
        'time': max(float(l.get('time') or 0.0) for l in lines),
        'width': len(lines),
        'best_iccs': best['iccs'],
        'best_eval_red': best.get('eval_red'),
        'best_mate_in': best.get('mate_in'),
        'best_bound': best.get('bound'),
        'rank': played['rank'] if played else None,
        'played_iccs': move_iccs,
        'played_eval_red': played.get('eval_red') if played else None,
        'played_mate_in': played.get('mate_in') if played else None,
        'played_bound': played.get('bound') if played else None,
        'loss': None,
        'loss_kind': None,
        'lines': [dict(l, pv=list(l.get('pv') or [])[:REVIEW_PV_PLIES]) for l in lines],
    }

    if played is None:
        out['loss_kind'] = 'below_top'
        return out

    if best.get('mate_in') is not None or played.get('mate_in') is not None:
        out['loss_kind'] = 'mate'
        return out

    loss = int(best['score']) - int(played['score'])
    out['loss'] = loss
    best_dir = _bound_dir(best.get('bound'))
    played_dir = _bound_dir(played.get('bound'))
    lower_ok = 'floor' in best_dir and 'ceil' in played_dir
    upper_ok = 'ceil' in best_dir and 'floor' in played_dir
    if lower_ok and upper_ok:
        out['loss_kind'] = 'exact'
    elif lower_ok:
        out['loss_kind'] = 'at_least'
    elif upper_ok:
        out['loss_kind'] = 'at_most'
    else:
        out['loss_kind'] = 'uncertain'
    return out


# --------------------------------------------------------------------------- #
# 调度协调器类 (EngineCoordinator)
# --------------------------------------------------------------------------- #

class EngineCoordinator:
    """引擎异步调度与任务协调器。

    负责：
    1. 管理单线落子搜索 (SearchTask 'engine-move') 与多线判分 (SearchTask 'analyze')
    2. 维护 _engine_io 排他互斥锁，确保同一时刻只有一个引擎搜索在占用进程/置换表
    3. 支持外部安全熔断叫停（立即发送 UCI stop 唤醒阻塞的管道，并 drain 排空残留数据）
    """

    def __init__(self, engines: EngineSet):
        self.engines = engines
        # 引擎输入输出全局排他锁：内置置换表与子进程管道同一时刻只容得下一条搜索在跑
        self._engine_io = threading.Lock()
        self.task: Optional[SearchTask] = None
        self.analysis_task: Optional[SearchTask] = None

    def task_busy(self) -> bool:
        """引擎落子搜索是否正在运行。"""
        return self.task is not None and self.task.status == 'running'

    def analysis_busy(self) -> bool:
        """复盘多线判分搜索是否正在运行。"""
        t = self.analysis_task
        return t is not None and t.status == 'running'

    def stop_search(self, task_id: Optional[str] = None) -> bool:
        """请求停掉当前引擎出招搜索。"""
        if self.task is None:
            return False
        if task_id and self.task.id != task_id:
            return False
        if self.task.status == 'running':
            self.task.stop_event.set()
            self.engines.stop()
            return True
        if self.task.status in ('ok', 'done', 'stopped', 'discarded'):
            return True
        return False

    def stop_analysis(self) -> None:
        """叫停判分搜索。"""
        if self.analysis_busy():
            assert self.analysis_task is not None
            self.analysis_task.stop_event.set()
            self.engines.stop()

    def clear(self) -> None:
        """新对局或载入局面时清空任务。"""
        self.stop_search()
        self.stop_analysis()
        self.task = None
        self.analysis_task = None

    def same_subject(self, task: Optional[SearchTask], game: Any, epoch: int) -> bool:
        """校验任务分析的局面是否仍然是当前局面。"""
        return _matches(task.subject if task else None, _subject_of(game, epoch))

    def start_search(
        self,
        game: Any,
        epoch: int,
        settings: Dict[str, Any],
        on_complete: Callable[[SearchTask, Any, Optional[EngineInfo]], None],
        on_error: Optional[Callable[[SearchTask, Exception], None]] = None,
        on_finally: Optional[Callable[[SearchTask], None]] = None,
    ) -> SearchTask:
        """开启后台引擎走棋搜索。调用方需已持 session 锁。"""
        if self.task_busy():
            assert self.task is not None
            return self.task
        if game.is_over():
            return None

        # 引擎要出招了，先叫停低优先级的判分搜索
        self.stop_analysis()

        task = SearchTask('engine-move')
        self.task = task

        req = SearchRequest(
            board=game.board,
            red_to_move=game.red_to_move,
            game_history=tuple(game.boards),
            move_history_iccs=tuple(r['iccs'] for r in game.records),
            start_fen=getattr(game, 'start_fen', None),
            max_depth=settings['max_depth'],
            time_limit=settings['think_ms'] / 1000.0,
            stop=task.stop_event.is_set,
        )
        engine = self.engines.choose()
        start_board = req.board
        red_to_move = req.red_to_move

        def worker():
            last = None
            try:
                with self._engine_io:
                    for info in engine.search(req):
                        if info.multipv <= 1:
                            last = info
                        task.progress = _progress(info, start_board, red_to_move)
                        if task.stop_event.is_set():
                            break

                # 拟人呼吸节拍：避免浅层秒发导致子力弹射，保留真实对弈的落子呼吸感
                target_pacing = min(settings.get('think_ms', 1500) / 1000.0, 3.0)
                remaining = target_pacing - (time.time() - task.started)
                if remaining > 0 and not task.stop_event.is_set():
                    task.stop_event.wait(remaining)

                if not task.stop_event.is_set():
                    on_complete(task, last, start_board, red_to_move)
            except Exception as exc:
                traceback.print_exc()
                task.status = 'error'
                task.error = str(exc)
                if on_error:
                    on_error(task, exc)
            finally:
                if on_finally:
                    on_finally(task)

        task.thread = threading.Thread(target=worker, name='engine-search', daemon=True)
        task.thread.start()
        return task

    def start_analysis(
        self,
        game: Any,
        epoch: int,
        settings: Dict[str, Any],
    ) -> SearchTask:
        """开启一次多线判分搜索。调用方需已持 session 锁。"""
        task = SearchTask('analyze')
        task.subject = _subject_of(game, epoch)
        self.analysis_task = task

        req = SearchRequest(
            board=game.board,
            red_to_move=game.red_to_move,
            game_history=tuple(game.boards),
            move_history_iccs=tuple(r['iccs'] for r in game.records),
            start_fen=getattr(game, 'start_fen', None),
            max_depth=settings['analyze_depth'],
            time_limit=settings['analyze_ms'] / 1000.0,
            multipv=max(1, int(settings['analyze_width'])),
            use_book=False,
            stop=task.stop_event.is_set,
        )
        engine = self.engines.choose()
        board, red_to_move = req.board, req.red_to_move
        width = max(1, int(settings['analyze_width']))
        legal_root = frozenset(game.legal_moves())

        def worker():
            # 判分搜索如果 0.5s 抢不到锁则跳过，不强行等待阻塞走棋
            if not self._engine_io.acquire(timeout=0.5):
                task.status = 'skipped'
                task.result = {'status': 'busy', 'message': '引擎正忙，这一手先不判'}
                return
            try:
                by_rank = {}
                dropped = 0
                whole_layer = False

                def commit(lines: List[Dict[str, Any]], force: bool = False) -> bool:
                    nonlocal whole_layer
                    recs = sorted((ln for ln in lines if ln and ln.get('iccs')),
                                  key=lambda ln: ln['rank'])
                    if not recs or (len(recs) < width and not force):
                        return False
                    task.lines = recs[:width]
                    if len(recs) >= width:
                        whole_layer = True
                    return True

                for info in engine.search(req):
                    mv = info.move
                    if mv is None or mv not in legal_root:
                        dropped += 1
                        continue
                    rank = int(info.multipv or 1)
                    if rank <= 1:
                        commit(list(by_rank.values()))
                        by_rank = {}
                    by_rank[rank] = _line_record(info, board, red_to_move)
                    task.progress = _progress(info, board, red_to_move)
                    if len(by_rank) >= width:
                        commit(list(by_rank.values()))
                        by_rank = {}
                    if task.stop_event.is_set():
                        break

                if not whole_layer:
                    commit(list(by_rank.values()), force=True)

                task.result = {
                    'status': 'ok',
                    'engine': engine.name,
                    'width': len(task.lines),
                    'dropped': dropped,
                    'elapsed': round(time.time() - task.started, 3),
                    'stopped': task.stop_event.is_set(),
                }
                task.status = 'done'
            except Exception as exc:
                traceback.print_exc()
                task.status = 'error'
                task.error = str(exc)
            finally:
                self._engine_io.release()

        task.thread = threading.Thread(target=worker, name='analyze', daemon=True)
        task.thread.start()
        return task

    def maybe_analyze(
        self,
        game: Any,
        epoch: int,
        settings: Dict[str, Any],
    ) -> Optional[SearchTask]:
        """轮到人类走棋时，适时在后台分析当前局面。"""
        if not settings.get('analyze'):
            return None
        if game.is_over() or game.engine_to_move or self.task_busy():
            return None
        if self.same_subject(self.analysis_task, game, epoch):
            return self.analysis_task
        if self.analysis_busy():
            self.stop_analysis()
        return self.start_analysis(game, epoch, settings)
