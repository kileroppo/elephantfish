// 复盘台自检：把「存档里那一局一手手摆回盘上」这件事钉住。
//
// 为什么要有这一套：复盘是这一层里最**安静**的功能。它坏的时候不报错、不白屏，
// 只是摆出一副对不上的盘（第 5 手显示成第 6 手的局面），或者整盘瞬移把滑行弄丢。
// 页面照样能下棋，audit / glide / motion 一条都不会红 —— 因为它们量的都是现场那块盘，
// 而台上那块盘压根不在它们的视野里。
//
// 这里守的是五种安静的坏法：
//   数   —— 台上的 ply、盘上的 ply、棋谱条选中行、棋谱行上的那手棋，四处读数必须是同一个数
//   像   —— 每一手只有走着的颗子换格，其余子纹丝不动；而且那颗子是**同一个 DOM 节点**
//           在滑（身份号一路带下去）。换了节点 = 整盘重挂 = 滑行全丢，画面对但没动
//   只读 —— 台上翻来覆去之后 /api/state 逐字段相同、一个写请求都没发
//   不搭车 —— 复盘架读的是存档，绝不能挤进 130ms 那条轮询
//   形   —— 四档视口里盘的比例都是 0.9000、进度按钮在盘**下面**、盘不压住棋谱条
//
// 牙齿（每刀只点红自己那一条，去掉即绿）：
//   「数」把 ReplayDesk 停在 focusPly ?? 1 改回 0 → 开台那条红；
//   「像」把 lib/replay.ts 里带着 id 的那行换成重新发号 → 「滑过去的是另一个节点」红；
//   「不搭车」往 GameShelf 的 useEffect 后塞一个 1s setInterval(reload) → 轮询窗口那条红；
//   「只读」在开台流程里加一次 POST /api/settings → 写请求那条红；
//   「形」把 app.css 里 `.stage > .board-wrap` 的限定去掉（那条 order 全站生效）
//        → 1024 与 414 两档各红一条「进度按钮排在盘的上面」，另两档照旧绿；
//   「形」再把 `.replay-board-wrap` 的 aspect-ratio 删掉 → 盘塌成 0×0，四档全红。
//        第二刀顺手量出一件事：0×0 的宽高比是 NaN，而 NaN 参与的比较一律为假，
//        所以这两处都写成 `!(… <= …)` 并先问尺寸 —— 照 `ratio > 0.01` 那个写法，
//        这一刀下去脚本 exit=0、四档一条都不红（真这么跑过一次）。
//
// 用法： node replay.mjs [url]（也在 `npm test` 那一串里，由 run.mjs 带着临时库跑）
// 它自己要下一小局并等判分，所以**请把它指向一个临时库**（跟 run.mjs 一条纪律）：
//   EF_STORE_PATH=/tmp/x.sqlite python server/app.py 8036 && node replay.mjs http://127.0.0.1:8036/
import {
  urlFromArgv, openBrowser, watchConsole, report, failFast, diagnose,
  post, getJSON, getState, reset, waitIdle,
  shelfPresent, shelfRow, deskInfo, deskBoard, closeDesk, openRightRail,
} from './_contract.mjs'

const URL = urlFromArgv(process.argv)
const OUT = 'E:/work/codework/elephantfish/.devtools/shots'
const problems = []
const notes = []
const bad = (m) => { problems.push(m); console.log(`  ✗ ${m}`) }
const ok = (m) => console.log(`  ok  ${m}`)

const { browser, page } = await openBrowser({ width: 1600, height: 980 })
failFast(browser, problems)
watchConsole(page, 'replay', problems)

const reqs = { get: 0, write: 0, polled: 0, games: 0, game: 0, mistakes: 0 }
const writes = []
page.on('request', (r) => {
  const u = r.url()
  if (!u.includes('/api/')) return
  if (r.method() !== 'GET') {
    reqs.write += 1
    writes.push(`${r.method()} ${u.replace(/^https?:\/\/[^/]+/, '')}`)
    return
  }
  reqs.get += 1
  if (/\/api\/state(\?|$)/.test(u)) reqs.polled += 1
  if (/\/api\/games(\?|$)/.test(u)) reqs.games += 1
  if (/\/api\/game\?/.test(u)) reqs.game += 1
  if (/\/api\/mistakes(\?|$)/.test(u)) reqs.mistakes += 1
})
const resetCounts = () => {
  for (const k of Object.keys(reqs)) reqs[k] = 0
  writes.length = 0
}

