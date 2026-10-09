# elephantfish 转述台 · 界面升级交接文档

> 面向对象：接手界面升级的执行者（Kimi K3 或任何前端工程师）
> 升级目标：**美观 / 布局质感 / 动效 / 光影细节**，加到 awwwards / Webby / FWA 那一档
> 核心前提：**这不是一个从零开始的项目，是一套已经做完三轮打磨、正在运行的成品。**

---

## §0 怎么用这份文档

**先读完，再动手。**

- §1–§4 是**事实**：项目在哪、已经做到什么程度、设计系统是什么、哪些东西一改就坏。
  这些内容精确到文件行号和令牌取值，**你不需要再跑一遍代码探索**。省下的 token 用来做事。
- §5 是**要做什么**：按 P0 / P1 / P2 排好顺序的升级工作流。
- §6–§8 是**怎么验收**、**别踩哪些坑**、**什么算做完**。

三条纪律：

1. **不要重写。** 这个界面的结构、状态机和交互逻辑都是正确的，且经过回归验证。你要做的是在它上面长东西，不是推倒重来。
2. **一次只做一件事。** 每改完一处，跑一遍 §6 的验收。绿了再动下一处。红着往下做，最后会分不清是谁弄坏的。
3. **不许引入动画库。** 技术栈只有 React 18 + TypeScript + Vite + 原生 CSS。所有动效用手写 CSS keyframes / transition / Web Animations API 完成。

### 直接把下面这段发给执行者

```
读 E:\work\codework\elephantfish\review\ui-upgrade-brief.md，这是界面升级的交接文档。
按文档 §5 的 P0 → P1 → P2 顺序逐项实施，每做完一项按 §6 验收，绿了再做下一项。
文档 §3/§4 是必须遵守的既有约定，不要重新发明设计令牌，不要改动 /api 契约。
不要重写组件，只在现有结构上增量改造。不要引入任何动画库。
注意：棋盘上的点选与拖拽落子是核心录入方式，任何动效改造都不许破坏它。
先只报告你对 §5 的理解和你的实施顺序，等我确认后再动代码。
```

---

## §1 项目地图

一个纯 Python 中国象棋引擎 + 一个本机 HTTP 转述服务 + 一个 React 前端。
**界面只在 `frontend/` 里，你不需要碰 Python。**

```
elephantfish/
├── engine/                引擎内核（Python，别动）
├── server/app.py          转述对局 HTTP 服务（别动）
├── frontend/              ← 你的战场
│   ├── index.html         入口（含内联 SVG favicon）
│   ├── vite.config.ts     dev 端口 5173，/api 代理到 127.0.0.1:8010
│   └── src/
│       ├── App.tsx                     295 行 · 总装：布局、键盘、首屏、终局遮罩
│       ├── types.ts                    197 行 · 服务端契约的类型（别改字段）
│       ├── api.ts                       91 行 · 薄封装 fetch
│       ├── hooks/useGame.ts            310 行 · 轮询 / 提交 / 排队 / toast 的唯一状态源
│       ├── lib/
│       │   ├── board.ts                107 行 · 棋盘几何：cell 80、margin 40、720×800
│       │   ├── format.ts                58 行 · 数字与评分格式化（PAWN_VALUE = 44）
│       │   └── sound.ts                134 行 · WebAudio 现场合成音效，无音频文件
│       ├── components/
│       │   ├── Board.tsx               471 行 · 棋盘 + 棋子 + 落子涟漪 + 吃子残影 + 主变线
│       │   ├── RelayConsole.tsx        251 行 · 转述台（① 录入 / ② 引擎应手）★心脏
│       │   ├── AnalysisPanel.tsx       134 行 · 评分条 / 深度阶梯 / 主变
│       │   ├── ControlRail.tsx         258 行 · 左栏：执子方 / 思考时间 / 本局统计
│       │   ├── MoveList.tsx             91 行 · 右栏棋谱（按回合分组的表格）
│       │   ├── TopBar.tsx              119 行 · 顶栏：品牌 / 状态药丸 / 三个图标按钮
│       │   └── Overlays.tsx             98 行 · toast 栈 + 帮助弹层
│       └── styles/
│           ├── tokens.css               90 行 · 全部设计令牌 ★改颜色只能改这里
│           └── app.css                2341 行 · 全部样式，按 13 个分节组织
└── .devtools/audit.mjs    自检脚本：4 视口 + 5 场景 + 竞态断言，会截图并量指标
```

`app.css` 的分节（带行号，方便你定位）：

