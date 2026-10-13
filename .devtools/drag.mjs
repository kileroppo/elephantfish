// 拖拽落子的专项自检：真的按住一颗子、拖到它合法的落点、松手，
// 然后回头问服务端「这一步记上了没有」。
//
// 用法： node drag.mjs [url]
//
// 定位元素与读状态一律走 `_contract.mjs`（data-* + /api/state）。
//
// 关于「抬起」那条断言：这里以前断言 `.piece.is-lifted`，而那个类在组件里
// 根本不存在 —— 也就是说 `ok` 恒为 false，这个脚本从界面重写（f9a954c）那天起
// 每次都以退出码 1 结束，而没人跑它，于是没人发现。现在换成一条真的有内容的
// 断言：拖拽中那颗子的**包围盒中心应当跟着指针跑**（不再是它原来的格子），
// 这既证明了「跟手」，也顺带证明了它确实被抬起来跟随而不是留在原地。

import {
  openBrowser,
  urlFromArgv,
  watchConsole,
  getState,
  waitIdle,
  waitOpponentTurn,
  reset,
  boardInfo,
  piece,
  target,
  selectedSquare,
  draggingFrom,
  squareCenter,
  calibrate,
  boardCropClip,
  report,
  diagnose,
  failFast,
} from './_contract.mjs'

const url = urlFromArgv(process.argv)
const { browser, page } = await openBrowser({ width: 1440, height: 900 })
const problems = watchConsole(page)
failFast(browser, problems)

await page.goto(url, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('[data-board]', { timeout: 10000 })
await waitIdle(page)

// 引擎执红先走一手，把局面交到对方（黑）手上 —— 这才是转述者要动手的局面。
await reset(page, 'red')
const game = (await waitOpponentTurn(page)).game

const move = game.legal_moves[0]
if (!move) throw new Error('对方没有合法着法可试')

console.log(
  `局面：轮到${game.turn} · 试拖 ${move.from} -> ${move.to}（${move.iccs} ${move.chinese}）`,
)

// 先自校验棋盘几何，再动手。对不上会带着明确的排查方向抛出来，
// 而不是让这一步悄悄掉到隔壁格上、最后报一个「没记上」。
const from = await calibrate(page, move.from)
const to = await squareCenter(page, move.to)
const info = await boardInfo(page)
console.log(`视角翻转：${info.flipped}（读 data-flipped，不再靠包围盒反推）`)

await page.mouse.move(from.x, from.y)
await page.mouse.down()
for (let i = 1; i <= 8; i += 1) {
  await page.mouse.move(from.x + ((to.x - from.x) * i) / 8, from.y + ((to.y - from.y) * i) / 8)
  await page.waitForTimeout(16)
}

// 松手之前：拖拽态、落点高亮、以及「子跟着指针走了」都该成立
const midSurface = await draggingFrom(page)
const midPiece = (await piece(page, move.from).getAttribute('data-dragging')) === 'true'
const midOver = (await target(page, move.to).getAttribute('data-over')) === 'true'
const midBox = await piece(page, move.from).boundingBox()
const followGap = midBox
  ? Math.hypot(midBox.x + midBox.width / 2 - to.x, midBox.y + midBox.height / 2 - to.y)
  : NaN
const cell = (await page.locator('[data-board]').boundingBox()).width / 9

console.log(
  `拖拽中：surface=${midSurface} piece=${midPiece} over=${midOver} ` +
    `跟手偏差=${Number.isNaN(followGap) ? 'n/a' : followGap.toFixed(0) + 'px'}`,
)

// 留一张「手正拿着子」的截图，方便用眼睛复核跟手、留影、落点高亮
await page.screenshot({
  path: 'shots/_dragging.png',
  clip: await boardCropClip(page, 30),
})
await page.mouse.up()
await page.waitForTimeout(500)

const after = await getState(page)
const landed = after.game.records.some((r) => r.iccs === move.iccs)
const cleared = (await draggingFrom(page)) === null
console.log(`落子已记录：${landed} · 拖拽残影已清理：${cleared} · 现在 ply=${after.game.ply}`)

// ---- 再验一次：点击—点击这条路没被指针事件改坏 ---- //
const g2 = (await waitOpponentTurn(page)).game
const mv2 = g2.legal_moves[2]
const f2 = await squareCenter(page, mv2.from)
const t2 = await squareCenter(page, mv2.to)
console.log(`改试点击：${mv2.from} -> ${mv2.to}（${mv2.iccs} ${mv2.chinese}）`)

await page.mouse.click(f2.x, f2.y)
await page.waitForTimeout(150)
const selectedNow = await selectedSquare(page)
const targetsShown = await page.locator('[data-target]').count()
await page.mouse.click(t2.x, t2.y)
await page.waitForTimeout(600)
const after2 = await getState(page)
const landed2 = after2.game.records.some((r) => r.iccs === mv2.iccs)
console.log(`点选生效：${selectedNow} · 可走点 ${targetsShown} 个 · 点击落子已记录：${landed2}`)

// ---- 结论 ---- //
if (!landed) problems.push(`拖拽 ${move.iccs} 没有被服务端记上`)
if (!cleared) problems.push('松手后盘面还留着 data-dragging（拖拽残影没清）')
if (midSurface !== move.from) {
  problems.push(`拖拽中盘面报的是 ${midSurface}，应该是 ${move.from}`)
}
if (!midPiece) problems.push(`拖拽中 ${move.from} 那颗子没标 data-dragging`)
if (!midOver) problems.push(`拖拽中落点 ${move.to} 没有 data-over（没有落点高亮）`)
if (!(followGap < cell)) {
  problems.push(`拖拽中棋子没有跟着指针（偏差 ${followGap.toFixed(0)}px > 一格 ${cell.toFixed(0)}px）`)
}
if (selectedNow !== mv2.from) problems.push(`点击 ${mv2.from} 没有选中它（选中了 ${selectedNow}）`)
if (!targetsShown) problems.push(`选中 ${mv2.from} 之后一个可走点都没显示`)
if (!landed2) problems.push(`点击落子 ${mv2.iccs} 没有被服务端记上`)

console.log(problems.length ? '有断言失败，现场如下' : '控制台与断言都干净')
if (problems.length) console.log(`页面现场：${await diagnose(page)}`)

await browser.close()
process.exit(report(problems, [], '—— 拖拽与点击两条路都通 ——'))
