// 思考期冻结 —— 验收清单
//   1 思考中不跑任何装饰动画（本人刚落的那一手除外）
//   2 思考中棋盘几何零位移
//   3 信息没被藏：深度刻度照样点亮、评分照样更新
//   4 引擎落子那一刻，棋子确实在走
//   5 被将军的王在思考中停闪，但那圈朱砂还在
import { chromium } from 'playwright-core'

const url = (process.argv[2] || 'http://127.0.0.1:8022/').replace(/\/$/, '') + '/'
const openRails = process.argv[3] === 'rails'
const results = []
const ok = (name, pass, detail) => results.push({ name, pass, detail })

const post = (p, b) =>
  fetch(url + p, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(b || {}),
  }).then((r) => r.json())
const getState = () => fetch(url + 'api/state').then((r) => r.json())

const browser = await chromium.launch({ channel: 'chrome' })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await ctx.newPage()
await page.goto(url, { waitUntil: 'networkidle' })
if (openRails) {
  await page.getByRole('button', { name: '展开对局设置' }).click().catch(() => {})
  await page.getByRole('button', { name: '展开分析与棋谱' }).click().catch(() => {})
}

const probe = () =>
  page.evaluate(() => {
    const path = (el) => {
      if (!el) return '?'
      const cls =
        typeof el.className === 'string'
          ? el.className.split(/\s+/).filter(Boolean).join('.')
          : String(el.className || '')
      return el.tagName.toLowerCase() + (cls ? '.' + cls : '')
    }
    const r = (s) => {
      const el = document.querySelector(s)
      if (!el) return null
      const b = el.getBoundingClientRect()
      return [b.left, b.top, b.width, b.height].map((v) => Math.round(v * 100) / 100)
    }
    return {
      thinking: !!document.querySelector('.app.is-thinking'),
      anims: document
        .getAnimations()
        .filter((a) => a.playState === 'running')
        .map((a) => `${a.animationName || a.transitionProperty || '?'} @ ${path(a.effect && a.effect.target)}`),
      geo: {
        topbar: r('.topbar'),
        stage: r('.stage'),
        board: r('.board'),
        relay: r('.relay'),
        analysis: r('.analysis'),
        movelist: r('.panel.movelist'),
      },
      lit: document.querySelectorAll('.rung.lit').length,
      depthText: (document.querySelector('.ladder-value') || {}).textContent || null,
      scoreText: (document.querySelector('.eval-score') || {}).textContent || null,
    }
  })

await post('api/new', { engine_side: 'black', think_ms: 3200 })
await page.waitForTimeout(2800)
const st = await getState()
const mv = st.state.game.legal_moves[0]
await post('api/move', { move: mv.iccs })

// ---- 思考期采样 ----
const stray = new Set()
const geoKeys = Object.keys((await probe()).geo)
const gMin = {}
const gMax = {}
let litFirst = null
let litLast = null
let depthFirst = null
let depthLast = null
let samples = 0
const t0 = Date.now()
const moveAnims = new Set()
let sawPanel = false
while (Date.now() - t0 < 7000) {
  const p = await probe()
  if (p.geo.analysis) sawPanel = true
  if (p.thinking) {
    samples += 1
    // 本人刚落的那一手（by-opponent / land-opponent）不算「思考期的动」
    for (const a of p.anims) {
      if (/by-opponent|land-opponent|inkIn|--py @ div\.piece\.(red|black)\.is-last|landHop|shadowHop/.test(a)) continue
      stray.add(a)
    }
    for (const k of geoKeys) {
      const v = p.geo[k]
      if (!v) continue
      if (!gMin[k]) {
        gMin[k] = [...v]
        gMax[k] = [...v]
      }
      for (let i = 0; i < 4; i += 1) {
        gMin[k][i] = Math.min(gMin[k][i], v[i])
        gMax[k][i] = Math.max(gMax[k][i], v[i])
      }
    }
    if (litFirst === null) litFirst = p.lit
    litLast = p.lit
    if (depthFirst === null) depthFirst = p.depthText
    depthLast = p.depthText
  } else {
    for (const a of p.anims) {
      if (/--px|--py|landHop|shadowHop|land-ripple/.test(a)) moveAnims.add(a)
    }
    if (moveAnims.size) break
  }
  await page.waitForTimeout(60)
}

// 1 思考期杂动
ok(
  openRails ? '1 思考期无装饰动画（展开栏）' : '1 思考期无装饰动画（默认布局）',
  stray.size === 0,
  stray.size ? [...stray].join(' / ') : `${samples} 次采样，只看到本人刚落的那一手`,
)

// 2 几何位移
const shifts = geoKeys
  .filter((k) => gMin[k] && gMax[k])
  .map((k) => ({
    k,
    d: Math.max(...[0, 1, 2, 3].map((i) => gMax[k][i] - gMin[k][i])),
  }))
ok(
  '2 思考期棋盘几何零位移',
  shifts.every((s) => s.d < 0.6),
  shifts.map((s) => `${s.k}Δ${s.d.toFixed(2)}`).join(' '),
)

// 3 信息还在（只在分析面板存在时检查）
if (sawPanel) {
  ok(
    '3 信息照常更新（刻度/深度在涨，只是不滑）',
    litLast >= litFirst && depthLast !== depthFirst,
    `点亮 ${litFirst}→${litLast}，深度 ${depthFirst}→${depthLast}`,
  )
}

// 4 引擎落子动画
ok(
  '4 引擎落子时棋子确实在走',
  moveAnims.size > 0,
  moveAnims.size ? [...moveAnims].join(' / ') : '没抓到',
)

// 5 被将军的王：思考中停闪但保留朱砂圈
const checkRing = await page.evaluate(() => {
  const piece = document.querySelector('.board .piece')
  if (!piece) return null
  document.querySelector('.app').classList.add('is-thinking')
  piece.classList.add('is-check')
  const face = piece.querySelector('.piece-face')
  const cs = getComputedStyle(face)
  const animations = face.getAnimations().filter((a) => a.playState === 'running')
  const out = { animationName: cs.animationName, running: animations.length, shadow: cs.boxShadow }
  document.querySelector('.app').classList.remove('is-thinking')
  piece.classList.remove('is-check')
  return out
})
ok(
  '5 将军的王思考中停闪、朱砂圈仍在',
  !!checkRing && checkRing.running === 0 && /rgb/.test(checkRing.shadow || ''),
  checkRing ? `animation=${checkRing.animationName} 运行=${checkRing.running}` : '取不到棋子',
)

await browser.close()

console.log(`\n场景：${openRails ? '左右栏展开' : '默认（栏收起）'}`)
console.log('─'.repeat(78))
for (const r of results) console.log(`${r.pass ? '✓' : '✗'} ${r.name}\n    ${r.detail}`)
const failed = results.filter((r) => !r.pass)
console.log('─'.repeat(78))
console.log(failed.length ? `${failed.length} 项未通过` : '全部通过')
process.exit(failed.length ? 1 : 0)
