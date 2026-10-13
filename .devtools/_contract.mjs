// 自检脚本与被测界面之间的**唯一**接口。
//
// 为什么不各写各的：三个脚本以前各自演化出一套自己的选择器，然后各自烂掉，
// 而且烂得悄无声息 ——
//
//   * `drag.mjs` 的通过条件含 `.piece.is-lifted`，这个类在组件里根本不存在，
//     所以它从界面重写那天起就一直退出 1（红得没人看，等于没有回归网）。
//   * `audit.mjs` 里 `page.fill('.relay-field input', …)` 匹配不到任何元素
//     （转述台已重写成 `relay-compact`），中局场景必然超时。
//   * `kbd.mjs` 结尾只有 console.log，从不 `process.exit` —— 永远退出 0。
//
// 三个都指着一套「看起来在跑、其实早就失效」的自检。把契约收进这个文件，
// 界面改了只需要改这里一处。
//
// ============================ 两条规矩 ============================
//
// 1. **定位元素只认 `data-*`，不认 class。** 类名归样式所有，一次美化就可能
//    改名，而改完没有任何东西会红。`Board.tsx` / `RelayConsole.tsx` 上的
//    `data-board` / `data-piece` / `data-target` / `data-relay-*` 就是为此加的。
// 2. **判断状态优先认 `/api/state`。** 服务端才是事实来源；界面那份是轮询来的、
//    会滞后一个周期。需要「界面追上来没有」时，用盘面上的 `data-ply` 跟服务端的
//    `game.ply` 对等式，而不是去猜某个元素代不代表「忙」。
//
// 截图与几何测量允许用布局类名（`.topbar` 之类）—— 那是取景，不是断言。
// 但测量目标一旦找不到必须**出声**，不能像以前那样静默退回一个默认值。

import { chromium } from 'playwright-core'

// --------------------------------------------------------------------------- //
// 浏览器
// --------------------------------------------------------------------------- //

export const DEFAULT_URL = 'http://127.0.0.1:8010/'

/** 命令行里的地址参数，统一补上结尾斜杠。 */
export function urlFromArgv(argv, fallback = DEFAULT_URL) {
  return (argv[2] || fallback).replace(/\/$/, '') + '/'
}

export async function openBrowser(viewport = { width: 1440, height: 900 }) {
  const browser = await chromium.launch({ channel: 'chrome' })
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2 })
  const page = await ctx.newPage()
  return { browser, ctx, page }
}

/**
 * 收集「这个页面的控制台本来是干净的」这一类问题。
 *
 * 三个脚本以前各有一份判据，而且不一致（`kbd.mjs` 会把 favicon 的 404 也算成
 * 错误，`drag.mjs` 不会）。这里定一份：
 *
 * * favicon 404 —— 本机应用没放图标，不是问题。
 * * 409 —— 是排队机制的正常信号，不是错误。
 *
 * 可以传一个共用的 ``sink``（多页面脚本要把每条页面的问题汇总到一处）。
 */
export function watchConsole(page, tag = '', sink = null) {
  const problems = sink || []
  const prefix = tag ? `[${tag}] ` : ''
  page.on('console', (m) => {
    if (m.type() !== 'error' || /favicon/i.test(m.text())) return
    if (/status of 409/.test(m.text())) return
    problems.push(`${prefix}console: ${m.text()}`)
  })
  page.on('pageerror', (e) => problems.push(`${prefix}pageerror: ${e.message}`))
  return problems
}

// --------------------------------------------------------------------------- //
// 服务端事实
// --------------------------------------------------------------------------- //

export const getState = (page) =>
  page.evaluate(() => fetch('/api/state').then((r) => r.json()).then((j) => j.state))

export const post = (page, path, body) =>
  page.evaluate(
    ([p, b]) =>
      fetch(p, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(b),
      }).then((r) => r.json()),
    [path, body],
  )

// --------------------------------------------------------------------------- //
// 盘面契约
// --------------------------------------------------------------------------- //

/** 盘面当前渲染出来的状态，一次读全。 */
export const boardInfo = (page) =>
  page.evaluate(() => {
    const el = document.querySelector('[data-board]')
    if (!el) return null
    return {
      flipped: el.dataset.flipped === 'true',
      thinking: el.dataset.thinking === 'true',
      ply: Number(el.dataset.ply),
      dragging: el.dataset.dragging ?? null,
    }
  })

export const piece = (page, square) => page.locator(`[data-piece][data-square="${square}"]`)
export const target = (page, square) => page.locator(`[data-target][data-square="${square}"]`)

/** 当前被选中的那个格子（没有就是 null）。 */
export const selectedSquare = (page) =>
  page.evaluate(
    () => document.querySelector('[data-piece][data-selected="true"]')?.dataset.square ?? null,
  )

/** 键盘光标停在哪一格（光标还没显形就是 null）。 */
export const cursorSquare = (page) =>
  page.evaluate(() => document.querySelector('[data-kbd-cursor]')?.dataset.cursor ?? null)

