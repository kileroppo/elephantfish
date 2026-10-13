// 自检审计：跑一遍真实流程，抓细节、量指标、收集控制台错误。
// 用法： node audit.mjs [url] [outDir]
//
// 和 shot.mjs 的区别：这个脚本会先把服务器重置成已知局面（而不是盲录一步），
// 并且会量一批「眼睛看不出来但会露怯」的指标：溢出、对比度、点击目标尺寸。
//
// ---------------------------------------------------------------------------
// 这次大修修掉了四处**静默失效**。四处都是一类毛病：脚本写着一句看起来在检查
// 什么的代码，实际那个东西早就不存在了，于是它要么恒真、要么恒假，而没有人知道。
//
// 1. `idle()` 的「界面同步了没有」判据是
//    `!querySelector('.relay-output.is-live') && !querySelector('.queue-chip')`，
//    这两个类名在组件里都不存在 → 条件恒真，这一半从来没验过。
// 2. 更要命的是 `idle()` 用 `page.waitForFunction(async () => …)`。Playwright
//    **不会 await 谓词返回的 Promise** —— 它看到的是一个真值对象，于是立即返回。
//    所以 `idle()` 从来没有等过任何东西，而它是下面每个动作的前置条件。
// 3. `relay()` 用 `page.fill('.relay-field input', …)`。转述台已重写成
//    `relay-compact`，输入框默认折叠、类名也换了 → 中局场景必然超时。
// 4. `.relay-console` 截图、`.relay` 取几何，两个类名同样不存在 → 截图被
//    `if (el)` 静默跳过，几何那项永远记成 null。
//
// 现在定位与判据一律走 `_contract.mjs`（data-* + /api/state），收尾统一走
// `report()`，退出码是真的。

import { mkdir } from 'node:fs/promises'
import {
  openBrowser,
  urlFromArgv,
  watchConsole,
  getState,
  post,
  waitIdle,
  reset,
  typeMove,
  queuedText,
  squareCenter,
  calibrate,
  report,
  diagnose,
} from './_contract.mjs'

const url = urlFromArgv(process.argv, 'http://127.0.0.1:8020/')
const outDir = (process.argv[3] || 'E:/work/codework/elephantfish/.devtools/shots').replace(/\/$/, '')

await mkdir(outDir, { recursive: true })

const { browser } = await openBrowser()
const problems = []
const notes = []
/** 409 是排队机制的正常信号（引擎在算），单独计数，不当错误看 */
let conflict409 = 0

function newPage(vp) {
  return browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 2,
  }).then(async (ctx) => {
    const page = await ctx.newPage()
    watchConsole(page, vp.name, problems)
    page.on('response', (r) => {
      if (!r.url().includes('/api/')) return
      if (r.status() === 409) {
        conflict409 += 1
        return
      }
      if (r.status() >= 400) {
        problems.push(`[${vp.name}] HTTP ${r.status()} ${r.url().replace(/^.*\/api/, '/api')}`)
      }
    })
    return { ctx, page }
  })
}

/** 录入一步「对方」的棋，并等到引擎的应手落地。
 *
 *  想走的那一步**不保证合法**：对方的走法是引擎现算出来的（皮卡鱼按时间窗搜，
 *  每次跑出来的局面都不完全一样），所以「录 g6g5」这种写死的走法迟早会踩到
 *  非法着法、被服务端 400 挡回来。这里退一步：想走的那步在当前局面里合法就走
 *  它，不合法就从合法着法里现取一步。这条曾经是隐藏的 —— 老 `relay()` 卡在
 *  失效选择器上超时，根本没走到这一步，所以没人发现写死的走法会漏。 */
async function relay(page, wanted) {
  await waitIdle(page)
  const legal = (await getState(page)).game.legal_moves
  const mv = legal.some((m) => m.iccs === wanted) ? wanted : legal[0].iccs
  await typeMove(page, mv)
  await waitIdle(page)
}

