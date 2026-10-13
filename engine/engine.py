# -*- coding: utf-8 -*-
"""引擎接缝。

仓库里有两个真实 adapter：内置纯 Python 搜索（``search.Searcher``）和
皮卡鱼 UCI 子进程（``pikafish_engine.PikafishEngine``）。**两个 adapter 意味着
这是一条真实接缝，不是假想的** —— 但接缝本身一直没画出来，于是「现在用的是
哪个引擎」这个事实泄漏到 ``server/app.py`` 的六处判断里，而两边的差异
（坐标参考系、pv 字段名、怎么喊停、要不要棋谱历史）散在调用点上。

这个模块把差异关进 adapter，对外只给一个接口：

    Engine.search(SearchRequest) -> Iterator[EngineInfo]

调用方（和测试）只需要知道这一句。真假引擎可以互换 —— 这正是接缝的用处。

参考系约定（接缝的核心，别再让调用方去猜）
------------------------------------------------------------------
``Searcher`` 内部是「引擎视角」：黑方走棋时整个棋盘被 180° 旋转，
所以它的 ``move`` 是相对走子方的，而 ``principal_variation`` 又特意翻回了
绝对坐标 —— 这一个不对称，就是 ``server/app.py`` 里那段
``abs_move = engine_move if red_to_move else flip_move(engine_move)``
存在的原因。接缝把它统一掉：

    move / pv    绝对坐标（与 ``game.board`` 同一个系），可直接喂给 ``Game.push``
    score        侧方视角（正 = 对当前走子方有利），前端直接展示
    eval_red     红方视角（正 = 对红方有利），直接进棋谱与战绩

于是调用方一次翻转都不用写。
"""

from __future__ import annotations

import dataclasses
from typing import Callable, Iterator, Optional, Protocol, Tuple

from . import core
from . import notation as nt
from .pikafish_engine import PikafishEngine
from .search import Searcher

# 设置里的引擎偏好值（``state.settings.engine_type`` 用这套词）
PIKAFISH = 'pikafish'
BUILTIN = 'builtin'
PREFERENCE_NAMES = (PIKAFISH, BUILTIN)

Move = Tuple[int, int]


@dataclasses.dataclass(frozen=True)
class SearchRequest:
    """一次搜索的全部输入。adapter 只读，不改。"""

    board: str
    red_to_move: bool
    # 历史局面串。内置引擎靠它做重复检测（长将判负要用）。
    game_history: Tuple[str, ...] = ()
    # 历史走法的 ICCS 串。UCI 引擎靠它还原全部棋谱、吃子计数与长打状态。
    move_history_iccs: Tuple[str, ...] = ()
    # 非初始局面时的起始 FEN（UCI 的 ``position fen`` 要用）。
    start_fen: Optional[str] = None
    max_depth: int = 20
    time_limit: float = 2.5
    # 返回 True 表示「外面要你现在就停」。两个 adapter 都必须认它。
    stop: Optional[Callable[[], bool]] = None


@dataclasses.dataclass(frozen=True)
class EngineInfo:
    """一层搜索的结果。

    字段名与参考系是接缝的一部分：两个 adapter 必须产出同一套，
    测试也只认这一套（见 ``tools/verify.py`` 的 H 段）。
    """

    depth: int
    move: Optional[Move]
    score: int            # 侧方视角
    eval_red: int         # 红方视角
    mate: bool
    nodes: int
    time: float
    nps: int
    pv: Tuple[Move, ...] = ()
    pv_iccs: Tuple[str, ...] = ()


class Engine(Protocol):
    """引擎接缝。

    ``new_game`` 是生命周期，不是搜索：内置引擎借它丢掉置换表，
    UCI 引擎借它发 ``ucinewgame``。两边都实现，调用方就不用分类讨论。
    """

    name: str

    def new_game(self) -> None:
        ...

    def search(self, req: SearchRequest) -> Iterator[EngineInfo]:
        ...