/** /api/state 里没有 game_id：那局还在会话里，没进存档就没人知道它是谁。
 *  所以「刚下的这局」= 存档列表第一行，再拿手数把它认出来。 */
const mine = async (wantPly) => {
  const g = await getJSON(page, '/api/games')
  const hit = (g.games ?? []).find((r) => r.ply_count >= wantPly)
  return { row: hit ?? (g.games ?? [])[0], summary: g.summary }
}

/** 只有三个字段是墙上时钟：task/analysis 的 elapsed 与 server_time。
 *  剥掉它们之前先确认它们真是时钟 —— 别的字段一根手指都不许动。 */
const canon = (x) => {
  const c = JSON.parse(JSON.stringify(x))
  if (c.task) delete c.task.elapsed
  if (c.analysis) delete c.analysis.elapsed
  delete c.server_time
  const sort = (v) => (Array.isArray(v) ? v.map(sort)
    : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sort(v[k])]))
    : v)
  return JSON.stringify(sort(c))
}

await page.goto(URL, { waitUntil: 'networkidle' })

// ---------------------------------------------------------------- 造一局有判分的棋 //
console.log('\n—— 先下一小局（引擎执黑：我方录的手才会被判分）——')
await reset(page, 'black', 700)
await post(page, '/api/settings', { analyze: true, analyze_ms: 700, analyze_depth: 8, analyze_width: 3 })
for (let i = 0; i < 4; i += 1) {
  const s = await getState(page)
  const first = s.game.legal_moves?.[0]
  if (!first) { bad(`第 ${i + 1} 手没有合法着法可录（被将死了？）`); break }
  await post(page, '/api/move', { move: first.iccs })
  await waitIdle(page)
}
// 再录一手，但这一手让引擎想 3.5 秒：为的就是造出一个**轮询真的在跑**的窗口。
// 空闲时这页面压根不轮询（POLL_MS 只跟着搜索开，M2-4 帧预算那一档），
// 所以「复盘架不搭轮询那班车」只能在忙碌窗口里量，否则两条都没东西可量。
await post(page, '/api/settings', { think_ms: 3500 })
const busy = (await getState(page)).game.legal_moves?.[0]
if (!busy) bad('录不上用来拖住引擎的那一手：没有合法着法')
else {
  resetCounts()
  await post(page, '/api/move', { move: busy.iccs }) // 这一发里引擎要应手，约 3.5 秒
  await waitIdle(page)
  if (reqs.polled < 8) bad(`引擎应手这几秒里 /api/state 只来了 ${reqs.polled} 次：轮询没跑起来，这一档什么都没量到`)
  else if (reqs.games + reqs.mistakes > 0) {
    bad(`轮询期间存档接口来了 ${reqs.games + reqs.mistakes} 次（games ${reqs.games} · mistakes ${reqs.mistakes}）：复盘架或错题本搭上了那班车`)
  } else ok(`那几秒 /api/state 来了 ${reqs.polled} 次，而 games/mistakes 一次没来`)
}

const livePly = (await getState(page)).game.ply
const { row: mineRow } = await mine(livePly)
if (!mineRow) bad('下完这一局，存档列表里一行都没有：sync_game 没写进去')
else if (mineRow.ply_count !== livePly) {
  bad(`会话停在第 ${livePly} 手，存档那一行却是 ${mineRow.ply_count} 手：写路径与实况分家`)
} else ok(`这一局 ${mineRow.game_id} 已进存档：${mineRow.ply_count} 手`)

const gameId = mineRow?.game_id ?? ''
let graded = 0
for (let i = 0; i < 40 && graded === 0; i += 1) {
  await page.waitForTimeout(1500)
  const g = await getJSON(page, '/api/games')
  graded = (g.games ?? []).find((r) => r.game_id === gameId)?.graded_plies ?? 0
}
if (!graded) bad('等不到任何一手被判分：台上的判分与「为什么」这一路没被验证')
else ok(`其中 ${graded} 手带上了判分`)

