![Elephantfish](logo/elephantfish.jpg)

## 介绍 

elephantfish 是受到 [sunfish](https://github.com/thomasahle/sunfish) 启发而撰写的纯python的中国象棋引擎，核心代码只有几百行（见 [elephantfish.py](elephantfish.py)）,棋力方面我仅进行过其与象棋小巫师傻瓜难度的一场对局，在我测试的对剧中，elephantfish赢得了比赛。

在几天前看到了[sunfish](https://github.com/thomasahle/sunfish)这个项目(是一个国际象棋引擎，只有111行)，觉得很有意思，于是做了一个类似中国象棋版本，中国象棋和国际象棋略有不同，我仅仅单独完成了棋规部分，子力价值表直接的参考了 [象眼](https://www.xqbase.com/league/elephanteye.htm) ,mtd search部分的代码由于原版sunfish写的非常通用，我也就一行未改。

如果你对于程序中的mtd search看不懂建议先看一些对弈基础理论,比如articles下的几篇文章，如[对弈程序基本技术](articles/对弈程序基本技术.pdf)，其官方网址：https://www.xqbase.com/computer/outline.htm

elephantfish默认会进行5秒钟的思考，当然实际一般会比5秒多一些，如果你想要它进行更长时间搜索以获得更好的性能可以对源码相应位置进行更改。

如同sunfish一样，我认为elephantfish会是一个很好的平台，由于其代码非常少，可以很方便的进行各种实验，希望各位感兴趣的同学可以尝试对其进行优化. 如果在优化后想要评估和目前版本的棋力差别，可以使用 `tools/arena.py` 中的 self_arena 来将你的代码和elephantfish进行对弈。

如果你觉得这个版本的象棋ai实力不够强，可以看看 [XQpy](https://github.com/bupticybee/XQPy)

## 运行截图

    Think depth: 6 My move: b9c7

      9 俥．象士将士象傌俥
      8 ．．．．．．．．．
      7 ．砲傌．．．．砲．
      6 卒．卒．卒．卒．卒
      5 ．．．．．．．．．
      4 ．．．．．．．．．
      3 兵．兵．兵．兵．兵
      2 ．炮．．炮．．．．
      1 ．．．．．．．．．
      0 车马相仕帅仕相马车
        ａｂｃｄｅｆｇｈｉ
        
    Your move:


Web UI（转述对局台）见下方「转述对局台」一节。

# 运行elephantfish!

elephahtfish 自包含在 `elephantfish.py` 文件中，只是用了python的自带操作而没有使用任何第三方库. 建议使用 `pypy` 或者 `pypy3` 来获得更好的性能表现.

简单的使用命令```python elephantfish.py``` 或者```pypy elephantfish.py``` 就可以运行象棋程序,程序会利用自带一个命令行工具进行对局.

## 转述对局台（Web UI）

如果以 Web UI 方式下棋，直接用启动脚本（首次会自动构建前端）：

```bash
start.bat           # Windows：双击即可
./start.sh          # macOS / Linux：可指定端口，如 ./start.sh 8020
```

脚本会自动找 Python、按需构建前端、拉起服务并打开浏览器。默认端口 8010；若它已被别的程序占用，脚本会先认出占用者不是本服务，再自动往后顺延一个空闲端口，不会把页面开到别人的接口上。服务跑在当前窗口，按 `Ctrl+C` 停止。

也可以完全手动：

```bash
cd frontend && npm install && npm run build     # 构建前端，只需要一次
python server/app.py 8010                       # 启动服务
```

浏览器打开 `http://localhost:8010/` 即可。

### 这个界面是干什么的

它不是「人和引擎下棋」的界面，而是**让人当信使**的界面：

```
对手大模型下一步棋  →  人把这一步录进棋盘  →  引擎算出应手
→  人把应手喂回对手大模型  →  循环，直到将死对方
```

所以整个界面围绕「录入对方走法 / 取走我方应手」这两件事设计。**录入以棋盘为先**：

- **直接摆子**：点棋盘上的棋子、再点落点；或者按住它拖过去。轮到的子有抓手光标，可走的点会亮起来，拖到哪个点哪个点张开。这是最快的一条路 —— 不需要把棋步翻译成任何符号；
- 习惯键盘的人，也可以在转述台①里敲坐标（`h2e2`）或中文记谱（`炮二平五`），输入前几个字符就出候选，`Tab` 补全、回车落子。焦点只对「键盘流」自动跟随：一旦你开始用棋盘，它就不再每手来抢；
- 引擎算棋的时候**照样能输入**：抢录的那一步会排队，引擎一收手自动落子，人不会被计算时间卡住；
- 右侧「引擎应手」一点即复制，直接粘回对手模型；
- 对手模型若提供 HTTP 接口，在「对手模型接入」里填上地址就能半自动拉取。空闲时界面留了一秒一次的慢心跳，别的标签页、或对手接入把局面推走，这边也看得见。

目录结构：

```
engine/            引擎内核（棋盘表示 / 搜索 / 记谱 / 对局状态机）
engine/engine.py   引擎接缝：两个 adapter + 「选哪个 / 谁可用 / 怎么降级」
server/session.py  对局会话（一局棋 + 一个引擎 + 一次在跑的搜索）
server/app.py      转述对局服务的 HTTP 外壳（路由 / 状态码 / 静态资源）
frontend/          Vite + React + TypeScript 界面
tools/arena.py     新老引擎回归对局
tools/verify.py    引擎一致性回归自检（棋规 / 记谱 / 主变 / 战绩 / 并发）
tools/smoke_http.py HTTP 契约自检（路由 / 状态码 / 字段 / 排队 / stale）
.devtools/         界面自检脚本（见下方「界面自检」）
review/            自检与质量迭代报告
```

原版 `elephantfish.py` **原样保留，作为棋力基准与回归 oracle** —— 它不是遗留代码：
`engine/core.py` 继承它的 `Position`，`tools/verify.py` 的走法生成对齐段拿它逐条逐序比对。
文件头有同样的说明。

对局逻辑与 HTTP 分开，图的是**测试面**：`server/session.py` 可以被直接实例化，
于是「引擎收手后排队那一步会不会落地」「搜索在飞时换局会不会把棋落到新对局上」
这类问题能写成普通断言；`server/app.py` 只管解析请求与写响应，由 `smoke_http.py`
走真实 HTTP 验契约。两边不需要为了测试对方而将就。

```bash
python tools/verify.py      # 引擎回归：棋规 / 记谱 / 主变 / 战绩 / 引擎接缝 / 并发（~86s，48 条断言）
python tools/smoke_http.py  # HTTP 契约：路由 / 状态码 / 字段 / 排队 / stale（自动找空闲端口）
```

### 界面自检

`.devtools/` 下是一套 Playwright 自检，一条命令跑完：

```bash
cd .devtools && npm install   # 只需要一次
npm test                      # 自己起服务，跑完自己关掉
```

`npm test` 就是 `node run.mjs`：挑一个空闲端口起 `python server/app.py`、等 `/api/health`、
依次跑三套脚本、汇总退出码（有失败就非零退出）。所以**不必先手动起服务** ——
以前得先开服务再跑脚本，忘了开只会得到一堆连接错误。

```bash
node run.mjs --port 8040      # 指定端口
node run.mjs --only drag      # 只跑一套
EF_PYTHON=py node run.mjs     # 指定解释器（默认 python）
npm run test:api              # HTTP 契约（tools/smoke_http.py）
npm run test:all              # 界面 + HTTP 一起
```

| 脚本 | 管什么 |
|---|---|
| `audit.mjs` | 四档视口的溢出 / 点击目标尺寸 / 控制台错误，外加交互场景与抢录竞态 |
| `drag.mjs` | 拖拽落子与点击落子两条路，坐标由棋子包围盒反推，视角翻转后照样成立 |
| `kbd.mjs` | 键盘走子通路（方向键移光标 → 回车选中 → 回车落子） |

三套脚本**只**通过 `_contract.mjs` 说话，不再各自记一套选择器。它导出的读状态
（`getState` / `boardInfo` / `selectedSquare` / `cursorSquare` …）与找元素
（`piece` / `target` / `relayInputOpen` / `queuedText` …）都跨在**稳定的 DOM 契约**上：

| 契约 | 落在哪 |
|---|---|
| `data-board` `data-flipped` `data-thinking` `data-ply` `data-dragging` | 棋盘容器 |
| `data-square` `data-piece` `data-side` `data-selected` `data-dragging` | 棋子 |
| `data-target` `data-over` | 可落点 |
| `data-kbd-cursor` `data-cursor` | 键盘光标 |
| `data-relay` `data-relay-queued` `data-relay-toggle` `data-relay-input` | 转述台 |
| `data-analysis` | 分析面板 |

外加服务端 `/api/state` 的事实。**不绑定 CSS 类名** —— 类名归样式所有，可以随时改名。
这条规矩不是洁癖，是修出来的：三个脚本原先全都断言过已经改名的类名
（`.relay-field` / `.queue-chip` / `.relay-output` / `.piece.is-lifted` …），
于是 `drag.mjs` 从界面重写那天起恒红、`kbd.mjs` 从不 `process.exit` 恒绿、
`audit.mjs` 里「等服务端闲」的判据恒真 —— 「全绿」从来没有事实依据。
详见 `review/quality-review.html`。

还有一处更隐蔽的坑记在这里：**Playwright 的 `waitForFunction` 不会 await 异步谓词**。
写成 `waitForFunction(async () => …)` 时它看到的是一个真值 Promise 对象，于是立即返回 ——
实测同一个判据同步版等满 626ms、异步版 6ms 就回来了。所以 `_contract.mjs` 里
「服务端闲 + 界面已同步」是**在 Node 侧轮询**实现的，不交给 `waitForFunction`。

**双引擎内核支持**：
- **⚡ 皮卡鱼（Pikafish · NNUE）**：接入世界顶级开源中国象棋引擎（Stockfish 架构 + 官方 NNUE 神经网络评估）。棋力高达 Elo 3500+，通过内置 UCI 驱动长驻运行，每秒搜索数百万至千万节点，中残局压制力极强，与任何对手大模型对弈时拥有绝对的碾压胜率。已随项目内置 macOS（通用二进制）、Windows、Linux 原生支持及 `pikafish.nnue` 权重文件，开箱即用。
- **🐘 象鱼内置（Elephantfish · 纯 Python）**：轻量级自包含教学/实验引擎，无任何外部二进制依赖。

在 Web 界面左侧控制栏的「引擎内核」即可随时一键切换两者。

**引擎接缝**（`engine/engine.py`）：两个引擎的差异关在两个 adapter 里，对外只有一个接口
`Engine.search(SearchRequest) -> Iterator[EngineInfo]`。接缝统一了三件一直散在调用点上的事：

- **参考系**。内置 `Searcher` 内部是「引擎视角」（黑方走棋时整个棋盘转过 180°），
  它的 `move` 是相对走子方的，而 `principal_variation` 又特意翻回了绝对坐标 ——
  这一个不对称，就是以前 `server/app.py` 里那句
  `abs_move = engine_move if red_to_move else flip_move(engine_move)` 存在的原因。
  接缝把 `move` / `pv` 一律定成**绝对坐标**，`score` 是侧方视角、`eval_red` 是红方视角，
  于是调用方一次翻转都不用写。
- **选哪个**。降级规则（偏好皮卡鱼但没装 → 落回内置）以前写在六处，各自重判一遍
  `engine_type == 'pikafish' and is_available`。现在只有 `EngineSet.active` 知道。
- **怎么测**。依赖是接受进来的，不是内部 new 出来的：`EngineSet(builtin=FakeEngine())`
  就能把真搜索整个换掉，`tools/verify.py` 的 H2 段就是这么验的。

**内置 Python 搜索优化**（`engine/search.py`）：MTD(f) 二分换成 PVS + 胜负窗 + 迭代加深；置换表加代际计数器（O(1) 失效，不再 `dict.clear()`）；置换表着法优先试、其余着法懒生成；空着裁剪、LMR、futility 裁剪、静态搜索。着法生成只遍历 90 个真实格点而不是 256 格。

用 `tools/arena.py` 在 1000 个随机开局上跑 50 局回归（深度 5，交换先后手）：

| | 深度 6 耗时 | 深度 6 节点 | 深度 7 耗时 | nps |
|---|---|---|---|---|
| 原版 | 0.71 s | 35.8 k | 12.81 s | ~48 k |
| 现在 | **约 4× 更快** | 大幅下降 | **3.07 s** | ~95 k |

50 局结果：新 24 / 原版 11 / 和 15，即分胜负的棋里新引擎拿 69%，约 **+135 Elo**。**优化让引擎变强了，不只是变快。**

**规则修正**：中国象棋的**困毙（无子可动但不是被将军）是判负**，不是和棋。原版沿用了国际象棋的处理，本仓库改正了。

**正确性验证**（`python tools/verify.py`，一条命令跑完，48 条断言）：

| 项目 | 规模 | 结果 |
|---|---|---|
| 着法生成 vs 原版 | 400 局随机对局、23,927 个随机构面 | 逐条逐**序**一致，分歧 0 |
| 中文记谱往返 | 940,999 步 | 失败 0 |
| ICCS 往返 | 940,999 步 | 失败 0 |
| 引擎接缝（两个 adapter） | 红方/黑方走棋各一遍，内置 + 皮卡鱼 | `move` 落在绝对坐标的合法着法集合里，`pv`/`pv_iccs` 同序，`eval_red` 换算正确 |
| 引擎接缝可替换 | 注入假引擎 | `choose()` 交出注入的对象，降级与校验各只有一份 |
| 困毙判负 | 自造局面 + 对照组 | 判负；抽掉红兵后回到「还在下」 |
| 认输后悔棋 | resign → undo_round → playing | 回到「等对手出招」 |
| 战绩计入与撤回 | 认输 → 悔棋 → 引擎认输，只走公开动词 | 可逆，且终局后再认输不重复记 |
| 主变逐步合法性 | 红方视角 / 黑方视角 | 每步合法，记谱往返一致 |
| 搜索在飞时换局 / 认输 | 假引擎卡在「算完了但还没落子」那一刻 | 旧 worker 那一步被丢弃，不落到新对局上 |
| 排队的一步 | 引擎算棋时录入对方走法 | 不报错、先排队，引擎收手后立刻落地 |
| 拉对手走法不持锁 | 出站请求卡住时并发读快照 | 其他请求照常进得来（不会被一次网络超时堵住） |

着法生成那一项是**连顺序都要求一致**的：重写搜索层不允许带来任何规则层面的漂移。
界面侧另有 `.devtools/` 里的三套 Playwright 自检（`npm test` 一条命令跑完），见上方「界面自检」。
对外 HTTP 契约（状态码 / 字段 / 路由 / stale 任务）由 `python tools/smoke_http.py` 单测，39 条断言。

# 特性

1. 使用简单而高效的 MTD 二分搜索算法（见[对弈程序基本技术](articles/对弈程序基本技术.pdf)）.
2. 使用众所周知的现代象棋引擎trick 比如空着裁剪.
3. 通过简单的子力价值表进行局面评估.
4. 使用python标准数据结构.

# License

[GNU GPL v3](https://www.gnu.org/licenses/gpl-3.0.en.html)
