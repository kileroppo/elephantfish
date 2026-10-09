import { chromium } from 'playwright-core'
const b = await chromium.launch({ channel: 'chrome' })
for (const vp of [{n:'phone',w:414,h:900},{n:'tablet',w:1024,h:1180},{n:'laptop',w:1366,h:800}]) {
  const c = await b.newContext({ viewport: { width: vp.w, height: vp.h } })
  const p = await c.newPage()
  await p.goto('http://127.0.0.1:8010/', { waitUntil: 'domcontentloaded' })
  await p.waitForTimeout(2500)
  const g = await p.evaluate(() => {
    const r = (s) => { const e = document.querySelector(s); if (!e) return null
      const b = e.getBoundingClientRect(); return { t: Math.round(b.top), b: Math.round(b.bottom), h: Math.round(b.height) } }
    const boardWrap = r('.board-wrap'), relay = r('.relay'), head = r('.relay-head'),
          field = r('.relay-field'), input = r('.relay-field input'),
          surface = r('.board-surface'), stageHead = r('.stage-head')
    return { boardWrap, boardSurface: surface, stageHead, relay, relayHead: head, relayField: field, input,
             overlapBoardRelayHead: boardWrap && head ? (boardWrap.b > head.t ? boardWrap.b - head.t : 0) : null }
  })
  console.log(vp.n, JSON.stringify(g, null, 1))
  await c.close()
}
await b.close()