const archive = await getJSON(page, `/api/game?game_id=${encodeURIComponent(gameId)}`)
if (!archive.ok) bad(`GET /api/game 直读失败：${archive.message}`)

// ---------------------------------------------------------------- 复盘架不搭轮询的车 //
console.log('\n—— 复盘架：装载读一次，之后就闭嘴 ——')
// 装载那一次：复盘架与错题本各读一回，之后只有按「重读」才会再来。
// 注意右轨默认是**收起**的（inert），不去按那枚标签，这两栏在 DOM 里存在却永远点不到。
resetCounts()
await page.reload({ waitUntil: 'networkidle' })
const mountReads = reqs.games + reqs.mistakes
if (mountReads === 0) bad('reload 之后一次存档接口都没发：复盘架根本没读，栏里是空的')
else if (mountReads > 2) bad(`装载就读了 ${mountReads} 次存档接口（games ${reqs.games} · mistakes ${reqs.mistakes}）：不止「各一次」`)
else ok(`装载读了 games ${reqs.games} · mistakes ${reqs.mistakes}（各一次）`)

await openRightRail(page)
if (!(await shelfPresent(page))) {
  bad('轨里没有复盘架（[data-shelf]）：这一层根本没有入口，后面全部跳过')
} else {
  const row = shelfRow(page, gameId)
  if (!(await row.count())) bad(`复盘架里没有这一局 ${gameId}`)
  else {
    const box = await row.boundingBox()
    if (box && box.height < 32) bad(`复盘架那一行点击目标 ${Math.round(box.height)}px < 32px`)
    else ok(`整行可点：${Math.round(box.height)}px`)
    resetCounts()
    await page.locator('[data-shelf] [data-shelf-reload]').click()
    await page.waitForTimeout(1200)
    if (reqs.games !== 1) bad(`按「重读」发了 ${reqs.games} 次 /api/games，应为 1 次`)
    else ok('按「重读」就正好补读一次，读完整栏照旧闭嘴')
  }
}

// ---------------------------------------------------------------- 开台 //
console.log('\n—— 台上的读数，从头到尾得是同一个数 ——')
const beforeState = await getState(page)
resetCounts()
await shelfRow(page, gameId).click()
await page.waitForFunction(
  () => document.querySelector('[data-replay]')?.dataset.replayLoading === 'false',
  null, { timeout: 20000 },
)
let d = await deskInfo(page)
let bb = null
if (!d) bad('点了复盘架那一行，复盘台没挂起来')
else if (d.errored) bad(`复盘台报错着：${d.at ?? '(没有文案)'}`)
else if (d.rows !== archive.plies.length) bad(`台上列了 ${d.rows} 行，存档里这一局是 ${archive.plies.length} 手`)
// 从复盘架点进来，台子要停在**走过第 1 手之后**那一格，不是第 0 手那个空开局：
// 停在第 0 手会让人以为这一局第一步没走（尤其引擎执红时，存档里第 1 手就是它走的）。
else if (d.ply !== 1) bad(`从复盘架点进来停在第 ${d.ply} 手，应停在走过第 1 手之后`)
else ok(`台开了：${d.rows} 行棋谱，进来就站在走过第 1 手之后`)

