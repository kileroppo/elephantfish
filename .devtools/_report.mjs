import { chromium } from 'playwright-core'

const b = await chromium.launch({ channel: 'chrome' })
const c = await b.newContext({ viewport: { width: 1000, height: 1200 }, deviceScaleFactor: 1 })
const p = await c.newPage()
const errs = []
p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()) })
p.on('pageerror', (e) => errs.push(String(e)))

await p.goto('file:///E:/work/codework/elephantfish/review/quality-review.html', { waitUntil: 'load' })
await p.waitForTimeout(400)

const info = await p.evaluate(() => {
  const bar = document.querySelector('.bar')
  const segs = [...document.querySelectorAll('.bar span')].map((s) => Math.round(s.getBoundingClientRect().width))
  return {
    barWidth: Math.round(bar.getBoundingClientRect().width),
    segs,
    h2: [...document.querySelectorAll('h2')].map((e) => e.textContent.trim()),
    tables: document.querySelectorAll('table').length,
    rows: document.querySelectorAll('tbody tr').length,
    docHeight: document.documentElement.scrollHeight,
    overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }
})
console.log(JSON.stringify(info, null, 1))
console.log('console errors:', errs.length ? errs : 'none')

await p.screenshot({ path: 'shots/_report_top.png', clip: { x: 0, y: 0, width: 1000, height: 1200 } })
await p.evaluate(() => document.querySelector('.score-row').scrollIntoView({ block: 'center' }))
await p.waitForTimeout(200)
await p.screenshot({ path: 'shots/_report_score.png', clip: { x: 0, y: 0, width: 1000, height: 620 } })
await b.close()
