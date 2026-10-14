// 棋子落子时「到底滑没滑过去」，要能在它坏掉时变红。
//
// 为什么需要它：位移走 `transition: transform var(--glide-dur) var(--ease-move)`。
// `--glide-dur` 以前是**按这一帧的 diff 现算**的。服务端够快时（本机十几毫秒），
// 「本地预判」与「服务端确认」两次 React commit 会落在**同一帧**里，而浏览器
// 整帧只做一次样式重算 —— 确认那一次已经把 `--glide-dur` 按「这一帧没换格」
// 改回了 `0ms`，于是浏览器看到的是「起点 → 终点、时长 0ms」：过渡根本不会开始，
// 棋子**瞬移**过去。而且它取决于服务端响应落在哪一帧：**时好时坏**。
// 现在的修法是把这一手的时长**锁**住（渲染期写进 glideRef，滑完由计时器收回），
// 两次 commit 的时长是同一个数，过渡必然开始。
//
// ------------------------- 这个探针怎么量，以及为什么 -------------------------
// 一、**量画面上真实的位置**，不读 `--cx`。`--cx` 是输入值：它写对了也证明不了
//     过渡放出来了 —— 瞬移那一次 `--cx` 照样从起点跳到终点。真正能区分
//     「滑过去」和「瞬移过去」的，是每帧 `getBoundingClientRect().left` 这条轨迹里
//     **有没有中间点**。所以顺序是：先抓 DOM 节点 → 起采样循环 → 再落子。
//     节点必须在点第二下**之前**抓在手里：React 按棋子身份号（`p.id`）做 key，
//     同一颗子跨这一步不换节点，而它的 `data-square` 会在预判那一帧就改成落点 ——
//     事后再按 `data-square` 去查，查到的会是别的位置、甚至查不到。
// 二、**量 left**。位移走 transform，left 是它在横轴上的投影。代价是：纯纵向的一手
//     （同一列上下走）left 不动，量不出滑行。所以下面只在**换列**的着法里挑跨度
//     最大的那一手 —— 这一步是刻意的，不是漏了。开局就有黑炮 b7 → g7（跨度 5、
//     落点无子），跨度大 = 滑行时间长 = 采样点多，判据更稳。
// 三、**至少走两步**。这个 bug 的特征就是「时好时坏」，只测一次可能正好撞上好的
//     那一次。两次不同的落子都要满足同一套判据。
// 四、**位置那条**（证明滑行真的放出来了）要同时满足两件事：
//     * 末值必须真的和首值不同（差 < 1px = 压根没动），并且**严格落在首末之间**的
//       采样点（两侧各留 2px 余量）要 ≥ 3 个 —— 瞬移是 0 个，一次正常滑行
//       （210ms @60fps）有十来个。
//     * **单帧最大跳变 ≤ 总位移的 60%**（`MAX_JUMP_RATIO`）—— 补上一条在「滑到一半
//       才断」时的漏网（那时中间点已经有 ≥ 3 个，但缺口会集中在一帧里补完）。
//     两个数都打出来，方便排查。
//     实测量与「格列跨度 × 板宽/720 × 80」的对照**只打印、不作阈值**：几何对不对
//     已经由 calibrate 保证，这里再卡一个阈值只会引入偶发假红。
//
// ---------- 「滑行时有时无」有两个真凶，症状一模一样、成因与验法都不一样 ----------
//
// 两处都表现为**同一件事**：棋子本该滑过去，却「啪」地出现在终点，而且时好时坏。
// 光看现象**分不出是哪一个** —— 它们唯一的共同机理是「跑到一半的 transform 过渡被
// 打断」，而打断它的东西有两种。所以下面两条断言各盯一种，缺一不可。
//
// (a) 走子那颗被 React **卸载重挂**（旧节点脱离文档、换一个新节点在终点出现）。
//     真凶在 `Board.tsx`：「预判隐藏被吃子」的判据一度写成
//         `p.square === pendingMove.to && p.side !== game.turn → null`
//     —— 确认落地那一帧 `turn` 已经翻到对面，走子那颗自己（它已站在 `to` 上）就被
//     这条判据连坐摘掉，下一帧以**新节点**重新出现。节点一换，过渡当场作废。
//     本机回执只要十几毫秒，确认正好落在滑行刚开头，画面上就是真的瞬移。
//     后来补上「只认正在走的那一颗」（`p.id !== pendingMove.id`），这条没了。
//     验法：看走子那颗是不是**同一个节点对象**（`isConnected` + 落子前打的标记还在
//     + 现在就在落点上）—— 就是下面「节点」那条断言，`--teeth-node` 专打它。
//
// (b) 走子那颗的节点被 React **挪位**（是同一个节点对象，但被 `insertBefore`
//     先摘、再插）。真凶在服务端 `engine/core.py` 的 `pieces_of()`：它是
//     `for fil: for rank:` —— **先按列、再按行**排序，于是 `game.pieces` 的顺序就是
//     棋子在盘面上的字母序。棋子一换格，它在数组里的下标就变，React 对 `key={p.id}`
//     的 keyed 子节点就会用 `insertBefore` 调整顺序；**对已经连在文档上的节点，
//     `insertBefore` 就是「先脱离、再插回」**，而 Chrome 在这种脱离时会
//     `transitioncancel` 掉正在跑的过渡。挪「走子那颗自己」还是挪「旁边那一串」
//     取决于 React 的 diff —— 所以它**时好时坏**，同一手棋换个局面就翻面。
//     修法：渲染前先按身份号排一遍（`[...game.pieces].sort((a, b) => a.id - b.id)`），
//     顺序与棋子站在哪儿无关，节点顺序恒定，React 就永不搬它们。
//     验法：**光看节点身份看不出这一种** —— 同一个对象、结束后又连回文档、也确实
//     落在落点上，`isConnected`/标记/落点全对。它只能靠**位置轨迹**认：特征是
//     「起点帧渲染过、过渡 start 过，随后单帧跳变≈总位移」。所以 (b) 交给位置那条
//     （`中间点 ≥ 3` + `单帧最大跳变 ≤ 60%`——后者专治「滑到一半才断」）。
//
// 一句话：**(a) 靠节点那条断言认，(b) 靠位置那条断言认。** 两条互不依赖，一起守着。
//
// ---------------- 一条必须留在这里的教训：别把回执压后 ----------------
//
// 这个探针的第一版，为了让预判那次滑行「完整跑完」，在采样前把 `/api/move` 的
// 回执**压后 560ms** 才放行。那是个 workaround —— 它绕开的正是上面 (a)：把确认帧
// 推迟到滑行**结束之后**，那条连坐判据的破坏就看不见了。所以压后回执**不是**
// 「服务端太快」的权宜之计，而是一块遮羞布：它遮住的正是这个探针最该量的东西。
// 缺陷修好之后，回执**绝不能再压后** —— 探针必须能在**真实时序**（本机十几毫秒
// 回执）下工作，否则 (a)、(b) 这两种打断一个都抓不到。
//
// ------------------------- 牙齿检验（两个开关） -------------------------
// 两道断言各配一个「把坏状态精确摆出来」的开关，都必须报红：
//   * `--teeth`：注入 `.piece { transition: none !important; }`，模拟
//     「过渡起不来、棋子一步到位」—— 位置那条必须红，而且**两条子判据都要红**
//     （中间点为 0，且单帧跳变 = 总位移 = 100%）。
//   * `--teeth-node`：落子提交之后把走子那颗的节点 `replaceWith(cloneNode())`，
//     精确模拟 (a)「React 卸载重挂」干了什么 —— 节点那条必须红；顺带也会把位置那条
//     的「单帧最大跳变」顶红（换节点时滑行已经走了一小段，剩下的缺口会在下一帧补齐）。
//
// 用法： node glide.mjs [url] [--teeth] [--teeth-node]