// 视角必须是「我方朝下」那一条约定（App.tsx：引擎执黑 → flipped=true），
// 而且**不许**跟着跳进来的那一手是谁走的跑 —— 跟着行棋方翻，会出现「盘上已经走了
// 一步、数却写着 0」那种数与像对不上的开局。
const wantFlipped = await page.locator('[data-replay]').evaluate((el) => el.dataset.replayFlipped === 'true')
if (wantFlipped !== (mineRow.engine_side === 'black')) {
  bad(`台上视角没跟现场那条约定一致：engine_side=${mineRow.engine_side} 应为 flipped=${mineRow.engine_side === 'black'}，实际 ${wantFlipped}`)
} else ok(`视角按「我方朝下」定，不跟着那一手的行棋方跑（引擎执${mineRow.engine_side === 'red' ? '红' : '黑'}）`)
const firstMv = archive.plies.find((p) => p.ply === 1)
bb = await deskBoard(page)
if (bb?.ply !== 1) bad(`台说停在第 ${d.ply} 手，那块盘上写的是第 ${bb?.ply} 手`)
else if (!bb.pieces.some((p) => p.square === firstMv.iccs.slice(2, 4) && p.side === firstMv.side)) {
  bad(`第 1 手 ${firstMv.iccs} 没摆上盘：落点 ${firstMv.iccs.slice(2, 4)} 上没有${firstMv.side === 'red' ? '红' : '黑'}子`)
} else ok(`第 1 手 ${firstMv.iccs} 真在盘上：落点站着${firstMv.side === 'red' ? '红' : '黑'}方那颗子`)
const two0 = await page.evaluate(() => {
  const all = [...document.querySelectorAll('[data-board]')]
  return all.map((e) => Number(e.dataset.ply))
})
if (!two0.includes(1) || two0.some((p) => p > 1 && p !== livePly)) {
  bad(`台开在第 1 手时两块盘的 ply 读数是 ${two0.join('/')}，应为 1 与现场的 ${livePly}`)
} else ok(`台上第 1 手、底下现场第 ${livePly} 手：回放没有把底下的盘带着走`)
const ratio = bb ? bb.box.width / bb.box.height : NaN
notes.push(`台上那块盘 ${Math.round(bb.box.width)}×${Math.round(bb.box.height)}，宽高比 ${ratio.toFixed(4)}（现场那块是 720/800 = 0.9000）`)
// 写成 `!(… <= …)` 而不是 `… > …`：0×0 的盘算出来是 NaN，而 NaN 参与的比较一律为假，
// 照原写法盘塌没了这一条也不会红（下面四档视口那一节同一条纪律）。
if (!(Math.abs(ratio - 720 / 800) <= 0.01) || bb.box.width < 200) {
  bad(`台上的盘 ${Math.round(bb.box.width)}×${Math.round(bb.box.height)}（比例 ${ratio.toFixed(4)}），复盘的盘不该与对局的盘（0.9000）长得不一样`)
}

// ---------------------------------------------------------------- 一手一手走 //
console.log('\n—— 每一手只许动那颗走着的子 ——')
let walked = 0
for (let n = 1; n <= Math.min(6, archive.plies.length); n += 1) {
  const mv = archive.plies.find((p) => p.ply === n)
  await page.locator(`[data-replay-row][data-ply="${n}"]`).click()
  await page.waitForTimeout(420)
  d = await deskInfo(page)
  bb = await deskBoard(page)
  const on = await page.locator('[data-replay-row][aria-current="step"]').getAttribute('data-ply')
  if (d.ply !== n) { bad(`点了第 ${n} 行，台上的数是 ${d.ply}`); break }
  if (bb.ply !== n) { bad(`台上 data-replay-ply=${d.ply} 而那块盘 data-ply=${bb.ply}：两处读数分家`); break }
  if (Number(on) !== n) { bad(`第 ${n} 手时棋谱条选中的是 ${on}`); break }
  const from = mv.iccs.slice(0, 2)
  const to = mv.iccs.slice(2, 4)
  const here = bb.pieces.find((p) => p.square === to)
  if (!here || here.side !== mv.side) {
    bad(`第 ${n} 手 ${mv.iccs}：落点 ${to} 上不是${mv.side === 'red' ? '红' : '黑'}方子（是${here?.side ?? '空的'}）`); break
  }
  if (bb.pieces.some((p) => p.square === from && p.side === mv.side)) {
    bad(`第 ${n} 手 ${mv.iccs}：起点 ${from} 上还站着同一颗子`); break
  }
  walked += 1
}
if (walked) ok(`走位对上 ${walked} 手：点行 → 台上的数、盘上的数、选中行、落点上的子，四处同步`)

