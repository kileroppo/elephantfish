// 拖拽落子的专项自检：真的按住一颗子、拖到它合法的落点、松手，
// 然后回头问服务端「这一步记上了没有」。
//
// 用法： node drag.mjs [url]
//
// 坐标不是硬编码的：先拿棋子元素的实际包围盒反推出当前视角有没有翻转，
// 再用同一套 toPixel 公式算落点。这样翻转视角之后这个脚本照样成立。

import { chromium } from 'playwright-core'

const url = (process.argv[2] || 'http://127.0.0.1:8020/').replace(/\/$/, '') + '/'
const MARGIN = 40
const CELL = 80
const BOARD_W = 720
const BOARD_H = 800

const browser = await chromium.launch({ channel: 'chrome' })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
const page = await ctx.newPage()

const problems = []
page.on('console', (m) => {
  if (m.type() === 'error' && !/favicon/i.test(m.text())) problems.push(`console: ${m.text()}`)
})
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`))

const post = (path, body) =>
  page.evaluate(
    ([p, b]) =>
      fetch(p, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(b),
      }).then((r) => r.json()),
    [path, body],
  )

const getState = () => page.evaluate(() => fetch('/api/state').then((r) => r.json()))

/** 失败时把页面的真实样子打出来 —— 否则只能看到一句超时，分不清是产品坏了还是脚本没等对。 */
const diagnose = async () => {
  try {
    return await page.evaluate(() => ({
      pieces: document.querySelectorAll('.piece').length,
      grabbable: document.querySelectorAll('.piece.is-grabbable').length,
      movelist: document.querySelector('.movelist .panel-count')?.textContent ?? null,
      turn: document.querySelector('.turn-badge')?.textContent ?? null,
      thinking: !!document.querySelector('.board.is-thinking'),
      boot: !!document.querySelector('.boot'),
    }))
  } catch (e) {
    return `diagnose 也读不到：${e}`
  }
}

process.on('unhandledRejection', async (e) => {
  console.log(`\n[失败] ${e?.message || e}`)
  console.log(`页面状态：${JSON.stringify(await diagnose())}`)
  console.log(problems.length ? `控制台问题：${JSON.stringify(problems)}` : '控制台：干净')
  await browser.close().catch(() => {})
  process.exit(1)
})

await page.goto(url, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('.board-surface')

/** 一直等到「轮到对方、且没有任何搜索在跑」这个稳定局面。
 *  判据取服务端的真实状态，不依赖前端那 130ms 的轮询延迟。 */
async function waitOpponentTurn(timeoutMs = 25000) {
  const deadline = Date.now() + timeoutMs
  let last = null
  while (Date.now() < deadline) {
    const s = (await getState()).state
    last = s
    if (s.game.opponent_to_move && (!s.task || s.task.status !== 'running')) return s
    await page.waitForTimeout(120)
  }
  throw new Error(
    `等不到「轮到对方」的稳定局面：turn=${last?.game?.turn} ply=${last?.game?.ply} task=${last?.task?.status}`,
  )
}

// 引擎执红先走一手，把局面交到对方（黑）手上。
// 先等服务端闲下来 —— 上一轮可能还留着在跑的搜索，不等它就是在测竞态而不是测拖拽。
async function waitIdle(timeoutMs = 25000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const s = (await getState()).state
    if (!s.task || s.task.status !== 'running') return s
    await page.waitForTimeout(120)
  }
  return null
}

await waitIdle()
await post('/api/new', { engine_side: 'red', think_ms: 900 })
let state
try {
  state = await waitOpponentTurn()
} catch {
  await post('/api/new', { engine_side: 'red', think_ms: 900 })
  state = await waitOpponentTurn()
}
// 客户端最多滞后一个轮询周期，等它把新状态渲染出来再动手
await page.waitForFunction(
  () => !document.querySelector('.board.is-thinking') && document.querySelector('.piece.is-grabbable'),
  null,
  { timeout: 8000 },
)

const game = state.game
const move = game.legal_moves[0]
const piece = game.pieces.find((p) => p.square === move.from)

// 客户端最多滞后一个轮询周期（130ms）。等棋谱上的手数真的跟服务端对上了，
// 再去 DOM 里找棋子 —— 否则会从上一局的残影里找一个已经走掉的子。
// 注：棋谱面板默认收起（专注模式），不能靠 .movelist 判断，改轮询服务端 ply 收敛。
let synced = false
for (let i = 0; i < 40 && !synced; i += 1) {
  const cur = await getState().catch(() => null)
  if (cur && cur.state.game.ply === game.ply) synced = true
  else await page.waitForTimeout(150)
}
if (!synced) {
  console.log(`客户端没有跟上服务端（服务端 ply=${game.ply}）`)
  console.log(`页面状态：${JSON.stringify(await diagnose())}`)
  console.log(problems.length ? `控制台问题：${JSON.stringify(problems)}` : '控制台：干净')
  await browser.close()
  process.exit(1)
}

console.log(`局面：轮到${game.turn} · 试拖 ${move.from} -> ${move.to}（${move.iccs} ${move.chinese}）`)

const fileOf = (sq) => sq.charCodeAt(0) - 97
const rankOf = (sq) => Number(sq.slice(1))

const surf = await page.locator('.board-surface').boundingBox()
const center = (file, rank, flipped) => {
  const f = flipped ? 8 - file : file
  const r = flipped ? 9 - rank : rank
  return {
    x: surf.x + (surf.width / BOARD_W) * (MARGIN + f * CELL),
    y: surf.y + (surf.height / BOARD_H) * (MARGIN + (9 - r) * CELL),
  }
}

// 用源棋子的真实包围盒反推视角有没有翻转
const label = `${piece.side === 'red' ? '红' : '黑'}${piece.glyph}于 ${piece.square}`
const srcBox = await page.locator(`[aria-label="${label}"]`).boundingBox()
if (!srcBox) throw new Error(`找不到棋子元素：${label}`)
const cx = srcBox.x + srcBox.width / 2
const cy = srcBox.y + srcBox.height / 2
const asNormal = center(fileOf(move.from), rankOf(move.from), false)
const asFlipped = center(fileOf(move.from), rankOf(move.from), true)
const flipped = Math.hypot(asFlipped.x - cx, asFlipped.y - cy) < Math.hypot(asNormal.x - cx, asNormal.y - cy)
console.log(`视角翻转：${flipped}（棋子推算中心 ${cx.toFixed(0)},${cy.toFixed(0)}）`)

const from = center(fileOf(move.from), rankOf(move.from), flipped)
const to = center(fileOf(move.to), rankOf(move.to), flipped)

// 拖动之前：确认有抓手提示
const grabs = await page.locator('.piece.is-grabbable').count()
console.log(`可抓取的子：${grabs} 颗`)

await page.mouse.move(from.x, from.y)
await page.mouse.down()
for (let i = 1; i <= 8; i += 1) {
  await page.mouse.move(from.x + ((to.x - from.x) * i) / 8, from.y + ((to.y - from.y) * i) / 8)
  await page.waitForTimeout(16)
}
// 松手之前：拖拽态与落点高亮应该都在
const mid = await page.evaluate(() => ({
  dragging: !!document.querySelector('.board-surface.is-dragging'),
  ghost: !!document.querySelector('.piece.dragging'),
  lifted: !!document.querySelector('.piece.is-lifted'),
  over: !!document.querySelector('.target.is-over'),
}))
console.log(`拖拽中：${JSON.stringify(mid)}`)
// 留一张「手正拿着子」的截图，方便用眼睛复核跟手、留影、落点高亮
await page.screenshot({
  path: 'shots/_dragging.png',
  clip: { x: surf.x - 30, y: surf.y - 30, width: surf.width + 60, height: surf.height + 60 },
})
await page.mouse.up()
await page.waitForTimeout(500)

const after = (await getState()).state.game
const landed = after.records.some((r) => r.iccs === move.iccs)
const cleared = await page.evaluate(() => !document.querySelector('.piece.dragging'))
console.log(`落子已记录：${landed} · 拖拽残影已清理：${cleared} · 现在 ply=${after.ply}`)

// 再验一次：点击—点击这条路没被指针事件改坏
const s2 = (await waitOpponentTurn()).game
for (let i = 0; i < 40; i += 1) {
  const cur = await getState().catch(() => null)
  if (cur && cur.state.game.ply === s2.ply) break
  await page.waitForTimeout(150)
}
const mv2 = s2.legal_moves[2]
const p2 = s2.pieces.find((p) => p.square === mv2.from)
const f2 = center(fileOf(mv2.from), rankOf(mv2.from), flipped)
const t2 = center(fileOf(mv2.to), rankOf(mv2.to), flipped)
console.log(`改试点击：${mv2.from} -> ${mv2.to}（${p2.glyph}）`)
await page.mouse.click(f2.x, f2.y)
await page.waitForTimeout(150)
const selectedNow = await page.locator('.piece.is-selected').count()
await page.mouse.click(t2.x, t2.y)
await page.waitForTimeout(600)
const after2 = (await getState()).state.game
const landed2 = after2.records.some((r) => r.iccs === mv2.iccs)
console.log(`点选生效：${selectedNow > 0} · 点击落子已记录：${landed2}`)

const ok = landed && cleared && mid.ghost && mid.lifted && mid.over && selectedNow > 0 && landed2 && !problems.length
console.log(problems.length ? `控制台问题：${JSON.stringify(problems)}` : '控制台：干净')
console.log(ok ? '—— 拖拽与点击两条路都通 ——' : '—— 有断言失败 ——')

await browser.close()
process.exit(ok ? 0 : 1)