| 行 | 分节 |
|---|---|
| 1 | 布局与外观（reset、body、背景） |
| 84 | 骨架（`.app` / `.workspace` / `.stage`） |
| 134 | 顶栏 |
| 292 | 面板（`.panel` 通用卡片） |
| 334 | 控件（`.btn` / `.seg` / `.preset` / 开关 / 滑杆） |
| 675 | 舞台头部（回合徽标） |
| 733 | **棋盘**（棋盘 / 棋子 / 标记 / 涟漪 / 主变线）★主战场 |
| 1142 | 终局遮罩 |
| 1201 | **转述台**（①②的排布与连接线）★主战场 |
| 1584 | 分析面板 |
| 1856 | 棋谱 |
| 1982 | 提示条 / 弹层 / 启动态 |
| 2177 | 响应式（1320 / 1140 / 720 三个断点 + reduced-motion） |

---

## §2 现状：这套界面已经做到哪一步了

**视觉语言**：纸 / 墨 / 朱砂三色系统。纸是底，墨是字，朱砂只用来标记「现在轮到谁」和「有危险」。整体是一张浅色纸面的三栏工作台。

**已经做完的（第三轮）**：

| 位置 | 已有的东西 |
|---|---|
| 棋盘 | `feTurbulence` 两层木纹（年轮带 + 纤维，`mix-blend-mode: multiply`）、上缘受光/下缘落影的 `boardSheen`、板边倒角、**三层落地影** |
| 棋子 | 车床同心刀痕（`repeating-radial-gradient`）、左上受光的镜面高光（`::before`）、内圈浅槽（`::after`）、**阴刻字**（上缘落影 + 下缘受光） |
| 落子 | 两圈错开 90ms 的 `land-ripple`；对方落墨、我方落朱砂；棋子 `settle` 回弹 |
| 吃子 | `ghost` 残影：放大 1.14 + 旋转 6° + 淡出，520ms 后清理 |
| 将军 | 被将的王 `alarm` 循环呼吸 |
| 引擎思考 | 棋盘 `inset` 呼吸光晕（`thinkGlow`）、右上角 `live-dot`、深度阶梯（12 格，已点亮 + 正在跑的那格呼吸） |
| 主变 | 盘面上 3 条渐隐虚线（`pv-trace`），透明度 0.5 / 0.34 / 0.18 |
| 评分 | 横向条 + logistic 映射 + 圆形 tick + 「红 / 均势 / 黑」刻度 + 人话判语 |
| 动效基线 | `--ease-out` / `--ease-spring`、`--dur-fast/dur/dur-slow`、全局 `prefers-reduced-motion` 兜底 |
| 音效 | 落子 / 吃子 / 将军 / 就绪 / 胜 / 负，全部 WebAudio 合成 |
| **录入** | **棋盘点选 + 拖拽落子**（轮到的子有抓手光标、可走点亮起、拖到的点张开、非法落点弹回原位）；键盘流可敲坐标 / 中文记谱；引擎算棋时输入会排队，收手自动落子 |

**已经做对、别推翻的**：

- 棋盘缩放锚在一个变量 `--u` 上（`--u = 棋盘实际宽度 / 720`，由 `ResizeObserver` 写进 `.board-surface`）。棋盘里每一个尺寸都是 `calc(var(--u) * Npx)`。
- 棋子用服务端下发的**稳定 id** 作 React key，所以滑动是「同一颗子移过去」，不是「这颗消失那颗出现」。
- 吃子残影靠对比前后两帧的棋子集合算出来，不依赖任何动画回调。
- 落子涟漪只在 `ply === prev + 1` 时触发 —— 悔棋、载入、翻转视角都不会误触发。
- 引擎算棋时输入框照样能打字，抢录的走法由**服务端**排队（`pending`），引擎收手自动落子。这是全项目最值钱的一个交互细节。
- **录入以棋盘为先。** 点子、点落点，或按住子拖过去 —— 两条路都通，都不需要把棋步翻译成符号。键盘输入是给习惯键盘的人留的第二条路。这两条路的优先级体现在焦点策略上：`App` 记着最后一次用的是哪种（`inputMode`），只有「键盘流」才会在每手自动聚焦输入框；你一旦开始在棋盘上摆子，它就不再抢焦点。
- **空闲时有一秒一次的慢心跳。** 搜索在跑时用 130ms 追进度，搜索一停轮询就关掉；但关掉之后界面会「闭眼」，看不见别的标签页、或对手模型 HTTP 接入推来的局面。所以空闲时补一个 1s 的 `/api/state` 心跳。这是这个软件最忌讳的事（看不见对手的棋）的直接防线。

**离奖项还差的三件事**（这是升级的重点，不是客套）：

1. **没有一个视觉上独一无二的形态。** 现在是「一套做得很好的三栏仪表盘」。评审看的是「有一件事只有它做得到」。
2. **动效停在「有反馈」，没到「有叙事」。** 棋子会滑、吃子会淡出，但引擎思考那几秒、终局那一刻，都还没有一个让人想录下来的镜头。
3. **材质是算出来的。** 木纹是高噪声、棋子高光是 CSS 渐变，全屏放大能看出是「画」的。

---

## §3 设计系统（必须遵守，不要重新发明）