// 那颗子必须是**同一个节点**滑过去的。节点换了 = 身份号每手重发 = 整盘被当成换局面、
// 集体瞬移 —— 画面对了，滑行没了，而没有任何一条断言会为此变红。
const quiet = archive.plies.find((p) => !p.captured && p.ply >= 2)
if (quiet) {
  await page.locator(`[data-replay-row][data-ply="${quiet.ply - 1}"]`).click()
  await page.waitForTimeout(420)
  const marked = await page.evaluate((sq) => {
    const el = document.querySelector(`[data-replay] [data-board] [data-piece][data-square="${sq}"]`)
    if (!el) return false
    el.__efTracked = true
    return true
  }, quiet.iccs.slice(0, 2))
  if (!marked) bad(`第 ${quiet.ply - 1} 手之后，${quiet.iccs.slice(0, 2)} 上找不到那颗要搬的子`)
  else {
    await page.locator(`[data-replay-row][data-ply="${quiet.ply}"]`).click()
    await page.waitForTimeout(110)
    const kept = await page.evaluate(() => {
      const g = document.querySelector('[data-replay] [data-board] .piece.is-gliding')
      return g ? { tracked: g.__efTracked === true, dur: g.style.getPropertyValue('--glide-dur') } : null
    })
    if (!kept) bad(`第 ${quiet.ply} 手没有那颗子在滑（.piece.is-gliding 一个都没有）：整盘被当成换局面了`)
    else if (!kept.tracked) bad(`滑过去的是**另一个节点**：身份号断了，滑行只是碰巧还在`)
    else ok(`滑行由同一个节点扛：${quiet.iccs} 那颗子带着身份号搬过去（--glide-dur ${kept.dur}）`)
  }
}

// ---------------------------------------------------------------- 判分与「为什么」 //
console.log('\n—— 有判分的那一手 ——')
const gradedRow = page.locator('[data-replay-row][data-graded="1"]').first()
if (!(await gradedRow.count())) bad('棋谱条里没有一行 data-graded="1"：判分那条路没被走到')
else {
  const n = Number(await gradedRow.getAttribute('data-ply'))
  await gradedRow.click()
  await page.waitForTimeout(260)
  d = await deskInfo(page)
  const chip = await page.locator('[data-replay-now] .grade-chip').first().textContent().catch(() => null)
  if (d.ply !== n) bad(`点了第 ${n} 手（带判分），台却停在 ${d.ply}`)
  else if (!chip) bad(`第 ${n} 手带着判分，「这一手」那块却没有 chip：${d.now}`)
  else ok(`第 ${n} 手：「${chip.trim()}」${d.why ? ` ｜ 附一句为什么（${d.why.slice(0, 18)}…）` : ' ｜ 这一手给不出吃子层面的原因'}`)
  const next = page.locator('[data-replay-next-graded]')
  if (await next.isDisabled()) notes.push('已经站在最后一个带判分的手上，「下一手判分」是灰的（对：不许偷偷跳到别的手）')
  else {
    await next.click()
    await page.waitForTimeout(260)
    d = await deskInfo(page)
    const landed = await page.locator(`[data-replay-row][data-ply="${d.ply}"]`).getAttribute('data-graded')
    if (landed !== '1') bad(`「下一手判分」停在第 ${d.ply} 手，那一手 data-graded=${landed}：跳错了`)
    else ok(`「下一手判分」落在第 ${d.ply} 手，仍然带判分`)
  }
}

