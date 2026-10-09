import { chromium } from 'playwright-core'
const b = await chromium.launch({ channel: 'chrome' })
const c = await b.newContext({ viewport: { width: 1500, height: 950 } })
const p = await c.newPage()
const t0 = Date.now()
const stamp = () => String(Date.now() - t0).padStart(6)
p.on('request', (r) => {
  if (r.url().includes('/api/move')) console.log(stamp(), '→ POST /api/move', r.postData())
})
p.on('response', async (r) => {
  if (r.url().includes('/api/move')) {
    let t = ''; try { t = (await r.text()).slice(0, 90) } catch {}
    console.log(stamp(), '←', r.status(), t)
  }
})
await p.goto('http://127.0.0.1:8010/', { waitUntil: 'networkidle' })
await p.waitForTimeout(800)
// 长考，制造一个足够宽的「引擎在算」窗口
await p.evaluate(() => fetch('/api/new', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({engine_side:'red',think_ms:2500})}))
await p.waitForTimeout(150)
console.log(stamp(), '--- 立刻抢录 b9c7（引擎正在算开局） ---')
await p.fill('.relay-field input', 'b9c7')
await p.press('.relay-field input', 'Enter')

for (let i = 0; i < 14; i++) {
  await p.waitForTimeout(400)
  const s = await p.evaluate(async () => {
    const st = (await (await fetch('/api/state')).json()).state
    return {
      chip: document.querySelector('.queue-chip')?.textContent?.trim() || null,
      disabled: document.querySelector('.relay-field input').disabled,
      live: !!document.querySelector('.relay-output.is-live'),
      recs: st.game.records.map(r => r.iccs).join(','),
      task: st.task ? st.task.status : null,
    }
  })
  console.log(stamp(), JSON.stringify(s))
  if (s.recs.includes('b9c7')) { console.log(stamp(), '*** 排队的那步落地了 ***'); break }
}
await b.close()