import {
  openBrowser,
  urlFromArgv,
  watchConsole,
  waitIdle,
  waitOpponentTurn,
  reset,
  calibrate,
  squareCenter,
  report,
  failFast,
} from './_contract.mjs'

const url = urlFromArgv(process.argv)
const teeth = process.argv.includes('--teeth') // 过渡整个掐掉
const teethNode = process.argv.includes('--teeth-node') // 落子途中把节点换掉

/** 采样窗口长度。要盖住「点击 + 最长一次滑行（360ms）」还有富余。 */
const WIN = 700

/** 单帧最大跳变最多允许占总位移的比例。
 *
 *  为什么非要这一条：「中间点 ≥ 3」只在「从头到尾都没滑」时可靠。如果节点是在滑行
 *  **中途**才被换掉（已经滑了三五帧再断），那几帧会留下 ≥ 3 个中间点，它就放过了 ——
 *  `--teeth-node` 实测第一步中间点是 2，离蒙混过关只差 1 个点。而「中途断掉」这一下
 *  会把**剩下的整段缺口压缩进一帧**，那一跳远大于正常滑行的单帧位移。
 *
 *  实测区间（连跑 5 遍 10 步）：正常滑行单帧最大跳变占总位移 **13%~32%**（波动来自
 *  掉帧 —— 缓动是纯减速、起步本来就快，掉一帧就翻倍；第二步很稳，一直是 13%~14%）。
 *  瞬移是 100%；`--teeth-node` 那种「滑到约四分之一处被换掉」是 74%。
 *  取 60%：比实测上限（32%）留了近一倍余量，又明显低于 74%。
 *  **上限就是 74%** —— 再放宽到那附近，`--teeth-node` 就抓不住了，所以不许超过它
 *  （这也是为什么没有按「超过 45% 就放宽」的预案改成 75%：那会让牙齿检验失效）。 */