# --------------------------------------------------------------------------- #
# adapter 一：内置纯 Python 引擎
# --------------------------------------------------------------------------- #

class BuiltinEngine:
    """``Searcher`` 的 adapter。

    要吸收的差异：输入是「引擎视角」的 ``Position``（黑方走棋时棋盘转过），
    输出里 ``move`` 是相对坐标而 ``pv`` 是绝对坐标，``pv_iccs`` 压根没有。
    """

    name = 'elephantfish'

    def __init__(self, searcher: Optional[Searcher] = None):
        self.searcher = searcher or Searcher()

    def new_game(self) -> None:
        self.searcher = Searcher()

    def search(self, req: SearchRequest) -> Iterator[EngineInfo]:
        pos = core.make_position(req.board, req.red_to_move)
        for info in self.searcher.search(
                pos,
                max_depth=req.max_depth,
                time_limit=req.time_limit,
                game_history=list(req.game_history),
                external_stop=req.stop,
                root_is_red=req.red_to_move):
            # Searcher 的 move 是「相对走子方」的：黑方走棋时整个棋盘转过，
            # 所以只有 black to move 才需要翻回绝对坐标。pv 已经是绝对坐标。
            yield _normalize(info, req.red_to_move,
                             flip_move=not req.red_to_move)


# --------------------------------------------------------------------------- #
# adapter 二：皮卡鱼 UCI 子进程
# --------------------------------------------------------------------------- #

class PikafishAdapter:
    """``PikafishEngine`` 的 adapter。

    要吸收的差异：输入是「棋盘串 + ICCS 棋谱 + start_fen」而非 ``Position``；
    中断靠给子进程发 ``stop``；``move``/``pv`` 本来就是绝对坐标，
    但多一个 ``pv_iccs`` 字段。另外它还兼着进程生命周期（可用性、二进制路径、线程与哈希）。
    """

    name = 'pikafish'

    def __init__(self, engine: Optional[PikafishEngine] = None, **kwargs):
        self.engine = engine or PikafishEngine(**kwargs)

    @property
    def available(self) -> bool:
        return self.engine.is_available

    @property
    def binary_path(self) -> Optional[str]:
        return self.engine.binary_path

    def new_game(self) -> None:
        if self.available:
            self.engine.new_game()

    def set_options(self, threads: Optional[int] = None,
                    hash_mb: Optional[int] = None) -> None:
        self.engine.set_options(threads=threads, hash_mb=hash_mb)

    def search(self, req: SearchRequest) -> Iterator[EngineInfo]:
        for info in self.engine.search(
                req.board,
                req.red_to_move,
                move_history_iccs=list(req.move_history_iccs),
                max_depth=req.max_depth,
                time_limit=req.time_limit,
                external_stop=req.stop,
                start_fen=req.start_fen):
            # 皮卡鱼的 move 来自 ICCS，本来就是绝对坐标，永远不翻
            yield _normalize(info, req.red_to_move, flip_move=False)


def _normalize(raw: dict, red_to_move: bool, flip_move: bool) -> EngineInfo:
    """把任意一个 adapter 的原始一层结果翻成接缝的参考系。

    ``flip_move`` 由 adapter 自己声明，不靠字段有无或走子方去猜 ——
    猜错会**静默**走错坐标（返回一手对不上局面的棋，不报任何错）。
    内置 ``Searcher`` 的 move 是相对走子方的，黑方走棋时才需要翻；
    皮卡鱼的 move 来自 ICCS，永远不需要翻。

    ``pv`` 两个 adapter 都已经是绝对坐标，不用动。
    """
    move = raw.get('move')
    if flip_move and move is not None:
        move = core.flip_move(move)

    pv = tuple(raw.get('pv') or ())
    score = int(raw.get('score') or 0)
    pv_iccs = tuple(raw.get('pv_iccs') or ()) or tuple(nt.to_iccs(m) for m in pv)
    return EngineInfo(
        depth=int(raw.get('depth') or 0),
        move=move,
        score=score,
        eval_red=score if red_to_move else -score,
        mate=bool(raw.get('mate')),
        nodes=int(raw.get('nodes') or 0),
        time=float(raw.get('time') or 0.0),
        nps=int(raw.get('nps') or 0),
        pv=pv,
        pv_iccs=pv_iccs,
    )


