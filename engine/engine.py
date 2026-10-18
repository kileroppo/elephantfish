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
    multipv      根着法排名，1 起；一层可以交回好几条，按 ``score`` 从好到差排
    bound        这一条的分数是 ``exact`` / ``lowerbound`` / ``upperbound``

于是调用方一次翻转都不用写。而「这个分数能不能当真值用」也不再是各自去猜的事：
排名与界标两边用同一套词，讲解层才敢把「差多少」说出口。

分数单位约定（和参考系同等重要，别再让下游去猜）
------------------------------------------------------------------
两个引擎的「分」压根不是一种东西：内置子力价值表里一兵 = 44
（``core.piece['P']``，见 ``elephantfish.py:24``），皮卡鱼按 UCI 惯例
输出 centipawn，一兵 = 100。**接缝只往外说 centipawn**，折算在每个 adapter
自己的 ``pawn_value`` 里声明并完成 —— 理由和 ``flip_move`` 一模一样：
谁产生这个数，谁才知道它的单位，让下游按固定除数去除，猜错单位的后果是
「让一车被显示成一步杀」，而且不报任何错。

杀棋也不能再用一个大数冒充。``mate_in`` 单独带**还有几步杀**（步数，
非负；0 = 已经被杀死 / 无着可走），**方向一律看 ``score`` / ``eval_red``
的符号**，避免同一个事实带两次符号、两处可能互相矛盾。杀棋时 ``score``
被钉在 ``MATE_CP`` 这个锚点上，只为让评分条知道该打满了。
"""

from __future__ import annotations

import dataclasses
from typing import Callable, Iterator, Optional, Protocol, Tuple

from . import core
from . import notation as nt
from .pikafish_engine import PikafishEngine
from .search import Searcher, EXACT, LOWER, UPPER

# 设置里的引擎偏好值（``state.settings.engine_type`` 用这套词）
PIKAFISH = 'pikafish'
BUILTIN = 'builtin'
PREFERENCE_NAMES = (PIKAFISH, BUILTIN)

# 分数的可信程度（UCI 的原词）。``upperbound`` 的意思是「真值只会更差」，
# ``lowerbound`` 是「真值只会更好」，``exact`` 才是搜出来的值。
BOUND_EXACT = 'exact'
BOUND_LOWER = 'lowerbound'
BOUND_UPPER = 'upperbound'
BOUND_NAMES = (BOUND_EXACT, BOUND_LOWER, BOUND_UPPER)

# 内置搜索层用 ``search`` 里那三个整数旗标标界（它本来就是置换表的旗标），
# 皮卡鱼给的是 UCI 原词。两套词只在 ``_normalize`` 里收敛一次，
# 接缝外面只剩 ``BOUND_NAMES`` 一种 —— 别让调用方自己去猜哪边给哪种。
_FLAG_TO_BOUND = {EXACT: BOUND_EXACT, LOWER: BOUND_LOWER, UPPER: BOUND_UPPER}

Move = Tuple[int, int]

# 接缝唯一致力的单位：centipawn，一兵 = 100。
CP_PAWN = 100
# 内置引擎自己的价值表里一兵是多少 —— 从 ``core`` 的子力表取，不写死，
# 免得哪天调了子力价值、折算系数还在原地当个假数。
BUILTIN_PAWN = core.piece['P']
# 杀棋在 cp 轴上的锚点：比任何子力优势都大就够，真相在 mate_in。
MATE_CP = 10000


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
    # 根着法要报几条排名线（含 1）。1 就是今天的老行为：每层只交一条、只有最优那手。
    # 大于 1 时两个 adapter 都要按层交回若干条，并各自标清分数是精确值还是界。
    multipv: int = 1
    # 节点预算。这是「可复现的 A/B」唯一可用的刻度：``time_limit`` 会随机器负载漂
    # 2~3 倍，``max_depth`` 会随战术漂（一连串将军就能把深度顶满），只有展开的节点数
    # 两边同口径、跨机器复现得了。两个 adapter 都必须认它 —— 内置在 ``search._tick``
    # 里判，皮卡鱼发 UCI 原生的 ``go nodes N``。``None`` = 不设预算。
    max_nodes: Optional[int] = None
    # 要不要吃开局库。**调用方必须显式说**：老 arena 就是被 ``think()`` 的默认值
    # （开书）坑了 —— 带书的一侧静默赢在不带书的一侧头上，量的是开局库不是被测改动。
    # 接缝这里的 ``True`` 只是把产品走棋的既有行为钉在原位（改了界面会退化），
    # 度量（``tools/arena2.py``）两侧一律显式传 ``False``。
    # 已知不对称，说清楚而不是藏起来：内置这边 True/False 走的是两条码路
    # （查 GLOBAL_BOOK vs 真搜索），皮卡鱼这边根本没有这本库，True 也只是
    # 「维持它本来的无书行为」。所以 use_book=True 时两侧并不等价 ——
    # 只有都传 False 才是可比的，这正是 arena2 强制的。
    use_book: bool = True
    # 返回 True 表示「外面要你现在就停」。两个 adapter 都必须认它。
    stop: Optional[Callable[[], bool]] = None


@dataclasses.dataclass(frozen=True)
class EngineInfo:
    """一层搜索里一条排名线的结果。

    ``multipv`` 是根着法排名，从 1 起（1 = 这一层的最优手）。``bound`` 说的是
    这个分数**能不能当真值用**：``upperbound`` 是「真值只会更差」（对 alpha 试探
    失败，压根没打算把它搜准），``lowerbound`` 是「真值只会更好」（把 beta 打穿了），
    ``exact`` 才是全窗搜出来的值。

    界标不是锦上添花，是后面做讲解要用的：「你这一手排第 3，比最优差 1.4 兵」
    这句话里，如果第 3 名的分数其实是个上界，那 1.4 只是个下限 —— 把界当精确值
    报给学员就是在骗他。

    字段名与参考系是接缝的一部分：两个 adapter 必须产出同一套，
    测试也只认这一套（见 ``tools/verify.py`` 的 H 段）。

    ``score`` / ``eval_red`` 一律是 **centipawn**（一兵 = 100）；
    ``mate_in`` 非 None 时它们被钉在 ±``MATE_CP``，此时只有符号有意义，
    距离读 ``mate_in``。
    """

    depth: int
    move: Optional[Move]
    score: int            # 侧方视角，centipawn
    eval_red: int         # 红方视角，centipawn
    mate: bool
    nodes: int
    time: float
    nps: int
    pv: Tuple[Move, ...] = ()
    pv_iccs: Tuple[str, ...] = ()
    # 还有几步杀（非负步数，0 = 已被杀/无着可走）；None = 这不是杀棋分。
    # 谁赢看 score 的符号，不在这里再带一次方向。
    mate_in: Optional[int] = None
    # 这一层是开局库直接给的着法，不是搜出来的。以前它在 ``_normalize``
    # 里被丢掉，于是界面分不清「背下来的」和「算出来的」。
    book: bool = False
    multipv: int = 1      # 根着法排名，1 起
    bound: str = BOUND_EXACT


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
    多线排名靠搜索层现成的一趟根遍历（``Searcher._search_root_multipv``），
    旗标是 ``search`` 里那三个整数，翻成接缝的字符串只在 ``_normalize`` 做一次。
    节点预算与开局库都从 ``req`` 明说（``max_nodes`` / ``use_book``），
    不再让 ``Searcher`` 的默认值替调用方做主。
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
                root_is_red=req.red_to_move,
                multipv=req.multipv,
                use_book=req.use_book,
                max_nodes=req.max_nodes):
            # Searcher 的 move 是「相对走子方」的：黑方走棋时整个棋盘转过，
            # 所以只有 black to move 才需要翻回绝对坐标。pv 已经是绝对坐标。
            # 分母同样是它自己的事：内置价值表里一兵是 44。
            yield _normalize(info, req.red_to_move,
                             flip_move=not req.red_to_move,
                             pawn_value=BUILTIN_PAWN)


# --------------------------------------------------------------------------- #
# adapter 二：皮卡鱼 UCI 子进程
# --------------------------------------------------------------------------- #

class PikafishAdapter:
    """``PikafishEngine`` 的 adapter。

    要吸收的差异：输入是「棋盘串 + ICCS 棋谱 + start_fen」而非 ``Position``；
    中断靠给子进程发 ``stop``；``move``/``pv`` 本来就是绝对坐标，
    但多一个 ``pv_iccs`` 字段。另外它还兼着进程生命周期（可用性、二进制路径、线程与哈希）。
    多线排名是 UCI 的 ``setoption name MultiPV``，界标直接来自 ``info`` 行里的
    ``lowerbound`` / ``upperbound`` —— 这两个词皮卡鱼说的是现成的，照抄就行。
    节点预算同样不用自己造：UCI 原生就有 ``go nodes N``。
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
                start_fen=req.start_fen,
                multipv=req.multipv,
                max_nodes=req.max_nodes):
            # 皮卡鱼的 move 来自 ICCS，本来就是绝对坐标，永远不翻；
            # 它的分本来就是 centipawn，所以分母用默认值，不用折算。
            # req.use_book 在这里**故意不往下传**：皮卡鱼没有这本开局库。
            # 见 SearchRequest.use_book 的注释 —— 只有两侧都 False 才可比。
            yield _normalize(info, req.red_to_move, flip_move=False,
                             pawn_value=CP_PAWN)


