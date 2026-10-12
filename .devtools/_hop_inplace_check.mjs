// 落子动效验收：① 刷新页面 ② 悔棋 —— 都不该有子动；③ 真走一步 —— 应该有落定那一下，
// 但棋子全程不离板（脸层的 translateY 必须恒为 0，只有 scale 在动）。
import { chromium } from 'playwright-core'

const url = (process.argv[2] || 'http://127.0.0.1:8125').replace(/\/$/, '') + '/'
const post = (p, b) =>
  fetch(url + p, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(b || {}),
  }).then((r) => r.json())
const getState = () => fetch(url + 'api/state').then((r) => r.json())
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function settle(ms = 8000) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    const s = (await getState()).state
    if (!(s.task && s.task.status === 'running') && !s.game.engine_to_move && s.game.ply > 0) return s
    await sleep(150)
  }
  return (await getState()).state
}

const results = []
const check = (name, pass, detail) => results.push({ name, pass, detail })

const browser = await chromium.launch({ channel: 'chrome' })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await ctx.newPage()

const sample = (ms) =>
  `(() => {
    window.__r = null
    const t0 = performance.now(); const rows = []
    const parse = (tr) => {
      const m = tr.match(/matrix\\(([^)]+)\\)/)
      if (!m) return null
      const v = m[1].split(',').map(Number)
      return { scale: v[0], ty: -v[5] }
    }
    const tick = () => {
      const t = Math.round(performance.now() - t0)
      for (const el of document.querySelectorAll('.piece.is-last')) {
        const p = parse(getComputedStyle(el.querySelector('.piece-face')).transform)
        if (p) rows.push({ t, who: el.getAttribute('aria-label'), scale: p.scale, ty: p.ty })
      }
      if (t < ${ms}) requestAnimationFrame(tick); else window.__r = rows
    }
    requestAnimationFrame(tick)
  })()`

const grab = async () => {
  await page.waitForFunction(() => !!window.__r, null, { timeout: 6000 })
  const rows = await page.evaluate(() => window.__r)
  if (!rows.length) return { n: 0, groups: [] }
  const byWho = new Map()
  for (const r of rows) {
    if (!byWho.has(r.who)) byWho.set(r.who, [])
    byWho.get(r.who).push(r)
  }
  return {
    n: rows.length,
    who: rows[0].who,
    groups: [...byWho].map(([who, rs]) => ({
      who,
      n: rs.length,
      tyMax: Math.max(...rs.map((r) => r.ty)),
      scaleMax: Math.max(...rs.map((r) => r.scale)),
      scaleMin: Math.min(...rs.map((r) => r.scale)),
    })),
    tyMax: Math.max(...rows.map((r) => r.ty)),
    scaleMax: Math.max(...rows.map((r) => r.scale)),
    scaleMin: Math.min(...rows.map((r) => r.scale)),
  }
}
const fmt = (r) =>
  r.n === 0
    ? '没有任何子拿到 is-last'
    : r.groups
        .map(
          (g) =>
            `${g.who}：抬起峰值=${g.tyMax.toFixed(2)}px 压=${g.scaleMax.toFixed(3)} 回压=${g.scaleMin.toFixed(3)}（${g.n} 帧）`,
        )
        .join(' ／ ')

await post('api/new')
await settle()

// ① 刷新 / 打开页面
await page.goto(url, { waitUntil: 'domcontentloaded' })
await page.evaluate(sample(1600))
{
  const r = await grab()
  console.log(`① 刷新页面        → ${fmt(r)}`)
  check('刷新页面不自弹', r.n === 0, fmt(r))
}

// ② 悔棋
await sleep(400)
await post('api/undo')
await page.evaluate(sample(1600))
{
  const r = await grab()
  console.log(`② 悔棋            → ${fmt(r)}`)
  check('悔棋不自弹', r.n === 0, fmt(r))
}

// ③ 真走一步（人自己走）
{
  const st = await settle()
  const mv = st.game.legal_moves[0]
  await sleep(300)
  await page.evaluate(sample(1600))
  const res = await post('api/move', { move: mv.iccs })
  const r = await grab()
  console.log(`③ 真走一步 ${mv.iccs}  → ${fmt(r)}   [${res.ok ? '已录入' : '被拒：' + (res.message || '')}]`)
  check('真走一步有落定动效', r.n > 0, fmt(r))
  check('真走一步棋子不离板', r.n > 0 && r.tyMax < 0.2, r.n ? `抬起峰值=${r.tyMax.toFixed(3)}px` : '无样本')
  check(
    '真走一步有压与回弹',
    r.n > 0 && r.scaleMax > 1.05 && r.scaleMin < 0.99,
    r.n ? `压=${r.scaleMax.toFixed(3)} 回压=${r.scaleMin.toFixed(3)}` : '无样本',
  )
}

console.log('\n---- 结论 ----')
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}  —  ${r.detail}`)
console.log(results.every((r) => r.pass) ? '\n全部通过' : '\n有未通过项')
await browser.close()
