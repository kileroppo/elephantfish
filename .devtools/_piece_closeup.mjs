// 棋子近景：把一颗红子放大拍清楚，用于人工核对
//   · 漆器盘面渐变
//   · 朱砂环（mask 挖出来的一圈，不是实心红圆片）
//   · 棋子的字
//   · 棋子右下那一片接触影（::after，方向随 --light-x = 0.42 → 右下）
//
// 办法照 _uishot.mjs：起 chrome channel、按元素 boundingBox 裁一块出来。
// 用法： node _piece_closeup.mjs [url] [outFile]
import { chromium } from 'playwright-core'
import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

const base = (process.argv[2] || 'http://127.0.0.1:8050/').replace(/\/$/, '')
const outFile =
  process.argv[3] || 'E:/work/codework/elephantfish/.devtools/shots/after-light/_piece_closeup.png'

await mkdir(dirname(outFile), { recursive: true })

const problems = []
const b = await chromium.launch({ channel: 'chrome' })
// dsf 3：这是个「看细节」的镜头，边缘/笔画/环要经得起放大看。
const c = await b.newContext({
  viewport: { width: 1600, height: 980 },
  deviceScaleFactor: 3,
  // 冻住会一直抖的装饰动画（呼吸点、旋转圈），只留静态几何 —— 拍的是材质不是动效。
  reducedMotion: 'reduce',
})
const p = await c.newPage()
p.on('console', (m) => {
  if (m.type() === 'error' && !/favicon/i.test(m.text())) problems.push(`console: ${m.text()}`)
})
p.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`))

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
  for (let i = 0; i < 200; i += 1) {
    const s = (await state()).state
    if (s.game.opponent_to_move && (!s.task || s.task.status !== 'running')) return s
    await p.waitForTimeout(150)
  }
  throw new Error('等「轮到对方」超时')
}

// 新开一局拿一个确定的局面：引擎执红先走，落定后轮到黑（人为信使）录入。
await waitIdle()
await js(() =>
  fetch('/api/new', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ engine_side: 'red', think_ms: 900 }),
  }),
)
await waitOpp()
// 等客户端把新局面画完 + 落子动画彻底静止
await p.waitForTimeout(1500)

// 挑一颗红子。优先中间的行/列，好让右下那片接触影落在盘面上而不是出界。
const want = ['h2', 'b2', 'c3', 'e3', 'g4', 'e0']
const picked = await js((prefs) => {
  const reds = Array.from(document.querySelectorAll('.piece.red'))
  const bySquare = (sq) => reds.find((el) => el.dataset.square === sq)
  for (const sq of prefs) {
    const el = bySquare(sq)
    if (el) return { square: sq, glyph: el.querySelector('.piece-glyph')?.textContent || '' }
  }
  const first = reds[0]
  return first
    ? { square: first.dataset.square, glyph: first.querySelector('.piece-glyph')?.textContent || '' }
    : null
}, want)

if (!picked) throw new Error('盘面上找不到红子')

const sel = `.piece[data-square="${picked.square}"]`
const box = await p.locator(sel).boundingBox()
if (!box) throw new Error(`量不到 ${sel} 的 boundingBox`)

// 裁一块比棋子略大的区域：右下要留出接触影的位移 + 模糊半径。
const pad = box.width * 0.42
const clip = {
  x: Math.max(0, box.x - pad),
  y: Math.max(0, box.y - pad),
  width: box.width + pad * 2,
  height: box.height + pad * 2,
}

await p.screenshot({ path: outFile, clip })
console.log(`红子 ${picked.square}（${picked.glyph}） box=${Math.round(box.width)}px → 写入 ${outFile}`)
console.log(`  裁切区域 ${JSON.stringify(clip)}`)

await b.close()
if (problems.length) {
  console.log('控制台问题：')
  for (const x of problems) console.log('  ' + x)
  process.exitCode = 1
} else {
  console.log('无控制台错误')
}