### 3.1 颜色令牌（`src/styles/tokens.css`）

```css
/* 纸 —— 从最亮的面到最沉的边 */
--paper-0: #fdfaf4;  --paper-1: #f7f2e8;  --paper-2: #efe8db;
--paper-3: #e4dac8;  --paper-4: #d6c9b1;

/* 墨 —— 正文到极淡的线 */
--ink-0: #16130f;  --ink-1: #2a241d;  --ink-2: #4b4237;
--ink-3: #776b5b;  --ink-4: #a19683;  --ink-mute: #9a8f7d;
--hairline: rgba(43,35,26,.12);  --hairline-strong: rgba(43,35,26,.22);

/* 朱砂 —— 唯一的强调色 */
--cinnabar: #b4322a;  --cinnabar-bright: #cd4034;
--cinnabar-wash: rgba(180,50,42,.10);  --cinnabar-edge: rgba(180,50,42,.28);

/* 玉 —— 只用于「确认/正面」 */
--jade: #2c6a56;  --jade-bright: #35836a;  --jade-wash: rgba(44,106,86,.10);

/* 棋盘 */
--board-face-1: #f2e6cb;  --board-face-2: #e9d8b4;  --board-face-3: #dcc79d;
--board-line: #6d5028;    --board-vignette: rgba(109,80,40,.16);

/* 棋子 */
--disc-face-1: #fdf8ec;  --disc-face-2: #f0e5cd;  --disc-face-3: #ddcfaf;
--piece-red: #a92c24;    --piece-black: #221d18;
--disc-shadow: 0 3px 6px rgba(58,41,18,.28), 0 10px 22px rgba(58,41,18,.16);
```

**规则：**

- 要新色，先在 `tokens.css` 里加一个有语义的名字（`--shadow-contact` 这类），不要在 `app.css` 里撒裸的 `rgba()`。现状有少量硬编码的 rgba（棋盘倒角、木纹矩阵），那是历史原因，不要去扩大它。
- **不要引入第三种强调色。** 朱砂 + 玉 + 墨已经够用，多一个就俗。
- `feColorMatrix` 的 `values` 属性吃不了 CSS 变量，所以木纹那两处颜色是硬编码在 `Board.tsx` 的 `<defs>` 里的 —— 这是已知例外。

### 3.2 字体

```css
--font-display: "Songti SC","STSong","Noto Serif SC",… serif;   /* 标题、输入框、记谱 */
--font-kai:     "STKaiti","KaiTi","楷体",… serif;                /* 棋子字、河界、品牌 */
--font-ui:      "Segoe UI","PingFang SC","Microsoft YaHei",…;   /* 界面正文 */
--font-num:     "JetBrains Mono","Cascadia Mono",Consolas,…;    /* 数字、坐标、ICCS */
```

不给项目引入新字体文件。数字一律 `font-variant-numeric: tabular-nums`（已有），否则 130ms 轮询下数字会左右抖动。

### 3.3 尺寸与圆角

```
--r-sm 6px   --r-md 10px   --r-lg 16px   --r-xl 22px
--shadow-panel  轻浮起（卡片）
--shadow-float  重浮起（棋盘）
```

### 3.4 动效令牌与全局兜底

```css
--ease-out:    cubic-bezier(0.22, 0.61, 0.36, 1);   /* 进入 / 减速 */
--ease-spring: cubic-bezier(0.34, 1.32, 0.46, 1);   /* 回弹 / 落定 */
--dur-fast: 140ms;  --dur: 220ms;  --dur-slow: 380ms;

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 1ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 1ms !important;
  }
}
```

**注意最后那一段**：它是全局兜底，你新写的任何 `@keyframes` 都自动降级，**不要用 `!important` 去反制它**。另外：现有 keyframes 用的是字面量毫秒（`620ms` / `700ms` / `2.1s`），不走 `--dur-*` 令牌 —— 因为兜底是 `!important` 所以仍然安全；但如果你写 JS 驱动的动画（WAAPI），必须自己判断 `matchMedia('(prefers-reduced-motion: reduce)')` 并跳过。

### 3.5 缩放机制（棋盘专属）

```
--u = 棋盘渲染宽度 / 720        （由 Board.tsx 的 ResizeObserver 写入 .board-surface）
棋子直径 = calc(var(--u) * 66px)
```

**棋盘区域内一切尺寸都必须写成 `calc(var(--u) * Npx)`。** 不要用 `em` / `rem` / `vw` / 百分比 —— 一旦字号跟着父级 `font-size` 走，换个字体或者窄屏就会全乱。这条是硬的。

### 3.6 光源约定（**新写死的一条，升级时必须服从**）

> **主光从左上方约 35° 入射，暖白 `#fff8e8`。**
> 所有高光在左上，所有本体投影落向右下，所有接触影在正下方。
> 新增的任何高光、投影、渐变、`drop-shadow` **必须**服从这个方向。

