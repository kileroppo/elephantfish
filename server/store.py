# -*- coding: utf-8 -*-
"""存档 —— 把「正在下的这一局」写成能拿去学习的那副样子。

后面所有跟「长进」有关的事都要从这份存档出发：给每一步人的棋判分、攒错题本、
数哪套开局在他手上输得多、把棋谱喂回 arena2 对拍。那些都需要同一样东西 ——
**按局面索引的、有序的、能重放的棋谱**。所以这里存的不是「界面上看到的样子」，
而是那副可以被重放的最小真相。

**为什么是投影，不是事件日志**

想过另一种写法：每落一步往库里 append 一行，悔棋时删掉，载入时清表。那是把
同一份真值写两遍，而这两遍会在三个地方对不齐 —— 悔棋只退一半、搜索在飞时局面
被换掉那步直接丢弃、认输之后又录进来一步。对不齐的存档不会报错，它只是**从此
每一步都差一行**，等到做错题本时才发现整局都对不上，那时已经没救了。

投影反过来：库里的每一局永远等于 ``game.records``，``sync_game()`` 把这一局的
plies **整个重写一遍**。写错也活不过下一步，因为下一步会把它盖掉。代价是一步棋
重插几十行 —— 一局棋最多一百多手，每手十几字节，这个数字不值得优化。

**为什么真值是 ``start_fen`` + 有序 ICCS**

因为那是 UCI 引擎、开局库、对拍脚本三者都认的格式。逐格的棋盘串只有当前这个
界面看得懂，存进来等于存一份只有自己能读的码。``plies.fen_before``（走这一步时
面对的局面）是**派生列**：回放一遍就有。留着它不是省那点算力，是因为「这道题
你错过几次」是按局面问的，而不是按第几手问的。

**ICCS 是身份，中文记谱是显示**

``chinese`` 会同音（两颗兵都能写成「兵三进一」），拿它当键迟早串棋。所有关联
都走 ``iccs``。

**写在哪**：每个 ``with self.lock:`` 作用域的**最后一条语句**。锁内写才谈得上
一致 —— 锁外写会读到一半的棋谱。见 ``server/session.py`` 里那几处 ``sync_game``。

**关掉与换地方**：``EF_STORE=off`` 整个关掉（自检里要验证「关档不许把下棋弄坏」），
``EF_STORE_PATH`` 指到别的文件（自检要打到临时库上，不许污染 ``data/``）。

**写失败不许把棋下停**：磁盘满、库被别的进程锁住，都不该让人手上这一局没了。
所以异常在 ``sync_game`` 的边界上吞掉，但**计一次数** —— 静默吞掉正是「存档悄悄
不再长」这种事故最好的藏身处，``tools/verify.py`` 的 L 段会盯着 ``errors`` 恒为 0。

**读侧：错题本**（``mistake_book``）跨所有对局把「人走的、带判分的」那些手按
``fen_before`` 聚在一起，回答「这个局面你错过几次、正解是哪一手」。它**只读**：
不写表、不在对局路径上加任何东西、也不新造事件日志 —— 判分早就整份存在
``plies.review`` 里了，这一步只是把它读出来。聚合在 Python 里做（读 JSON 那条路
通），不为此动 schema。「算不算错」的门槛只写在 ``review_verdict`` 一处，
证不出「这一手确实更差」的那些（``at_most`` / ``uncertain`` / ``below_top`` /
比不出距离的杀棋）一律归到「看不准，不计入」，并在返回里按 loss_kind 如实给出。

**读侧：逐手回放**（``recent_games`` / ``game_replay``）答的是错题本答不了的另一半：
「那把我到底是在哪儿错的」。错题本给的是**局面**，回放给的是**那一局** —— 人要把
一次漏着重新摆上盘，需要的是「从这一局第一手起，一手手走到那个局面」。它要的全部
真值本来就已经在库里了（``games.start_fen`` + 有序 ``plies.iccs`` —— 当初把真值存成
这两个就是为了这一刻），所以这一步仍然**只读**：不写表、不加列、不在会话锁上挂
任何事物。``plies.review`` 在这里依旧是一整份不透明的 JSON，读侧只负责原样搬运，
判分里有什么键由写的那一侧说了算。

**这两个读接口凭什么算「能摆回盘上」**：``tools/verify.py`` 的 O 段拿真规则层把
存档里的每一手重放一遍 —— 从 ``start_fen`` 出发，逐手 ``plies.iccs`` 验一次合法性、
落一次子，要求算出来的局面与那一行存的 ``fen_before`` 逐字符相同。重放对不上不是
「显示有点问题」，是**存档本身在骗人**：那种事不会报错，它只会让回放里每一步都差
一个子，而人正是要靠这些局面对自己讲「你当时该走哪」。
"""

from __future__ import annotations

import json
import os
import sqlite3
import threading
import time
import traceback

from engine import notation as nt

# 默认落在仓库根的 data/ 下：和 data/fen/ 那个语料目录是同一个意思 ——
# 都是「越用越值钱、不该跟着代码走」的东西。
DEFAULT_RELPATH = os.path.join('data', 'elephantfish.sqlite')

