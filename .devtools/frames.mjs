// 卡顿的**可量化**判据：棋子的位移是不是真的走 transform、有没有走回 left/top。
//
// 为什么需要它：位移以前走 `left` / `top` 过渡（布局属性），每帧重排 + 重绘；
// 棋子 ::after 上还挂着 filter: blur()，于是每帧还要重新光栅化一次模糊层。
// 这是「动画不流畅」的根因，但它是**看不见的** —— 观感只能说「有点顿」，
// 既没法证明改好了没有，也防不住它悄悄退回去。
//
// ------------------------- 探针自己踩过的三个坑 -------------------------
// 一、量「动作窗口里的 LayoutCount 增量」：旧代码 71 次、新代码 74 次，
//     像改了个寂寞。窗口里混着一堆与棋子无关的布局。
// 二、改成「滑行窗口减静置本底」的对照，看着严谨，**仍然没牙**：
//     旧 点击 +5 / 拖拽 +20，新 +5 / +19 —— 一模一样。`LayoutCount` 统计的是
//     「整页布局跑了几趟」，Blink 能把一个绝对定位元素的位移收进它自己的布局
//     子树、并进同一趟重排，于是计数全被背景噪声主导。**不会变红的探针等于没有。**
// 三、换成 trace 事件计数，`Paint` 这一列确实分得开（同一套方法实测：
//     left/top 点击落子 +23 次重绘，transform −3 次）—— 但跑第二遍时
//     静置本底从 30 掉到 3：headless 下页面没动画时根本不产帧，
//     「静置窗口」的绝对值在 3~46 之间乱跳，配出来的差值毫无意义，必然偶发变红。
//
// 结论：**绝对值不可靠就不要拿它当断言。** 这个探针现在只做一件事 ——
// 直接查棋子的位移机制本身，那是确定的：
//     * transition-property 里不许出现 left / top；
//     * left / top 必须是 0（位置不由它们承担）；
//     * 改一下 --cx，棋子必须真的横移一格 —— 这一条顺便证明上面的「0」
//       不是因为样式没生效，而是因为换算确实走在 transform 上。
// 退回去的任何一种改法都会让这三条里的至少一条立刻变红。
//
// trace 的 Layout / Paint 事件数与帧间隔照旧打印，但**只作参考、不作阈值**。
//
// 用法： node frames.mjs [url]

import {
  openBrowser,
  urlFromArgv,
  watchConsole,
  waitIdle,
  waitOpponentTurn,
  reset,
  boardInfo,
  squareCenter,
  calibrate,
  report,
  failFast,
} from './_contract.mjs'

const url = urlFromArgv(process.argv)
const { browser, page, ctx } = await openBrowser({ width: 1440, height: 900 })
const problems = watchConsole(page)
failFast(browser, problems)

/** 对照窗口长度。取 260ms：够覆盖一次近手滑行（210ms）。 */
const WIN = 260

const cdp = await ctx.newCDPSession(page)

// ---- 装采样器：rAF 帧间隔 + 超长任务 ------------------------------------- //
await page.goto(url, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('[data-board]', { timeout: 10000 })
await page.evaluate(() => {
  window.__probe = { frames: [], long: [], on: false, last: 0 }
  const loop = (t) => {
    // `last` 存在 probe 上而不是闭包里：开采样时必须清掉它，否则第一帧的「间隔」
    // 会把前面整段空闲算进去，凭空报一个几千毫秒的最长帧。
    const p = window.__probe
    if (p.on) {
      if (p.last) p.frames.push(t - p.last)
      p.last = t
    }
    requestAnimationFrame(loop)
  }
  requestAnimationFrame(loop)
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) window.__probe.long.push(Math.round(e.duration))
    }).observe({ entryTypes: ['longtask'] })
  } catch {
    /* 没有 longtask 就只报帧间隔 */
  }
})
await waitIdle(page)

const arm = () =>
  page.evaluate(() => {
    window.__probe.frames = []
    window.__probe.long = []
    window.__probe.last = 0
    window.__probe.on = true
  })

const collect = () =>
  page.evaluate(() => {
    const p = window.__probe
    const out = { frames: p.frames.slice(), long: p.long.slice() }
    p.frames = []
    p.long = []
    p.on = false
    return out
  })