def _normalize(raw: dict, red_to_move: bool, flip_move: bool,
               *, pawn_value: int = CP_PAWN) -> EngineInfo:
    """把任意一个 adapter 的原始一层结果翻成接缝的参考系。

    ``flip_move`` 由 adapter 自己声明，不靠字段有无或走子方去猜 ——
    猜错会**静默**走错坐标（返回一手对不上局面的棋，不报任何错）。
    内置 ``Searcher`` 的 move 是相对走子方的，黑方走棋时才需要翻；
    皮卡鱼的 move 来自 ICCS，永远不需要翻。

    ``pawn_value`` 同理，也由 adapter 声明：它是「这个引擎的分母是多少」。
    内置传 ``BUILTIN_PAWN``（一兵 44），皮卡鱼用默认值（本来就是 centipawn）。

    ``pv`` 两个 adapter 都已经是绝对坐标，不用动。

    排名与界标两边给的词不一样：内置是 ``search`` 里那三个整数旗标，皮卡鱼是
    UCI 原词。缺省一律按「单线 + 精确值」收 —— 开局库那一手、以及一层 info
    都没出就收到 ``bestmove`` 的极端情况，本来就没有排名和界可标。
    """
    move = raw.get('move')
    if flip_move and move is not None:
        move = core.flip_move(move)

    bound = raw.get('bound')
    if isinstance(bound, int):
        bound = _FLAG_TO_BOUND.get(bound, BOUND_EXACT)
    pv = tuple(raw.get('pv') or ())
    pv_iccs = tuple(raw.get('pv_iccs') or ()) or tuple(nt.to_iccs(m) for m in pv)

    mate_in = raw.get('mate_in')
    raw_score = int(raw.get('score') or 0)
    if mate_in is None:
        # 单位折算只发生在这里：进来的是各家自己的分，出去的一律 centipawn。
        score = int(round(raw_score * CP_PAWN / pawn_value))
    else:
        # 杀棋：分数退化成方向，距离交给 mate_in。内置引擎的方向在原始分的
        # 正负里；皮卡鱼杀棋时没有 cp 分，所以由它自己声明 mate_sign。
        sign = raw.get('mate_sign')
        if sign is None:
            sign = 1 if raw_score > 0 else -1
        score = MATE_CP if sign > 0 else -MATE_CP
        mate_in = abs(int(mate_in))

    return EngineInfo(
        depth=int(raw.get('depth') or 0),
        move=move,
        score=score,
        eval_red=score if red_to_move else -score,
        mate=mate_in is not None,
        nodes=int(raw.get('nodes') or 0),
        time=float(raw.get('time') or 0.0),
        nps=int(raw.get('nps') or 0),
        pv=pv,
        pv_iccs=pv_iccs,
        mate_in=mate_in,
        book=bool(raw.get('book')),
        multipv=int(raw.get('multipv') or 1),
        bound=bound or BOUND_EXACT,
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
