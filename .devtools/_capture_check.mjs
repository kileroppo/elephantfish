// 临时探针：吃子这一手的「落点时钟」到底按没按同一拍响。
// 用法： node _capture_check.mjs [url]
//
// 摆一个**必然吃子、跨度拉满**的局面（红车 a0 → h0 吃黑马，跨度 7 → 滑行 360ms、
// 落点 315ms），逐帧记下四件事的时刻：
//   is-doomed   被吃子还在盘上（预判期间是它本尊，确认之后是替身）
//   knock       残影挂上来（被撞飞）
//   last-to     落点框显形
//   impact      涟漪真的在播
//   beat        WebAudio 里第一声（落子音效，由 useGame 排）
// 期望：is-doomed 一路连续到落点，knock / last-to / impact / beat 挤在同一拍上。

import { chromium } from 'playwright-core'
import { urlFromArgv, calibrate, squareCenter, post, getState, boardInfo } from './_contract.mjs'

const url = urlFromArgv(process.argv)
const FEN = '4k4/9/9/9/9/9/9/9/3K5/R6n1 w - - 0 1'

const browser = await chromium.launch({ channel: 'chrome' })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
const page = await ctx.newPage()
page.on('pageerror', (e) => console.log('[pageerror]', e.message))
page.on('console', (m) => {
  if (m.type() === 'error' && !/favicon/i.test(m.text())) console.log('[console]', m.text())
})

// 必须在 goto 之前把局面摆好（Node 侧 fetch，见 motion.mjs 里那段同样的教训）。
// 顺手把引擎调成「不会自动应手」——采样窗口里只许有我这一个动作在动。
await fetch(new URL('/api/settings', url), {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ auto_reply: false }),
})
await fetch(new URL('/api/load', url), {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ fen: FEN, engine_side: 'black' }),
})

await page.goto(url, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('.board [data-piece]', { timeout: 15000 })
await page.waitForTimeout(1200) // 等开场落盘播完，不然量到的是编排

const st = await getState(page)
const mv = st.game.legal_moves.find((m) => m.iccs === 'a0h0')
if (!mv) {
  console.log('载入的局面里没有 a0h0 这一手，legal =', st.game.legal_moves.map((m) => m.iccs))
  await browser.close()
  process.exit(1)
}
console.log('这一手：', mv.iccs, mv.chinese)

// 记下每一次 AudioNode 被排队的时刻（play() 里所有声音最终都走 start）
await page.evaluate(() => {
  window.__beats = []
  const wrap = (Proto) => {
    const origin = Proto.prototype.start
    Proto.prototype.start = function (...args) {
      window.__beats.push(performance.now())
      return origin.apply(this, args)
    }
  }
  wrap(window.AudioBufferSourceNode)
  wrap(window.OscillatorNode)
})

const from = await calibrate(page, mv.from)
const to = await squareCenter(page, mv.to)

await page.mouse.click(from.x, from.y) // 选中，不产生位移
await page.waitForTimeout(150)

const sampling = page.evaluate(
  ([sq, dst, ms]) =>
    new Promise((resolve) => {
      const origin = document.querySelector(`[data-piece][data-square="${sq}"]`)
      window.__probe = { origin, frames: [], t0: performance.now() }
      const center = (el) => {
        const r = el.getBoundingClientRect()
        return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width }
      }
      const u = () =>
        Number.parseFloat(getComputedStyle(document.querySelector('[data-board]')).getPropertyValue('--u')) || 0
      const loop = () => {
        const p = window.__probe
        const t = performance.now() - p.t0
        const kn = document.querySelector('.piece.piece-ghost-knockback')
        const mv = document.querySelector(`[data-piece][data-square="${dst}"]`)
        let off = 0
        let poke = 0
        if (kn && mv) {
          const a = center(kn)
          const b = center(mv)
          off = Math.hypot(a.x - b.x, a.y - b.y)
          // 残影有多少探在攻击子**外面**：拿它中心到攻击子边缘的距离算
          poke = Math.max(0, off + a.w / 2 - b.w / 2)
        }
        p.frames.push({
          t,
          doomed: document.querySelectorAll('.piece.is-doomed').length,
          knock: kn ? 1 : 0,
          off: Math.round(off),
          poke: Math.round(poke),
          lastTo: document.querySelectorAll('.last-to').length,
          impact: document.getAnimations().some((a) => a.animationName === 'pieceImpactSquash'),
          beats: window.__beats.filter((b) => b > p.t0).length,
          glide: p.origin ? getComputedStyle(p.origin).getPropertyValue('--glide-dur').trim() : '',
        })
        if (t < ms) requestAnimationFrame(loop)
        else resolve(p.frames)
      }
      requestAnimationFrame(loop)
    }),
  [mv.from, mv.to, 900],
)

await page.waitForTimeout(60)
const clickAt = await page.evaluate(() => performance.now() - window.__probe.t0)
await page.mouse.click(to.x, to.y)
// 注意：这里**不能**插 page.screenshot —— 它会同时掐停 rAF 与主线程上的定时器，
// 于是残影采不到峰值、音效那一拍直接被推到几百毫秒之后（实测过）。要看画面就单独跑一遍。

const frames = await sampling
const first = (key, pred = (v) => v > 0) => {
  const f = frames.find((x) => pred(x[key]))
  return f ? Math.round(f.t - clickAt) : null
}
const last = (key) => {
  let at = null
  for (const f of frames) if (f[key] > 0) at = Math.round(f.t - clickAt)
  return at
}

console.log(`帧数 ${frames.length} · --glide-dur 读到 ${frames.at(-1)?.glide || frames[0]?.glide}`)
console.log('  落点标记 last-to：首帧', first('lastTo'), '末帧', last('lastTo'))
console.log('  死子 is-doomed：首帧', first('doomed'), '末帧', last('doomed'))
console.log('  残影 knock：首帧', first('knock'), '末帧', last('knock'))
console.log('  涟漪 impact：首帧', first('impact'), '末帧', last('impact'))
console.log('  音效 beat：首帧', first('beats'), '共', frames.at(-1)?.beats)
const maxOff = Math.max(0, ...frames.map((f) => f.off))
const maxPoke = Math.max(0, ...frames.map((f) => f.poke))
console.log(`  残影离攻击子中心最远 ${maxOff}px，其中探在攻击子外面 ${maxPoke}px`)

// 逐帧打印关键列，方便看有没有「断了一帧」
const rows = frames
  .map(
    (f) =>
      `${String(Math.round(f.t - clickAt)).padStart(4)} d${f.doomed} k${f.knock}` +
      ` off${String(f.off).padStart(3)} poke${String(f.poke).padStart(3)} L${f.lastTo} i${f.impact ? 1 : 0} b${f.beats}`,
  )
  .join('\n  ')
console.log(rows)

await page.screenshot({ path: 'capture-check.png', clip: await page.locator('[data-board]').boundingBox() })
await browser.close()