/** 采一个固定长度的 trace 窗口（只作参考数值用）。 */
async function measure(label, action) {
  await arm()
  const events = []
  const onData = ({ value }) => {
    // 别用 push(...value)：一次可能几千条，展开会把参数栈顶爆
    for (const e of value) events.push(e)
  }
  cdp.on('Tracing.dataCollected', onData)
  await cdp.send('Tracing.start', {
    categories: 'devtools.timeline',
    transferMode: 'ReportEvents',
  })

  const t0 = Date.now()
  await action()
  const left = WIN - (Date.now() - t0)
  if (left > 0) await page.waitForTimeout(left)

  const done = new Promise((res) => cdp.once('Tracing.tracingComplete', res))
  await cdp.send('Tracing.end')
  await done
  cdp.off('Tracing.dataCollected', onData)

  const count = (name) => events.filter((e) => e.name === name && e.ph === 'X').length
  const { frames, long } = await collect()
  const sorted = [...frames].sort((a, b) => a - b)
  return {
    label,
    layout: count('Layout'),
    paint: count('Paint'),
    style: count('UpdateLayoutTree'),
    frames: frames.length,
    p50: sorted.length ? sorted[Math.floor(sorted.length * 0.5)] : NaN,
    max: sorted.length ? sorted[sorted.length - 1] : NaN,
    over33: frames.filter((d) => d > 33).length,
    long,
  }
}

const line = (m) =>
  `${m.label.padEnd(20)} Layout ${String(m.layout).padStart(3)}  Paint ${String(m.paint).padStart(3)}  ` +
  `样式重算 ${String(m.style).padStart(3)}  | 帧 ${String(m.frames).padStart(3)}  ` +
  `p50 ${m.p50.toFixed(1)}  最长 ${m.max.toFixed(1)}ms  超 33ms ${m.over33}` +
  (m.long.length ? `  超长任务 ${m.long.join('/')}ms` : '')

// ---- 一、引擎执红开局，把局面交到我们手上 ------------------------------- //
await reset(page, 'red')
const game = (await waitOpponentTurn(page)).game
const mv = game.legal_moves[0]
if (!mv) throw new Error('没有合法着法可试')
const from = await calibrate(page, mv.from)
const to = await squareCenter(page, mv.to)
const info = await boardInfo(page)
console.log(`试走 ${mv.from} -> ${mv.to}（${mv.iccs} ${mv.chinese}）· 翻转 ${info.flipped}\n`)

// ---- 二、落子与拖拽两条路各采一个窗口（数值只作参考） ------------------- //
const click = await measure('点击落子（滑行中）', async () => {
  await page.mouse.click(from.x, from.y)
  await page.waitForTimeout(140)
  await page.mouse.click(to.x, to.y)
})

const g2 = (await waitOpponentTurn(page)).game
const mv2 = g2.legal_moves[2] ?? g2.legal_moves[0]
const f2 = await squareCenter(page, mv2.from)
const t2 = await squareCenter(page, mv2.to)
const drag = await measure('拖拽跟手（拖动中）', async () => {
  await page.mouse.move(f2.x, f2.y)
  await page.mouse.down()
  for (let i = 1; i <= 12; i += 1) {
    await page.mouse.move(f2.x + ((t2.x - f2.x) * i) / 12, f2.y + ((t2.y - f2.y) * i) / 12)
    await page.waitForTimeout(16)
  }
  await page.mouse.up()
})

await waitIdle(page)
console.log('—— 主线程事件（参考值，不作阈值：headless 下这组绝对值会飘） ——')
for (const m of [click, drag]) console.log('  ' + line(m))

// ---- 三、断言：位移机制本身 --------------------------------------------- //
//
// 这一段是确定性的：读真实棋子的计算样式，再改一次 --cx 看它动不动。
// 以下是三种把位移写回布局属性的改法，各自会在哪一条上变红：
//   改回 `transition: left/top`      → transitionProperty 里出现 left
//   用 left/top 百分比做位置          → left/computed 不是 0px
//   位置写对了但换算没接上（比如漏抄 --u）→ 改 --cx 棋子不动

// 键盘光标只有在「按过一次方向键」之后才渲染（kbdOn），所以断言之前先把它叫出来。
// 不叫的话 mech.cursor 恒为 null，下面那两条关于光标的断言永远不执行 ——
// 一个永远不跑的断言比没有断言更坏：它会让这一段看起来是绿的。
await page.locator('[data-board]').focus()
await page.keyboard.press('ArrowRight')
await page.waitForTimeout(150) // 等它挂上（它自己还带一个 cursorPop 入场动画）

const mech = await page.evaluate(() => {
  const read = (selector) => {
    const el = document.querySelector(selector)
    if (!el) return null
    const cs = getComputedStyle(el)
    return {
      selector,
      transitionProperty: cs.transitionProperty,
      left: cs.left,
      top: cs.top,
      position: cs.position,
      hasCx: el.style.getPropertyValue('--cx') !== '',
    }
  }
  return {
    piece: read('[data-piece]'),
    cursor: read('.kbd-cursor'),
    boardWidth: document.querySelector('[data-board]')?.getBoundingClientRect().width ?? 0,
  }
})

