#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""对局度量台第二代 —— 一把能当「晋级闸门」的尺子。

为什么要有第二代：``tools/arena.py`` 量出来的数字不能当闸门，三个硬伤。
这一版逐条把它掰过来（细节都在下面的「三条硬伤」里，代码里每条都配了牙齿检验）：

1. **A/B 被污染。** 老 arena 让新版走 ``searcher.think()``，而它的 ``use_book``
   默认是 ``True`` —— 带开局库的一侧静默赢在不带库的一侧头上，量的是开局库，
   不是被测改动。这一版两侧**共用同一份显式配置**，开局库只能是显式点亮的变量
   （``--book``，两侧一起开，并写进报告），不一致直接拒绝开跑，不是警告。
2. **Elo 不理和棋。** 老 arena 的胜率只数胜负、把和棋从分母里踢掉。象棋自对弈
   在这个棋力上**和棋占一大半**，那么算是错的。这一版分数按 WDL：胜 1 / 和 0.5 /
   负 0，Elo 由同一个分数导出，并给 95% 置信区间。
3. **没有固定节点预算，两侧还写死。** 时间预算会随机器负载漂 2~3 倍，深度预算会
   随战术漂（一连串将军就能把深度顶满），只有「展开了多少个节点」两边同口径、
   跨机器复现得了。这一版有 ``--budget``（内置在 ``search._tick`` 里判，皮卡鱼发
   ``go nodes N``），两侧是**任意两份配置字典**（引擎参数 / 代码根目录），
   颜色按轮次交替（每侧执红执黑的局数一样，且同一轮两局用同一个开局 —— 配对设计，
   开局方差进不了 A/B 之差）。

用法
----
训练侧的随手测量（小样本，只出数字，不出裁决）::

    python tools/arena2.py --split train --games 20 --budget 20000 \
        --baseline 16483fa --params-b @data/learned/cand.json

闸门：候选（新版）vs 基准（钉住的改动前工作树）。给 ref 就自己建工作树并打印路径::

    python tools/arena2.py --split gate --games 300 --budget 40000 \
        --candidate HEAD --baseline 16483fa

自检（含牙齿检验：每条断言都配一个「注入已知坏输入必须变红」）::

    python tools/arena2.py --selftest          # 全套，含真下 4 局 + 建基准工作树
    python tools/arena2.py --selftest --lite   # 只跑不依赖真对局的那部分

闸门语义
--------
* ``--split``：1000 个随机开局按固定常量切成 700 训练 / 300 闸门。闸门那 300 个
  **永不参与调参**（切分只由常量导出，谁也没法「不小心」用歪；报告里带开局指纹，
  同一轮调参有没有偷看闸门集，事后能查出来）。
* 裁决：95% CI 下界 > 0 才 ``promote``；上界 < 0 才 ``reject``；其余一律
  ``inconclusive``。样本不足 ``MIN_GATE_GAMES``（100）局时**只可能**
  ``inconclusive`` —— 尺子在这个样本量下量不出「变强了」这件事（数字见
  ``MIN_GATE_GAMES`` 的注释），硬要它报一个自信的数就是骗人。
* 报告写到 ``data/learned/last_gate.json``（时间戳、候选 ref/sha、基准 sha、
  切分、局数、WDL、Elo、95% CI、裁决）。**不会**自动改 ``data/learned/active.json``
  ——「哪版生效」这一下由人来翻，尺子只负责说实话。