SCHEMA = """
CREATE TABLE IF NOT EXISTS games (
    game_id      TEXT PRIMARY KEY,
    -- 真值两件套：起点 + 有序棋谱。局面是算出来的，不是存出来的。
    start_fen    TEXT NOT NULL,
    engine_side  TEXT NOT NULL,
    -- play = 正常开的一局；setup = 排局/补棋摆出来的局。
    -- 后者不是同一件事：它的「成绩」不能混进战绩里算胜率。
    source       TEXT NOT NULL,
    opened_at    REAL NOT NULL,
    updated_at   REAL NOT NULL,
    ply_count    INTEGER NOT NULL,
    -- 下面三列全是派生值，留着是为了列表页不用回放整局。
    fen_now      TEXT NOT NULL,
    state        TEXT,
    winner       TEXT,
    reason       TEXT,
    -- 引擎视角的胜负：wins / losses / draws；还没结束就是 NULL。
    outcome      TEXT
);

CREATE TABLE IF NOT EXISTS plies (
    game_id     TEXT NOT NULL REFERENCES games(game_id) ON DELETE CASCADE,
    ply         INTEGER NOT NULL,
    side        TEXT NOT NULL,
    -- by 分得开「谁走的」：学习只挑人的那部分。
    by          TEXT NOT NULL,
    iccs        TEXT NOT NULL,
    chinese     TEXT NOT NULL,
    piece       TEXT,
    captured    TEXT,
    gives_check INTEGER NOT NULL,
    mate        INTEGER NOT NULL,
    -- 红方视角的 centipawn（接缝唯一的单位）。NULL = 这一步没有评估，
    -- 今天确实有：人录的那一步还没接上判分。
    eval_red    INTEGER,
    mate_in     INTEGER,
    depth       INTEGER,
    think_time  REAL,
    -- 走这一步时面对的局面（派生列，见模块开头）。
    fen_before  TEXT NOT NULL,
    -- 这一步的判分（JSON 文本），只有人走的那一步才有，见 session.grade_move。
    -- 整份存而不是只存 loss：错题本要拿正解那条主变讲「你该走哪」，
    -- 而 loss_kind 要留着 —— 把「至少差 1.4 兵」讲成「差 1.4 兵」是骗人。
    -- NULL = 没判过（判分关着、引擎那一步、或那一手没有排名线可对）。
    -- 这与「判了但差值未知」不是一回事，后者 review 里有 status=outside。
    review      TEXT,
    PRIMARY KEY (game_id, ply)
);

-- 跨局的累计账（引擎思考了多少手、多少节点、赢了几局）。
-- 键值表而不是固定列：这本账会长，而每加一列都要动一次建表语句。
CREATE TABLE IF NOT EXISTS agg_stats (
    key   TEXT PRIMARY KEY,
    value REAL NOT NULL
);

-- 实训营学员通关与棋力精通度档案
CREATE TABLE IF NOT EXISTS training_progress (
    puzzle_id       TEXT PRIMARY KEY,
    category        TEXT NOT NULL,
    status          TEXT NOT NULL,
    attempts        INTEGER NOT NULL DEFAULT 0,
    hints_used      INTEGER NOT NULL DEFAULT 0,
    first_try_pass  INTEGER NOT NULL DEFAULT 0,
    last_cleared_at REAL,
    updated_at      REAL NOT NULL
);
"""


def resolve_path():
    """该把库存哪儿。``None`` 表示「这一进程不存档」。"""
    mode = (os.environ.get('EF_STORE') or '').strip().lower()
    if mode in ('off', '0', 'no', 'none'):
        return None
    override = (os.environ.get('EF_STORE_PATH') or '').strip()
    if override:
        return override
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(root, DEFAULT_RELPATH)


_STORES: dict = {}
_STORES_LOCK = threading.Lock()

# 「没传参数」这个信息本身要用一个独一无二的对象表达 —— None 不行，
# 因为 None 是合法的路径值（= 关掉存档）。
_MISSING = object()


def open_store(path=_MISSING):
    """按路径取存档，同一路径进程内只开一条连接。

    参数缺省才去读环境变量 —— 自检换过 ``EF_STORE_PATH`` 之后，不该被上一个
    调用点已经缓存下来的连接拖回老库。
    """
    if path is _MISSING:
        path = resolve_path()
    with _STORES_LOCK:
        store = _STORES.get(path)
        if store is None:
            store = _STORES[path] = Store(path)
        return store


# --------------------------------------------------------------------------- #
# 错题本：按**局面**把历次判分聚在一起（只读）
# --------------------------------------------------------------------------- #
#
# 判分讲的是「这一手在第几名、差几兵」，学习要问的却是「**这个局面**你错过几次、
# 正解是哪一手」。同一类局面反复错，才是值得重做的题。所以这里跨所有对局按
# ``plies.fen_before`` 聚合 —— 那一列存的就是「走这一步面对的局面」，而且
# ``nt.to_fen`` 交回的串里 halfmove/fullmove 恒为 ``0 1``（见 notation.py），
# 局号与步数都不参与比较：同一个位置在不同局、不同步数上会聚成同一道题。
#
# **这一段只读**。它不写库、不在对局路径上挂任何东西、也不新造事件日志：判分早就
# 整份躺在 ``plies.review`` 里（存它的那天就写明了「后面要拿它做错题本」），这里
# 只是把它读出来聚合。聚合在 Python 里做 —— 读 JSON 那条路是通的，所以不为此动
# schema、不加生成列：为一种读法去改写入侧的形状，是让查询替存档做主。
#
# 「算不算错」这道门槛**只写在 ``review_verdict`` 这一处**，其余全从它派生：
#
#   exact      两侧都是全窗精确值 —— 证得出，计入。
#   at_least   真值只会更大：第 1 名是下界或精确值、人那手是上界或精确值，于是
#              ``loss > 0`` 时「这一手确实更差」已经证到了，只是**大小**是下界。
#              计入 —— 措辞那一侧本来就有「至少」兜着（``format.ts`` 的
#              ``gradeLabel``），这句话在错题本里同样是真的。
#              —— 这里与「只计 exact」的原方案不同，理由就是上面那两行：把
#              at_least 挡在门外并不更保守，它挡掉的是**已经证出来**的漏着。
#   at_most    真值只会更小，那个正数可能压根是 0 甚至负的 —— 不计入。
#   uncertain  两个界方向互相抵消，什么都没证出来 —— 不计入。
#   below_top  连人这一手自己的分都没搜出来 —— 不计入。
#   mate       不做 centipawn 减法，只比杀棋距离：证得出「本来能将死对方却走了
#              别的」或「本来能撑更久却撑短了」才计入，两边都给不出距离就不计入。
#              单独一档（``mate_misses``）—— 它改变的是性质而不是程度，跟兵数
#              不是同一把尺。
#
# 一句话：宁可少报几题，也不许把**没证出来**的比较报成错题；at_most / uncertain /
# below_top / 比不出距离的杀棋一律归到「看不准，不计入」（blurred），并按
# loss_kind 如实出现在返回里。