console.log('\n—— 位移机制（这一节才是断言） ——')
for (const r of [mech.piece, mech.cursor]) {
  if (!r) continue
  console.log(
    `  ${r.selector.padEnd(14)} transition-property = ${r.transitionProperty}\n` +
      `  ${''.padEnd(14)} left/top = ${r.left} / ${r.top}   position = ${r.position}   --cx 已写入 = ${r.hasCx}`,
  )
}

if (!mech.piece) {
  problems.push('盘面上找不到 [data-piece]，没法验位移机制')
} else {
  const tp = mech.piece.transitionProperty
  if (/\b(left|top)\b/.test(tp)) {
    problems.push(`棋子的 transition-property 里有 left/top（${tp}）—— 位移又走回布局属性了`)
  }
  if (!/\btransform\b/.test(tp)) {
    problems.push(`棋子的 transition-property 里没有 transform（${tp}）—— 位移不再由 transform 承担`)
  }
  if (mech.piece.left !== '0px' || mech.piece.top !== '0px') {
    problems.push(
      `棋子的 left/top 是 ${mech.piece.left}/${mech.piece.top}，不是 0px ——` +
        ` 位置又回到 left/top 上了（那是每帧重排的写法）`,
    )
  }
  if (!mech.piece.hasCx) problems.push('棋子身上没有 --cx，位置换算接不上')
}

if (!mech.cursor) {
  // 找不到光标 = 这两条断言根本没跑。探针自己哑火也算问题，不然它会一直「绿」着骗人。
  problems.push('按了方向键仍然找不到 .kbd-cursor —— 光标那两条断言等于没写')
} else {
  if (/\b(left|top)\b/.test(mech.cursor.transitionProperty)) {
    problems.push(
      `键盘光标的 transition-property 里有 left/top（${mech.cursor.transitionProperty}）——` +
        ` 方向键连按时每格一次重排`,
    )
  }
  if (!mech.cursor.hasCx) problems.push('键盘光标身上没有 --cx，位置换算接不上')
}

// 改一格 --cx，棋子必须真的横移一格（顺带证明位置确实由 transform 换算得来）
//
// 量之前先等这颗子不在滑行中：--glide-dur 非 0 时它正走 transform 过渡，
// 那一刻读到的包围盒是过程中的值 —— 会在下面报一个「位移与板面换算没接上」的假红。
await page
  .waitForFunction(
    () => {
      const el = document.querySelector('[data-piece]')
      if (!el) return false
      return (parseFloat(getComputedStyle(el).getPropertyValue('--glide-dur')) || 0) === 0
    },
    { timeout: 3000 },
  )
  .catch(() =>
    problems.push('棋子的 --glide-dur 一直没归 0 —— 滑行时长可能没被收回，会赖在 DOM 上'),
  )

const moved = await page.evaluate(() => {
  const el = document.querySelector('[data-piece]')
  if (!el) return null
  const cx = el.style.getPropertyValue('--cx')
  const before = el.getBoundingClientRect()
  el.style.setProperty('--cx', `${parseFloat(cx) + 80}px`)
  const after = el.getBoundingClientRect()
  const leftAfter = getComputedStyle(el).left
  el.style.setProperty('--cx', cx)
  return { dx: after.x - before.x, leftAfter }
})

const expected = (80 * mech.boardWidth) / 720
console.log(
  `  改 --cx +80 板面像素 → 棋子实际横移 ${moved ? moved.dx.toFixed(1) : 'n/a'}px` +
    `（预期 ${expected.toFixed(1)}px），期间 left 仍是 ${moved ? moved.leftAfter : 'n/a'}`,
)
if (!moved) {
  problems.push('读不到棋子的包围盒，没法验 --cx 是否真的驱动了位移')
} else {
  if (Math.abs(moved.dx - expected) > 3) {
    problems.push(
      `改 --cx 之后棋子横移了 ${moved.dx.toFixed(1)}px，预期 ${expected.toFixed(1)}px` +
        ` —— 位移与板面换算没接上（--u 漏了？）`,
    )
  }
  if (moved.leftAfter !== '0px') {
    problems.push(`改 --cx 之后棋子的 left 变成了 ${moved.leftAfter} —— 位移没走 transform`)
  }
}

await browser.close()
process.exit(
  report(problems, [], '—— 棋子位移走 transform：不重排、不重绘、只搬图层 ——'),
)