const MAX_JUMP_RATIO = 0.6

const { browser, page } = await openBrowser({ width: 1440, height: 900 })
const problems = watchConsole(page)
failFast(browser, problems)

await page.goto(url, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('[data-board]', { timeout: 10000 })
await waitIdle(page)

if (teeth) {
  // 把过渡掐掉，模拟「过渡起不来、棋子一步到位」这个坏状态。
  // 用 `.piece` —— 棋子、以及被吃残影（它同样挂着 piece 类）都归它管。
  await page.addStyleTag({ content: '.piece { transition: none !important; }' })
  console.log('【牙齿检验 --teeth】已注入 `.piece { transition: none }` —— 位置那条必须报红（中间点、单帧跳变两条子判据都该红）。\n')
}
if (teethNode) {
  console.log('【牙齿检验 --teeth-node】落子提交后会把走子那颗的节点换掉 —— 节点那条必须报红（位置那条的单帧跳变也该跟着红）。\n')
}

// ---- 挑一手：换列、落点无子、跨度最大 ----------------------------------- //
//
// 三条理由：
//   * 换列 —— 我们量的是 left，纯纵向的一手量不出滑行（见文件头第二条）。
//   * 落点无子 —— 不吃子就不会冒出一颗被吃残影来搅乱 DOM（残影也挂 .piece 类，
//     还会自己动）。我们只想要「一颗子的干净位移」。
//   * 跨度最大 —— 跨度大滑行久、采样点多，判据更稳。
function pickMove(game) {
  const occupied = new Set(game.pieces.map((p) => p.square))
  const dFile = (m) => Math.abs(m.from.charCodeAt(0) - m.to.charCodeAt(0))
  const dRank = (m) => Math.abs(Number(m.from.slice(1)) - Number(m.to.slice(1)))
  const span = (m) => Math.max(dFile(m), dRank(m))
  const legal = game.legal_moves.filter(
    (m) => m.from !== m.to && dFile(m) >= 1 && !occupied.has(m.to),
  )
  if (!legal.length) return null
  legal.sort((a, b) => span(b) - span(a))
  return legal[0]
}

/** 把采样轨迹折算成判据要用的几个数。 */
function shape(left) {
  if (left.length < 2) return null
  const first = left[0]
  const last = left[left.length - 1]
  const lo = Math.min(first, last)
  const hi = Math.max(first, last)
  // 「严格落在首末之间」：两侧各留 2px 余量，免得把缓动收尾时贴着终点的抖动也算进来。
  const mid = left.filter((v) => v > lo + 2 && v < hi - 2).length
  let maxJump = 0
  for (let i = 1; i < left.length; i += 1) maxJump = Math.max(maxJump, Math.abs(left[i] - left[i - 1]))
  return { n: left.length, first, last, delta: last - first, mid, maxJump }
}

/**
 * 落一手，采下「要动的那颗子」每一帧的 left，并在收尾时回报它的节点还在不在。
 *
 * 采样循环在**点第二下之前**就转起来了（`sampling` 这个 promise 先不 await），
 * 于是轨迹里一定带着落子**之前**的几个起点样本。点完第二下等它自己跑满 WIN，
 * 最后才 await 收结果 —— 中途不能停，否则会把滑行那段截掉。
 */
async function step(mv, from, to) {
  await page.mouse.click(from.x, from.y) // 先选中：这一下不产生位移
  await page.waitForTimeout(150)

  const sampling = page.evaluate(
    ([sq, dst, ms]) =>
      new Promise((resolve) => {
        const origin = document.querySelector(`[data-piece][data-square="${sq}"]`)
        if (!origin) return resolve({ missing: true, left: [] })
        // 节点攥在 window.__glide 上、并打一个标记：收尾时凭「同一个节点对象」
        // 认出它有没有被 React 卸载重挂过（见文件头「节点」那条断言）。
        window.__glide = { origin, left: [] }
        origin.__tag = 'mover'
        const left = window.__glide.left
        const t0 = performance.now()
        const loop = () => {
          // 原节点还活着就接着读它；万一它被换掉，就退而读落点上的那颗 ——
          // 采样不该因为节点更替整个塌掉（那样位置那条给的会是「0 个样本」而不是
          // 「中间点 0」）。节点更替本身由下面那条**独立**的断言报，不靠这里。
          const node = origin.isConnected
            ? origin
            : document.querySelector(`[data-piece][data-square="${dst}"]`)
          if (node) left.push(node.getBoundingClientRect().left)
          if (performance.now() - t0 < ms) requestAnimationFrame(loop)
          else resolve({ missing: false, left })
        }
        requestAnimationFrame(loop)
      }),
    [mv.from, mv.to, WIN],
  )

  await page.waitForTimeout(60) // 先攒下几个「起点」样本，再落子
  await page.mouse.click(to.x, to.y)

  if (teethNode) {
    // 落子提交之后、采样结束之前：把走子那颗的节点换掉 ——
    // 这正是 React「卸载重挂」干的事（新节点没有旧的过渡状态，过渡必断）。
    await page.waitForTimeout(100)
    await page.evaluate(() => {
      const el = window.__glide?.origin
      if (el && el.isConnected) el.replaceWith(el.cloneNode(true))
    })
  }

  // 兜底：万一 rAF 被掐停，别让整条脚本吊死在这个 promise 上。
  const rec = await Promise.race([
    sampling,
    page.waitForTimeout(WIN + 2500).then(() => ({ missing: false, left: [], timedOut: true })),
  ])

  // 节点那条：落子前攥住的那个节点对象，现在还在不在文档里、还落在落点上。
  const node = await page.evaluate(() => {
    const el = window.__glide?.origin
    if (!el) return null
    return {
      connected: el.isConnected,
      tag: el.__tag ?? null,
      square: el.isConnected ? el.getAttribute('data-square') : null,
    }
  })
  return { rec, node }
}

// ---- 走两步，每一步都过同一套判据 --------------------------------------- //
//
// 引擎执红先走一手，把局面交到黑手上；我们（对手）走一步，引擎应一手，再走一步。
await reset(page, 'red')

for (const name of ['第一步', '第二步']) {
  const game = (await waitOpponentTurn(page)).game
  const mv = pickMove(game)
  if (!mv) {
    problems.push(`${name}：找不到「换列、落点无子」的合法着法，没法采这一手`)
    break
  }

  // 先自校验棋盘几何，再动手（对不上会带着明确的排查方向抛出来）。
  const from = await calibrate(page, mv.from)
  const to = await squareCenter(page, mv.to)
  const boardW = (await page.locator('[data-board]').boundingBox()).width
  const dFile = Math.abs(mv.from.charCodeAt(0) - mv.to.charCodeAt(0))
  const expected = dFile * (boardW / 720) * 80

  console.log(
    `${name}：${mv.from} -> ${mv.to}（${mv.iccs} ${mv.chinese}）` +
      ` · 列跨度 ${dFile} · 预期横移 ${expected.toFixed(1)}px`,
  )

  const { rec, node } = await step(mv, from, to)
  const m = shape(rec.left)

  // ---- 断言一：画面上真的滑过去了（位置） ---- //
  if (!m) {
    problems.push(
      `${name}：只采到 ${rec.left.length} 个样本` +
        `${rec.timedOut ? '（采样悬挂，rAF 可能被掐停了）' : ''}` +
        `${rec.missing ? `（落子前就找不到 [data-piece][data-square=${mv.from}]）` : ''}` +
        ' —— 采不到轨迹就没法证明它滑了',
    )
  } else {
    const didMove = Math.abs(m.delta) >= 1 // 位移小到一个像素以内 = 压根没动
    const jumpRatio = didMove ? m.maxJump / Math.abs(m.delta) : 0
    console.log(
      `        采 ${String(m.n).padStart(2)} 点 · 首 ${m.first.toFixed(1)} → 末 ${m.last.toFixed(1)}` +
        `（位移 ${m.delta.toFixed(1)}px）· 中间点 ${m.mid} · 相邻最大跳变 ${m.maxJump.toFixed(1)}px` +
        `（占总位移 ${(jumpRatio * 100).toFixed(0)}%）`,
    )
    // ---- 断言一（位置）：两条子判据，分别堵「完全没滑」和「滑到一半才断」 ----
    if (!didMove) {
      problems.push(
        `${name}：末值与首值只差 ${m.delta.toFixed(2)}px —— 棋子压根没动（${mv.from} -> ${mv.to}）`,
      )
    }
    // 子判据 1：中间点 ≥ 3。堵「从头到尾一步到位」。
    if (m.mid < 3) {
      problems.push(
        `${name}：严格落在首末之间的采样点只有 ${m.mid} 个（要求 ≥ 3）—— 位移是瞬移过去的，` +
          `过渡没起来（相邻最大跳变 ${m.maxJump.toFixed(1)}px，总位移 ${m.delta.toFixed(1)}px）`,
      )
    }
    // 子判据 2：单帧最大跳变 ≤ 总位移的 MAX_JUMP_RATIO。
    // 为什么必须有它：子判据 1 只在「从头到尾都没滑」时可靠；节点若是在滑行**中途**
    // 才被换掉，前面几帧已经留下了 ≥ 3 个中间点，子判据 1 就放过了（`--teeth-node`
    // 实测第一步中间点 = 2，离 ≥ 3 只差 1 个点）。而「中途断掉」会把**剩下的整段缺口
    // 压缩进一帧**，这一跳远大于正常滑行的单帧位移 —— 拿它比总位移，识别得又准又稳。
    if (didMove && jumpRatio > MAX_JUMP_RATIO) {
      problems.push(
        `${name}：单帧最大跳变 ${m.maxJump.toFixed(1)}px = 总位移的 ${(jumpRatio * 100).toFixed(0)}%` +
          `（要求 ≤ ${(MAX_JUMP_RATIO * 100).toFixed(0)}%）—— 滑行中途断过一次，剩下的缺口一帧补完了`,
      )
    }
  }

  // ---- 断言二：走子那颗的 DOM 节点没在途中被换掉（节点） ---- //
  //
  // 这条不吃帧率，是确定性的：React 一旦卸载重挂那颗子，旧节点就脱离文档，
  // 跑在它身上的 transform 过渡当场作废 —— 哪怕位置那条因为采样侥幸躲过也赖不掉。
  if (!node) {
    problems.push(`${name}：没拿到落子前攥住的节点引用 —— 这条节点断言等于没写`)
  } else {
    console.log(
      `        走子那颗的节点：还在文档里 ${node.connected} · 标记 ${node.tag ?? '（丢了）'} ·` +
        ` 现在在 ${node.square ?? '—'}（落点 ${mv.to}）`,
    )
    if (!node.connected) {
      problems.push(
        `${name}：走子那颗的 DOM 节点在落子途中被换掉了（React 卸载重挂）——` +
          ` 跑到一半的 transform 过渡会被这一下打断`,
      )
    } else if (node.tag !== 'mover') {
      problems.push(
        `${name}：节点还在，但落子前打的标记 ${JSON.stringify(node.tag)} 丢了 ——` +
          ` 说明中途被卸载重挂过（拿到的是另一个节点对象）`,
      )
    } else if (node.square !== mv.to) {
      problems.push(
        `${name}：节点还在，但它现在停在 ${node.square}，不在落点 ${mv.to} 上 ——` +
          ` 这一段位移没落到那颗子身上`,
      )
    }
  }
}

await browser.close()
process.exit(report(problems, [], '—— 棋子是一帧一帧滑过去的（节点也没被换掉） ——'))
