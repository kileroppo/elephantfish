// 一次性验证：对局结束后，空闲心跳（每秒一次 /api/state）是否停摆。
// 用法： node _idle_heartbeat_check.mjs [url]
//
// 手法：不通过界面按钮，直接在页面上下文里打 API（等价于"另一个标签页"的动作），
// 于是本页面只能靠空闲心跳才能发现局面被推走了。证据就是 /api/state 的请求计数。
import { chromium } from 'playwright-core'

const url = (process.argv[2] || 'http://127.0.0.1:8060/').replace(/\/$/, '') + '/'
const browser = await chromium.launch({ channel: 'chrome' })
const ctx = await browser.newContext({ viewport: { width: 1600, height: 980 } })
const page = await ctx.newPage()

let stateHits = 0
page.on('request', (req) => {
  if (req.url().includes('/api/state')) stateHits += 1
})

await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForSelector('[data-board]')
await page.waitForTimeout(1500)

const snap = () =>
  page.evaluate(async () => {
    const s = await fetch('/api/state').then((r) => r.json()).then((j) => j.state)
    const el = document.querySelector('[data-board]')
    return { serverPly: s.game.ply, serverStatus: s.game.status.state, boardPly: el ? Number(el.dataset.ply) : null }
  })

/** 在一个时间窗里数 /api/state 的请求数（自己那次 fetch 不算，先归零）。 */
async function countHeartbeat(ms, label) {
  stateHits = 0
  await page.waitForTimeout(ms)
  const n = stateHits
  console.log(`  ${label.padEnd(30)} ${ms / 1000}s 内 /api/state 请求 ${n} 次  ${n > 0 ? '（心跳在跑）' : '★ 心跳停摆'}`)
  return n
}

const newGame = (side) =>
  page.evaluate(
    (s) => fetch('/api/new', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ engine_side: s, think_ms: 600 }) }).then((r) => r.json()),
    side,
  )

console.log('步骤 1：开一局（引擎执红，它会先走一手 → ply=1）')
await newGame('red')
await page.waitForTimeout(2500)
let r = await snap()
console.log(`  服务端 ply=${r.serverPly} status=${r.serverStatus}   界面 data-ply=${r.boardPly}`)

console.log('\n步骤 2：对局进行中，心跳应当每秒一次')
await countHeartbeat(4000, '对局进行中')

console.log('\n步骤 3：模拟「另一个标签页」让本局结束（直接打 /api/resign，不走界面）')
await page.evaluate(() => fetch('/api/resign', { method: 'POST' }))
await page.waitForTimeout(2500)
r = await snap()
console.log(`  服务端 ply=${r.serverPly} status=${r.serverStatus}   界面 data-ply=${r.boardPly}`)

console.log('\n步骤 4：对局已结束，心跳还在不在？')
const after = await countHeartbeat(4000, '对局已结束')

console.log('\n步骤 5：模拟「另一个标签页」开一局新的（引擎执黑 → ply=0，跟旧局的 1 不同）')
await newGame('black')
const want = await page.evaluate(() => fetch('/api/state').then((x) => x.json()).then((j) => j.state.game.ply))
console.log(`  新局服务端 ply=${want}（旧局界面停在 ${r.boardPly}）`)
let caught = false
for (let i = 0; i < 14; i += 1) {
  await page.waitForTimeout(500)
  const s = await snap()
  if (s.serverPly === s.boardPly) {
    console.log(`  ✓ 第 ${((i + 1) * 0.5).toFixed(1)}s 界面自己追上了：data-ply=${s.boardPly}`)
    caught = true
    break
  }
}
if (!caught) {
  const s = await snap()
  console.log(`  ★ 7 秒内始终没发现。界面停在 data-ply=${s.boardPly}，服务端早已是新局 ply=${s.serverPly}`)
}

console.log('\n================ 结论 ================')
if (after === 0) {
  console.log('对局结束后 /api/state 心跳**完全停止**（4 秒内 0 次）。')
  console.log('本页面从此只能等用户手动操作才会再对齐 —— 另一个标签页开的新局它看不见。')
  console.log(`步骤 5 能否自己发现：${caught ? '能' : '不能'}`)
} else {
  console.log(`对局结束后心跳仍在跑（4 秒内 ${after} 次），本页面能自己发现新局：${caught}`)
}

await browser.close()