现状已经是这个方向（棋子 `radial-gradient(circle at 34% 26%)`、`boardSheen` 上亮下暗），但没有成文。升级时把它当成物理定律，别加一个从右边来的光。

### 3.7 断点

| 断点 | 行为 |
|---|---|
| `> 1320px` | 三栏：`262px / 自适应 / 336px` |
| `≤ 1320px` | 三栏收窄：`236px / 1fr / 300px` |
| `≤ 1140px` | 单栏，`.stage { display: contents }` + `order` 重排：回合条 → 棋盘 → 转述台 → 分析 → 控制 |
| `≤ 720px` | 触摸目标放大：主按钮 46px、次按钮 40px、输入框 52px |

---

## §4 硬约束（改了就会坏）

| # | 约束 | 为什么 |
|---|---|---|
| 1 | **棋子 key 必须是 `p.id`**，不能改成 `p.square` | 稳定 id 是滑动动画成立的前提。换成坐标，棋子会变成「消失 + 出现」，滑动消失。 |
| 2 | **落子 / 吃子效果只在 `ply === prev + 1` 时触发** | 悔棋（ply 变小）、载入局面（一步跳多手）、翻转视角都不该有落子的一下，否则会出现「倒着落子」。这个判断在 `Board.tsx` 的两个 `useEffect` 里。 |
| 3 | **效果锚定「对局状态」，不锚定「搜索任务完成」** | 任务会被顶替（抢录的走法落地后服务端立刻开下一次搜索，旧 task id 会失效）。靠任务事件驱动会丢特效。用 `game.records` / `game.last_move`。 |
| 4 | **棋盘内所有尺寸走 `calc(var(--u) * Npx)`** | 见 §3.5。 |
| 5 | **轮询间隔 130ms，组件会被高频重渲染** | 所有效果必须纯 CSS 驱动、组件必须 `memo`、渲染期不分配大对象。`feTurbulence` 和大 `filter` 绝不能放在每帧重算的节点上（`BoardArtwork` 已用 `memo` 包住，保持它）。 |
| 6 | **不要动 `/api` 契约和排队机制** | `pending` / `queued` / `stale` 这套是上一轮花大力气才稳定的，`types.ts` 和 `api.ts` 的字段不要改。 |
| 7 | **`overflow: hidden` 的祖先会裁掉外投影** | 已踩过的坑：`thinkGlow` 最初写成外 `box-shadow`，父级 `.board-surface` 是 `overflow: hidden`，动画跑了整轮从没在屏幕上出现过。**光晕必须用 `inset`。** |
| 8 | **不要用 `!important` 反制 reduced-motion 兜底** | 见 §3.4。 |
| 9 | **不引入任何依赖库** | 没有 framer-motion、没有 GSAP、没有动画工具库。手写 CSS。 |
| 10 | **不改 `.relay` / `.board-wrap` 在桌面端和窄屏的定位模型** | 桌面端 `.board-wrap` 是 flex 里撑满剩余空间的一块（`min-height: 0`），窄屏它变成 grid 行（`min-height: auto`）。这中间的差别是上一轮修过 74px 溢出换来的。要改布局，先量包围盒。 |
| 11 | **不要让棋子再挂 `onClick`，也不要给棋盘加回 `onClick`** | 点选与拖拽全部走 `.board-surface` 上的 pointer 事件。同一个元素上同时存在 `onClick` 和 `pointerdown`，拖拽结束那一下浏览器补的 `click` 会把同一步走两遍。 |
| 12 | **不要恢复「每手自动聚焦输入框」** | 那会让用棋盘的人每落一手被抢一次焦点 —— 等于劝退最快的录入方式。自动聚焦交给 `App` 的 `inputMode` 决定。 |
| 13 | **不要删掉空闲心跳** | 见 §2。删了它，另一个标签页、或对手模型 HTTP 接入推来的局面在界面上就是不可见的。 |
| 14 | **拖动中的那颗子不能有过渡** | `.piece.dragging` 必须 `transition: none`。只要有一点过渡，跟手就会拖出一段橡皮筋似的延迟，手感立刻塌掉。 |

---

## §5 升级方案

> **先看这一条。** §2 里「录入」那一行**已经做完了**：棋盘点选、拖拽落子、焦点策略、空闲心跳都在跑，而且有 `drag.mjs` 守着。
> §5 要动的是这些交互**长什么样、动起来如何**，不是让它们能跑。
> 任何改动都必须让 §6 的两条自检保持全绿 —— 尤其是拖拽那条。

按 **P0（做出「击杀特效」和三个叙事镜头）→ P1（版式与材质）→ P2（微交互）** 的顺序。每做完一项跑一次 §6。

---

### P0-1 · 落子：从「平移」升级为「抬—走—落」

**现状问题**

