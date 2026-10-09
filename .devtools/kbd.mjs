// 键盘走子专项自检：聚焦棋盘 → 方向键移动光标 → 回车选中 → 方向键走到合法落点 → 回车落子，
// 最后问服务端「这一步记上了没有」。
//
// 用法： node kbd.mjs [url]
import { chromium } from 'playwright-core'

const url = (process.argv[2] || 'http://127.0.0.1:8010/').replace(/\/$/, '') + '/'

const browser = await chromium.launch({ channel: 'chrome' })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await ctx.newPage()
const consoleErrs = []
page.on('console', (m) => m.type() === 'error' && consoleErrs.push(m.text()))
page.on('pageerror', (e) => consoleErrs.push(String(e)))

await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForSelector('.board-surface', { timeout: 8000 })

// 等引擎闲下来再动手，不然点击会被 thinking 挡掉
await page.waitForFunction(() => !document.querySelector('.board.is-thinking'), { timeout: 30000 })

// 初始光标 = 初始局面的 last_move 为空 → 落在 e0（红帅）。e0 是自家子，回车应选中。
await page.focus('.board-surface')
await page.keyboard.press('ArrowUp') // 触发光标显形：e0 → e1
await page.waitForTimeout(120)
const cursorVisible = (await page.locator('.kbd-cursor').count()) === 1

// 走兵：初始局面红方兵在 c6？不——用通用策略：先点选一颗有合法步的子。
// 直接问服务端合法着法，挑第一步，用键盘把光标挪到 from，回车；再挪到 to，回车。
const snapRaw = await page.evaluate(async () => {
  const r = await fetch('/api/state')
  return r.json()
}).catch(() => null)
const snap = snapRaw?.state?.game ?? null
const recordedBefore = (snap?.records ?? []).map((r) => r.iccs)

let moveOk = false
let tried = ''
if (snap && snap.legal_moves && snap.legal_moves.length) {
  const mv = snap.legal_moves.find((m) => m.from !== m.to)
  tried = mv.iccs
  const df = mv.to.charCodeAt(0) - mv.from.charCodeAt(0)
  const dr = Number(mv.to.slice(1)) - Number(mv.from.slice(1))
  // 先把光标精确挪到 from：光标现在在某未知格，用「从 initialCursor 推」不可靠，
  // 干脆多点几次反方向键把光标逼到角上，再正向数步。
  for (let i = 0; i < 10; i++) await page.keyboard.press('ArrowLeft')
  for (let i = 0; i < 12; i++) await page.keyboard.press('ArrowDown')
  // 现在光标应在 a0（未翻转视角）
  const fromF = mv.from.charCodeAt(0) - 97
  const fromR = Number(mv.from.slice(1))
  for (let i = 0; i < fromF; i++) await page.keyboard.press('ArrowRight')
  for (let i = 0; i < fromR; i++) await page.keyboard.press('ArrowUp')
  await page.keyboard.press('Enter') // 选中
  await page.waitForTimeout(80)
  for (let i = 0; i < Math.abs(df); i++) await page.keyboard.press(df > 0 ? 'ArrowRight' : 'ArrowLeft')
  for (let i = 0; i < Math.abs(dr); i++) await page.keyboard.press(dr > 0 ? 'ArrowUp' : 'ArrowDown')
  await page.keyboard.press('Enter') // 落子
  await page.waitForTimeout(600)
  const afterRaw = await page.evaluate(async () => {
    const r = await fetch('/api/state')
    return r.json()
  })
  const after = afterRaw?.state?.game
  const recordedAfter = (after?.records ?? []).map((r) => r.iccs)
  // 自动应手可能立刻把引擎的回应也记上，所以不能只看 last_move，
  // 看「我们这一步有没有出现在新增记录里」。
  moveOk = recordedAfter.length > recordedBefore.length && recordedAfter.includes(mv.iccs)
}

// Esc 取消选中不应报错
await page.keyboard.press('Escape')

console.log(`光标显形：${cursorVisible}`)
console.log(`键盘落子 ${tried}：${moveOk ? '已记录' : '未记录'}`)
console.log(`控制台：${consoleErrs.length ? '有错误！\n' + consoleErrs.join('\n') : '干净'}`)
console.log(cursorVisible && moveOk && !consoleErrs.length ? '—— 键盘走子通路 OK ——' : '—— 存在问题 ——')
await browser.close()