内置引擎是纯 Python（约 95 knps），所以真跑一轮闸门是**挂机活**，不是 CI 活：
300 局按每局 60 步、每步 40k 节点算 ≈ 20 分钟以上。自检里那点局数是为了让
尺子的机械部分红得起来，跟测量精度无关。
"""

from __future__ import annotations

import argparse
import dataclasses
import hashlib
import importlib.util
import json
import math
import os
import random
import re
import subprocess
import sys
import tempfile
import time
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from engine import Game, RED, core, notation as nt            # noqa: E402
from engine import EngineInfo, SearchRequest                        # noqa: E402

OPENINGS_PATH = os.path.join(ROOT, 'data', 'fen', 'random_openings.fen')
LEARNED_DIR = os.path.join(ROOT, 'data', 'learned')
ACTIVE_JSON = os.path.join(LEARNED_DIR, 'active.json')
GATE_JSON = os.path.join(LEARNED_DIR, 'last_gate.json')

# --------------------------------------------------------------------------- #
# 开局切分
# --------------------------------------------------------------------------- #

# 切分只由这两个常量导出：比例 + 洗牌种子。种子写成死数是有意的 ——
# 换种子等于换一套闸门题，那之前所有闸门报告就不可比了。要扩充开局库只能
# 往后追加、不能插到中间，所以切分按下标洗牌，不依赖内容排序。
SPLIT_SEED = 20261017
TRAIN_RATIO = 0.7        # 1000 条 → 700 / 300：300 局闸门正好是一晚上的挂机量
# 开局**顺序**的种子，与切分种子分开：换顺序就该看出是换了批次，
# 混用一个数会把「同一套题排了个新队」和「换了一套题」写成同一种改动。
DEFAULT_SEED = 20261018

# --------------------------------------------------------------------------- #
# 尺度与闸门常量
# --------------------------------------------------------------------------- #

# 样本量下限。推导：每局得分 1/0.5/0，最坏方差在「胜负各半」处 = 0.25，
# se = 0.5/√n；Elo = -400·log10(1/s-1) 在 s=0.5 处的斜率是 400/(ln10·0.25) ≈ 1737。
# 于是 95% CI 半宽 ≈ 1.96 × 1737 × 0.5/√n ≈ 1700/√n Elo：
#   n=25  → ±340     n=100 → ±170      n=300 → ±98
# 一轮自对弈调参通常改不动 100 Elo，100 局以下连「±170 以内」都算不上结论，
# 所以 100 局以下禁止 promote —— 不是保守，是这个样本量下压根没有结论可言。
MIN_GATE_GAMES = 100

# 内置 Searcher 的 _tick 节拍：老接缝里没有 max_nodes 时，度量台把同一机制
# 包在 _tick 上，判定只能在整拍上发生，最坏要多展开 1024 个节点。
# 所以给「包装侧」的预算往下挪一格，让两侧的最坏值对齐到同一个上界，
# 断言才敢一律写成 nodes <= budget。
TICK_STRIDE = 1024

# 皮卡鱼的 ``go nodes N`` 实测超出：预算 2000/20000/200000 → 2000/20001/200182
# （超出 0 / 1 / 182，即 ≤0.09%）。它是按线程本地计数判的，收手那一下必然超一点。
# 容差给到 2% 且不低于 512，跨局面留余量；内置那边是硬上界，容差 0。
def node_bound(kind: str, budget: Optional[int]) -> Optional[int]:
    if not budget:
        return None
    if kind == 'pikafish':
        return int(budget) + max(512, int(budget) // 50)
    return int(budget)

# --------------------------------------------------------------------------- #
# 两侧共用的显式配置
# --------------------------------------------------------------------------- #

# 这些键**两侧必须一致**：它们决定的是「尺子」而不是「被测的东西」。
# 允许不一致的只有 root / params / name（见 SIDE_ONLY_KEYS）。
FAIRNESS_KEYS = ('engine', 'max_nodes', 'max_depth', 'time_limit',
                 'use_book', 'threads', 'hash_mb')
SIDE_ONLY_KEYS = ('root', 'ref', 'params', 'name')
ALLOWED_KEYS = FAIRNESS_KEYS + SIDE_ONLY_KEYS

DEFAULTS: Dict[str, Any] = {
    'engine': 'builtin',
    'max_nodes': 20000,
    # 深度只是「别在预算花完之前先被深度卡住」的上限，不参与公平性；
    # 24 对内置引擎意味着永远是节点预算先收手。
    'max_depth': 24,
    # 看门狗，不是预算：机器卡死 / 引擎抽风时总得有个收手的钟。
    # 60s/步 × 300 局远大于节点预算的自然耗时，正常情况下一次也不会触发。
    'time_limit': 60.0,
    # 开局库默认**关**，而且是显式写在这里的：老 arena 就栽在「默认开」。
    'use_book': False,
    # 线程固定 1：内置引擎本来就是单线程，皮卡鱼多线程的节点口径与 TT 命中都不同，
    # 两侧同口径才可比。
    'threads': 1,
    'hash_mb': 64,
}

# params 能覆盖哪些模块常量，是一份**白名单**，不是「凡是模块全局都能改」。
# 原因：``engine.core`` 的 piece / pst 在导入期就被派生成 MATE_LOWER /
# _PST_CACHE / search.py 里的 from-import 绑定 —— 覆盖它们只改一半，
# 会静默造出「评估与杀棋阈值打架」的引擎。真要学这些表，得先把 core 的
# 派生量改成函数，那是另一件活，不在这把尺子里蒙混过去。
PARAM_ALLOWLIST: Dict[str, Tuple[str, ...]] = {
    # search 这几个都在调用点按全局查（不是导入期烤进常量），覆盖是干净的
    'search': ('QS_LIMIT', 'TABLE_SIZE', 'HISTORY_CAP', 'MAX_PLY', 'RANK'),
}

ENGINE_KINDS = ('builtin', 'pikafish')


class RigError(RuntimeError):
    """尺子本身不成立 —— 宁可不报数，也不报一个来路不明的数。"""


class ConfigError(RigError):
    """配置有问题：两侧不一致、键不认识、值不合理。"""


# --------------------------------------------------------------------------- #
# 开局库：载入与切分
# --------------------------------------------------------------------------- #

def load_openings(path: str = OPENINGS_PATH, expect: int = 1000) -> List[str]:
    """读 FEN 列表，并把每一行**验一遍**。

    老 arena 用 ``if line and '/' in line`` 过滤 —— 坏行被静丢掉，于是
    「1000 个开局」可能实际只剩 980 个，而没人知道少了哪 20 个。这里反过来：
    解析不了的行是错误，重复的开局也是错误（重复等于给同一个局面记两次票，
    权重被偷偷改了，两侧还不一定同分布）。
    """
    if not os.path.isfile(path):
        raise RigError(f'开局库文件不存在: {path}')
    out: List[str] = []
    bad: List[str] = []
    seen: Dict[str, int] = {}
    with open(path, encoding='utf-8') as fh:
        for lineno, raw in enumerate(fh, 1):
            line = raw.strip()
            if not line or line.startswith('#'):
                continue
            try:
                board, _r, _h, _f = nt.from_fen(line)
            except Exception as exc:                       # noqa: BLE001
                bad.append(f'第 {lineno} 行解析失败: {exc}')
                continue
            if len(board.replace('\n', '').replace(' ', '')) < 90:
                bad.append(f'第 {lineno} 行棋盘不完整')
                continue
            if line in seen:
                bad.append(f'第 {lineno} 行与第 {seen[line]} 行重复')
                continue
            seen[line] = lineno
            out.append(line)
    if bad:
        raise RigError(f'开局库有 {len(bad)} 行不合格（不静默丢行）：\n  ' +
                       '\n  '.join(bad[:5]))
    if expect and len(out) != expect:
        raise RigError(f'开局库期望 {expect} 条，实得 {len(out)} 条 —— '
                       f'切分比例是按这个规模定的，别改一半')
    return out


def split_openings(all_fens: Sequence[str],
                   seed: int = SPLIT_SEED,
                   ratio: float = TRAIN_RATIO) -> Dict[str, List[str]]:
    """切成 ``{'train': [...], 'gate': [...]}``，只由 (下标, seed, ratio) 导出。

    排的是**下标**而不是内容：开局库文件以后只追加、不插中间，于是每个下标的
    归属只由 ``(seed, 下标)`` 的哈希决定，与文件里其它行、与总条数都无关。
    为什么不用 ``random.Random(seed).shuffle(idx)``：洗牌是整列置换，追加一条
    会把 1000 个开局的归属全部重洗 —— 之前每一份闸门报告比的题就作废了，
    而「同一把尺子」的前提正是同一套题。哈希排序之后，扩容最多只让**边界上
    一个**开局从 gate 挪进 train（train_n 由比例导出，会变），其余一动不动。
    """
    order = sorted(range(len(all_fens)),
                   key=lambda i: hashlib.sha1(f'{seed}:{i}'.encode('utf-8')).hexdigest())
    train_n = int(round(len(all_fens) * ratio))
    train = sorted(order[:train_n])
    gate = sorted(order[train_n:])
    return {'train': [all_fens[i] for i in train],
            'gate': [all_fens[i] for i in gate],
            'train_index': train, 'gate_index': gate}


def openings_fingerprint(fens: Sequence[str]) -> str:
    """开局集指纹。报告里带上它，才能事后查出「调参有没有用过闸门集」。"""
    h = hashlib.sha1(('\n'.join(fens) + '\n').encode('utf-8'))
    return h.hexdigest()[:16]


# --------------------------------------------------------------------------- #
# 代码根目录：路径 / git ref → 钉住的工作树
# --------------------------------------------------------------------------- #

def _git(args: Sequence[str], cwd: str = ROOT) -> str:
    proc = subprocess.run(['git', *args], cwd=cwd, capture_output=True,
                          text=True, encoding='utf-8')
    if proc.returncode != 0:
        raise RigError(f'git {" ".join(args)} 失败: {proc.stderr.strip()[:200]}')
    return proc.stdout.strip()


def git_sha(root: str) -> Optional[str]:
    try:
        return _git(['rev-parse', 'HEAD'], cwd=root)
    except RigError:
        return None


def git_dirty(root: str) -> bool:
    try:
        return bool(_git(['status', '--porcelain'], cwd=root))
    except RigError:
        return True


def default_baseline_dir() -> str:
    """基准工作树的默认落脚处。

    放在系统临时目录而不是仓库里：仓库里多一个工作树目录就会在 ``git status``
    里长出来一坨未跟踪项（这仓库的规矩是 diff 只该出现在 tools/ 与 engine/）。
    想换地方用 ``--baseline-root`` 或环境变量 ``ARENA2_BASELINE_DIR``。
    """
    env = os.environ.get('ARENA2_BASELINE_DIR')
    if env:
        return os.path.abspath(env)
    return os.path.join(tempfile.gettempdir(), 'elephantfish-arena2-baselines')


def resolve_root(spec: Optional[str], baseline_dir: str, quiet: bool = False,
                 label: str = '根目录') -> Tuple[str, Optional[str]]:
    """把 ``--candidate`` / ``--baseline`` 的值解析成 (仓库根目录, 原始 ref)。

    认三种写法：省略（=度量台自己所在的根）、目录路径、git ref。
    给 ref 就自己拉一个 detached 工作树出来，**并把路径打印出来** ——
    闸门要能被事后重现，就得知道当初比的是哪个树。
    """
    if spec is None:
        return ROOT, None
    spec = str(spec)
    if os.path.isdir(spec):
        cand = os.path.abspath(spec)
        if not os.path.isdir(os.path.join(cand, 'engine')):
            raise ConfigError(f'{label} 目录里没有 engine/ 包: {cand}')
        return cand, None

    sha = _git(['rev-parse', '--verify', f'{spec}^{{commit}}'])
    if not re.fullmatch(r'[0-9a-f]{40}', sha or ''):
        raise ConfigError(f'{label} 既不是目录也不是能解析的 git ref: {spec!r}')
    dest = os.path.join(baseline_dir, sha[:12])
    if os.path.isdir(dest):
        if git_sha(dest) == sha:
            if not quiet:
                print(f'[arena2] {label}工作树复用: {dest}  sha={sha[:12]}', flush=True)
            return dest, spec
        # 同一路径上躺着别的 sha —— 那是脏缓存，不能拿它当基准
        raise RigError(f'{label}工作树路径已存在但不是这个 commit: {dest} '
                       f'(HEAD={git_sha(dest)} 期望 {sha[:12]})，先 git worktree remove')
    os.makedirs(baseline_dir, exist_ok=True)
    _git(['worktree', 'add', '--detach', dest, sha])
    if not quiet:
        print(f'[arena2] {label}工作树已建: {dest}  ref={spec}  sha={sha}', flush=True)
        print(f'[arena2]   用完了想清掉: git worktree remove --force "{dest}"', flush=True)
    return dest, spec


def baseline_path_for(sha: str, baseline_dir: Optional[str] = None) -> str:
    """resolve_root 给 ref 时落脚的那个路径（自检收尾要按同一个规则找它）。"""
    return os.path.join(baseline_dir or default_baseline_dir(), sha[:12])


def release_baseline(path: str, quiet: bool = True) -> None:
    """用完把工作树退掉。留着会在一堆 worktree 里长出一个没人认领的树。"""
    try:
        _git(['worktree', 'remove', '--force', path])
    except RigError as exc:
        if not quiet:
            print(f'[arena2] 工作树没能退掉（手动补一刀 git worktree remove --force）：{exc}')
        return
    if not quiet:
        print(f'[arena2] 工作树已退掉: {path}', flush=True)


# --------------------------------------------------------------------------- #
# 把一个仓库根目录下的 engine 包**独立**加载进来
# --------------------------------------------------------------------------- #

def _load_module_from_file(alias: str, path: str,
                           search_locations: Optional[Sequence[str]] = None):
    spec = importlib.util.spec_from_file_location(alias, path,
                                                 submodule_search_locations=search_locations)
    if spec is None or spec.loader is None:
        raise RigError(f'没法为 {path} 构造 import spec')
    mod = importlib.util.module_from_spec(spec)
    sys.modules[alias] = mod
    spec.loader.exec_module(mod)
    return mod


def load_namespace(root: str, alias: str):
    """独立加载 ``<root>/engine`` 包，得到一份与宿主互不干扰的引擎命名空间。

    两个坑，都是这仓库特有的：

    * ``engine/core.py`` 会 ``import elephantfish``（原版是走法生成的唯一事实来源）。
      那个名字在 ``sys.modules`` 里只有一份，先加载的赢 —— 于是基准侧会悄悄用上
      **我们这份** elephantfish.py。所以这里把 ``elephantfish`` 临时换成该根目录自己
      的那一份，导完再换回来。
    * 反过来，如果本工作树的改动没提交，拿 HEAD 建出来的基准树就是「改动前」，
      正是闸门要的东西；宿主自己那份照常从 ROOT 用，两边不打架。
    """
    root = os.path.abspath(root)
    if root == os.path.abspath(ROOT):
        import engine as own                       # 宿主自己那份，不重复加载
        return own
    pkg_dir = os.path.join(root, 'engine')
    init_py = os.path.join(pkg_dir, '__init__.py')
    if not os.path.isfile(init_py):
        raise RigError(f'{root} 底下没有 engine/__init__.py，不是可用的代码根目录')

    base_alias = f'{alias}_base'
    saved_pkg = sys.modules.get(alias)
    saved_base = sys.modules.get(base_alias)
    saved_ef = sys.modules.get('elephantfish')
    sys.modules.pop(alias, None)
    try:
        # 先把该根目录的原版实现挂成 elephantfish，engine.core 导入时才会拿到它
        base_mod = _load_module_from_file(base_alias, os.path.join(root, 'elephantfish.py'))
        sys.modules['elephantfish'] = base_mod
        sys.path.insert(0, root)
        try:
            ns = _load_module_from_file(alias, init_py, [pkg_dir])
        finally:
            sys.path.remove(root)
    finally:
        if saved_ef is None:
            sys.modules.pop('elephantfish', None)
        else:
            sys.modules['elephantfish'] = saved_ef
        if saved_base is None:
            sys.modules.pop(base_alias, None)
        if saved_pkg is not None:
            sys.modules[alias] = saved_pkg
    return ns


def ns_fields(ns) -> Tuple[str, ...]:
    return tuple(f.name for f in dataclasses.fields(ns.SearchRequest))


def probe_caps(ns) -> Dict[str, str]:
    """这份接缝支持什么，是**探**出来的，不是猜的。

    闸门比的是「改动前的工作树」，它必然没有这一版加的 ``max_nodes`` / ``use_book``
    字段。静默把这两个键丢掉 = 基准侧无预算 / 基准侧偷吃开局库，正是要根除的那类
    污染。所以探不出来就明确标成 wrap（度量台补装同一机制），补装不了就报错。
    """
    fields = ns_fields(ns)
    caps = {'search_request': tuple(fields)}
    caps['max_nodes'] = 'native' if 'max_nodes' in fields else None
    caps['use_book'] = 'native' if 'use_book' in fields else None
    if caps['max_nodes'] is None:
        if not hasattr(ns.Searcher, '_tick'):
            raise RigError('这份接缝既没有 max_nodes 字段，Searcher 也没有 _tick，'
                           '度量台没法补装节点预算 —— 拿它当基准会得到不可比的结果')
        caps['max_nodes'] = 'tick_wrap'
    if caps['use_book'] is None:
        caps['use_book'] = 'wrap_default_off'
    return caps


def install_tick_cap(ns) -> None:
    """给没有 ``max_nodes`` 的老接缝补装节点预算：包在**同一个** ``_tick`` 收手点上。

    不是另造一套机制：内置搜索只在 ``_tick`` 一处决定停不停，所以包它等于
    「基准侧与新版走同一条收手路径」，差别只有判定节拍（整拍 1024），
    那一格已经用「预算往下挪 TICK_STRIDE」补掉了（见 Side.effective_budget）。
    """
    if getattr(ns.Searcher, '_arena2_tick_cap', False):
        return
    orig = ns.Searcher._tick

    def _tick(self):
        budget = getattr(self, 'node_budget', None)
        if budget is not None and self.nodes >= budget:
            self.stop = True
            return
        return orig(self)

    ns.Searcher._tick = _tick
    ns.Searcher._arena2_tick_cap = True


def install_book_off(ns) -> None:
    """给 ``SearchRequest`` 没有 use_book 字段的老接缝补上「不许吃开局库」。

    老 adapter 调 ``searcher.search(...)`` 时不传 use_book，于是吃到 ``search()``
    的默认值 True —— 基准侧背定式、候选侧真搜索，这局就没法看了。这里把该类
    的默认值替成 False（只影响这一份命名空间，宿主不受影响）。
    """
    if getattr(ns.Searcher, '_arena2_book_off', False):
        return
    orig = ns.Searcher.search

    def search(self, pos, *a, **kw):
        kw.setdefault('use_book', False)
        return orig(self, pos, *a, **kw)

    ns.Searcher.search = search
    ns.Searcher._arena2_book_off = True


def apply_params(ns, params: Dict[str, Any], which: str) -> List[str]:
    """把引擎参数覆盖到该侧的 ``engine.search`` 模块上，返回改动了哪些名字。

    只认白名单，认不出来就报错：拼错的键被静默忽略等于「以为在比 A、其实在比 A vs A」，
    这种错最贵，因为它给出的数字看着完全合理。
    """
    touched: List[str] = []
    for raw_key, value in (params or {}).items():
        mod_name, _, name = str(raw_key).rpartition('.')
        mod_name = mod_name or 'search'
        if mod_name not in PARAM_ALLOWLIST:
            raise ConfigError(
                f'{which}: 参数 {raw_key} 落在不支持的模块（{mod_name}）。'
                f'engine.core 的 piece / pst 有导入期派生量，覆盖只改一半，'
                f'这一版明确拒绝。')
        if name not in PARAM_ALLOWLIST[mod_name]:
            raise ConfigError(f'{which}: 参数 {raw_key} 不在白名单 '
                              f'{PARAM_ALLOWLIST[mod_name]} 里')
        mod = getattr(ns, mod_name, None) or getattr(ns.search, mod_name, None)
        if mod is None or not hasattr(mod, name):
            raise ConfigError(f'{which}: 模块 {mod_name} 里根本没有 {name} 这个名字')
        setattr(mod, name, value)
        touched.append(f'{mod_name}.{name}')
    return touched


# --------------------------------------------------------------------------- #
# 一侧
# --------------------------------------------------------------------------- #

class Side:
    """一份配置 = 一个代码根目录 + 一份引擎参数 + 一套共用的尺子刻度。"""

    def __init__(self, name: str, ns, caps: Dict[str, str], adapter,
                 fairness: Dict[str, Any], budget: Optional[int],
                 cap_mode: str, book_mode: str, root: str,
                 ref: Optional[str], sha: Optional[str],
                 params: Dict[str, Any], touched: List[str]):
        self.name = name
        self.ns = ns
        self.caps = caps
        self.adapter = adapter
        self.kind = fairness['engine']
        self.root = root
        self.ref = ref
        self.sha = sha
        self.params = dict(params or {})
        self.touched = touched
        self.cap_mode = cap_mode
        self.book_mode = book_mode
        self.budget = budget
        # 包装侧往下挪一格：老 _tick 只在整拍上判，最坏多展开 TICK_STRIDE 个节点，
        # 挪过之后「实测 nodes <= budget」这个硬上界对两侧都成立。
        self.effective_budget = (max(1, int(budget) - TICK_STRIDE)
                                 if budget and cap_mode == 'tick_wrap' else budget)
        self.fairness = fairness
        # 记账：这些数字都要进报告，不接受「大概没超」
        self.moves = 0
        self.total_nodes = 0
        self.max_move_nodes = 0
        # 接缝的 ``nodes`` 是**最后一个完成层**的累计值。迭代加深被预算掐断时，
        # 未完成的那一层可能已经花掉了预算的九成，而报告里看不见 ——
        # 实测「预算 4000、每步报 1078」。所以真实展开量另记一份：
        # 内置引擎读它自己的计数器（只在度量台读，不参与选棋，不碰接缝语义），
        # 皮卡鱼的 UCI info 行本来就带当层的部分展开量，报的就是收手点，没有这个缺口。
        self.total_true_nodes = 0
        self.max_true_nodes = 0
        self.book_moves = 0
        self.over_budget_moves = 0
        self.searches_no_layer = 0

    def describe(self) -> Dict[str, Any]:
        return {
            'name': self.name,
            'engine': self.kind,
            'root': self.root,
            'ref': self.ref,
            'sha': self.sha,
            'dirty': git_dirty(self.root),
            'params': self.params,
            'applied': self.touched,
            'budget': self.budget,
            'effective_budget': self.effective_budget,
            'budget_mode': self.cap_mode,
            'book_mode': self.book_mode,
            'moves': self.moves,
            'total_nodes': self.total_nodes,
            'max_move_nodes': self.max_move_nodes,
            'total_true_nodes': self.total_true_nodes,
            'max_true_nodes': self.max_true_nodes,
            'node_bound': node_bound(self.kind, self.budget),
            'book_moves': self.book_moves,
            'over_budget_moves': self.over_budget_moves,
        }

    def reset_ledger(self) -> None:
        """把记账清零（预检那几步不该进正式账本）。"""
        self.moves = 0
        self.total_nodes = 0
        self.max_move_nodes = 0
        self.total_true_nodes = 0
        self.max_true_nodes = 0
        self.book_moves = 0
        self.over_budget_moves = 0
        self.searches_no_layer = 0

    def new_game(self) -> None:
        self.adapter.new_game()

    def choose(self, board: str, red_to_move: bool, game_history: Tuple[str, ...],
               iccs_history: Tuple[str, ...], start_fen: Optional[str]) -> EngineInfo:
        """要一步棋。走的全是接缝那一个接口，两侧一样。"""
        f = self.fairness
        kwargs: Dict[str, Any] = dict(
            board=board, red_to_move=red_to_move,
            game_history=game_history, move_history_iccs=iccs_history,
            start_fen=start_fen,
            max_depth=f['max_depth'], time_limit=f['time_limit'],
            use_book=bool(f['use_book']))
        if f['max_nodes'] and self.cap_mode == 'native':
            kwargs['max_nodes'] = int(f['max_nodes'])
        elif f['max_nodes'] and self.cap_mode == 'tick_wrap':
            # 实例属性：BuiltinEngine.new_game() 会换掉 searcher，所以每步都设
            self.adapter.searcher.node_budget = int(self.effective_budget)
        # 剩下这些字段是接缝的地基，缺一个就没法比：宁可崩在开跑前
        supported = set(ns_fields(self.ns))
        foundation = ('board', 'red_to_move', 'game_history', 'move_history_iccs',
                      'max_depth', 'time_limit')
        missing = [k for k in foundation if k not in supported]
        if missing:
            raise RigError(f'{self.name}: 这份接缝的 SearchRequest 缺字段 {missing}')
        # use_book 只有两种去处：字段在 → 直接传；不在 → install_book_off 已把类默认改成 False
        if 'use_book' not in supported and f['use_book']:
            raise RigError(f'{self.name}: 这份接缝没有 use_book 字段，'
                           f'而配置要求开书 —— 度量台没法给它开书，两侧会不对称')
        kwargs = {k: v for k, v in kwargs.items() if k in supported}

        req = self.ns.SearchRequest(**kwargs)
        last: Optional[EngineInfo] = None
        for info in self.adapter.search(req):
            last = info
            if info.nodes > self.max_move_nodes:
                self.max_move_nodes = int(info.nodes)
        if last is None:
            self.searches_no_layer += 1
            raise RigError(
                f'{self.name} 在第 {self.moves + 1} 步一层都没搜完（预算 '
                f'{f["max_nodes"]} 节点太小，局面 {start_fen} 都出不来一手）。'
                f'尺子不接受「拿不走棋凑一局」：要么把 --budget 加大，要么换开局。')
        bound = node_bound(self.kind, self.budget)
        if bound is not None and last.nodes > bound:
            self.over_budget_moves += 1
        # 真实展开量：内置引擎的计数器在 search() 开头清零，所以搜完这一步
        # 读到的就是这一步的总量，比「最后一个完成层」的报值大，那部分正是
        # 被预算掐掉的当前层。皮卡鱼没有这个计数器（UCI 也不给），只能用报值。
        true_nodes = int(last.nodes)
        searcher = getattr(self.adapter, 'searcher', None)
        if self.kind == 'builtin' and searcher is not None:
            true_nodes = max(true_nodes, int(getattr(searcher, 'nodes', 0) or 0))
        if bound is not None and true_nodes > bound:
            self.over_budget_moves += 1
        if getattr(last, 'book', False):
            self.book_moves += 1
        self.moves += 1
        self.total_nodes += int(last.nodes)
        self.total_true_nodes += true_nodes
        self.max_true_nodes = max(self.max_true_nodes, true_nodes)
        return last


def build_side(name: str, spec: Dict[str, Any], fairness: Dict[str, Any],
               baseline_dir: str, alias: str, quiet: bool = False) -> Side:
    """按一份 side 配置把引擎拉起来（含 ref→工作树、独立命名空间、补装能力）。"""
    root, ref = resolve_root(spec.get('root'), baseline_dir, quiet=quiet, label=name)
    ns = load_namespace(root, alias)
    caps = probe_caps(ns)
    kind = fairness['engine']
    params = dict(spec.get('params') or {})
    budget = fairness['max_nodes']

    if kind == 'builtin':
        cap_mode = caps['max_nodes'] if budget else 'none'
        if cap_mode == 'tick_wrap':
            install_tick_cap(ns)
        book_mode = caps['use_book']
        if book_mode == 'wrap_default_off':
            install_book_off(ns)
        touched = apply_params(ns, params, name)
        adapter = ns.BuiltinEngine()
    else:
        # 皮卡鱼这一侧：预算靠 go nodes，开局库天然没有（见 SearchRequest 的注释）。
        # 老接缝没有 max_nodes 字段 = 没有 go nodes = 只能退回时间，那不可比。
        if budget and caps['max_nodes'] != 'native':
            raise RigError(f'{name}: 这份接缝的 SearchRequest 没有 max_nodes 字段，'
                           f'而皮卡鱼的补装点是 UCI 命令、不是 Python 计数器 —— '
                           f'拿它当基准就只能用时间预算，那把尺子不是可复现的')
        cap_mode = 'native' if budget else 'none'
        book_mode = 'pikafish_has_no_book'
        touched = apply_params(ns, params, name)
        adapter = ns.PikafishAdapter(threads=int(fairness['threads']),
                                     hash_mb=int(fairness['hash_mb']))
        if not getattr(adapter, 'available', True):
            raise RigError(f'{name}: 皮卡鱼二进制不可用（engine/pikafish/ 或 PIKAFISH_PATH），'
                           f'--engine pikafish 跑不起来')
    return Side(name=name, ns=ns, caps=caps, adapter=adapter, fairness=fairness,
                budget=budget, cap_mode=cap_mode, book_mode=book_mode,
                root=root, ref=ref, sha=git_sha(root),
                params=params, touched=touched)


# --------------------------------------------------------------------------- #
# 配置：共用刻度 + 两份 side 字典
# --------------------------------------------------------------------------- #

def parse_json_arg(value: Optional[str]) -> Optional[Dict[str, Any]]:
    """``{...}`` 直接当 JSON，``@path`` 读文件；其余交给 resolve_root 当路径 / ref。"""
    if value is None:
        return None
    text = value
    if text.startswith('@'):
        with open(text[1:], encoding='utf-8') as fh:
            text = fh.read()
    if not text.lstrip().startswith('{'):
        return None
    try:
        data = json.loads(text)
    except json.JSONDecodeError as exc:
        raise ConfigError(f'配置 JSON 解析失败: {exc}') from exc
    if not isinstance(data, dict):
        raise ConfigError('配置必须是 JSON 对象（字典），两侧共用一份刻度')
    return data


def is_root_spec(value: Optional[str]) -> bool:
    if value is None:
        return False
    text = str(value)
    if text.startswith('@') or text.lstrip().startswith('{'):
        return False
    return True


def build_side_spec(value: Optional[str], name: str) -> Dict[str, Any]:
    """把 --candidate/--baseline 的取值收成一个 side 字典（可以只有 root）。"""
    spec: Dict[str, Any] = {}
    if value is not None:
        if is_root_spec(value):
            spec = {'root': value}
        else:
            parsed = parse_json_arg(value)
            assert parsed is not None
            spec = parsed
    spec.setdefault('name', name)
    return spec


def merge_fairness(spec: Dict[str, Any], shared: Dict[str, Any], name: str,
                   strict: bool = True) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    """把 side 字典拆成（共用刻度, 该侧独有部分），并守住「两侧同刻度」。

    这是硬伤 1 的正解：不是「提醒一下」，是**不让不一致的配置开跑**。
    """
    unknown = [k for k in spec if k not in ALLOWED_KEYS]
    if unknown:
        raise ConfigError(f'{name}: 不认识的键 {unknown}。可用的键：{list(ALLOWED_KEYS)}'
                          f'（拼错的键被静默忽略 = 比了个寂寞）')
    fairness = dict(shared)
    conflicts = []
    for key in FAIRNESS_KEYS:
        if key in spec and spec[key] != fairness[key]:
            conflicts.append(f'{key}: 该侧要 {spec[key]!r}，共用刻度是 {fairness[key]!r}')
    if conflicts and strict:
        raise ConfigError(f'{name}: 两侧必须共用同一份刻度，不一致的地方 —— ' + '；'.join(conflicts))
    side_only = {k: v for k, v in spec.items() if k in SIDE_ONLY_KEYS}
    return fairness, side_only


def validate_shared(shared: Dict[str, Any], games: int, split: str,
                    has_baseline: bool, min_games: int = MIN_GATE_GAMES) -> List[str]:
    """开跑前的体检。返回警告（不给警告而硬拒的那些直接抛）。"""
    warnings: List[str] = []
    if shared['engine'] not in ENGINE_KINDS:
        raise ConfigError(f'engine 只能是 {ENGINE_KINDS}，给的是 {shared["engine"]!r}')
    if not isinstance(games, int) or games <= 0:
        raise ConfigError(f'--games 要正整数，给的是 {games}')
    if games % 2:
        raise ConfigError(f'--games 必须是偶数（现在是 {games}）：一轮两局、同一开局交换颜色，'
                          f'奇数局必然让一侧多执一次红 —— 先手优势就直接进了 A/B 之差')
    budget = shared['max_nodes']
    if budget is not None and int(budget) <= 2 * TICK_STRIDE:
        raise ConfigError(f'--budget={budget} 太小：包装侧要往下挪 {TICK_STRIDE} 一格，'
                          f'至少得大于 {2 * TICK_STRIDE}')
    if shared['use_book']:
        warnings.append('开局库开着（--book）：两侧一起开，量的是「带库的棋力」，'
                        '报告里 use_book=true 已记下')
    if (shared['engine'] == 'builtin'
            and (int(shared['threads']) != 1
                 or int(shared['hash_mb']) != int(DEFAULTS['hash_mb']))):
        # 这两个刻度只被皮卡鱼认。内置这边的表大小是 engine/search.py 的模块常量
        # （要改用 params 的 TABLE_SIZE 白名单，那条路是真生效的）。留着它们进
        # FAIRNESS_KEYS 是因为「两侧不许不一致」这条规则只有一条，不值得为
        # 一个引擎开例外；但也不能让人以为调了它就越过了什么。
        warnings.append('threads/hash_mb 对内置引擎不起作用（只有皮卡鱼认这两个）；'
                        '要改内置的表大小用 params 的 search.TABLE_SIZE')
    if split == 'gate' and not has_baseline:
        raise ConfigError('--split gate 必须给 --baseline：闸门比的是「改动前 vs 改动后」，'
                          '没有基准就没有差可报，写不出那行 sha')
    if split == 'gate' and int(min_games) < MIN_GATE_GAMES:
        raise ConfigError(f'--split gate 不许把 --min-games 压到 {MIN_GATE_GAMES} 以下：'
                          f'闸门唯一的牙就是这条样本量下限，能用参数关掉就等于没有')
    return warnings


# --------------------------------------------------------------------------- #
# 下一局：只走接缝与 Game，规则实现全仓库只有这一份
# --------------------------------------------------------------------------- #

def play_game(red: Side, black: Side, fen: str, max_ply: int) -> Dict[str, Any]:
    """从 ``fen`` 下一整局，返回结果与两边的节点记账。

    终局判定交给 ``engine.Game`` —— 它已经有将死/困毙判负、三次重复、
    单方长将判负、60 回合无吃子判和，``tools/verify.py`` 的 C 段就在守它。
    老 arena 在脚本里另抄了一份判定，抄得还不全（没有 60 回合那条）：
    两份规则迟早分叉，分叉那天量出来的就不是棋力差而是规则差。
    """
    sides = {'red': red, 'black': black}
    game = Game(engine_side=RED)
    game.start_fen = fen            # Game 不存 FEN，而皮卡鱼要 position fen
    game.load_fen(fen)
    before = {'red': red.total_nodes, 'black': black.total_nodes}
    for side in (red, black):
        side.new_game()

    plies = 0
    for ply in range(max_ply):
        st = game.status()
        if st['state'] != 'playing':
            return _finish(game, st, ply, sides, before)
        mover = sides['red' if game.red_to_move else 'black']
        info = mover.choose(board=game.board, red_to_move=game.red_to_move,
                           game_history=tuple(game.boards),
                           iccs_history=tuple(r['iccs'] for r in game.records),
                           start_fen=fen)
        move = info.move
        legal = game.legal_moves()
        if move not in legal:
            # 参考系错会静默走出一手对不上盘面的棋（不报错），这是唯一能抓住它的地方
            raise RigError(f'{mover.name} 交回一手不合法的棋 {nt.to_iccs(move) if move else None} '
                           f'（局面 {game.board[:9]!r}… 轮到{"红" if game.red_to_move else "黑"}）'
                           f' —— 接缝的绝对坐标约定被破坏了')
        game.push(move, by='arena2', eval_red=info.eval_red,
                  depth=info.depth, think_time=round(info.time, 3))
        plies = ply + 1

    st = game.status()
    if st['state'] == 'playing':
        st = {'state': 'draw_ply_limit', 'winner': None, 'reason': f'到达 {max_ply} 步上限'}
    return _finish(game, st, plies, sides, before)


def _finish(game: Game, st: Dict[str, Any], plies: int,
            sides: Dict[str, Side], before: Dict[str, int]) -> Dict[str, Any]:
    """把 Game 的终局状态换成「红方视角」的结果（谁赢 + 和棋）与本局节点增量。"""
    winner = st.get('winner')
    result = 'draw' if winner is None else ('red' if winner == RED else 'black')
    nodes = {color: int(side.total_nodes - before[color])
             for color, side in sides.items()}
    return {'result': result, 'winner': winner, 'plies': plies,
            'state': st['state'], 'reason': st.get('reason', ''),
            'nodes': nodes, 'iccs_tail': [r['iccs'] for r in game.records][-4:]}


# --------------------------------------------------------------------------- #
# WDL / Elo / 置信区间 / 裁决
# --------------------------------------------------------------------------- #

def wdl_score(wins: int, draws: int, losses: int) -> float:
    """WDL 分数：胜 1 / 和 0.5 / 负 0，分母是**全部**对局。

    老 arena 用 ``wins / (wins + losses)`` 把和棋从分母里踢了 —— 象棋自对弈
    这里和棋能占六成，踢掉等于把最强的那一类结果当不存在。
    """
    n = wins + draws + losses
    if n <= 0:
        raise RigError('没有对局，算不出分数')
    return (wins + 0.5 * draws) / n


def elo_from_score(score: float, clip: float = 1e-4) -> float:
    """Elo 差。s=0 或 1 处公式发散，先夹到 [clip, 1-clip]：
    夹过之后给出的区间会比真的窄一点（宁窄不无限，报告里另有局数可以反驳）。"""
    s = min(max(float(score), clip), 1.0 - clip)
    return -400.0 * math.log10(1.0 / s - 1.0)


def ci_elo_from_scores(scores: Sequence[float], z: float = 1.96) -> Tuple[float, float, float]:
    """返回 (elo, 95% 下界, 95% 上界)。

    做法：先按每局得分（1/0.5/0）算均值与样本标准误，得到分数的正态区间，
    再用同一个单调映射换算成 Elo 区间。比「直接把 Elo 的 se 线性化」稳，
    因为 s 靠近 0/1 时映射是高度非线性的。
    """
    n = len(scores)
    if n < 2:
        s = scores[0] if scores else 0.5
        return elo_from_score(s), elo_from_score(s), elo_from_score(s)
    mean = sum(scores) / n
    var = sum((x - mean) ** 2 for x in scores) / (n - 1)
    se = math.sqrt(var / n)
    lo_s = min(max(mean - z * se, 1e-4), 1 - 1e-4)
    hi_s = min(max(mean + z * se, 1e-4), 1 - 1e-4)
    return elo_from_score(mean), elo_from_score(lo_s), elo_from_score(hi_s)


def verdict_of(games: int, elo_lo: float, elo_hi: float, problems: Sequence[str],
               min_games: int = MIN_GATE_GAMES) -> Tuple[str, List[str]]:
    """裁决。三条硬规矩，顺序不许换：尺子先于数字，样本量先于结论。"""
    reasons: List[str] = []
    if problems:
        reasons.append('尺子本身不成立，数字不作数：' + '；'.join(problems))
        return 'inconclusive', reasons
    if games < min_games:
        reasons.append(f'样本只有 {games} 局，低于闸门下限 {min_games} 局 —— '
                       f'95% CI 半宽约 {1700 / max(1, math.sqrt(games)):.0f} Elo，'
                       f'这个宽度下报 promote 是骗人')
        return 'inconclusive', reasons
    if elo_lo > 0:
        reasons.append(f'95% CI 下界 {elo_lo:+.1f} > 0：候选确实更强')
        return 'promote', reasons
    if elo_hi < 0:
        reasons.append(f'95% CI 上界 {elo_hi:+.1f} < 0：候选确实更弱')
        return 'reject', reasons
    reasons.append(f'95% CI [{elo_lo:+.1f}, {elo_hi:+.1f}] 跨过 0：分不出强弱')
    return 'inconclusive', reasons


@dataclasses.dataclass
class Ledger:
    """一局一轮的账本。所有数字都能从 ``games`` 重算一遍（这是牙齿的来源）。"""
    games: List[Dict[str, Any]] = dataclasses.field(default_factory=list)
    cand: str = 'A'
    base: str = 'B'
    wins: int = 0
    draws: int = 0
    losses: int = 0
    score: float = 0.5
    elo: float = 0.0
    elo_lo: float = 0.0
    elo_hi: float = 0.0
    verdict: str = 'inconclusive'
    reasons: List[str] = dataclasses.field(default_factory=list)
    problems: List[str] = dataclasses.field(default_factory=list)
    red_games: int = 0
    black_games: int = 0
    duration: float = 0.0
    openings: List[str] = dataclasses.field(default_factory=list)
    # 这一轮实际生效的样本量闸门。写进账本而不是让 check_ledger 去猜全局常量：
    # 调用方（自检、--min-games）把它调小了，账本就得按调小的那个自查。
    min_games: int = MIN_GATE_GAMES


def summarize(rounds: Sequence[Dict[str, Any]], cand_name: str, base_name: str,
              scorer=wdl_score, min_games: int = MIN_GATE_GAMES) -> Ledger:
    """把逐轮记录汇成账本。``scorer`` 只为牙齿检验存在：把「丢掉和棋」的算法
    传进来，下面的 ``check_ledger`` 必须报问题。"""
    led = Ledger(cand=cand_name, base=base_name, min_games=int(min_games))
    for rec in rounds:
        led.games.extend(rec['games'])
    wins = sum(1 for g in led.games if g['outcome'] == 'win')
    draws = sum(1 for g in led.games if g['outcome'] == 'draw')
    losses = sum(1 for g in led.games if g['outcome'] == 'loss')
    led.wins, led.draws, led.losses = wins, draws, losses
    led.red_games = sum(1 for g in led.games if g['cand_color'] == 'red')
    led.black_games = sum(1 for g in led.games if g['cand_color'] == 'black')
    scores = [OUTCOME_SCORE[g['outcome']] for g in led.games]
    led.score = scorer(wins, draws, losses)
    led.elo, led.elo_lo, led.elo_hi = ci_elo_from_scores(scores)
    led.duration = sum(float(g.get('sec') or 0.0) for g in led.games)
    # 先按「尺子没问题」把裁决算出来，再拿账本自洽性去推翻它 ——
    # 顺序反了的话 check_ledger 看到的 verdict 永远是初值，
    # 「样本不足还想 promote」那条就变成一句不会响的假警报。
    led.verdict, led.reasons = verdict_of(len(led.games), led.elo_lo, led.elo_hi,
                                         [], min_games=min_games)
    problems = check_ledger(led, scores)
    if problems:
        led.problems = problems
        led.verdict, led.reasons = verdict_of(len(led.games), led.elo_lo,
                                             led.elo_hi, problems,
                                             min_games=min_games)
    return led


OUTCOME_SCORE = {'win': 1.0, 'draw': 0.5, 'loss': 0.0}


def check_ledger(led: Ledger, scores: Optional[Sequence[float]] = None) -> List[str]:
    """账本自洽性检查。返回问题列表；空列表才算干净。

    写这一段的动机是「任何一条断言都要能被故意写错」：账本里每个数都能从
    ``games`` 重算，所以只要有一处偷偷改了算法（比如把和棋忘了算），
    重算值与上报值就对不上，这里必红。
    """
    problems: List[str] = []
    n = len(led.games)
    if n == 0:
        return ['一局都没有']
    if led.wins + led.draws + led.losses != n:
        problems.append(f'胜负和加起来 {led.wins + led.draws + led.losses} ≠ 局数 {n}'
                        f'（和棋被丢了？老 arena 就是这么算胜率的）')
    honest = (led.wins + 0.5 * led.draws) / n
    if abs(led.score - honest) > 1e-9:
        problems.append(f'分数 {led.score:.6f} ≠ WDL 重算 {honest:.6f}')
    if scores is not None:
        per_game = sum(scores) / len(scores)
        if abs(per_game - honest) > 1e-9:
            problems.append(f'逐局得分均值 {per_game:.6f} ≠ 计数重算 {honest:.6f}')
    if abs(led.elo - elo_from_score(led.score)) > 1e-6:
        problems.append(f'Elo {led.elo:.3f} 与分数导出的 {elo_from_score(led.score):.3f} 不一致')
    if not (led.elo_lo - 1e-9 <= led.elo <= led.elo_hi + 1e-9):
        problems.append(f'Elo {led.elo:+.1f} 不在自己的置信区间 '
                        f'[{led.elo_lo:+.1f}, {led.elo_hi:+.1f}] 里')
    if led.red_games != led.black_games:
        problems.append(f'颜色没配平：候选执红 {led.red_games} 局、执黑 {led.black_games} 局')
    if led.verdict == 'promote' and n < led.min_games:
        problems.append(f'{n} 局就报 promote，越过不了 {led.min_games} 局的样本量闸门')
    return problems


def check_rig(sides: Sequence[Side], fairness: Dict[str, Any],
              games: Sequence[Dict[str, Any]]) -> List[str]:
    """对局过程中攒下的「尺子体检」。这些问题会让裁决变成 inconclusive。"""
    problems: List[str] = []
    for side in sides:
        bound = node_bound(side.kind, side.budget)
        # 两个口径都要查：报值（最后一个完成层）与真实展开量。只查报值的话，
        # 「预算根本没生效、每层都在超时前多烧一大截」这种坏法可以看不见 ——
        # 报值永远比真实量小，上界对它松，对真实量才紧。
        for attr, label in (('max_move_nodes', '报值'),
                            ('max_true_nodes', '真实量')):
            got = int(getattr(side, attr) or 0)
            if side.budget and bound is not None and got > bound:
                problems.append(f'{side.name} 单步节点{label} {got} 超过上界 '
                                f'{bound}（预算 {side.budget}, 模式 {side.cap_mode}）'
                                f' —— 节点预算没生效，这轮不是等预算对比')
        if not fairness['use_book'] and side.book_moves:
            problems.append(f'{side.name} 吃了 {side.book_moves} 手开局库，而配置是 '
                            f'use_book=False —— 书就是被静默打开的，A/B 不干净')
        if side.over_budget_moves:
            problems.append(f'{side.name} 有 {side.over_budget_moves} 步的节点数越过上界')
    return problems


# --------------------------------------------------------------------------- #
# 跑一轮
# --------------------------------------------------------------------------- #

def run_match(sides: Sequence[Side], fens: Sequence[str], games: int,
              cand_idx: int = 0, max_ply: int = 200, verbose: bool = True,
              min_games: int = MIN_GATE_GAMES) -> Ledger:
    """``sides[cand_idx]`` 是候选侧。每轮同一个开局打两局、交换颜色。

    开局顺序、颜色顺序都只由 (fens, 局数) 导出，同一 seed 同一 split 跑两次
    得到逐局一样的结果 —— 「换个顺序再跑一遍数字就变」的尺子不能当闸门。
    """
    cand, base = sides[cand_idx], sides[1 - cand_idx]
    rounds: List[Dict[str, Any]] = []
    pairs = games // 2
    used: List[str] = []
    for i in range(pairs):
        fen = fens[i % len(fens)]
        used.append(fen)
        per_game: List[Dict[str, Any]] = []
        for swap in (0, 1):
            red, black = (cand, base) if swap == 0 else (base, cand)
            before = {'a': cand.total_nodes, 'b': base.total_nodes}
            t0 = time.time()
            out = play_game(red, black, fen, max_ply)
            sec = time.time() - t0
            outcome = ('draw' if out['result'] == 'draw'
                       else 'win' if out['result'] == ('red' if swap == 0 else 'black')
                       else 'loss')
            per_game.append({
                'round': i + 1, 'cand_color': 'red' if swap == 0 else 'black',
                'opening': fen, 'outcome': outcome, 'result': out['result'],
                'state': out['state'], 'reason': out['reason'], 'plies': out['plies'],
                'sec': round(sec, 2),
                'nodes': {'cand': cand.total_nodes - before['a'],
                          'base': base.total_nodes - before['b']},
                'iccs_tail': out['iccs_tail'],
            })
            if verbose:
                side_cn = '红' if swap == 0 else '黑'
                cn = {'win': f'{cand.name}胜', 'draw': '和棋', 'loss': f'{base.name}胜'}[outcome]
                print(f'  第 {i * 2 + swap + 1:3d} 局  {cand.name}执{side_cn}  {cn:10s} '
                      f'{out["plies"]:3d} 步  {sec:5.1f}s  {out["reason"]}', flush=True)
        rounds.append({'games': per_game})
    led = summarize(rounds, cand.name, base.name, min_games=min_games)
    led.openings = used
    rig = check_rig(sides, cand.fairness, led.games)
    if rig:
        # 尺子先于数字：体检有问题就把裁决按「有问题」重算一遍（只会更保守）
        led.problems = rig + led.problems
        led.verdict, led.reasons = verdict_of(len(led.games), led.elo_lo, led.elo_hi,
                                             led.problems, min_games=min_games)
    return led


# --------------------------------------------------------------------------- #
# 报告
# --------------------------------------------------------------------------- #

def read_active(path: str = ACTIVE_JSON) -> Optional[Dict[str, Any]]:
    """读「当前生效版本」指针。读不到不是错误：M3 还没跑过第一版时本来就没有。"""
    if not os.path.isfile(path):
        return None
    try:
        with open(path, encoding='utf-8') as fh:
            return json.load(fh)
    except (OSError, json.JSONDecodeError) as exc:
        raise RigError(f'{path} 读不出来：{exc}（active.json 是人翻的指针文件，'
                       f'坏掉的话得先修，度量台不会替它猜）')


def report_dict(led: Ledger, sides: Sequence[Side], fairness: Dict[str, Any],
                split: str, seed: int, args_desc: str = '') -> Dict[str, Any]:
    cand, base = sides[0], sides[1]
    out = {
        'timestamp': time.strftime('%Y-%m-%dT%H:%M:%S'),
        'tool': 'tools/arena2.py',
        'split': split,
        'seed': seed,
        'games': len(led.games),
        'wins': led.wins, 'draws': led.draws, 'losses': led.losses,
        'wdl_score': round(led.score, 6),
        'elo': round(led.elo, 1),
        'elo_ci95': [round(led.elo_lo, 1), round(led.elo_hi, 1)],
        'verdict': led.verdict,
        'reasons': led.reasons,
        'rig_problems': led.problems,
        'cand_color_games': {'red': led.red_games, 'black': led.black_games},
        'fairness': dict(fairness),
        'candidate': cand.describe(),
        'baseline': base.describe(),
        'duration_sec': round(led.duration, 1),
        'opening_fingerprint': openings_fingerprint(getattr(led, 'openings', [])),
        'min_gate_games': led.min_games,
        'auto_promoted': False,
    }
    if args_desc:
        out['argv'] = args_desc
    for side_key, side in (('candidate', cand), ('baseline', base)):
        out[f'{side_key}_ref'] = side.ref
        out[f'{side_key}_sha'] = side.sha
    return out


def write_gate_report(out: Dict[str, Any], path: str) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as fh:
        json.dump(out, fh, ensure_ascii=False, indent=2, sort_keys=True)
        fh.write('\n')
    os.replace(tmp, path)


# --------------------------------------------------------------------------- #
# 预检：预算够不够走完一层
# --------------------------------------------------------------------------- #

def preflight(sides: Sequence[Side], fen: str, max_ply: int = 4) -> None:
    """预算太小会让「一层都没搜完」变成中途炸膛。开跑前先试一步。

    在初始局面上走 ``max_ply`` 步，两侧都用即将上岗的那份配置。
    """
    game = Game(engine_side=RED)
    game.start_fen = fen
    game.load_fen(fen)
    for side in sides:
        side.new_game()
    for ply in range(max_ply):
        mover = sides[ply % len(sides)]
        info = mover.choose(board=game.board, red_to_move=game.red_to_move,
                           game_history=tuple(game.boards),
                           iccs_history=tuple(r['iccs'] for r in game.records),
                           start_fen=fen)
        legal = game.legal_moves()
        if info.move not in legal:
            raise RigError(f'{mover.name} 预检就交回不合法的棋：{nt.to_iccs(info.move)}')
        game.push(info.move, by='arena2')
    for side in sides:
        side.reset_ledger()


# --------------------------------------------------------------------------- #
# 主流程
# --------------------------------------------------------------------------- #

def shared_from_args(args) -> Dict[str, Any]:
    shared = dict(DEFAULTS)
    shared['engine'] = args.engine
    shared['max_nodes'] = args.budget
    shared['max_depth'] = args.max_depth
    shared['time_limit'] = args.time_limit
    shared['use_book'] = bool(args.book)
    shared['threads'] = args.threads
    shared['hash_mb'] = args.hash
    return shared


def cmd_run(args) -> int:
    shared = shared_from_args(args)
    cand_spec = build_side_spec(args.candidate, '候选')
    base_spec = build_side_spec(args.baseline, '基准')
    # --params-a / --params-b 是 side 字典的一部分，合进去再拆，
    # 这样「两侧允许不同的地方」只有 root / params / name 一条规则
    for flag, spec in ((args.params_a, cand_spec), (args.params_b, base_spec)):
        if not flag:
            continue
        # 走 parse_json_arg 而不是裸 json.loads：调参那一侧的权重几乎总是存在
        # data/learned/*.json 里，用法（文件头的 @path）已经承诺支持 @，
        # 这里漏掉就会让「照文档写的命令」炸在开跑之后。
        parsed = parse_json_arg(flag)
        if parsed is None:
            raise ConfigError(f'{spec["name"]}: --params 需要 JSON 对象或 @文件，'
                              f'给的是 {flag[:60]!r}')
        params = spec.setdefault('params', {})
        clash = [k for k in parsed if k in params]
        if clash:
            raise ConfigError(f'{spec["name"]}: 参数被 side 配置和 --params 同时给了 '
                              f'{clash} —— 谁赢不该靠猜，去掉一个')
        params.update(parsed)
    # 两侧各自声明的「独有部分」才允许不同；共用刻度不一致 = 拒绝开跑
    _cf, cand_only = merge_fairness(cand_spec, shared, cand_spec['name'])
    _bf, base_only = merge_fairness(base_spec, shared, base_spec['name'])
    warnings = validate_shared(shared, args.games, args.split,
                               has_baseline=args.baseline is not None,
                               min_games=args.min_games)
    for w in warnings:
        print(f'[arena2] 注意：{w}', flush=True)

    all_fens = load_openings(args.openings)
    splits = split_openings(all_fens)
    fens = splits[args.split]
    seed_rng = random.Random(args.seed)
    order = list(fens)
    seed_rng.shuffle(order)          # 只在切分内部定顺序，切分本身由 SPLIT_SEED 锁死

    sides = [
        build_side(cand_spec['name'], cand_only, shared, args.baseline_dir,
                   'arena2_ns_cand', quiet=args.quiet),
        build_side(base_spec['name'], base_only, shared, args.baseline_dir,
                   'arena2_ns_base', quiet=args.quiet),
    ]
    print(f'[arena2] 候选 {sides[0].name}: engine={sides[0].kind} '
          f'root={sides[0].root} sha={(sides[0].sha or "")[:12] or "非 git"} '
          f'预算模式={sides[0].cap_mode} 书={sides[0].book_mode}', flush=True)
    print(f'[arena2] 基准 {sides[1].name}: engine={sides[1].kind} '
          f'root={sides[1].root} sha={(sides[1].sha or "")[:12] or "非 git"} '
          f'预算模式={sides[1].cap_mode} 书={sides[1].book_mode}', flush=True)
    print(f'[arena2] 刻度 预算={shared["max_nodes"]} 深度={shared["max_depth"]} '
          f'时限(看门狗)={shared["time_limit"]}s 开局库={shared["use_book"]} '
          f'切分={args.split}({len(fens)} 个开局, 指纹 {openings_fingerprint(fens)}) '
          f'seed={args.seed}', flush=True)

    preflight(sides, order[0])
    t0 = time.time()
    led = run_match(sides, order, args.games, cand_idx=0, max_ply=args.max_ply,
                    verbose=not args.quiet, min_games=args.min_games)

    n = len(led.games)
    print()
    print(f'总战绩 {n} 局：{sides[0].name} {led.wins} 胜 / '
          f'{sides[1].name} {led.losses} 胜 / 和 {led.draws}')
    print(f'WDL 分数 {led.score:.4f}（和棋按半分计入分母） '
          f'颜色配平 候选执红 {led.red_games} / 执黑 {led.black_games}')
    print(f'Elo 差（候选 − 基准）{led.elo:+.1f}  95% CI '
          f'[{led.elo_lo:+.1f}, {led.elo_hi:+.1f}]')
    for side in sides:
        print(f'  {side.name}: 步数 {side.moves} 节点合计 {side.total_nodes:,}'
              f'（真实展开 {side.total_true_nodes:,}）'
              f' 单步峰值 {side.max_move_nodes:,}（真实 {side.max_true_nodes:,}）'
              f' 上界 {node_bound(side.kind, side.budget):,} '
              f'开局库手 {side.book_moves}')
    print(f'裁决 {led.verdict}')
    for r in led.reasons:
        print(f'  · {r}')
    for p in led.problems:
        print(f'  ! 尺子问题：{p}')
    print(f'耗时 {time.time() - t0:.1f}s')

    out = report_dict(led, sides, shared, args.split, args.seed, ' '.join(sys.argv[1:]))
    active = read_active()
    out['active_before'] = active
    if active and active.get('sha') and sides[1].sha and active['sha'] != sides[1].sha:
        print(f'[arena2] 注意：active.json 指向的 sha({active["sha"][:12]}) '
              f'与本轮基准({sides[1].sha[:12]})不是同一个 —— '
              f'确认你要比的是不是当前生效版本')
    if args.report:
        write_gate_report(out, args.report)
        print(f'[arena2] 明细报告: {args.report}')
    if args.split == 'gate':
        path = args.gate_out or GATE_JSON
        write_gate_report(out, path)
        print(f'[arena2] 闸门报告: {path}（裁决 {led.verdict}；'
              f'active.json 未改动，要晋级由人来翻）')
    return 0 if not led.problems else 1


# --------------------------------------------------------------------------- #
# 自检 + 牙齿检验
# --------------------------------------------------------------------------- #

# 自检用的刻度：内置引擎约 95 knps，预算 1400 节点 ≈ 15ms/步，
# 20 步上限 ≈ 每局 0.4s。这个尺度只能验机械，不能验棋力 —— 精度是
# 那 300 局挂机的活，别拿这里的数字说事。
SB_BUDGET = 1400
SB_MAX_PLY = 20
SB_GAMES = 2           # 一轮 = 两局（同一开局交换颜色）

# 自检要拿来当「改动前基准」的那个 commit：M3（节点预算 + use_book 进接缝）之前
# 的最后一版。钉死它而不是取 HEAD，理由在上面 S4 的注释里 —— 提交之后 HEAD 就
# 带上 max_nodes 了，「补装路径」这条分支会从此走不到，自检变成假牙。
SELFTEST_BASELINE_REF = '16483fa'


def _initial_fen() -> str:
    return nt.to_fen(core.initial, True)


def build_sides(spec_a: Dict[str, Any], spec_b: Dict[str, Any],
                shared: Optional[Dict[str, Any]] = None,
                quiet: bool = True) -> Tuple[List[Side], Dict[str, Any]]:
    fairness = dict(DEFAULTS)
    if shared:
        fairness.update(shared)
    _fa, only_a = merge_fairness({**spec_a}, fairness, spec_a.get('name', 'A'))
    _fb, only_b = merge_fairness({**spec_b}, fairness, spec_b.get('name', 'B'))
    sides = [
        build_side(only_a.get('name', 'A'), only_a, fairness, default_baseline_dir(),
                   'arena2_ns_a', quiet=quiet),
        build_side(only_b.get('name', 'B'), only_b, fairness, default_baseline_dir(),
                   'arena2_ns_b', quiet=quiet),
    ]
    return sides, fairness


def _synthetic_ledger(outcomes: Iterable[str]) -> Ledger:
    rounds = []
    lst = list(outcomes)
    for i in range(0, len(lst), 2):
        pair = lst[i:i + 2]
        games = []
        for j, oc in enumerate(pair):
            games.append({'outcome': oc, 'cand_color': 'red' if j == 0 else 'black',
                          'sec': 0.0, 'nodes': {'cand': 0, 'base': 0}})
        rounds.append({'games': games})
    return summarize(rounds, 'A', 'B')


def _rigged_wdl(wins: int, draws: int, losses: int) -> float:
    """故意写坏的计数器：老 arena 的算法（和棋从分母里踢掉）。

    它存在的唯一理由就是证明 ``check_ledger`` 有牙 —— 传进 ``summarize``
    之后账本必须报问题，不报就是这套断言是假的。
    """
    return wins / max(1, wins + losses)


def selftest(lite: bool = False) -> List[Tuple[str, bool, str]]:
    """自检。每条都配一个「注入已知坏输入必须变红」，红不起来的断言不算断言。

    返回 ``(标签, 是否通过, 详情)`` 列表；``tools/verify.py`` 的 J 段直接把这些
    接进它自己的计数器，所以一条命令还是 ``python tools/verify.py`` 全跑。
    """
    out: List[Tuple[str, bool, str]] = []

    def add(label: str, ok: bool, detail: str = '') -> None:
        out.append((label, bool(ok), detail))

    def expect_raise(label: str, fn, needle: str = '') -> None:
        """负控：这件坏事先必须被拒；顺手把「拒得太宽」也用正控卡住。"""
        try:
            fn()
        except (ConfigError, RigError) as exc:
            msg = str(exc)
            if needle and needle not in msg:
                add(label, False, f'拒了，但理由不对：{msg[:120]}')
            else:
                add(label, True, msg[:100])
            return
        except Exception as exc:                          # noqa: BLE001
            add(label, False, f'抛的是 {type(exc).__name__}: {exc}（期望 ConfigError/RigError）')
            return
        add(label, False, '没报错 —— 这条断言没有牙')

    # ---- S1 开局切分 --------------------------------------------------- #
    try:
        all_fens = load_openings()
        add('S1 开局库 1000 条全部解析、无重复', len(all_fens) == 1000, f'{len(all_fens)} 条')
        sp = split_openings(all_fens)
        train, gate = sp['train'], sp['gate']
        add('S1 切分 700 / 300', (len(train), len(gate)) == (700, 300),
            f'train={len(train)} gate={len(gate)}')
        add('S1 训练集与闸门集不相交', not (set(train) & set(gate)),
            f'交集 {len(set(train) & set(gate))}')
        again = split_openings(all_fens)
        add('S1 切分确定性（同 seed 同结果）',
            again['train'] == train and again['gate'] == gate)
        add('S1 闸门集指纹稳定',
            openings_fingerprint(gate) == openings_fingerprint(again['gate']),
            openings_fingerprint(gate))
        # 牙齿：切分必须按下标哈希排，不许用整列置换（见 split_openings 的注释）。
        # 换成 shuffle 的话这条会红 —— 追加一条开局把 300 个闸门题全换掉，
        # 等于把历史闸门报告作废，而这正是「同一把尺子」最容易悄悄失效的地方。
        grown = list(all_fens) + [all_fens[0]]
        sp_g = split_openings(grown)
        before_of = {i: ('train' if i in set(sp['train_index']) else 'gate')
                     for i in range(len(all_fens))}
        after_of = {i: ('train' if i in set(sp_g['train_index']) else 'gate')
                    for i in range(len(all_fens))}
        moved = [i for i in before_of if before_of[i] != after_of[i]]
        add('S1 牙齿：追加一条开局不许把闸门集换血（最多边界上一个换组）',
            len(moved) <= 1, f'换组 {len(moved)} 个：{moved[:5]}')
    except RigError as exc:
        add('S1 开局库载入', False, str(exc)[:150])
        all_fens, gate = [], []

    bad_dir = tempfile.mkdtemp(prefix='arena2_s1_')
    bad_path = os.path.join(bad_dir, 'bad.fen')
    with open(bad_path, 'w', encoding='utf-8') as fh:
        fh.write(all_fens[0] + '\n' if all_fens else '')
        fh.write('这不是 FEN\n')
    expect_raise('S1 牙齿：坏 FEN 被拒而不是静默丢行',
                 lambda: load_openings(bad_path, expect=0), '不合格')

    # ---- S2 配置守门（硬伤 1）------------------------------------------ #
    expect_raise('S2 牙齿：只给候选开开局库 → 拒',
                 lambda: merge_fairness({'name': 'A', 'use_book': True}, dict(DEFAULTS), 'A'),
                 'use_book')
    # 正控：同一份刻度两侧都同意，就该过得去（否则守门是橡皮图章的反面 —— 全拒）
    ok_shared, _ = merge_fairness({'name': 'A'}, dict(DEFAULTS), 'A')
    add('S2 正控：不声明任何刻度时沿用共用值', ok_shared == DEFAULTS)
    expect_raise('S2 牙齿：只给一侧改节点预算 → 拒',
                 lambda: merge_fairness({'name': 'A', 'max_nodes': 99999}, dict(DEFAULTS), 'A'),
                 'max_nodes')
    expect_raise('S2 牙齿：只给一侧换引擎 → 拒',
                 lambda: merge_fairness({'name': 'A', 'engine': 'pikafish'}, dict(DEFAULTS), 'A'),
                 'engine')
    expect_raise('S2 牙齿：拼错的键不许被静默忽略',
                 lambda: merge_fairness({'name': 'A', 'use_books': True}, dict(DEFAULTS), 'A'),
                 '不认识的键')
    expect_raise('S2 牙齿：奇数局数不许开跑（颜色配不平）',
                 lambda: validate_shared(dict(DEFAULTS), 7, 'train', True), '偶数')
    expect_raise('S2 牙齿：闸门模式少了 --baseline 不许开跑',
                 lambda: validate_shared(dict(DEFAULTS), 300, 'gate', False), '--baseline')
    expect_raise('S2 牙齿：有派生量的参数（piece）不许半覆盖',
                 lambda: apply_params(_own_ns(), {'core.piece': {'P': 50}}, 'A'), '派生')
    expect_raise('S2 牙齿：白名单外的搜索参数被拒',
                 lambda: apply_params(_own_ns(), {'search.NOT_A_THING': 1}, 'A'), '白名单')
    add('S2 开局库默认值是关（不是老 arena 的开）', DEFAULTS['use_book'] is False)

    # ---- S3 WDL / Elo / 裁决（硬伤 2）--------------------------------- #
    led = _synthetic_ledger(['win', 'draw'] * 5)
    add('S3 5 胜 5 和 → WDL 分数 0.75', abs(led.score - 0.75) < 1e-12, f'{led.score}')
    add('S3 5 胜 5 和 → Elo ≈ +190.8（和棋按半分）', abs(led.elo - 190.85) < 0.5,
        f'{led.elo:+.1f}')
    add('S3 干净账本没有尺子问题', led.problems == [], str(led.problems))
    rigged = summarize([{'games': [{'outcome': o, 'cand_color': c, 'sec': 0.0,
                                     'nodes': {'cand': 0, 'base': 0}}
                                    for o, c in zip(['win', 'draw'] * 5,
                                                    ['red', 'black'] * 5)]}],
                       'A', 'B', scorer=_rigged_wdl)
    add('S3 牙齿：把和棋从分母里踢掉的计数器必红', bool(rigged.problems),
        (rigged.problems or ['没报问题 —— 断言没牙'])[0][:110])

    all_draws = _synthetic_ledger(['draw'] * 4)
    add('S3 全和 → 分数 0.5 / Elo 0 / 区间退化到 0',
        abs(all_draws.score - 0.5) < 1e-12 and abs(all_draws.elo) < 1e-9
        and abs(all_draws.elo_lo) < 1e-9 and abs(all_draws.elo_hi) < 1e-9,
        f'score={all_draws.score} elo={all_draws.elo:+.1f} '
        f'ci=[{all_draws.elo_lo:+.1f},{all_draws.elo_hi:+.1f}]')
    add('S3 全和不许报 promote（也不许报 reject）',
        all_draws.verdict == 'inconclusive', all_draws.verdict)

    ten = _synthetic_ledger(['win', 'draw'] * 5)
    v_promote, r1 = verdict_of(10, ten.elo_lo, ten.elo_hi, [], min_games=10)
    add('S3 正控：把样本量闸门降到 10 就能 promote（promote 分支是活的）',
        v_promote == 'promote', f'ci=[{ten.elo_lo:+.1f},{ten.elo_hi:+.1f}] ' + str(r1))
    v_real, r2 = verdict_of(10, ten.elo_lo, ten.elo_hi, [])
    add('S3 样本量闸门：10 局一律 inconclusive，哪怕 CI 不过 0',
        v_real == 'inconclusive' and any('样本' in x for x in r2), '; '.join(r2)[:110])
    lose = _synthetic_ledger(['loss'] * 10)
    v_rej, r3 = verdict_of(10, lose.elo_lo, lose.elo_hi, [], min_games=10)
    add('S3 负控：0 胜 10 负 → reject（reject 分支也是活的）', v_rej == 'reject',
        f'ci=[{lose.elo_lo:+.1f},{lose.elo_hi:+.1f}]')
    wide = ci_elo_from_scores([1.0, 0.5] * 5)[2] - ci_elo_from_scores([1.0, 0.5] * 5)[0]
    many = ci_elo_from_scores(([1.0] + [0.5] * 9) * 10)
    add('S3 区间随样本收窄（√n 律）', (many[2] - many[0]) < wide,
        f'n=10 宽 {wide:.0f} → n=100 宽 {many[2] - many[0]:.0f}')
    expect_raise('S3 牙齿：零局算不出分数', lambda: wdl_score(0, 0, 0), '没有对局')
    unbal = _synthetic_ledger(['win', 'win', 'draw', 'draw'])
    unbal.red_games, unbal.black_games = 3, 1
    unbal.problems = check_ledger(unbal, [1.0, 0.5, 0.5, 0.0][:len(unbal.games)])
    add('S3 牙齿：颜色没配平必红', any('颜色' in p for p in unbal.problems),
        str(unbal.problems)[:110])

    # ---- S4 节点预算（硬伤 3，真下）------------------------------------ #
    sides, fairness = build_sides({'name': 'A'}, {'name': 'B'},
                                 {'max_nodes': SB_BUDGET, 'max_depth': 24})
    if lite:
        add('S4 跳过（--lite）：不真下棋的部分留给完整自检', True, 'lite')
    else:
        add('S4 候选侧接缝原生支持 max_nodes', sides[0].cap_mode == 'native',
            sides[0].cap_mode)
        for side in sides:
            info = side.choose(core.initial, True, (core.initial,), (), None)
            add(f'S4 {side.name} 内置预算是硬上界（nodes <= budget）',
                info.nodes <= SB_BUDGET, f'nodes={info.nodes} budget={SB_BUDGET}')
        add('S4 两侧都没吃开局库', sum(s.book_moves for s in sides) == 0,
            f'book_moves={sum(s.book_moves for s in sides)}')

        # 黑方视角再来一遍：预算判定与参考系无关，但这条要真的量一次
        for side in sides:
            info = side.choose(core.initial, False, (core.initial,), (), None)
            add(f'S4 {side.name} 黑方视角同样受预算约束', info.nodes <= SB_BUDGET,
                f'nodes={info.nodes}')
        for side in sides:
            side.reset_ledger()

        led_real = run_match(sides, [all_fens[0], all_fens[1]], SB_GAMES * 2,
                             cand_idx=0, max_ply=SB_MAX_PLY, verbose=False)
        add('S4 牙齿：预算越界必红（真下一轮之后仍守住上界）',
            all(s.max_move_nodes <= node_bound(s.kind, s.budget) for s in sides),
            ' '.join(f'{s.name}:{s.max_move_nodes}/{s.budget}' for s in sides))
        # 真实展开量同一条上界，而且它必须**贴到**预算：接缝报的是「最后一个完成层」，
        # 被预算掐断的那一层不进报值（实测预算 4000 时只报 1078）。如果这里
        # 也只用报值，「预算压根没生效」就能藏在报值的宽松上界里不被发现 ——
        # 所以既要真量 <= 上界，也要真量 >= 预算的一半（证明确实是预算在收手）。
        add('S4 真实展开量同样守住上界',
            all(s.max_true_nodes <= node_bound(s.kind, s.budget) for s in sides),
            ' '.join(f'{s.name}:{s.max_true_nodes}' for s in sides))
        add('S4 正控：真实展开量贴到预算（是预算在收手，不是深度先到）',
            all(s.max_true_nodes >= SB_BUDGET // 2 for s in sides),
            ' '.join(f'{s.name}:{s.max_true_nodes}/{SB_BUDGET}' for s in sides))
        add('S4 正控：真实展开量 >= 报值（缺口方向只能是「报的比做的少」）',
            all(s.max_true_nodes >= s.max_move_nodes for s in sides),
            ' '.join(f'{s.name}:{s.max_true_nodes}v{s.max_move_nodes}' for s in sides))
        problems = check_rig(sides, {'use_book': False}, led_real.games)
        add('S4 干净轮次的尺子体检为空', problems == [], str(problems)[:120])
        # 注入：假装某一侧的预算根本没生效（报值口径）
        saved = sides[0].max_move_nodes
        sides[0].max_move_nodes = SB_BUDGET * 10
        injected = check_rig(sides, {'use_book': False}, led_real.games)
        sides[0].max_move_nodes = saved
        add('S4 牙齿：把单步节点改成超预算 → 体检必红',
            any('超过上界' in p for p in injected), (injected or ['没红'])[0][:110])
        # 注入：报值干净、真实量越界 —— 只有「两个口径都查」才咬得住这种坏法
        saved_true = sides[0].max_true_nodes
        sides[0].max_true_nodes = SB_BUDGET * 10
        injected_t = check_rig(sides, {'use_book': False}, led_real.games)
        sides[0].max_true_nodes = saved_true
        add('S4 牙齿：只有真实量越界（报值干净）时也必须红',
            any('真实量' in p for p in injected_t), (injected_t or ['没红'])[0][:110])
        saved_book = sides[0].book_moves
        sides[0].book_moves = 3
        injected_b = check_rig(sides, {'use_book': False}, led_real.games)
        sides[0].book_moves = saved_book
        add('S4 牙齿：配置关书却吃了书 → 体检必红',
            any('开局库' in p for p in injected_b), (injected_b or ['没红'])[0][:110])

        # 太小的预算要在开跑前拒掉，而不是下到一半炸
        starve_sides, _ = build_sides({'name': 'A'}, {'name': 'B'}, {'max_nodes': 4096})
        expect_raise('S4 牙齿：预算小于两拍 → 开跑前就拒',
                     lambda: validate_shared({'engine': 'builtin', 'max_nodes': 100,
                                              'max_depth': 24, 'time_limit': 60.0,
                                              'use_book': False, 'threads': 1,
                                              'hash_mb': 64}, 4, 'train', True),
                     '太小')
        del starve_sides

        # ---- 基准工作树（改动前那份代码）：补装路径要真的管用 ---------- #
        # 基准 ref 钉死在「改动前那一版」而不是取 HEAD：这一段的对象是「接缝里
        # 没有 max_nodes 字段」的那份代码，而 HEAD 在我们提交之后就有字段了 ——
        # 拿 HEAD 当基准的自检会在提交那一刻静默变成一条永不会走到的分支。
        base_sha = _git(['rev-parse', '--verify', f'{SELFTEST_BASELINE_REF}^{{commit}}'])
        base_dir = default_baseline_dir()
        pre_existing = os.path.isdir(baseline_path_for(base_sha, base_dir))
        try:
            b_sides, _ = build_sides({'name': '候选'},
                                     {'name': '基准', 'root': SELFTEST_BASELINE_REF},
                                     {'max_nodes': SB_BUDGET})
            wrap = b_sides[1]
            add('S4 基准侧接缝没有 max_nodes 字段 → 走 _tick 补装',
                wrap.cap_mode == 'tick_wrap', f'{wrap.cap_mode} sha={(wrap.sha or "")[:12]}')
            info = wrap.choose(core.initial, True, (core.initial,), (), None)
            add('S4 牙齿：补装之后基准侧同样 nodes <= budget',
                info.nodes <= SB_BUDGET, f'nodes={info.nodes} budget={SB_BUDGET} '
                f'有效预算={wrap.effective_budget}')
            info_b = wrap.choose(core.initial, False, (core.initial,), (), None)
            add('S4 基准侧黑方视角也受补装的预算约束', info_b.nodes <= SB_BUDGET,
                f'nodes={info_b.nodes}')
            add('S4 基准侧补装了 use_book=False（老默认是开书）',
                wrap.book_mode == 'wrap_default_off', wrap.book_mode)
            add('S4 牙齿：基准侧真的补装了预算（不是「碰巧没花完」）',
                wrap.effective_budget == SB_BUDGET - TICK_STRIDE
                and wrap.cap_mode == 'tick_wrap',
                f'有效预算={wrap.effective_budget} 模式={wrap.cap_mode}')
            led2 = run_match(b_sides, [all_fens[2]], SB_GAMES * 2, cand_idx=0,
                             max_ply=SB_MAX_PLY, verbose=False)
            add('S4 候选(原生) vs 基准(补装) 一轮跑通且都在预算内',
                led2.games and all(
                    max(s.max_move_nodes, s.max_true_nodes) <= node_bound(s.kind, s.budget)
                    for s in b_sides),
                ' '.join(f'{s.name}:{s.max_true_nodes}' for s in b_sides))
            # 补装侧的真实量也得落在「有效预算 ~ 上界」这条窄带里：小于有效预算
            # 说明收手机制压根没启动，大于上界说明整拍判定漏了。
            # 这一格 1024 的粒度是**已知代价**，写出来而不是藏起来：自检的 1400
            # 节点上它占 27%，真跑闸门的 40000 节点上只占 2.6% —— 基准侧最多比
            # 候选侧少展开一个整拍，这个方向对基准不利，所以闸门数字只会偏保守。
            add('S4 补装侧真实量落在有效预算与上界之间（粒度代价看得见）',
                wrap.effective_budget <= wrap.max_true_nodes <= SB_BUDGET,
                f'真实={wrap.max_true_nodes} 有效预算={wrap.effective_budget} '
                f'上界={SB_BUDGET}')
        except (RigError, ConfigError) as exc:
            add('S4 基准工作树', False, str(exc)[:150])
        finally:
            # 只退掉「这次自检自己拉出来的」那棵树；如果它本来就在（多半是
            # 用户真的跑过 --baseline 16483fa），删掉它等于把别人的闸门缓存砸了。
            if not pre_existing:
                release_baseline(baseline_path_for(base_sha, base_dir))

    # ---- S5 同一份配置自对弈（硬伤 1+2 的合取检验）-------------------- #
    if lite:
        add('S5 跳过（--lite）：同构自对弈要真下棋', True)
    else:
        id_sides, _ = build_sides({'name': '甲'}, {'name': '乙'},
                                  {'max_nodes': SB_BUDGET})
        led_id = run_match(id_sides, [all_fens[0]], SB_GAMES * 2, cand_idx=0,
                           max_ply=SB_MAX_PLY, verbose=False)
        scores = [1.0 if g['outcome'] == 'win' else 0.5 if g['outcome'] == 'draw' else 0.0
                  for g in led_id.games]
        n = len(scores)
        mean = sum(scores) / n
        var = sum((x - mean) ** 2 for x in scores) / (n - 1) if n > 1 else 0.0
        se = math.sqrt(var / n) if n else 0.0
        add('S5 同构局里确实出现了和棋（牙齿依赖的前提）', led_id.draws >= 1,
            f'{led_id.wins}胜 {led_id.draws}和 {led_id.losses}负')
        add('S5 牙齿：候选=基准时分数不许偏离 0.5（样本自缩放容差）',
            abs(mean - 0.5) <= max(2 * se, 0.02),
            f'score={mean:.3f} se={se:.3f} tol={max(2 * se, 0.02):.3f}')
        add('S5 候选=基准 → 95% CI 跨过 0',
            led_id.elo_lo <= 0 <= led_id.elo_hi,
            f'elo={led_id.elo:+.1f} ci=[{led_id.elo_lo:+.1f},{led_id.elo_hi:+.1f}]')
        add('S5 候选=基准 → 裁决不许是 promote', led_id.verdict != 'promote',
            f'{led_id.verdict}: ' + '; '.join(led_id.reasons)[:90])
        add('S5 候选=基准 → 颜色严格配平',
            led_id.red_games == led_id.black_games == SB_GAMES,
            f'红 {led_id.red_games} 黑 {led_id.black_games}')
        add('S5 尺子体检干净', led_id.problems == [], str(led_id.problems)[:120])

        # 真·牙齿（硬伤 2 的那一口）：把上面这轮真实账本的「和棋不进账」版本
        # 喂给 check_ledger —— 局记录保持原样（含和棋），只把计数按老 arena
        # 的写法改成「胜+负」。只要这一轮出过和棋（上面已断言 draws>=1），
        # 计数与局数就对不上、分数与重算值也对不上，必红。
        #
        # 为什么这里不用「换个 scorer 再 summarize 一遍」当牙齿：和棋被踢出
        # 分母这件事，在**胜负恰好配平**的样本上与诚实口径恒等
        # （w==l 时 w/(w+l)=0.5=(w+0.5d)/(2w+d)），于是它会静默地不红。
        # 那种恒等式是算法性质，不是巧合，所以确定性的 scorer 牙齿放在 S3
        # （5 胜 5 和的固定计数上），这里只咬「和棋不进账」这一种写法。
        rigged_id = dataclasses.replace(led_id, draws=0)
        rigged_problems = check_ledger(rigged_id, [OUTCOME_SCORE[g['outcome']]
                                                   for g in rigged_id.games])
        add('S5 牙齿：同构自对弈把和棋从账里踢掉 → check_ledger 必红',
            bool(rigged_problems),
            f'wins={led_id.wins} draws={led_id.draws} losses={led_id.losses} '
            f'problems={(rigged_problems or ["没报问题 —— 断言没牙"])[0][:90]}')

    # ---- S6 开局库真的是一个可点亮的变量 ------------------------------- #
    ns = _own_ns()
    searcher = ns.Searcher()
    pos = core.make_position(core.initial, True)
    book_hit = None
    for info in searcher.search(pos, max_depth=3, time_limit=None,
                                root_is_red=True, use_book=True,
                                max_nodes=SB_BUDGET):
        if info.get('book'):
            book_hit = info
            break
    add('S6 正控：use_book=True 时开局库真的会命中（接缝报告 book 字段）',
        book_hit is not None, str(book_hit and book_hit.get('move')))
    last = None
    for info in ns.BuiltinEngine().search(
            SearchRequest(board=core.initial, red_to_move=True, max_depth=3,
                          time_limit=None, use_book=False, max_nodes=SB_BUDGET)):
        last = info
    add('S6 牙齿：use_book=False 时一双手都不吃书，且真的展开了节点',
        last is not None and not last.book and last.nodes > 1,
        f'book={getattr(last, "book", None)} nodes={last.nodes if last else None}')

    # ---- S7 闸门报告 --------------------------------------------------- #
    tmp = tempfile.mkdtemp(prefix='arena2_s7_')
    active_path = os.path.join(tmp, 'active.json')
    with open(active_path, 'w', encoding='utf-8') as fh:
        fh.write('{"sha": "deadbeef", "note": "假的指针，自检不许动它"}\n')
    before = open(active_path, encoding='utf-8').read()
    if lite:
        rep_sides = sides
    else:
        rep_sides, rep_fair = build_sides({'name': '候选'}, {'name': '基准'},
                                          {'max_nodes': SB_BUDGET})
    rep_led = _synthetic_ledger(['win', 'draw'] * 2)
    rep = report_dict(rep_led, rep_sides, dict(DEFAULTS), 'gate', 1, 'selftest')
    need = ('timestamp', 'candidate_sha', 'baseline_sha', 'split', 'games',
            'wins', 'draws', 'losses', 'wdl_score', 'elo', 'elo_ci95', 'verdict',
            'reasons', 'fairness', 'auto_promoted')
    missing = [k for k in need if k not in rep]
    add('S7 闸门报告字段齐全', missing == [], f'缺 {missing}')
    add('S7 报告记的是「不自动晋级」', rep['auto_promoted'] is False)
    gate_path = os.path.join(tmp, 'last_gate.json')
    write_gate_report(rep, gate_path)
    back = json.load(open(gate_path, encoding='utf-8'))
    add('S7 报告落盘且可原样读回（按 key 排序、UTF-8）',
        back['verdict'] == rep['verdict'] and back['elo_ci95'] == rep['elo_ci95'])
    add('S7 active.json 只读不写', open(active_path, encoding='utf-8').read() == before)
    add('S7 读 active.json：present 时原样带回',
        (read_active(active_path) or {}).get('sha') == 'deadbeef')
    add('S7 读 active.json：没有指针文件时返回 None 而不是编一个',
        read_active(os.path.join(tmp, 'nope.json')) is None)
    bad_active = os.path.join(tmp, 'broken.json')
    with open(bad_active, 'w', encoding='utf-8') as fh:
        fh.write('{ not json')
    expect_raise('S7 牙齿：坏掉的 active.json 要报错，不许替人猜版本',
                 lambda: read_active(bad_active), 'active.json')

    for side in rep_sides if not lite else []:
        if isinstance(side.adapter, side.ns.PikafishAdapter):
            side.adapter.engine.quit()
    return out


def _own_ns():
    """度量台宿主自己那份 engine 包（S6/S7 要直接探 Searcher 的行为）。"""
    import engine
    return engine


# --------------------------------------------------------------------------- #
# 入口
# --------------------------------------------------------------------------- #

def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(
        description='elephantfish 对局度量台第二代（同刻度 A/B + WDL/Elo + 固定节点预算）')
    ap.add_argument('--split', choices=('train', 'gate'), default='train',
                    help='train=700 个可调参的开局；gate=300 个只做闸门的开局')
    ap.add_argument('--games', type=int, default=10, help='局数，必须是偶数（一轮两局交换颜色）')
    ap.add_argument('--budget', type=int, default=DEFAULTS['max_nodes'],
                    help='两侧共用的固定节点预算（max_nodes）')
    ap.add_argument('--max-depth', type=int, default=DEFAULTS['max_depth'])
    ap.add_argument('--time-limit', type=float, default=DEFAULTS['time_limit'],
                    help='看门狗（秒/步），不是预算；节点预算才是刻度')
    ap.add_argument('--engine', choices=ENGINE_KINDS, default=DEFAULTS['engine'],
                    help='两侧必须同一个引擎')
    ap.add_argument('--book', action='store_true',
                    help='两侧一起开开局库（默认关；开了就等于在量开局库）')
    # 这两个只在 --engine pikafish 时真的起作用（内置引擎是单线程、自带表大小），
    # 但它们仍是 FAIRNESS_KEYS 的成员：两侧不一致就不是同一把尺子了。
    # 放在共用刻度里而不是 side 的 params 里，因为「谁允许不同」只有
    # root / params / name 一条规则，多一条规则就多一类静默污染。
    ap.add_argument('--threads', type=int, default=DEFAULTS['threads'],
                    help='皮卡鱼线程数（两侧同一个数；内置引擎忽略它）')
    ap.add_argument('--hash', type=int, default=DEFAULTS['hash_mb'],
                    help='皮卡鱼置换表 MB（内置引擎忽略它）')
    ap.add_argument('--candidate', default=None,
                    help='候选侧：目录 / git ref / JSON 配置（省略=度量台所在根）')
    ap.add_argument('--baseline', default=None,
                    help='基准侧：目录 / git ref / JSON 配置；--split gate 必填')
    ap.add_argument('--params-a', default=None,
                    help='候选侧引擎参数：JSON 对象或 @文件（白名单内的搜索常量）')
    ap.add_argument('--params-b', default=None,
                    help='基准侧引擎参数：JSON 对象或 @文件')
    ap.add_argument('--max-ply', type=int, default=200, help='单局步数上限')
    ap.add_argument('--openings', default=OPENINGS_PATH)
    ap.add_argument('--seed', type=int, default=DEFAULT_SEED, help='开局顺序的种子')
    ap.add_argument('--min-games', type=int, default=MIN_GATE_GAMES,
                    help='promote 的样本量下限（默认 100；改它就是在拔尺子的牙）')
    ap.add_argument('--baseline-root', dest='baseline_dir', default=None,
                    help='ref 展开成工作树时的落脚目录（默认为系统临时目录下）')
    ap.add_argument('--report', default=None, help='把明细写成 JSON 到这个路径')
    ap.add_argument('--gate-out', default=None, help='闸门报告落地路径（默认 data/learned/last_gate.json）')
    ap.add_argument('--quiet', action='store_true', help='不逐局打印')
    ap.add_argument('--selftest', action='store_true', help='跑自检（含牙齿检验）')
    ap.add_argument('--lite', action='store_true', help='自检只跑不依赖真对局的部分')
    return ap


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    if args.baseline_dir is None:
        args.baseline_dir = default_baseline_dir()
    if args.selftest:
        results = selftest(lite=args.lite)
        fails = [r for r in results if not r[1]]
        print(f'\n[arena2 --selftest] {len(results)} 条断言，失败 {len(fails)} 条')
        for label, ok, detail in results:
            print(f"  [{'ok  ' if ok else 'FAIL'}] {label}" + (f'  —— {detail}' if detail else ''))
        return 1 if fails else 0
    return cmd_run(args)


if __name__ == '__main__':
    sys.exit(main())