```css
.piece {
  transition: left var(--dur-slow) var(--ease-out),
              top  var(--dur-slow) var(--ease-out), …;
}
```

两个毛病：(a) `left/top` 过渡每帧触发 layout + paint；(b) 全程是一条直线，没有重量 —— 真实的木棋子是「被拿起来、移动、放下」，中间会**离板**。

**怎么做**

1. 注册两个可过渡的自定义属性，用合成层定位：

```css
@property --px { syntax: '<length>'; inherits: false; initial-value: 0px; }
@property --py { syntax: '<length>'; inherits: false; initial-value: 0px; }

.piece {
  transform: translate3d(var(--px), var(--py), 0) translate(-50%, -50%);
  transition: --px 340ms var(--ease-out), --py 340ms var(--ease-out);
}
```

   `Board.tsx` 里把 `left/top` 百分比改成写 `--px/--py` 像素值（用 `toPixel()`，它会带上翻转）。

2. **抬—走—落**：位移和内层抬升并行。`.piece-face` 加一段与位移同时长的 `hop` 关键帧，峰值在位移中段：

```css
@keyframes hop {
  0%   { transform: translateY(0)     scale(1);    }
  42%  { transform: translateY(-13%)  scale(1.055); }
  100% { transform: translateY(0)     scale(1);    }
}
```

   注意 `.piece.is-last .piece-face` 现在挂着 `settle` 关键帧（回弹），把 `hop` 和 `settle` 合成一条时间线，别让两个 animation 抢同一个 `transform`。

3. **接触影与本体分离**（这是「离板」唯一的视觉证据）：给 `.piece` 加 `::after` 做一个椭圆接触影，位移时它透明度略降、尺寸略大（离板），落定时收回。影子和本体不同步，重量感才出得来。

**验收**：正常走子有抬起与落定；悔棋 / 载入 / 翻转不触发；reduced-motion 下退化为直接到位。

---

### P0-2 · 吃子特效（用户点名要的「击杀特效」，现在的实现太弱）

**现状**：`captureOut` 关键帧 —— 原地 `scale(1.14) rotate(6deg)` → `scale(0.6) rotate(14deg)` 淡出。问题是**没有方向**：不管从哪边吃,被吃的子都是原地打转淡出，看不出「被谁打飞」。

**要做成四段**

| 段 | 时间 | 内容 |
|---|---|---|
| **命中** | T=0 | 吃子方到位那一帧。落点炸开一圈**冲击环**（比现有 `land-ripple` 更硬更快更亮），叠一帧白闪 |
| **崩解** | T=0–140ms | 被吃的子沿「吃子方 → 被吃方」的**方向**甩出 1.2–1.8 格，同时 `rotate` 30–90°、`scale → 0.5`、`opacity → 0` |
| **碎屑** | T=60–520ms | 6–10 粒木屑从落点沿扇形飞出，带「重力」下坠 |
| **余韵** | T=200–700ms | 吃子方 `settle`（已有）；落点留一枚朱砂钉标记 |

**关键实现点**

- **方向**由 JS 算：`Board.tsx` 里从 `last_move.from` 与 `last_move.to` 算出角度，写成 CSS 变量：

```tsx
const a = toPercent(parseSquare(last.from).file, parseSquare(last.from).rank, flipped)
const b = toPercent(parseSquare(last.to).file, parseSquare(last.to).rank, flipped)
const rad = Math.atan2(b.y - a.y, b.x - a.x)
style={{ '--kx': `${Math.cos(rad) * 1.5}`, '--ky': `${Math.sin(rad) * 1.5}` }}
```

```css
.piece.ghost {
  animation: captureOut 560ms var(--ease-out) both;
  transform-origin: center;
}
@keyframes captureOut {
  0%   { opacity: 1; transform: translate(-50%,-50%) scale(1) rotate(0); }
  18%  { opacity: 1; transform: translate(-50%,-50%) scale(1.08) rotate(0); }   /* 被打中的顿挫 */
  100% { opacity: 0;
         transform: translate(calc(-50% + var(--kx) * 66px * var(--u)),
                              calc(-50% + var(--ky) * 66px * var(--u)))
                    scale(0.5) rotate(78deg); }
}
```

- **碎屑**用纯 CSS，不引图片：一个 `.debris` 容器，内部 ≤10 个 `<i>`，每个用 `--i` 算出角度和延迟：

```css
.debris i {
  position: absolute; left: 50%; top: 50%;
  width: calc(var(--u) * 3px); height: calc(var(--u) * 3px);
  background: var(--board-line); border-radius: 1px;
  animation: shard 460ms var(--ease-out) both;
  animation-delay: calc(var(--i) * 22ms);
  --ang: calc(var(--i) * 36deg);
}
@keyframes shard {
  0%   { opacity: .9; transform: rotate(var(--ang)) translateX(0) translateY(0) scale(1); }
  100% { opacity: 0;  transform: rotate(var(--ang)) translateX(calc(var(--u) * 30px))
                                       translateY(calc(var(--u) * 34px)) scale(.3); }
}
```

   动画结束**必须**清理节点（复用 `Board.tsx` 里 `ghosts` 的定时清理模式）。

