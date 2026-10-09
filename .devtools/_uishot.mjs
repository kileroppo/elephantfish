// 受控取景：明确指定要拖哪颗子，把「手正拿着子」的那一帧拍清楚。
// 用法： node _uishot.mjs [url] [from] [to]
import { chromium } from 'playwright-core'

const base = (process.argv[2] || 'http://127.0.0.1:8020/').replace(/\/$/, '')
const wantFrom = process.argv[3] || null
const wantTo = process.argv[4] || null

const MARGIN = 40
const CELL = 80
const BOARD_W = 720
const BOARD_H = 800

const b = await chromium.launch({ channel: 'chrome' })
const c = await b.newContext({ viewport: { width: 1440, height: 980 }, deviceScaleFactor: 2 })
const p = await c.newPage()
p.on('pageerror', (e) => console.log('pageerror:', e.message))

const js = (fn, arg) => p.evaluate(fn, arg)
const state = () => js(() => fetch('/api/state').then((r) => r.json()))

await p.goto(base + '/', { waitUntil: 'domcontentloaded' })
await p.waitForSelector('.board-surface')

const waitIdle = async () => {
  for (let i = 0; i < 120; i += 1) {
    const s = (await state()).state
    if (!s.task || s.task.status !== 'running') return s
    await p.waitForTimeout(150)
  }
  throw new Error('等服务端空闲超时')
}
const waitOpp = async () => {
  for (let i = 0; i < 160; i += 1) {
    const s = (await state()).state
    if (s.game.opponent_to_move && (!s.task || s.task.status !== 'running')) return s
    await p.waitForTimeout(150)
  }
  throw new Error('等「轮到对方」超时')
}

await waitIdle()
await js(() =>
  fetch('/api/new', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ engine_side: 'red', think_ms: 900 }),
  }),
)
let s = await waitOpp()
// 等客户端把新局面画出来
await p
  .waitForFunction(
    (ply) => document.querySelector('.movelist .panel-count')?.textContent?.includes(String(ply)),
    s.game.ply,
    { timeout: 8000 },
  )
  .catch(() => console.log('警告：客户端未跟上手数'))

const pick = wantFrom === 'idle'
  ? null
  : wantFrom
    ? s.game.legal_moves.find((m) => m.from === wantFrom && (!wantTo || m.to === wantTo))
    : s.game.legal_moves.find((m) => m.from.startsWith('b') || m.from.startsWith('h')) ??
      s.game.legal_moves[0]

const surf = await p.locator('.board-surface').boundingBox()

if (!pick) {
  console.log('只拍静止局面')
  await p.screenshot({
    path: 'shots/_idle.png',
    clip: { x: surf.x - 26, y: surf.y - 26, width: surf.width + 52, height: surf.height + 52 },
  })
  console.log('已写入 shots/_idle.png')
  await b.close()
  process.exit(0)
}

console.log(`演示：${pick.from} -> ${pick.to}（${pick.chinese}）· 局面 turn=${s.game.turn}`)
const fileOf = (q) => q.charCodeAt(0) - 97
const rankOf = (q) => Number(q.slice(1))
const center = (q) => ({
  x: surf.x + (surf.width / BOARD_W) * (MARGIN + fileOf(q) * CELL),
  y: surf.y + (surf.height / BOARD_H) * (MARGIN + (9 - rankOf(q)) * CELL),
})

const a = center(pick.from)
const z = center(pick.to)
await p.mouse.move(a.x, a.y)
await p.mouse.down()
for (let i = 1; i <= 10; i += 1) {
  await p.mouse.move(a.x + ((z.x - a.x) * i) / 10, a.y + ((z.y - a.y) * i) / 10)
  await p.waitForTimeout(18)
}
const info = await js(() => ({
  dragging: !!document.querySelector('.board-surface.is-dragging'),
  ghost: !!document.querySelector('.piece.dragging'),
  lifted: !!document.querySelector('.piece.is-lifted'),
  targets: document.querySelectorAll('.target').length,
  over: document.querySelectorAll('.target.is-over').length,
}))
console.log(`拖拽中：${JSON.stringify(info)}`)
await p.screenshot({
  path: 'shots/_dragging.png',
  clip: { x: surf.x - 26, y: surf.y - 26, width: surf.width + 52, height: surf.height + 52 },
})
await p.mouse.up()
await p.waitForTimeout(400)
console.log('已写入 shots/_dragging.png')
await b.close()