/** 正在被拖拽的那一格（没在拖就是 null）。 */
export const draggingFrom = (page) =>
  page.evaluate(() => document.querySelector('[data-board]')?.dataset.dragging ?? null)

// --------------------------------------------------------------------------- //
// 等界面与服务端对齐
// --------------------------------------------------------------------------- //

/** 出错信息里带上当时的局面，否则只有一句「等不到」，没法排查。 */
const summarise = (s) =>
  s
    ? `turn=${s.game.turn} ply=${s.game.ply} engine_side=${s.game.engine_side} ` +
      `oppToMove=${s.game.opponent_to_move} task=${s.task ? s.task.status : null}`
    : '<读不到 state>'

// 为什么这两个等待在 **Node 侧轮询**，而不是用 page.waitForFunction：
//
// Playwright 的 waitForFunction **不会 await 谓词返回的 Promise**。写
// `page.waitForFunction(async () => { …fetch… })` 时，它看到的是一个（真值）
// 对象，于是**立即返回**。实测：同步谓词 T=3 才返回，换成一模一样的 async
// 谓词则在 T=0、6ms 就返回了。
//
// 这个坑已经在仓库里躺了很久：`audit.mjs` 的 `idle()` 就是那么写的，而它是
// 每个转述动作的前置条件 —— 也就是说那些「等界面稳定」从来没等过任何东西。
// 老老实实在 Node 侧循环，比猜这个语义可靠。

/**
 * 等「服务端闲下来 + 界面已经渲染到这个局面」。返回完整 state（要用局面自己取 `.game`）。
 *
 * 「界面追上来没有」的判据是**一个等式**：盘面上的 `data-ply` 等于服务端的
 * `game.ply`。以前这里是
 * `!document.querySelector('.relay-output.is-live') && !document.querySelector('.queue-chip')`，
 * 而这两个类名在组件里都已不存在，条件恒真 —— 这一半从来没验过。
 */
export async function waitIdle(page, timeout = 30000) {
  const deadline = Date.now() + timeout
  let last = null
  while (Date.now() < deadline) {
    last = await getState(page)
    const info = await boardInfo(page)
    const idle = !(last.task && last.task.status === 'running')
    if (info && idle && info.ply === last.game.ply) return last
    await page.waitForTimeout(120)
  }
  throw new Error(`等不到「服务端闲 + 界面已同步」：${summarise(last)}`)
}

/** 等「服务端闲下来 + 轮到对手走 + 界面已同步」。转述场景动手前的稳定局面。
 *  同样返回完整 state。 */
export async function waitOpponentTurn(page, timeout = 30000) {
  const deadline = Date.now() + timeout
  let last = null
  while (Date.now() < deadline) {
    last = await getState(page)
    const info = await boardInfo(page)
    const idle = !(last.task && last.task.status === 'running')
    if (info && idle && last.game.opponent_to_move && !info.thinking && info.ply === last.game.ply) {
      return last
    }
    await page.waitForTimeout(120)
  }
  throw new Error(`等不到「轮到对手的稳定局面」：${summarise(last)}`)
}

/** 重置成一局已知状态：引擎执某方开局，等它把第一手走完。 */
export async function reset(page, engineSide = 'red', thinkMs = 900) {
  await post(page, '/api/new', { engine_side: engineSide, think_ms: thinkMs })
  return waitIdle(page)
}

// --------------------------------------------------------------------------- //
// 真的像人一样录一步棋
// --------------------------------------------------------------------------- //

/**
 * 录一步棋：按 `/` 展开录入栏 → 填 → 回车。
 *
 * `/` 是 `RelayConsole` 自己接管的全局快捷键（任意位置按下都会展开并聚焦）。
 * 走它而不是直接找输入框，是因为输入框**默认是折叠的** —— 以前
 * `page.fill('.relay-field input', …)` 既赌错了类名，也赌错了折叠状态。
 */
export async function typeMove(page, text) {
  await page.keyboard.press('/')
  const input = page.locator('[data-relay-input]')
  await input.waitFor({ state: 'visible', timeout: 8000 })
  await input.fill(text)
  await input.press('Enter')
}

/** 输入栏现在开着吗。 */
export const relayInputOpen = (page) =>
  page.evaluate(() => !!document.querySelector('[data-relay-input]'))

/** 排队提示上写的走法（没有排队就是 null）。 */
export const queuedText = (page) =>
  page.evaluate(
    () => document.querySelector('[data-relay-queued]')?.dataset.relayQueued ?? null,
  )

// --------------------------------------------------------------------------- //
// 盘面几何
// --------------------------------------------------------------------------- //