**约束**：只在吃子时放；≤10 个 DOM 节点；只在 `ply === prev + 1` 时触发（§4 第 2 条）；reduced-motion 自动降级（§3.4）。

---

### P0-3 · 三个「叙事镜头」（现在完全没有）

这是「动效从有反馈升到有叙事」的核心。三处关键时刻，各给一个镜头。

#### (a) 终局 —— 从静态遮罩升级成一段 1.2s 的收束

现状：`.result-veil` 只是一个静态遮罩 + 卡片。升级顺序：

1. 棋盘轻微下压 `scale(0.985)` 并降饱和 `filter: saturate(0.6)`（400ms）
2. 胜方的王（或制胜的那颗子）亮起一圈朱砂余光，轻微呼吸一次
3. **印章**从上方盖下：`scale(1.6) → 1`、`rotate(-8deg) → -4deg`、落定时有一下极短的墨渍扩散（一个 `radial-gradient` 环放大淡出）
4. 遮罩与按钮淡入（delay 到印章落定之后）

印章的图形请用**纯 CSS/SVG 画**（一枚橙色方章 + 阴刻字），不要用图片。

#### (b) 将军 —— 全盘响应，不只王自己在报警

现状：只有被将的王 `alarm` 循环。升级：加一次**全盘**响应 —— 棋盘四角暗角（vignette）加深再退回（380ms 两次），配 `play('check')`。让「将军」是盘面的事件，不只是某颗子的事件。

#### (c) 开局 —— 「铺盘」入场序列

现状：`boardIn` 只是淡入 + 上浮 14px。升级为棋子**按到中线的距离错峰落下**：

```
每颗子的 animation-delay = 它与河界的距离 × 系数
```

形成一次约 600ms 的入场序列。只在 `game.is_start && game.ply === 0` 时放，别在每次重渲染时重放。

---

### P1-1 · 版式：让「转述」这个概念长出形状

**这是离奖项最远的一项。** 下面三档，**从低风险往高风险做，做完一档量一档**。

**低风险（先做这个）—— 把 ①→② 的连接线变成「活的传送带」**

现状：`.relay-link` 是一条静态虚线（`.relay-link-line` + 一个 `.relay-link-dot`）。
升级：当一步棋从 ① 进来、引擎开始算、② 给出应手时，一个「墨点」沿这条线**从 ① 走到 ② 再走回来**。它把「转述」这个动作变成可见的物理过程。

改动只在 `RelayConsole.tsx` + `.relay-link` 相关 CSS。可以复用一个 `phase` 状态：`idle | inbound | thinking | outbound`。

**中风险 —— 棋谱从「表格」变成「两条轨道」**

把「对方的棋 / 我方的棋」做成盘面外左右两条**实体刻度轨**：每落一手，对应轨道亮一格并向下生长。这样 `MoveList` 从右栏的三列表格，变成盘侧的两条纹路。信息更少、形态更独特。

**高风险（先量再做）—— 对称双翼**

宽屏下把 ①② 从底部卡片提到棋盘左右两翼，形成「输入翼 → 棋盘 → 输出翼」的对称构图。

⚠️ **动手前必须先量**：棋盘是主角，不能让它的渲染尺寸变小。

```js
// 在 .devtools 里量：改版前先记录 .board 的 getBoundingClientRect()
```

---

### P1-2 · 评分条 → 棋势走势

现状：`.eval-bar` 是一根横向条 + 圆形 tick，只讲「此刻」。

升级：在条下方叠一条**很细的走势线**（sparkline），数据直接取 `game.records[].eval`，横轴是手数。这一栏就从「一个数字」变成「这一局的叙事」。

- 用单条 SVG `<path>`，`d` 在 `useMemo` 里一次算好，不要每帧重排
- tick 现在用 `left` 过渡 → 改成 `transform: translateX()`，并换 `--ease-spring`
- 走势线用 `--ink-4` 这样的极淡色，不要抢评分条的视觉

---

### P1-3 · 材质：从「算出来的」再推一层

**保持「全程序化、零图片素材」的原则** —— 这个项目的美学一致性就来自这条，不要为了一处材质引入位图。

1. **棋盘木纹加第三层**：现在是「年轮带 + 纤维」两层。加一层**节疤 / 轮纹同心弧**（`feTurbulence type="turbulence"` + `feComponentTransfer` 阈值化成稀疏暗弧），让木纹有方向性，而不是均匀噪声。第三层的浓度要很轻（opacity ≤ 0.2），只是打破均匀感。

2. **棋盘下面加一张垫**：一个比棋盘大一圈、带自身微噪点与内阴影的圆角面。目的：给棋盘的三层投影一个**承接面** —— 现在棋盘是浮在纸色背景上的，投影没有落点。