// ---------------------------------------------------------------- 只读 //
console.log('\n—— 回放一局，不该改变任何一局 ——')
await page.keyboard.press('End')
await page.waitForTimeout(320)
d = await deskInfo(page)
if (d.ply !== archive.plies.length) bad(`End 之后停在 ${d.ply}，这一局一共 ${archive.plies.length} 手`)
else ok(`End 到最后一手：第 ${d.ply} / ${d.rows}`)
const two = await page.evaluate(() => {
  const all = [...document.querySelectorAll('[data-board]')]
  const desk = all.find((e) => e.closest('[data-replay]'))
  const live = all.find((e) => !e.closest('[data-replay]'))
  return { boards: all.length, desk: desk ? Number(desk.dataset.ply) : null, live: live ? Number(live.dataset.ply) : null }
})
if (two.boards !== 2) bad(`台开着却找到 ${two.boards} 块盘：应为台上那块 + 底下现场那块`)
else if (two.live !== livePly) bad(`底下的现场盘被带着走了：应停在第 ${livePly} 手，却是第 ${two.live} 手`)
else ok(`两块盘各说各的：台上第 ${two.desk} 手，底下现场仍停在第 ${two.live} 手`)
await closeDesk(page)
if (canon(beforeState) !== canon(await getState(page))) {
  bad('开台到关台，/api/state 变了：复盘台是只读的，它不该碰会话')
} else ok('开台到关台，/api/state 逐字段相同（只剥掉那三个时钟字段）')
if (writes.length) bad(`这段时间发了写请求：${writes.join(', ')}`)
else ok(`这段时间 GET ${reqs.get} 次、POST 0 次`)

// ---------------------------------------------------------------- 点击目标与窄屏 //
console.log('\n—— 四档视口：盘的比例、按钮的位置、点击目标 ——')
await shelfRow(page, gameId).click()
await page.waitForFunction(
  () => document.querySelector('[data-replay]')?.dataset.replayLoading === 'false',
  null, { timeout: 20000 },
)
// 这一档为什么按视口循环量：以前只在 1600 量一次比例、只在 414 量一次横向溢出，
// 于是两种坏法都从这双眼里漏出去了 —— 窄屏那条 `.board-wrap { order }` 串进台上那层，
// 把按钮排到盘的**上面**（画面还在，顺序是错的）；1024 那一档盘被 max-width 压回
// 578×695，比例 0.832，而现场那块是 0.9000（同一条棋谱两种样子）。
// 比例、位置、遮挡这三件事必须在每一档都量，只在某一档量等于没量。
const VIEWPORTS = [
  { n: '1600×980 桌面', w: 1600, h: 980 },
  { n: '1366×800 笔记本', w: 1366, h: 800 },
  { n: '1024×1180 平板', w: 1024, h: 1180 },
  { n: '414×900 手机', w: 414, h: 900 },
]
for (const [i, vp] of VIEWPORTS.entries()) {
  await page.setViewportSize({ width: vp.w, height: vp.h })
  await page.waitForTimeout(400)
  // 等入场那 400ms 播完再量：sheetIn 带着 scale(0.965)，正在升起来的那一层里
  // 每个按钮都矮 1px，量出来是「31px 过小」——那是脚本在跟动画抢读数，不是界面坏了。
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-replay]')
    if (!el) return false
    return el.getAnimations({ subtree: false }).every((a) => a.playState === 'finished')
  }, null, { timeout: 8000 })
  const geo = await page.evaluate(() => {
    const rect = (s) => {
      const el = document.querySelector(s)
      return el ? el.getBoundingClientRect() : null
    }
    const board = rect('[data-replay] [data-board]')
    const ctrl = rect('[data-replay-ctrl]')
    const strip = rect('[data-replay-strip]')
    const cross = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left))
      * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top))
    const small = [...document.querySelectorAll('[data-replay] button, [data-shelf] button, [data-mistake-replay]')]
      .filter((el) => {
        const r = el.getBoundingClientRect()
        return r.width > 0 && r.height > 0 && r.height < 32
      })
      .map((el) => `${(el.className || el.tagName).split(' ')[0]}(${Math.round(el.getBoundingClientRect().height)}px)`)
    return {
      overflow: document.documentElement.scrollWidth - window.innerWidth,
      ratio: board.width / board.height,
      w: Math.round(board.width),
      h: Math.round(board.height),
      ctrlTop: Math.round(ctrl.top),
      boardTop: Math.round(board.top),
      ctrlAboveBoard: ctrl.top < board.top - 1,
      boardOverStrip: Math.round(cross(board, strip)),
      small,
    }
  })
  const tag = vp.n
  // 先问盘有没有尺寸：宽高比 0/0 是 NaN，而 NaN 参与的比较一律为假 ——
  // 只写「比例须为 0.9000」的那条会在盘被收成 0×0 时**闭嘴**（实测：去掉 wrap 的
  // aspect-ratio 之后整块盘塌成 0×0，四条断言一条都不红，脚本 exit=0）。
  const fails = []
  if (geo.w < 200 || geo.h < 200) fails.push(`盘塌成 ${geo.w}×${geo.h}：这一档没把高度交给盘`)
  if (geo.overflow > 0) fails.push(`横向溢出 ${geo.overflow}px`)
  if (geo.w >= 200 && !(Math.abs(geo.ratio - 720 / 800) <= 0.01)) {
    fails.push(`盘 ${geo.w}×${geo.h} 比例 ${geo.ratio.toFixed(4)}，复盘的盘不该与对局的盘（0.9000）长得不一样`)
  }
  if (geo.ctrlAboveBoard) fails.push(`进度按钮（顶 ${geo.ctrlTop}）排在盘（顶 ${geo.boardTop}）的**上面**：窄屏那条 .board-wrap 的 order 串进了这一层`)
  if (geo.boardOverStrip > 0) fails.push(`盘压住棋谱条 ${geo.boardOverStrip}px²：行高比盘的内容矮`)
  if (geo.small.length) fails.push(`点击目标过小(<32px)：${geo.small.join(', ')}`)
  for (const f of fails) bad(`${tag}：${f}`)
  if (!fails.length) {
    ok(`${tag}：盘 ${geo.w}×${geo.h} 比例 ${geo.ratio.toFixed(4)}，按钮在盘下面，不压棋谱条，按钮都不小于 32px`)
  }
  if (i === 0) await page.screenshot({ path: `${OUT}/replay-desktop.png` })
  if (i === VIEWPORTS.length - 1) await page.screenshot({ path: `${OUT}/replay-phone.png` })
}
await closeDesk(page)