MATE_MISS_WEIGHT = 1000       # 杀棋那一档里，「错过杀」比「慢一步杀 / 少撑几步」压得重

# 错题本一次最多列几道题。每题整份带着「最差那次」的判分（措辞要让前端读），
# 条数封顶才让这份响应的体量有上界；总数照实在 summary 里报，不受 limit 影响。
MISTAKE_LIMIT_DEFAULT = 60

# 历史局列表一次最多列几局。一局一行、每行十几个字段，40 行已经比一屏长得多；
# 同样地，总数在 summary 里照实报，limit 只切列表不切总账。
GAMES_LIMIT_DEFAULT = 40

BLURRED_KINDS = ('at_most', 'uncertain', 'below_top')


# --------------------------------------------------------------------------- #
# 读侧的列名表：响应里的键**就是**这两串，一列不多一列不少
# --------------------------------------------------------------------------- #
#
# 为什么写成常量而不是 `SELECT *`：存档会长列（review 就是这么长出来的），而
# `SELECT *` 会把新列直接冲进 HTTP 响应里 —— 那等于让 schema 替对外契约做主，
# 而且冲进来的第一列永远是「最新加的那个」，谁都没检查过。列名写在这里，
# 读出来的行按同一串名字装配，加列这件事必须**在这里**发生一次才进得了响应。
#
# 这两串同时也是 ``tools/verify.py`` O 段与 ``tools/smoke_http.py`` 12 段拿来
# 逐字段对账的键集：接口给多了或给少了都会红。
GAME_HEAD_COLUMNS = ('game_id', 'start_fen', 'engine_side', 'source', 'opened_at',
                     'updated_at', 'ply_count', 'fen_now', 'state', 'winner',
                     'reason', 'outcome')

PLY_COLUMNS = ('ply', 'side', 'by', 'iccs', 'chinese', 'piece', 'captured',
               'gives_check', 'mate', 'eval_red', 'mate_in', 'depth',
               'think_time', 'fen_before', 'review')

# 「这一局有几手带判分」的**唯一定义**。列表与总账共用这一段，因为两处一旦
# 分了叉，UI 就会看到「列表说这局有 3 手判分，点进去 0 手」。
# ``COUNT(review)`` 数的是非 NULL 的那些行 —— 也就是「这一手带着判分」，
# 与错题本那个 ``graded_plies`` 同一把尺（JSON 读不动的那行照样算「带着」，
# 它在回放里另计 ``unreadable``）。
_GRADED_JOIN = """
            LEFT JOIN (SELECT game_id, COUNT(review) AS graded_plies
                       FROM plies GROUP BY game_id) p ON p.game_id = g.game_id
"""


def review_verdict(review):
    """一份判分（``json.loads`` 之后的 dict）→ 这道题算不算「错」。

    返回 ``(bucket, why, weight)``：

    * ``bucket`` 三选一 —— ``'miss'`` 计入错题、``'clean'`` 判清了而且不算错、
      ``'blurred'`` 这份判分证不出对错，**不许界面把它念成「没错」**；
    * ``why`` 是给人和自检看的一句话理由；
    * ``weight`` 只在 ``'miss'`` 时有意义，是用来挑「最差的那次」的**两位刻度**
      ``(档, 档内大小)``：兵数那一档 ``(1, loss)``（exact 与 at_least 给的 loss 都是
      真值的下界，同一把尺，比大小合法），杀棋那一档 ``(2, …)``。**两种尺不能相减**，
      所以先比档再比大小 —— 写成单个数字的话，「慢一步杀」（差 2 个步数）会被一次
      300cp 的漏着挤下去，而性质变了比程度变了更值得重做，这正是分档要办的事。
    """
    if not isinstance(review, dict):
        return 'blurred', '判分不是一个 dict', None

    kind = review.get('loss_kind')
    if review.get('status') == 'outside' or kind == 'below_top':
        return 'blurred', '这一手没进引擎的前几名，连它自己的分都没搜出来', None

    if kind in ('exact', 'at_least'):
        loss = review.get('loss')
        if not isinstance(loss, int) or isinstance(loss, bool):
            return 'blurred', '判分里没有可用的差值', None
        if loss > 0:
            return ('miss',
                    f'恰好差 {loss}cp' if kind == 'exact' else f'至少差 {loss}cp',
                    (1, loss))
        return 'clean', '证得出这一手不差于第 1 名', None

    if kind in BLURRED_KINDS:
        return 'blurred', f'{kind}：那个数证不出「这一手更差」', None

    if kind == 'mate':
        lines = review.get('lines') or []
        first = lines[0] if lines and isinstance(lines[0], dict) else {}
        # 方向读第 1 名的**走子方视角**分 —— 与 format.ts 的 gradeLabel 同一个读法。
        # 读 best_eval_red 会在黑方思考时把符号翻错（那是红方视角）。
        best_score = first.get('score')
        if best_score is None:
            return 'blurred', '杀棋判分里没有第 1 名的分', None
        best_in = review.get('best_mate_in')
        played_in = review.get('played_mate_in')

        if best_score > 0:
            # 走子方本来能把死对方。
            if review.get('rank') == 1:
                return 'clean', '这一手就是那记杀', None
            if played_in is None and best_in is not None:
                return 'miss', f'错过 {best_in} 步杀', (2, MATE_MISS_WEIGHT)
            if played_in is not None and best_in is not None:
                if played_in > best_in:
                    return 'miss', '该走快杀却走了慢杀', (2, played_in - best_in)
                return 'clean', '同样杀得死', None
            return 'blurred', '两手都是杀棋，距离却没都给全', None

        # 杀棋是冲着自己来的：这一手的功课是**撑得久**，没什么可「错过」的。
        if played_in is not None and best_in is not None:
            if played_in < best_in:
                return ('miss',
                        f'只撑 {played_in} 步，最优能撑 {best_in} 步',
                        (2, best_in - played_in))
            return 'clean', '已经是最能撑的那一手', None
        return 'blurred', '撑多久说不准', None

    return 'blurred', f'判分缺 loss_kind（{kind!r}）', None