# --------------------------------------------------------------------------- #
# 两个 adapter + 「选哪个」的规则
# --------------------------------------------------------------------------- #

class EngineSet:
    """手里的一组引擎，以及「现在该用谁」。

    这是「降级逻辑在哪」的唯一答案。以前它写在 ``Session.__init__``、
    ``start_search``、``state()``、``/api/health``、``act_settings``、``act_new``
    六处，各自重判一遍 ``engine_type == 'pikafish' and is_available``。
    现在只有 ``active`` 一个地方知道。

    （那六处里的前五处现属 ``server/session.py`` 的 ``GameSession``，最后两处
    即它的 ``update_settings`` / ``new_game``。）
    """

    def __init__(self, builtin, pikafish=None, prefer: str = PIKAFISH):
        self.builtin = builtin
        self.pikafish = pikafish
        self._prefer = prefer if prefer in PREFERENCE_NAMES else BUILTIN

    # ---- 偏好 ---------------------------------------------------------- #

    @property
    def preference(self) -> str:
        """用户选的引擎（``pikafish`` / ``builtin``）。"""
        return self._prefer

    def set_preference(self, name) -> bool:
        """设置偏好。名字不认就原样不动，返回是否接受 ——
        校验规则只有这一份，别再让 HTTP 层自己判。"""
        name = str(name or '').lower()
        if name not in PREFERENCE_NAMES:
            return False
        self._prefer = name
        return True

    def available(self, name: str) -> bool:
        if name == PIKAFISH:
            return bool(self.pikafish and self.pikafish.available)
        return True

    # ---- 实际生效的引擎 ------------------------------------------------ #

    @property
    def active_engine(self) -> Engine:
        """实际会跑搜索的那个 adapter。降级只在这里发生。"""
        if self._prefer == PIKAFISH and self.available(PIKAFISH):
            return self.pikafish
        return self.builtin

    @property
    def active(self) -> str:
        """实际生效引擎在**设置词表**里的名字（``pikafish`` / ``builtin``）。

        注意与 ``Engine.name`` 的区别：接缝上内置引擎自报 ``elephantfish``
        （界面上要显示的名字），而设置里那个字段的取值一直是 ``builtin``。
        两套词都是既有的 HTTP 契约，谁都不能改，所以在这里一次性映射掉。
        """
        return PIKAFISH if self.active_engine is self.pikafish else BUILTIN

    @property
    def pikafish_path(self) -> Optional[str]:
        return self.pikafish.binary_path if self.pikafish else None

    def choose(self) -> Engine:
        return self.active_engine

    # ---- 生命周期 ------------------------------------------------------ #

    def new_game(self) -> None:
        """新对局：两边都清一遍，免得把上一局的知识带进来。"""
        self.builtin.new_game()
        if self.pikafish:
            self.pikafish.new_game()

    def set_options(self, threads: Optional[int] = None,
                    hash_mb: Optional[int] = None) -> None:
        if self.pikafish:
            self.pikafish.set_options(threads=threads, hash_mb=hash_mb)


def default_engines(prefer: str = PIKAFISH, threads: int = 2,
                    hash_mb: int = 64) -> EngineSet:
    """真实环境用的一组引擎。

    测试要注入假引擎，直接 ``EngineSet(builtin=FakeEngine(), pikafish=None)``
    即可 —— 依赖是接受进来的，不是在这里 new 出来的。
    """
    return EngineSet(
        builtin=BuiltinEngine(),
        pikafish=PikafishAdapter(threads=threads, hash_mb=hash_mb),
        prefer=prefer,
    )
