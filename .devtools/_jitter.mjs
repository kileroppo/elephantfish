// 抖动复现：新建「引擎执黑」的对局，走一步人棋触发引擎应手，
// 同时用 CDP screencast 以高帧率抓帧（比 page.screenshot 快得多，不会漏掉瞬时抖动）。
import { chromium } from 'playwright-core'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'

const url = (process.argv[2] || 'http://127.0.0.1:8010/').replace(/\/$/, '') + '/'
const dir = 'shots/_jitter2'
rmSync(dir, { recursive: true, force: true })
mkdirSync(dir, { recursive: true })

const post = (path, body) =>
  fetch(url + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  }).then((r) => r.json())
const getState = () => fetch(url + 'api/state').then((r) => r.json())

const browser = await chromium.launch({ channel: 'chrome' })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await ctx.newPage()
await page.goto(url, { waitUntil: 'networkidle' })

// 引擎执黑，人先走
await post('api/new', { engine_side: 'black', think_ms: 900 })
await page.waitForTimeout(700)

const st = await getState()
const mv = st.state.game.legal_moves[0]
console.log(`人走：${mv.iccs}`)

// 开录
const cdp = await ctx.newCDPSession(page)
let n = 0
const frames = []
cdp.on('Page.screencastFrame', async (e) => {
  const idx = String(n).padStart(4, '0')
  n += 1
  frames.push({ idx, ts: e.metadata.timestamp })
  writeFileSync(`${dir}/${idx}.jpg`, Buffer.from(e.data, 'base64'))
  try {
    await cdp.send('Page.screencastFrameAck', { sessionId: e.sessionId })
  } catch {
    /* 收尾时会失败，忽略 */
  }
})
await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 80, everyNthFrame: 1 })

await page.waitForTimeout(300)
await post('api/move', { move: mv.iccs }) // 触发引擎应手
await page.waitForTimeout(2600)
await cdp.send('Page.stopScreencast')
console.log(`frames=${n}`)
await browser.close()