def load_review(text):
    """库里的 JSON 文本 → dict。读不动就返回 ``None``，不抛。

    一行读不出来的判分不该让整个错题本 500；它也不该悄悄消失 —— 坏行单独计入
    ``unreadable``，这样「少了一堆题」这件事在自检里是看得见的。
    """
    if not text:
        return None
    try:
        value = json.loads(text)
    except (ValueError, TypeError):
        return None
    return value if isinstance(value, dict) else None


def _blank_mistake_summary(store_enabled=True):
    return {
        'positions': 0,          # 攒出过判分的局面数（含一题没错的）
        'listed': 0,             # 本次返回的题数
        'miss_positions': 0,     # 其中有错题的局面数
        'graded_plies': 0,       # 人走的、带判分的手次
        'misses': 0,
        'exact_misses': 0,
        'at_least_misses': 0,
        'mate_misses': 0,
        'clean': 0,
        'blurred': 0,
        'unreadable': 0,
        'games': 0,              # 涉及几局 —— 错题本讲的从来不是眼下这一局
        'limit': 0,
        'store_enabled': store_enabled,
    }


def _blank_games_summary(store_enabled=True):
    """历史局列表的空账。存档关着也要把这副形状交回去，而不是回一个 ``None``。

    ``total_games`` 与 ``listed`` 分开存：前者是库里一共几局，后者是这次给了几行。
    两个数一旦被同一个变量代替，「limit 把数据藏起来」这件事就再也看不见了。
    """
    return {
        'total_games': 0,        # 库里一共几局（不受 limit 影响）
        'listed': 0,             # 本次返回的行数
        'truncated': False,      # 是不是被 limit 切过 —— UI 要能说「还有 N 局没列」
        'play_games': 0,         # source='play'：真正下完/下过的那些
        'setup_games': 0,        # source='setup'：排局/补棋摆出来的，不是同一件事
        'graded_plies': 0,       # 全库带判分的手数
        'graded_games': 0,       # 其中有判分的局数 —— 「哪些局值得回看」就靠它
        'limit': 0,
        'store_enabled': store_enabled,
    }