3. **棋子加极小随机旋转**：由 `id` 决定 `--tilt: calc(...)`，幅度 ±2°。一排棋子不再像盖章。

4. **棋子加接触影**：见 P0-1 第 3 点。

---

### P1-4 · 光影：把「一个光源」写死并加深环境遮蔽

1. 按 §3.6 的光源约定，**巡检所有高光与投影**，把方向不一致的清掉。现状基本一致，加东西时容易破坏。
2. **棋盘环境光遮蔽**：在棋盘内框内沿、以及棋子落点周围，叠一层极淡的暗（`radial-gradient`），让平面有「凹」的感觉。
3. 棋子 hover 时加一道**掠射光**：一条旋转的线性渐变扫过，600ms 一次，只在 hover 触发，别常驻。

---

### P2 · 微交互清单（有余力再做）

**先做这条** —— 它的价值高于下面所有条：

- **键盘走子（无障碍 + 第二条纯键盘通路）。** 现在棋盘只能用鼠标/触摸，纯键盘用户一步也走不了，这是 §8「无障碍」那一项最大的一块欠账。做法：把棋盘做成一个可聚焦容器，方向键移动一格「光标」，回车选中 / 落子，Esc 取消；焦点格要有和 `.target` 同族的可见样式，别另起一套。

其余：

- 棋谱最新一手「盖印」入场（缩放入场 + 极短回弹）
- toast 用 spring 入场、向右滑出退场（现在只有淡入淡出）
- 深度阶梯每一格点亮时 `pop` 一下
- 复制成功：一个「拓印」确认（墨圈扩散 + 已复制）
- 视角翻转：真正的**两段式 3D 翻面**（`rotateY(0) → 90deg` 换坐标 `→ 0`），而不是瞬间换位
- 棋盘悬停时坐标显形（已有）：加一点逐格显形的延迟差

---

## §6 验收流程

**每一次改动之后都要跑。** 不许「攒一堆再一起验」。

### 6.1 构建必须干净

```bash
cd frontend
npm run build          # 先 tsc --noEmit 再 vite build，任一失败即红
```

`tsc` 报错一律不许跳过。上一轮因为多文件重叠编辑，反复出现 `TS2451 Cannot redeclare block-scoped variable`，如果你在改 `useGame.ts` 这类大文件，**整文件重写**而不是反复打补丁。

### 6.2 起服务

```bash
# 终端 1：服务（会同时托管 frontend/dist 的构建产物）
python server/app.py 8010

# 终端 2（可选）：前端热更新
cd frontend && npm run dev     # 5173，/api 已代理到 8010
```

### 6.3 跑自检（会截图 + 量指标）

```bash
cd .devtools
node audit.mjs http://127.0.0.1:8010/    # 四档视口 + 五个场景 + 抢录竞态
node drag.mjs  http://127.0.0.1:8010/    # 拖拽落子与点击落子两条路
```

**期望输出最后一行**：

```
—— 无控制台错误、无溢出、无过小点击目标、无未决竞态 ——
—— 拖拽与点击两条路都通 ——
```

它会断言 11 类事情，其中和你直接相关的：

| 断言 | 阈值 |
|---|---|
| 控制台错误 / 未处理 4xx·5xx | 0 |
| 横向溢出 | 0 px（四档视口） |
| 棋盘与容器包围盒一致 | `boardWrap === boardSurface` 高度 |
| 窄屏信息顺序 | 棋盘 → 转述台 → 分析 → 控制 |
| 可点目标尺寸 | ≥ 32px |
| 竞态场景 | 抢录时 `/api/move` 只发 1 次、409 为 0 |
| 拖拽落子（`drag.mjs`） | 拖动中 `.is-dragging` / `.piece.dragging` / `.is-lifted` / `.target.is-over` 四样同时在；松手后服务端确实记下了这一步；残影被清理 |
| 点击落子（`drag.mjs`） | 点子出现 `.piece.is-selected`；点落点后服务端记下该步 |

**当前基线（你改之前应该是这样）**：

```
desktop  597×663 / 棋子字号 34.83px
laptop   435×483 / 25.38px
tablet   520×578 / 30.33px
phone    390×433 / 22.75px
溢出 0px · 抢录只发 1 次请求 · 409 为 0
拖拽落子：四样拖拽态同时在 · 已记录 · 残影已清理；点击落子：已记录
```

### 6.4 用眼睛看（这一步不能省）

自检脚本抓的是「会不会坏」，抓不到「好不好看」。**每一项改完，必须把 `.devtools/shots/` 里的截图打开看**：

- `desktop.png` / `laptop.png` / `tablet.png` / `phone.png` —— 四档视口的全貌
- `_board.png` / `_board_midgame.png` —— 棋盘细节裁切
- `_piece.png` —— 棋子细节裁切
- `thinking.png` —— 引擎思考中的状态
- `help.png` / `selected.png` —— 弹层与选中态

