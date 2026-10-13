// 键盘走子专项自检：聚焦棋盘 → 方向键移动光标 → 回车选中 → 方向键走到合法落点
// → 回车落子，最后问服务端「这一步记上了没有」。
//
// 用法： node kbd.mjs [url]
//
// 这个脚本以前**从不 `process.exit`** —— 结尾只有三行 console.log，无论发现
// 什么问题都以 0 结束。一条永远不会失败的检查比没有检查更糟：它让人以为键盘
// 通路有覆盖，而「有问题」只写在 stdout 上，没人读 stdout。
//
// 它以前还靠「连按 10 次左 + 12 次下把光标逼到 a0，再正向数步」来定位光标。
// 现在光标在哪一格就写在 DOM 上（`data-cursor`），照着差值走即可 —— 不必
// 假定初始位置，也不必赌按键会不会被边界钳住。

import {
  openBrowser,
  urlFromArgv,
  watchConsole,
  getState,
  waitIdle,
  waitOpponentTurn,
  reset,
  boardInfo,
  cursorSquare,
  selectedSquare,
  report,
  diagnose,
  failFast,
} from './_contract.mjs'

const url = urlFromArgv(process.argv)
const { browser, page } = await openBrowser()
const problems = watchConsole(page)
failFast(browser, problems)

/**
 * 把光标从当前位置走到目标格。
 *
 * 方向键走的是**屏幕**方向：组件内部在翻转视角时会把 dFile/dRank 取反
 * （Board.tsx 的 moveCursor），所以这里算差值也要按屏幕方向算。
 */
async function walkTo(target) {
  const cur = await cursorSquare(page)
  if (!cur) throw new Error('光标还没显形，要先按一次方向键')
  const info = await boardInfo(page)
  const curF = cur.charCodeAt(0) - 97
  const curR = Number(cur.slice(1))
  const tF = target.charCodeAt(0) - 97
  const tR = Number(target.slice(1))
  const dFile = info.flipped ? curF - tF : tF - curF
  const dRank = info.flipped ? curR - tR : tR - curR

  for (let i = 0; i < Math.abs(dFile); i += 1) {
    await page.keyboard.press(dFile > 0 ? 'ArrowRight' : 'ArrowLeft')
  }
  for (let i = 0; i < Math.abs(dRank); i += 1) {
    await page.keyboard.press(dRank > 0 ? 'ArrowUp' : 'ArrowDown')
  }
  const now = await cursorSquare(page)
  if (now !== target) {
    // 光标没走到该去的地方 —— 这是键盘导航本身的问题，不是脚本没等对
    throw new Error(`光标没能走到 ${target}，停在 ${now}（方向键没生效或被钳住了）`)
  }
}

await page.goto(url, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('[data-board]', { timeout: 10000 })
await waitIdle(page)

// 引擎执红先走一手，把局面交到对方（黑）手上 —— 这时键盘才有子可动
await reset(page, 'red')
const game = (await waitOpponentTurn(page)).game
const mv = game.legal_moves.find((m) => m.from !== m.to)
if (!mv) throw new Error('对方没有可试的合法着法')

console.log(`局面：轮到${game.turn} · 试走 ${mv.from} -> ${mv.to}（${mv.iccs} ${mv.chinese}）`)

// 聚焦棋盘并按一次方向键，光标才显形（初始 cursor 是 null，要按一下才出现）
await page.locator('[data-board]').focus()
await page.keyboard.press('ArrowUp')
const revealed = await cursorSquare(page)
console.log(`光标显形：${revealed}`)

const before = (await getState(page)).game.records.map((r) => r.iccs)

await walkTo(mv.from)
await page.keyboard.press('Enter')
await page.waitForTimeout(150)
const picked = await selectedSquare(page)
const targetCount = await page.locator('[data-target]').count()

await walkTo(mv.to)
await page.keyboard.press('Enter')
await page.waitForTimeout(600)

const after = (await getState(page)).game.records.map((r) => r.iccs)
// 自动应手可能立刻把引擎的回应也记上，所以不能只看 last_move，
// 要看「我们这一步有没有出现在新增记录里」。
const landed = after.length > before.length && after.includes(mv.iccs)
console.log(`回车选中了：${picked} · 可走点 ${targetCount} 个 · 键盘落子已记录：${landed}`)

// Esc 取消选中不应报错（它会走到 watchConsole 里）
await page.keyboard.press('Escape')
await page.waitForTimeout(100)

if (!revealed) problems.push('按了方向键之后光标没有显形（data-kbd-cursor 不存在）')
if (picked !== mv.from) problems.push(`回车没有选中 ${mv.from}（选中了 ${picked}）`)
if (!targetCount) problems.push(`选中 ${mv.from} 之后一个可走点都没显示`)
if (!landed) problems.push(`键盘落子 ${mv.iccs} 没有被服务端记上（新增记录 ${after.length - before.length} 条）`)

console.log(problems.length ? '有断言失败，现场如下' : '控制台与断言都干净')
if (problems.length) console.log(`页面现场：${await diagnose(page)}`)

await browser.close()
process.exit(report(problems, [], '—— 键盘走子通路 OK ——'))