// 这几个常量是棋盘 SVG 的几何，来自 frontend/src/lib/board.ts。
// 抄一份在这里是有风险的：那边一改，这边算出来的落点就偏了。
// 所以 cellCenter() 会拿真实棋子的包围盒**自校验**一遍，对不上就大声报错，
// 而不是让拖拽悄悄掉到隔壁格子上去。
const MARGIN = 40
const CELL = 80
const BOARD_W = 720
const BOARD_H = 800

/**
 * 从格号算像素中心。
 *
 * 视角有没有翻转读 `data-flipped`，不再像以前那样拿棋子包围盒去反推 ——
 * 那种反推在半数情况下是对的，另外半数情况下会把脚本自己的错误算成产品的错误。
 * 格子是正方形，所以只用一个轴的缩放（用 x 轴），旋转设备下也稳。
 */
export async function squareCenter(page, square) {
  const info = await boardInfo(page)
  const box = await page.locator('[data-board]').boundingBox()
  if (!box) throw new Error('找不到 [data-board]，盘面还没渲染出来')

  const file = square.charCodeAt(0) - 97
  const rank = Number(square.slice(1))
  const f = info.flipped ? 8 - file : file
  const r = info.flipped ? 9 - rank : rank
  const scale = box.width / BOARD_W
  return {
    x: box.x + scale * (MARGIN + f * CELL),
    y: box.y + scale * (MARGIN + (9 - r) * CELL),
  }
}

/**
 * 自校验：算出来的中心和那颗子真正的包围盒中心，差得不该超过半格。
 *
 * 这是「棋盘几何常量抄在测试里」这个耦合的报警器。没有它，lib/board.ts 的
 * 间距一改，拖拽测试就会落到隔壁格上，然后报一个「这一步没被记上」——
 * 排查方向完全错了。
 */
export async function calibrate(page, square) {
  const computed = await squareCenter(page, square)
  const box = await piece(page, square).boundingBox()
  if (!box) throw new Error(`棋盘上没有 ${square} 这颗子`)
  const real = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  const off = Math.hypot(real.x - computed.x, real.y - computed.y)
  const cell = (await page.locator('[data-board]').boundingBox()).width / 9
  if (off > cell / 2) {
    throw new Error(
      `棋盘几何对不上：按常量算 ${square} 的中心在 ${computed.x.toFixed(0)},` +
        `${computed.y.toFixed(0)}，真实棋子在 ${real.x.toFixed(0)},${real.y.toFixed(0)}，` +
        `偏了 ${off.toFixed(0)}px（半格 ${(cell / 2).toFixed(0)}px）。` +
        `大概 frontend/src/lib/board.ts 的 MARGIN/CELL 改了，需要同步 _contract.mjs。`,
    )
  }
  return computed
}

// --------------------------------------------------------------------------- //
// 收尾
// --------------------------------------------------------------------------- //

/** 盘面截图用的裁剪框（往外留一点边，好看清落点高亮与残影）。 */
export async function boardCropClip(page, pad = 30) {
  const box = await page.locator('[data-board]').boundingBox()
  if (!box) throw new Error('找不到 [data-board]，没法裁剪')
  return {
    x: Math.max(0, box.x - pad),
    y: Math.max(0, box.y - pad),
    width: box.width + pad * 2,
    height: box.height + pad * 2,
  }
}

/** 把「发现的问题」打出来并定退出码。三个脚本共用同一套收尾话术。 */
export function report(problems, notes = [], okLine = '—— 全部通过 ——') {
  if (notes.length) {
    console.log('\n—— 指标 ——')
    for (const n of notes) console.log('  ' + n)
  }
  if (problems.length) {
    console.log('\n—— 发现的问题 ——')
    for (const p of problems) console.log('  ✗ ' + p)
    console.log(`\n共 ${problems.length} 条问题`)
    return 1
  }
  console.log(`\n${okLine}`)
  return 0
}

/** 出错时把页面现场打出来 —— 只看到一句 timeout，分不清是产品坏了还是脚本没等对。 */
export async function diagnose(page) {
  try {
    return await page.evaluate(async () => {
      const s = (await (await fetch('/api/state')).json()).state
      const el = document.querySelector('[data-board]')
      return JSON.stringify({
        board: el ? { ...el.dataset } : null,
        turn: s.game.turn,
        ply: s.game.ply,
        oppToMove: s.game.opponent_to_move,
        taskStatus: s.task ? s.task.status : null,
        pending: s.pending,
        pieces: document.querySelectorAll('[data-piece]').length,
        targets: document.querySelectorAll('[data-target]').length,
      })
    })
  } catch (err) {
    return '<诊断失败: ' + err.message + '>'
  }
}

/** 顶层兜底：任何未捕获的 rejection 都要留下现场并以非零码退出。 */
export function failFast(browser, problems) {
  process.on('unhandledRejection', async (e) => {
    console.log(`\n[失败] ${e?.message || e}`)
    console.log(`控制台：${problems.length ? JSON.stringify(problems) : '干净'}`)
    await browser.close().catch(() => {})
    process.exit(1)
  })
}