**上一轮最有价值的一个发现就是靠放大截图抓到的**：`thinkGlow` 那圈呼吸光从写下那天起就没在屏幕上出现过（外投影被 `overflow: hidden` 裁掉）—— 代码在跑、动画在跑、控制台干净，只是渲染结果被吃掉。**只有放大看才能发现。**

### 6.5 建议新增的断言

给 `audit.mjs` 加两条（这是升级过程中会用到的新门槛）：

1. **长任务检测**：用 `PerformanceObserver` 抓 `longtask`，确保新动效没有把主线程卡住（轮询 130ms，预算很紧）。
2. **reduced-motion 快照**：以 `reducedMotion: 'reduce'` 的 context 再跑一次，确认没有任何循环动画残留（`animation-iteration-count` 应该都是 1）。

---

## §7 反面清单（都是已经踩过的坑，别再踩）

| 坑 | 现象 | 正确做法 |
|---|---|---|
| 在 `overflow: hidden` 的祖先上用外 `box-shadow` | 动画在跑，屏幕上什么都没有，控制台干净 | 用 `inset` 光晕 |
| 用 `left/top` 做新动效 | 每帧 layout + paint，和 130ms 轮询抢主线程 | `transform: translate3d()` 或注册 `@property` |
| 用任务完成事件驱动落子特效 | 抢录落地后任务被顶替，特效丢失 | 锚定 `game.records` / `game.last_move` |
| 悔棋 / 载入时也放落子动画 | 出现「倒着落子」 | 只在 `ply === prev + 1` 时触发 |
| `@keyframes` 抢同一个 `transform` | 两个动画互相打断，动作抽搐 | 一条时间线合成一个 keyframes，或分层（外层管位移、内层管抬升） |
| 在每帧重算的节点上放 `feTurbulence` / 大 `filter` | nps 掉、输入延迟 | `memo` + 只在首帧算一次 |
| 加第三个强调色 | 界面立刻变俗 | 朱砂 + 玉 + 墨，够了 |
| 为了一处材质引入位图 | 美学一致性破掉，还多了加载态 | 全部程序化：SVG / CSS / WebAudio |
| 多文件重叠编辑同一个大文件 | `TS2451` 重复声明 | 整文件重写 |

---

## §8 什么叫做完了

评分基准（与 `review/quality-review.html` 一致，八维加权）：

| 维度 | 权重 | 当前 | 目标 |
|---|---|---|---|
| 功能正确与稳健 | 20% | 9.0 | ≥ 9.0（不许回退） |
| 核心工作流效率 | 18% | 9.0 | ≥ 9.0（不许回退） |
| 视觉工艺（棋盘与棋子） | 15% | 8.0 | **9.0+** |
| 版式与信息层级 | 13% | 7.5 | **9.0+** |
| 响应式 | 12% | 8.5 | ≥ 8.5（不许回退） |
| 文案与内容表达 | 10% | 8.5 | ≥ 8.5 |
| 创意与概念 | 7% | 6.5 | **9.0+** |
| 无障碍 | 5% | 7.0 | ≥ 7.0 |

**当前综合 8.6。目标 9.3+。**

**「做完了」的判据，按重要性排序：**

1. **能指着屏幕说出一件只有这个软件做得到的事。** 现在这个位置是空的。P0-2（吃子特效）和 P1-1（转述轨道）是最有希望填上它的两处。
2. **有一个想让人录下来的镜头。** 终局那段收束（P0-3a）就是为它做的。
3. **自检全绿，且没有把已有分数改低。** 动效再漂亮，如果棋盘溢出 1px 或者抢录多发了请求，就是负分。
4. **`prefers-reduced-motion` 下依然可用、且不丑。**

**明确不要做的事：**

- 不要为了「显得有动效」而给每个元素都加动画。这个界面的气质是**纸/墨/木的克制**，多一处花哨就少一分。**动效要有理由：讲清楚这一步在发生什么。**
- 不要把三栏推倒重来。它是对的。
- 不要碰 Python 侧。引擎和服务的正确性已经用 400 局回归锁住了（`python tools/verify.py`，26 条断言、23,927 个构面、0 分歧）。

---

## 附：可复现命令

```bash
# 引擎回归（约 81s，确认你没碰 Python 却把 Python 弄坏了）
python tools/verify.py

# 起服务
python server/app.py 8010

# 前端构建
cd frontend && npm run build

# 界面自检（四档视口 + 五个场景 + 竞态断言，截图落在 .devtools/shots/）
cd .devtools && node audit.mjs http://127.0.0.1:8010/
```

---

*本文档由第三轮质量迭代收尾时生成。文中所有行号、令牌取值、断点、基线数字均来自当前工作区的实测，未做估算。*