class Store:
    """实况状态的投影目标。``path=None`` 就是关掉，所有写都变空操作。"""

    def __init__(self, path=None):
        self.path = path
        self.errors = 0
        self._lock = threading.Lock()
        self._conn = None
        if path is None:
            return
        directory = os.path.dirname(os.path.abspath(path))
        if directory:
            os.makedirs(directory, exist_ok=True)
        self._conn = sqlite3.connect(path, check_same_thread=False)
        # WAL：落子线程在写的时候，前端 130ms 一次的轮询还在读。默认 journal
        # 模式下写者直接锁库，读者会撞见 database is locked —— 那种错表现为
        # 「界面偶尔转圈」，比存档丢了几行更难查。
        self._conn.execute('PRAGMA journal_mode=WAL')
        self._conn.execute('PRAGMA foreign_keys=ON')
        self._conn.executescript(SCHEMA)
        self._conn.commit()

    @property
    def enabled(self) -> bool:
        return self._conn is not None

    def load_agg_stats(self, defaults):
        """读回累计账（跨重启的那本）。

        ``defaults`` 是会话自己的初始 dict，键与类型都由它说了算 —— 库里的 value
        一律是 REAL，而 ``moves`` 这类必须是 int（界面拿它做计数，浮点数会让
        「1234567.0 步」这种显示冒出来）。所以这里按 defaults 的类型逐个转回来，
        不在库里再造一份键名表。
        """
        if self._conn is None:
            return {}
        with self._lock:
            rows = dict(self._conn.execute('SELECT key, value FROM agg_stats'))
        out = {}
        for key, default in defaults.items():
            if key not in rows:
                continue
            value = rows[key]
            out[key] = int(value) if isinstance(default, int) else float(value)
        return out

    def mistake_book(self, limit=None):
        """错题本：把历次对局里「人走的、带判分的」那些手，按局面聚在一起。

        **只读**：一句 SELECT，不写任何表，也不碰会话的锁。它拿的是 ``self._lock``
        —— 那把锁管的是这一条 SQLite 连接，不是棋；为的就是不与 ``sync_game`` 的
        写事务交错（交错本身不会坏数据，但会读到半程的投影）。

        一次读全部带判分的人步再在 Python 里聚合：库里没有判分的索引，而这台的
        量级是「几百到几万手」，扫一遍比给 JSON 列造一套生成列便宜得多。

        返回 ``{'mistakes': [...], 'summary': {...}}``。每题：

        * ``fen_before`` / ``side`` —— 题目就是「这个局面，该走子方怎么走」；
        * ``graded_plies`` 带判分走过几次，``misses`` 其中错过几次（下面三档相加
          等于它：``misses`` + ``clean`` + ``blurred`` + ``unreadable``）；
        * ``blurred_kinds`` 按 loss_kind 如实给出「看不准、不计入」的那几次是哪些；
        * ``worst_*`` 最差那次的判分要点，``worst_review`` 是整份判分 —— 措辞
          由 ``frontend/src/lib/format.ts`` 决定，这里不写一句人话；
        * ``last_game_id`` / ``last_ply`` / ``last_at`` 最近一次发生在哪儿。

        排序按「错过次数」优先，再按判分次数、再按 FEN（第三把键是必要的：
        同分时不许每次刷新换个顺序，界面没法读）。只列 ``misses > 0`` 的题；
        一题没错的局面只在 summary 里出现。

        ``limit`` 缺省用 ``MISTAKE_LIMIT_DEFAULT``，``0`` 表示不封顶（自检要拿
        全量核对数字，界面只要前几十题）。
        """
        limit = MISTAKE_LIMIT_DEFAULT if limit is None else max(0, int(limit))
        if self._conn is None:
            return {'mistakes': [],
                    'summary': _blank_mistake_summary(store_enabled=False)}

        with self._lock:
            rows = self._conn.execute(
                """
                SELECT p.fen_before, p.game_id, p.ply, p.side, p.iccs, p.chinese,
                       p.review, g.updated_at
                FROM plies p
                JOIN games g ON g.game_id = p.game_id
                WHERE p.by = 'opponent' AND p.review IS NOT NULL
                ORDER BY p.fen_before, g.updated_at, p.game_id, p.ply
                """
            ).fetchall()

        groups: dict = {}
        for (fen, gid, ply, side, iccs, chinese, raw, updated_at) in rows:
            entry = groups.get(fen)
            if entry is None:
                entry = groups[fen] = {
                    'fen_before': fen, 'side': side,
                    'graded_plies': 0, 'misses': 0, 'clean': 0, 'blurred': 0,
                    'unreadable': 0,
                    'exact_misses': 0, 'at_least_misses': 0, 'mate_misses': 0,
                    'blurred_kinds': {}, 'game_ids': [],
                    'worst': None, 'worst_weight': None,
                    'last_game_id': gid, 'last_ply': ply, 'last_at': updated_at,
                }
            entry['graded_plies'] += 1
            if gid not in entry['game_ids']:
                entry['game_ids'].append(gid)
            # 「最近一次」读的是 games.updated_at（plies 自己没有时刻）。
            # updated_at 同一局内单调，跨局比较就是「哪一局最后动过」。
            if updated_at >= entry['last_at']:
                entry['last_at'] = updated_at
                entry['last_game_id'] = gid
                entry['last_ply'] = ply

            review = load_review(raw)
            if review is None:
                entry['unreadable'] += 1
                continue
            bucket, why, weight = review_verdict(review)
            if bucket == 'blurred':
                entry['blurred'] += 1
                kind = str(review.get('loss_kind'))
                entry['blurred_kinds'][kind] = entry['blurred_kinds'].get(kind, 0) + 1
                continue
            if bucket == 'clean':
                entry['clean'] += 1
                continue

            entry['misses'] += 1
            kind = review.get('loss_kind')
            if kind == 'exact':
                entry['exact_misses'] += 1
            elif kind == 'at_least':
                entry['at_least_misses'] += 1
            elif kind == 'mate':
                entry['mate_misses'] += 1
            # 并列时留**先遇到的那一次**（行已按 updated_at 排好序）：判据要能
            # 复现，不能让「同分时挑哪个」变成一次哈希顺序的运气。
            if entry['worst_weight'] is None or weight > entry['worst_weight']:
                lines = review.get('lines') or []
                best = lines[0] if lines and isinstance(lines[0], dict) else {}
                entry['worst_weight'] = weight
                entry['worst'] = {
                    'game_id': gid, 'ply': ply,
                    'played_iccs': iccs, 'played_chinese': chinese,
                    'best_iccs': best.get('iccs') or review.get('best_iccs') or '',
                    'best_chinese': best.get('chinese') or '',
                    'rank': review.get('rank'),
                    'loss': review.get('loss'),
                    'loss_kind': kind,
                    'why': why,
                    # 整份判分原样带出去：那句「差几兵 / 至少差几兵 / 错过几步杀」
                    # 全站只有一个出口（format.ts 的 gradeLabel），这里只给事实。
                    'review': review,
                }

        entries = []
        for fen in sorted(groups, key=lambda f: (-groups[f]['misses'],
                                                 -groups[f]['graded_plies'], f)):
            entry = groups[fen]
            if entry['misses'] <= 0:
                continue
            worst = entry['worst'] or {}
            entries.append({
                'fen_before': fen,
                'side': entry['side'],
                'graded_plies': entry['graded_plies'],
                'misses': entry['misses'],
                'exact_misses': entry['exact_misses'],
                'at_least_misses': entry['at_least_misses'],
                'mate_misses': entry['mate_misses'],
                'clean': entry['clean'],
                'blurred': entry['blurred'],
                'blurred_kinds': entry['blurred_kinds'],
                'unreadable': entry['unreadable'],
                'games': len(entry['game_ids']),
                'best_iccs': worst.get('best_iccs', ''),
                'best_chinese': worst.get('best_chinese', ''),
                'worst_rank': worst.get('rank'),
                'worst_loss': worst.get('loss'),
                'worst_loss_kind': worst.get('loss_kind'),
                'worst_why': worst.get('why', ''),
                'worst_iccs': worst.get('played_iccs', ''),
                'worst_chinese': worst.get('played_chinese', ''),
                'worst_game_id': worst.get('game_id', ''),
                'worst_ply': worst.get('ply'),
                'worst_review': worst.get('review'),
                'last_game_id': entry['last_game_id'],
                'last_ply': entry['last_ply'],
                'last_at': entry['last_at'],
            })

        summary = _blank_mistake_summary()
        summary['limit'] = limit
        listed = entries[:limit] if limit else entries
        for e in entries:
            for key in ('graded_plies', 'misses', 'exact_misses', 'at_least_misses',
                        'mate_misses', 'clean', 'blurred', 'unreadable'):
                summary[key] += e[key]
            summary['miss_positions'] += 1
        # 只列了错题的局面之外，还有「判过分但一次没错」的局面 —— 它们不进这本账，
        # 但总数不许被 limit 或过滤偷偷抹掉。
        summary['positions'] = len(groups)
        summary['listed'] = len(listed)
        summary['games'] = len({gid for e in groups.values() for gid in e['game_ids']})
        return {'mistakes': listed, 'summary': summary}

    def recent_games(self, limit=None):
        """历次对局的列表，新的一手最先 —— UI 靠它**挑一局**来回放。

        错题本讲的是「哪个局面你错过」，这一句讲的是「哪一局值得重看」。两者
        都是**只读投影**：列表与总账各一句 SELECT，不写任何表，也不碰会话的
        ``self.lock``（把一把会改棋的锁递给一个只查历史的读接口，等于让
        「有人在下棋」堵住「有人在看历史」）。锁只取 ``self._lock`` ——
        它管的是这条 SQLite 连接。

        每行带 ``graded_plies``：这一局有几手带着判分。**它必须来自一条聚合**，
        不许「先取列表、再逐局去数」—— 列表页是点开就发的，N+1 那条路在几百局
        之后会把一个「看看有哪些棋」的请求变成几百次查询。所以 ``graded_plies``
        由 ``_GRADED_JOIN`` 那个 GROUP BY 子查询一次算出，与总账共用同一定义。

        行数按 ``updated_at`` 从新到旧；同刻并列时再按 ``game_id`` —— 同分不许每次
        刷新换个顺序，界面没法读。``source='setup'``（排局/补棋）**照样列出来**，
        但 ``source`` 一并带回去：那不是同一件事，藏起来会让 UI 以为「没下过」，
        把它混进战绩里又是另一个错。字段由 UI 自己念。

        ``limit`` 缺省 ``GAMES_LIMIT_DEFAULT``，``0`` 表示不封顶。被切掉的那些
        不消失：``summary.total_games`` 与 ``summary.truncated`` 照实说。

        存档关着（``EF_STORE=off``）时返回空列表 **加** ``store_enabled=False``，
        与 ``mistake_book`` 同一副口径：只回一个空列表会被读成「你还没下过棋」。
        """
        limit = GAMES_LIMIT_DEFAULT if limit is None else max(0, int(limit))
        if self._conn is None:
            return {'games': [], 'summary': _blank_games_summary(store_enabled=False)}

        with self._lock:
            rows = self._conn.execute(
                f"""
                SELECT g.game_id, g.start_fen, g.engine_side, g.source,
                       g.opened_at, g.updated_at, g.ply_count, g.fen_now,
                       g.state, g.winner, g.reason, g.outcome,
                       COALESCE(p.graded_plies, 0)
                FROM games g
                {_GRADED_JOIN}
                ORDER BY g.updated_at DESC, g.game_id
                """).fetchall()
            totals = self._conn.execute(
                f"""
                SELECT COUNT(*),
                       SUM(CASE WHEN g.source = 'setup' THEN 1 ELSE 0 END),
                       SUM(CASE WHEN g.source <> 'setup' THEN 1 ELSE 0 END),
                       COALESCE(SUM(p.graded_plies), 0),
                       SUM(CASE WHEN COALESCE(p.graded_plies, 0) > 0
                                THEN 1 ELSE 0 END)
                FROM games g
                {_GRADED_JOIN}
                """).fetchone()

        games = []
        for row in rows:
            item = dict(zip(GAME_HEAD_COLUMNS + ('graded_plies',), row))
            games.append(item)

        summary = _blank_games_summary()
        summary['limit'] = limit
        (summary['total_games'], setup_games, play_games,
         summary['graded_plies'], summary['graded_games']) = (
            [int(v or 0) for v in totals])
        summary['setup_games'] = setup_games
        summary['play_games'] = play_games
        listed = games[:limit] if limit else games
        summary['listed'] = len(listed)
        summary['truncated'] = len(listed) < len(games)
        return {'games': listed, 'summary': summary}

    def game_replay(self, game_id):
        """那一局的每一手，按 ``ply`` 升序 —— 足够把整局一手手摆回盘上。

        **只读**，与 ``recent_games`` 同一套理由。两次 SELECT（局头 + 棋谱）都取
        ``self._lock``：这两句必须落在同一个瞬间里读，否则棋谱读到一半
        ``sync_game`` 把它重写一遍，交回去的就是「前半局加后半局」那种拼盘。
        读 JSON 一律放到锁外 —— 锁内只做「把行拿回来」这一件事。

        回放靠的不是 ``fen_before``，而是 ``start_fen`` + 有序 ICCS（那才是真值，
        见模块开头）。``fen_before`` 是派生列，留着是因为「这道题你错过几次」按
        局面问；这里把它一并交回去，UI 就不必自己重放一遍才能显示某一手的局面。
        两边对不上就是存档坏了 —— ``tools/verify.py`` 的 O 段正是拿真规则重放来
        逼问这件事的，不是拿这一列跟自己比。

        ``review`` 交回**整份解析后的判分**，内容一概不看（里面有什么键由判分那
        一侧决定，这里只负责原样搬运）。读不动的那些与错题本同一套词：那一手
        ``review=None``，并计进 ``summary['unreadable']`` —— 坏行不许把整局读失败，
        也不许悄悄消失。

        不在库里的 ``game_id`` 回 ``{'found': False, ...}``，**且不带 plies**：
        回一副空棋谱会被读成「这局一步没走」。存档关着同样是 ``found=False``，
        但 ``store_enabled=False`` 会把原因说清楚，两种「没有」不许混成一个。
        """
        if self._conn is None:
            return {'found': False, 'store_enabled': False, 'game_id': game_id}

        head_sql = ('SELECT %s FROM games WHERE game_id=?'
                    % ', '.join(GAME_HEAD_COLUMNS))
        ply_sql = ('SELECT %s FROM plies WHERE game_id=? ORDER BY ply ASC'
                   % ', '.join(PLY_COLUMNS))
        with self._lock:
            head_row = self._conn.execute(head_sql, (game_id,)).fetchone()
            ply_rows = (self._conn.execute(ply_sql, (game_id,)).fetchall()
                        if head_row is not None else [])

        if head_row is None:
            return {'found': False, 'store_enabled': True, 'game_id': game_id}

        plies = []
        graded = 0
        unreadable = 0
        for row in ply_rows:
            item = dict(zip(PLY_COLUMNS, row))
            raw = item.pop('review')
            # 0/1 是库里的存法，「是不是将军 / 是不是杀棋」才是它问的事。
            item['gives_check'] = bool(item['gives_check'])
            item['mate'] = bool(item['mate'])
            if raw is not None:
                graded += 1
            item['review'] = load_review(raw)
            if raw is not None and item['review'] is None:
                unreadable += 1
            plies.append(item)

        return {
            'found': True,
            'store_enabled': True,
            'game': dict(zip(GAME_HEAD_COLUMNS, head_row)),
            'plies': plies,
            'summary': {
                'plies': len(plies),
                'graded_plies': graded,
                'unreadable': unreadable,
                'game_id': game_id,
            },
        }

    # ------------------------------------------------------------------ #
    # 精训营学员档案（只读与增量记录）
    # ------------------------------------------------------------------ #

    def get_training_progress(self) -> dict:
        """获取所有已记录题目的通关进度字典：puzzle_id -> progress dict。"""
        if self._conn is None:
            return {}
        with self._lock:
            cur = self._conn.execute(
                'SELECT puzzle_id, category, status, attempts, hints_used, '
                'first_try_pass, last_cleared_at, updated_at FROM training_progress'
            )
            rows = cur.fetchall()
        out = {}
        for row in rows:
            out[row[0]] = {
                'puzzle_id': row[0],
                'category': row[1],
                'status': row[2],
                'attempts': row[3],
                'hints_used': row[4],
                'first_try_pass': bool(row[5]),
                'last_cleared_at': row[6],
                'updated_at': row[7],
            }
        return out

    def record_training_attempt(self, puzzle_id: str, category: str,
                                solved: bool, hints_used: int = 0,
                                first_try: bool = False) -> dict:
        """记录一次解题尝试或通关。"""
        if self._conn is None:
            return {'store_enabled': False}
        now = time.time()
        with self._lock:
            cur = self._conn.execute(
                'SELECT attempts, hints_used, status, first_try_pass '
                'FROM training_progress WHERE puzzle_id = ?',
                (puzzle_id,)
            )
            row = cur.fetchone()
            if row is None:
                attempts = 1
                total_hints = hints_used
                if solved:
                    status = 'mastered' if hints_used == 0 and first_try else 'solved_with_hints'
                    first_try_pass = 1 if first_try and hints_used == 0 else 0
                    cleared_at = now
                else:
                    status = 'in_progress'
                    first_try_pass = 0
                    cleared_at = None
                self._conn.execute(
                    'INSERT INTO training_progress '
                    '(puzzle_id, category, status, attempts, hints_used, first_try_pass, last_cleared_at, updated_at) '
                    'VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                    (puzzle_id, category, status, attempts, total_hints, first_try_pass, cleared_at, now)
                )
            else:
                attempts = row[0] + 1
                total_hints = max(row[1], hints_used)
                prev_status = row[2]
                first_try_pass = row[3]
                cleared_at = None
                if solved:
                    if prev_status == 'mastered':
                        status = 'mastered'
                    elif hints_used == 0 and first_try and attempts == 1:
                        status = 'mastered'
                        first_try_pass = 1
                    else:
                        status = 'solved_with_hints' if prev_status != 'mastered' else 'mastered'
                    cleared_at = now
                else:
                    status = prev_status if prev_status in ('mastered', 'solved_with_hints') else 'in_progress'

                if cleared_at is not None:
                    self._conn.execute(
                        'UPDATE training_progress SET attempts = ?, hints_used = ?, status = ?, '
                        'first_try_pass = ?, last_cleared_at = ?, updated_at = ? WHERE puzzle_id = ?',
                        (attempts, total_hints, status, first_try_pass, cleared_at, now, puzzle_id)
                    )
                else:
                    self._conn.execute(
                        'UPDATE training_progress SET attempts = ?, hints_used = ?, status = ?, '
                        'updated_at = ? WHERE puzzle_id = ?',
                        (attempts, total_hints, status, now, puzzle_id)
                    )
            self._conn.commit()

        return {
            'store_enabled': True,
            'puzzle_id': puzzle_id,
            'status': status,
            'attempts': attempts,
            'hints_used': total_hints,
            'first_try_pass': bool(first_try_pass),
        }

    def get_training_summary(self) -> dict:
        """获取学员实训综合战报。"""
        if self._conn is None:
            return {'store_enabled': False, 'total_solved': 0, 'mastered': 0, 'by_category': {}}
        with self._lock:
            cur = self._conn.execute(
                'SELECT category, status, first_try_pass FROM training_progress'
            )
            rows = cur.fetchall()

        total = len(rows)
        mastered = sum(1 for r in rows if r[1] == 'mastered')
        solved = sum(1 for r in rows if r[1] in ('mastered', 'solved_with_hints'))
        first_try = sum(1 for r in rows if r[2] == 1)

        by_cat: dict = {}
        for cat, stat, _ in rows:
            if cat not in by_cat:
                by_cat[cat] = {'total': 0, 'solved': 0, 'mastered': 0}
            by_cat[cat]['total'] += 1
            if stat in ('mastered', 'solved_with_hints'):
                by_cat[cat]['solved'] += 1
            if stat == 'mastered':
                by_cat[cat]['mastered'] += 1

        return {
            'store_enabled': True,
            'total_attempted': total,
            'total_solved': solved,
            'mastered': mastered,
            'first_try_accuracy': round((first_try / solved * 100) if solved > 0 else 0.0, 1),
            'by_category': by_cat,
        }

    def close(self):
        conn, self._conn = self._conn, None
        if conn is not None:
            conn.close()

    # ------------------------------------------------------------------ #
    # 投影
    # ------------------------------------------------------------------ #

    def sync_game(self, sess):
        """把一个会话的实况写进库：这一局的每一手 + 累计账。

        调用方必须已经持有 ``sess.lock``。
        """
        if self._conn is None:
            return
        try:
            with self._lock, self._conn:
                self._sync_game_locked(sess)
        except Exception:                                     # noqa: BLE001
            # 见模块开头：吞掉是为了不让存档把下棋弄停，计数是为了让它
            # 不至于悄悄停摆 —— errors 必须一直是 0，由自检盯着。
            self.errors += 1
            traceback.print_exc()

    def _sync_game_locked(self, sess):
        game = sess.game
        conn = self._conn
        gid = sess.game_id
        now = time.time()
        status = game.status()

        conn.execute(
            """
            INSERT INTO games(game_id, start_fen, engine_side, source,
                              opened_at, updated_at, ply_count,
                              fen_now, state, winner, reason, outcome)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(game_id) DO UPDATE SET
                start_fen=excluded.start_fen,
                engine_side=excluded.engine_side,
                source=excluded.source,
                updated_at=excluded.updated_at,
                ply_count=excluded.ply_count,
                fen_now=excluded.fen_now,
                state=excluded.state,
                winner=excluded.winner,
                reason=excluded.reason,
                outcome=excluded.outcome
            """,
            (gid, game.start_fen, game.engine_side,
             getattr(sess, 'game_source', 'play'),
             now, now, len(game.records),
             nt.to_fen(game.board, game.red_to_move),
             status['state'], status['winner'], status['reason'],
             game_stats_outcome(sess)),
        )

        # 整个重写这一局的棋谱。删多插少不是偷懒，是「投影」这个词的含义：
        # 悔棋之后库里不许留着已经被退掉的那几手。
        conn.execute('DELETE FROM plies WHERE game_id=?', (gid,))
        rows = []
        for i, rec in enumerate(game.records):
            rows.append((
                gid, rec['ply'], rec['side'], rec['by'], rec['iccs'],
                rec['chinese'], rec['piece'], rec['captured'],
                1 if rec['check'] else 0, 1 if rec['mate'] else 0,
                rec['eval'], rec['mate_in'], rec['depth'], rec['time'],
                nt.to_fen(game.boards[i], game.sides[i]),
                dump_review(rec.get('review')),
            ))
        if rows:
            conn.executemany(
                """
                INSERT INTO plies(game_id, ply, side, by, iccs, chinese,
                                  piece, captured, gives_check, mate,
                                  eval_red, mate_in, depth, think_time,
                                  fen_before, review)
                VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                """,
                rows,
            )

        for key, value in sess.engine_stats.items():
            conn.execute(
                'INSERT INTO agg_stats(key, value) VALUES(?,?) '
                'ON CONFLICT(key) DO UPDATE SET value=excluded.value',
                (key, float(value)),
            )


def dump_review(value):
    """判分 → 库里的 TEXT。``None`` 保持 NULL，不许序列化成字符串 ``"null"``。

    键排序、中文不转义，为的是投影**可比较**：同一局重放两遍要落出逐字节相同的
    文本，自检才能直接拿库里的字段跟实况比，而不是先去排除一份序列化差异。
    """
    if value is None:
        return None
    return json.dumps(value, ensure_ascii=False, sort_keys=True)


def game_stats_outcome(sess):
    """这一局已经记进战绩的那个结果（引擎视角），还没结束就给 None。

    读的是 ``game_stats['settled']`` 而不是现场再判一次：认输那一步之后如果又
    录进来一手，现场判会翻成另一个结果，而战绩账本上记的是第一次那个。存档要
    跟账本一致，不是跟「此刻看起来谁赢了」一致。
    """
    return getattr(sess, 'game_stats', {}).get('settled')