// ---------------------------------------------------------------- 错题本那一步 //
console.log('\n—— 错题本「摆到盘上」——')
await page.setViewportSize({ width: 1600, height: 980 })
await page.waitForTimeout(400)
const jumps = await page.locator('[data-mistake-replay]').count()
const book = await getJSON(page, '/api/mistakes')
if (!jumps) notes.push('错题本这一屏没有可跳的题（跨局还没攒出「同一个局面错过两次」）：那条跳转这次没验到')
else {
  const wantGame = await page.locator('[data-mistake-replay]').first().getAttribute('data-mistake-replay')
  await page.locator('[data-mistake-replay]').first().click()
  await page.waitForFunction(
    () => document.querySelector('[data-replay]')?.dataset.replayLoading === 'false',
    null, { timeout: 20000 },
  )
  d = await deskInfo(page)
  const entry = (book.mistakes ?? [])[0]
  if (d.gameId !== wantGame) bad(`那颗按钮说要摆 ${wantGame}，台上却是 ${d.gameId}`)
  else if (entry && d.ply !== (entry.worst_ply ?? -1)) {
    bad(`跳到了第 ${d.ply} 手，而题上写的最差那次是第 ${entry.worst_ply} 手：台上摆的是另一道题`)
  } else {
    // 光比手数不够：默认就落在第 1 手，题也常常是第 1 手，两者撞上了什么也证不出来。
    // 比的是**那一手到底是哪手棋** —— 题上写的走法必须就是盘上正摆着的那手。
    const detail = await getJSON(page, `/api/game?game_id=${encodeURIComponent(d.gameId)}`)
    const shown = (detail.plies ?? []).find((p) => p.ply === d.ply)
    if (entry?.worst_iccs && shown?.iccs && shown.iccs !== entry.worst_iccs) {
      bad(`题上那一手是 ${entry.worst_iccs}，台上第 ${d.ply} 手却是 ${shown.iccs}：跳过去的是另一道题`)
    } else ok(`错题本跳到 ${d.gameId} 第 ${d.ply} 手，正是题上那一次（${shown?.iccs ?? '?'} ${shown?.chinese ?? ''}）`)
  }
  await page.screenshot({ path: `${OUT}/replay-from-mistake.png` })
  await closeDesk(page)
}

console.log('\n现场：' + (await diagnose(page)))
await browser.close()
process.exit(report(problems, notes, '—— 复盘台自检全部通过 ——'))