/** 取一个布局地标。找不到时必须出声 —— 静默返回默认值就等于这条指标废了。 */
async function landmark(page, selector, label) {
  const el = await page.$(selector)
  if (!el) problems.push(`找不到布局地标 ${selector}（${label}）—— 这项指标已经失效，需同步脚本`)
  return el
}

/** 抢录场景里排队的那一步。黑方 c6 卒前进一格：在第 6 手后的局面里，
 *  无论引擎那一步怎么走，它基本都是合法着法（红子还在自己半场，碰不到 c6）。 */
const QUEUED_MOVE = 'c6c5'

// --------------------------------------------------------------------------- //
// 1. 四种尺寸的首屏
// --------------------------------------------------------------------------- //

const VIEWPORTS = [
  { name: 'desktop', width: 1600, height: 980 },
  { name: 'laptop', width: 1366, height: 800 },
  { name: 'tablet', width: 1024, height: 1180 },
  { name: 'phone', width: 414, height: 900 },
]

for (const vp of VIEWPORTS) {
  const { ctx, page } = await newPage(vp)
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-board]', { timeout: 10000 })
  await reset(page)
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${outDir}/${vp.name}.png` })
  if (vp.name === 'phone') {
    await page.screenshot({ path: `${outDir}/phone_full.png`, fullPage: true })
  }

  const m = await page.evaluate(() => {
    const de = document.documentElement
    const board = document.querySelector('[data-board]')
    const box = board ? board.getBoundingClientRect() : null
    const btns = [...document.querySelectorAll('button')].map((b) => {
      const r = b.getBoundingClientRect()
      return {
        w: Math.round(r.width),
        h: Math.round(r.height),
        t: (b.textContent || '').trim().slice(0, 10),
      }
    })
    const fontEl = document.querySelector('[data-piece] .piece-glyph')
    return {
      overflowX: de.scrollWidth - de.clientWidth,
      boardW: box ? Math.round(box.width) : 0,
      boardH: box ? Math.round(box.height) : 0,
      smallBtns: btns.filter((b) => b.h > 0 && b.h < 32),
      pieceFont: fontEl ? getComputedStyle(fontEl).fontSize : null,
      relayTop: document.querySelector('[data-relay]')?.getBoundingClientRect().top ?? -1,
      analysisTop: document.querySelector('[data-analysis]')?.getBoundingClientRect().top ?? -1,
      fontFound: !!fontEl,
    }
  })
  if (!m.fontFound) problems.push(`[${vp.name}] 找不到棋子字形元素，字号这项指标失效`)
  if (!m.boardW) problems.push(`[${vp.name}] [data-board] 没有尺寸，盘面没渲染出来`)
  if (m.overflowX > 1) problems.push(`[${vp.name}] 横向溢出 ${m.overflowX}px`)
  if (m.smallBtns.length) {
    problems.push(
      `[${vp.name}] 点击目标过小(<32px): ${m.smallBtns.map((b) => `${b.t}(${b.w}x${b.h})`).join(', ')}`,
    )
  }
  // 「转述台排在分析面板之前」只在**窄屏单栏**下才有意义：宽屏是左右两个侧栏
  // 并排，比较它们的纵坐标是没有意义的。以前这个指标在四种尺寸下都照算，
  // 于是宽屏上恒为 false，谁也没法从这一行里看出什么。
  const stacked = vp.width <= 1140
  if (!stacked) {
    notes.push(`${vp.name.padEnd(8)} 棋盘 ${m.boardW}x${m.boardH}  棋子字号 ${m.pieceFont}  溢出 ${m.overflowX}px  顺序：宽屏左右分栏，不适用`)
  } else {
    if (m.relayTop < 0 || m.analysisTop < 0) {
      problems.push(`[${vp.name}] 读不到转述台或分析面板的位置，顺序这项指标失效`)
    }
    const ok = m.relayTop < m.analysisTop
    if (!ok) problems.push(`[${vp.name}] 转述台没有排在分析面板之前（窄屏上它是主操作区）`)
    notes.push(
      `${vp.name.padEnd(8)} 棋盘 ${m.boardW}x${m.boardH}  棋子字号 ${m.pieceFont}  ` +
        `溢出 ${m.overflowX}px  转述台先于分析 ${ok}`,
    )
  }
  console.log(`✓ ${vp.name}  棋盘 ${m.boardW}x${m.boardH}  ${m.pieceFont}`)
  await ctx.close()
}

// --------------------------------------------------------------------------- //
// 2. 细节放大：河流文字 / 棋子 / 面板
// --------------------------------------------------------------------------- //

{
  const { ctx, page } = await newPage({ name: 'detail', width: 1600, height: 980 })
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-board]', { timeout: 10000 })
  await reset(page)
  await page.waitForTimeout(300)

  for (const [sel, name] of [
    ['[data-board]', '_board'],
    ['.river-text', '_river'],
    ['[data-piece]', '_piece'],
    ['[data-relay]', '_relay'],
  ]) {
    const el = await landmark(page, sel, `细节截图 ${name}`)
    if (el) await el.screenshot({ path: `${outDir}/${name}.png` })
  }

  // 河流文字的几何：看 SVG 文本有没有被压扁
  const riverBox = await page.evaluate(() => {
    const g = document.querySelector('.river-text')
    if (!g) return null
    const r = g.getBoundingClientRect()
    return { w: Math.round(r.width), h: Math.round(r.height) }
  })
  if (!riverBox) problems.push('找不到 .river-text，河流文字几何这项指标失效')
  notes.push(`河流文字包围盒 ${JSON.stringify(riverBox)}`)

  console.log('✓ detail 裁剪')
  await ctx.close()
}

// --------------------------------------------------------------------------- //
// 3. 中局 + 思考中 + 帮助
// --------------------------------------------------------------------------- //

{
  const { ctx, page } = await newPage({ name: 'scene', width: 1600, height: 980 })
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-board]', { timeout: 10000 })
  try {
    await reset(page)
    // 引擎执红，对手（黑）走这些棋
    for (const mv of ['b9c7', 'h9g7', 'i9h9', 'h7h3', 'c6c5', 'c9e7']) {
      await relay(page, mv)
    }
    await page.waitForTimeout(600)
    await page.screenshot({ path: `${outDir}/midgame.png` })
    console.log('✓ midgame')

    const el = await landmark(page, '[data-board]', '中局盘面截图')
    if (el) await el.screenshot({ path: `${outDir}/_board_midgame.png` })

    // 引擎思考中的瞬间：长考窗口要够宽，否则截到的是算完之后
    await waitIdle(page)
    // 这一步同样只能现取：本局的实际局面取决于引擎前面怎么走
    await typeMove(page, (await getState(page)).game.legal_moves[0].iccs)
    await page.waitForTimeout(350)
    const thinking = (await getState(page)).task?.status === 'running'
    if (!thinking) problems.push('[scene] 没能截到「思考中」的瞬间，这张图无效')
    await page.screenshot({ path: `${outDir}/thinking.png` })
    console.log(`✓ thinking（抓到了：${thinking}）`)

    await waitIdle(page)
    await page.keyboard.press('Escape')
    await page.keyboard.press('?')
    await page.waitForTimeout(400)
    await page.screenshot({ path: `${outDir}/help.png` })
    console.log('✓ help')
  } catch (e) {
    problems.push('scene: ' + e.message.split('\n')[0] + ' :: ' + (await diagnose(page)))
  }
  await ctx.close()
}

// --------------------------------------------------------------------------- //
// 4. 选中棋子
// --------------------------------------------------------------------------- //

{
  const { ctx, page } = await newPage({ name: 'selected', width: 1600, height: 980 })
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-board]', { timeout: 10000 })
  try {
    const state = await reset(page)
    // 不再按棋盘比例瞎点：直接从服务端拿一手合法着法的起点，按几何算它的中心。
    const mv = state.game.legal_moves[0]
    const at = await calibrate(page, mv.from)
    await page.mouse.click(at.x, at.y)
    await page.waitForTimeout(400)

    const shown = await page.locator('[data-target]').count()
    if (!shown) problems.push(`[selected] 点选 ${mv.from} 之后没有出现可走点`)
    notes.push(`点选 ${mv.from} -> 可走点 ${shown} 个`)

    await page.screenshot({ path: `${outDir}/selected.png` })
    console.log('✓ selected')
  } catch (e) {
    problems.push('selected: ' + e.message.split('\n')[0] + ' :: ' + (await diagnose(page)))
  }
  await ctx.close()
}

// --------------------------------------------------------------------------- //
// 5. 竞态：引擎还在算的时候抢先录入，应该排队并自动落地，而不是弹错误
// --------------------------------------------------------------------------- //

{
  const { ctx, page } = await newPage({ name: 'race', width: 1500, height: 950 })
  let conflicts = 0
  let movePosts = 0
  page.on('response', (r) => {
    if (!r.url().includes('/api/move')) return
    movePosts += 1
    if (r.status() === 409) conflicts += 1
  })
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-board]', { timeout: 10000 })
  try {
    // 长考窗口必须落在**开局库之外**。内置引擎在开局前几手是查库的，毫秒级就
    // 出招、根本不看 think_ms —— 以前这段用 `/api/new` 起手再等 250ms 就录，
    // 那个赌注必输（等到引擎已经走完，录入就变成直接落子，永远测不到排队）。
    // 载入 6 手之后轮到红方，引擎真的要搜满 think_ms。
    await post(page, '/api/load', {
      moves: ['h2e2', 'h9g7', 'h0g2', 'b9c7', 'i0h0', 'a9a8'],
      engine_side: 'red',
      think_ms: 5000,
    })

    const thinkingNow = await (async () => {
      const deadline = Date.now() + 3000
      while (Date.now() < deadline) {
        const s = await getState(page)
        if (s.task?.status === 'running') return true
        await page.waitForTimeout(80)
      }
      return false
    })()
    if (!thinkingNow) problems.push('[race] 引擎没有进入思考状态，这个场景无效')

    // 引擎还在算的时候，人把手里的棋敲进来 —— 应该排队，不是报错
    await typeMove(page, QUEUED_MOVE)
    await page.waitForTimeout(300)

    const settle = await getState(page)
    const chip = await queuedText(page)
    await page.screenshot({ path: `${outDir}/queued.png` })
    console.log('✓ queued  排队提示:', JSON.stringify(chip))

    if (settle.task?.status !== 'running') {
      problems.push('[race] 录入之后引擎已经不在思考，没测到排队窗口')
    }
    if (!settle.pending) problems.push('[race] 服务端没有把抢先录入的那一步记下来')
    if (!chip) problems.push('[race] 界面上没有出现排队提示（[data-relay-queued]）')

    // 等排队那一步落地（引擎收手后服务端自动落子）
    const landed = await (async () => {
      const deadline = Date.now() + 30000
      while (Date.now() < deadline) {
        const s = await getState(page)
        if (!s.pending && s.game.records.some((r) => r.iccs === QUEUED_MOVE)) return true
        await page.waitForTimeout(150)
      }
      return false
    })()
    if (!landed) problems.push(`[race] 排队的那一步 ${QUEUED_MOVE} 没有自动落地`)
    notes.push(
      `抢录 ${QUEUED_MOVE} 自动落地：${landed}；期间 /api/move 发了 ${movePosts} 次，409 ${conflicts} 次`,
    )
    if (conflicts > 0) problems.push(`[race] 不该再出现 409（出现了 ${conflicts} 次）`)
    if (movePosts > 1) problems.push(`[race] 录入一步发起了 ${movePosts} 次请求，应该只发一次`)
  } catch (e) {
    problems.push('race: ' + e.message.split('\n')[0] + ' :: ' + (await diagnose(page)))
  }
  await ctx.close()
}

// --------------------------------------------------------------------------- //

await browser.close()

notes.push(`409（排队重试，属正常信号）共 ${conflict409} 次`)
process.exit(report(problems, notes, '—— 无控制台错误、无溢出、无过小点击目标、无未决竞态 ——'))
