import { chromium } from 'playwright-core'
const b = await chromium.launch({ channel: 'chrome' })
const c = await b.newContext({ viewport: { width: 1600, height: 980 } })
const p = await c.newPage()
await p.goto('http://127.0.0.1:8010/', { waitUntil: 'networkidle' })
await p.waitForTimeout(700)

const dump = async (tag) => {
  const d = await p.evaluate(async () => {
    const s = (await (await fetch('/api/state')).json()).state
    const i = document.querySelector('.relay-field input')
    return {
      chip: document.querySelector('.queue-chip')?.textContent?.trim() ?? null,
      inputDisabled: i?.disabled,
      disabledAttr: i?.getAttribute('disabled') !== null,
      placeholder: i?.placeholder,
      live: !!document.querySelector('.relay-output.is-live'),
      pending: s.pending,
      status: s.game.status.state,
      turn: s.game.turn,
      oppToMove: s.game.opponent_to_move,
      taskStatus: s.task ? s.task.status : null,
      recs: s.game.records.map((r) => r.iccs).join(','),
    }
  })
  console.log(tag, JSON.stringify(d))
}

await p.evaluate(() => fetch('/api/new', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({engine_side:'red',think_ms:900})}))
await p.waitForTimeout(1500)
await dump('after reset  ')

for (const mv of ['b9c7','h9g7','i9h9','h7h3','c6c5','c9e7']) {
  await p.evaluate(async () => {
    const s = (await (await fetch('/api/state')).json()).state
    const ok = !(s.task && s.task.status === 'running') && s.game.opponent_to_move
    if (!ok) throw new Error('not idle')
  })
  await dump(`before ${mv} `)
  try {
    await p.fill('.relay-field input', mv, { timeout: 4000 })
    await p.press('.relay-field input', 'Enter')
  } catch (e) {
    console.log('  !! fill 失败:', mv, e.message.split('\n')[0])
    await dump('  失败时   ')
    break
  }
  await p.waitForTimeout(1300)
  await dump(`after  ${mv} `)
}
await b.close()
