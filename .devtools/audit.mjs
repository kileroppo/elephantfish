// 自检审计：跑一遍真实流程，抓细节、量指标、收集控制台错误。
// 用法： node audit.mjs [url] [outDir]
//
// 和 shot.mjs 的区别：这个脚本会先把服务器重置成已知局面（而不是盲录一步），
// 并且会量一批「眼睛看不出来但会露怯」的指标：溢出、对比度、点击目标尺寸。

import { chromium } from 'playwright-core'
import { mkdir } from 'node:fs/promises'

const url = process.argv[2] || 'http://127.0.0.1:8020/'
const outDir = (process.argv[3] || 'E:/work/codework/elephantfish/.devtools/shots').replace(/\/$/, '')

await mkdir(outDir, { recursive: true })

const browser = await chromium.launch({ channel: 'chrome' })
const problems = []
const notes = []
/** 409 是排队机制的正常信号（引擎在算），单独计数，不当错误看 */
let conflict409 = 0

function newPage(vp) {
  const ctx = browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 2,
  })
  return ctx.then(async (c) => {
    const page = await c.newPage()
    const tag = vp.name
    page.on('console', (m) => {
      if (m.type() !== 'error' || /favicon/i.test(m.text())) return
      if (/status of 409/.test(m.text())) return
      problems.push(`[${tag}] console: ${m.text()}`)
    })
    page.on('pageerror', (e) => problems.push(`[${tag}] pageerror: ${e.message}`))
    page.on('response', (r) => {
      if (!r.url().includes('/api/')) return
      if (r.status() === 409) {
        conflict409 += 1
        return
      }
      if (r.status() >= 400) {
        problems.push(`[${tag}] HTTP ${r.status()} ${r.url().replace(/^.*\/api/, '/api')}`)
      }
    })
    return { ctx: c, page }
  })
}

/** 重置成一局已知状态：引擎执红开局，等它走完第一手。 */
async function reset(page, engineSide = 'red') {
  await page.evaluate(async (side) => {
    await fetch('/api/new', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ engine_side: side, think_ms: 900 }),
    })
  }, engineSide)
  await idle(page)
}

/** 等「服务器空闲 + 轮到对手 + 界面也已经同步过来」。
 *  只等服务器是不够的：前端那份 thinking 是轮询来的，会滞后一个周期。 */
async function idle(page, timeout = 30000) {
  await page.waitForFunction(
    async () => {
      const r = await fetch('/api/state')
      const s = (await r.json()).state
      const settle = !(s.task && s.task.status === 'running') && s.game.opponent_to_move
      const uiSynced =
        !document.querySelector('.relay-output.is-live') &&
        !document.querySelector('.queue-chip')
      return settle && uiSynced
    },
    { timeout, polling: 120 },
  )
}

/** 录入一步「对方」的棋，并等到引擎的应手落地。 */
async function relay(page, mv) {
  await idle(page)
  await page.fill('.relay-field input', mv)
  await page.press('.relay-field input', 'Enter')
  await idle(page)
}

const BOARD_CROP = { x: 300, y: 60, width: 760, height: 860 }

/** 出问题时把关键现场打出来：光看一句 timeout 根本不知道发生了什么 */
async function diagnose(page) {
  try {
    return await page.evaluate(async () => {
      const s = (await (await fetch('/api/state')).json()).state
      const i = document.querySelector('.relay-field input')
      return JSON.stringify({
        chip: document.querySelector('.queue-chip')?.textContent?.trim() ?? null,
        inputDisabled: i ? i.disabled : null,
        live: !!document.querySelector('.relay-output.is-live'),
        pending: s.pending,
        status: s.game.status.state,
        turn: s.game.turn,
        oppToMove: s.game.opponent_to_move,
        taskStatus: s.task ? s.task.status : null,
        ply: s.game.ply,
      })
    })
  } catch (err) {
    return '<诊断失败: ' + err.message + '>'
  }
}

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
  await page.waitForTimeout(900)
  await reset(page)
  await page.waitForTimeout(500)
  await page.screenshot({ path: `${outDir}/${vp.name}.png` })
  if (vp.name === 'phone') {
    await page.screenshot({ path: `${outDir}/phone_full.png`, fullPage: true })
  }

  const m = await page.evaluate(() => {
    const de = document.documentElement
    const overflowX = de.scrollWidth - de.clientWidth
    const surface = document.querySelector('.board-surface')
    const box = surface ? surface.getBoundingClientRect() : null
    const btns = [...document.querySelectorAll('button')].map((b) => {
      const r = b.getBoundingClientRect()
      return {
        w: Math.round(r.width),
        h: Math.round(r.height),
        t: (b.textContent || '').trim().slice(0, 10),
      }
    })
    const relayTop = document.querySelector('.relay')?.getBoundingClientRect().top ?? -1
    const analysisTop = document.querySelector('.analysis')?.getBoundingClientRect().top ?? -1
    return {
      overflowX,
      boardW: box ? Math.round(box.width) : 0,
      boardH: box ? Math.round(box.height) : 0,
      smallBtns: btns.filter((b) => b.h > 0 && b.h < 32),
      pieceFont: getComputedStyle(document.querySelector('.piece-glyph') || de)
        .getPropertyValue('font-size'),
      relayBeforeAnalysis: relayTop >= 0 && analysisTop >= 0 ? relayTop < analysisTop : null,
    }
  })
  if (m.overflowX > 1) problems.push(`[${vp.name}] 横向溢出 ${m.overflowX}px`)
  if (m.smallBtns.length) {
    problems.push(
      `[${vp.name}] 点击目标过小(<32px): ${m.smallBtns.map((b) => `${b.t}(${b.w}x${b.h})`).join(', ')}`,
    )
  }
  notes.push(
    `${vp.name.padEnd(8)} 棋盘 ${m.boardW}x${m.boardH}  棋子字号 ${m.pieceFont}  溢出 ${m.overflowX}px  转述台先于分析 ${m.relayBeforeAnalysis}`,
  )
  console.log(`✓ ${vp.name}  棋盘 ${m.boardW}x${m.boardH}  ${m.pieceFont}`)
  await ctx.close()
}

// --------------------------------------------------------------------------- //
// 2. 细节放大：河流文字 / 棋子 / 面板
// --------------------------------------------------------------------------- //

{
  const { ctx, page } = await newPage({ name: 'detail', width: 1600, height: 980 })
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(700)
  await reset(page)
  await page.waitForTimeout(300)

  const surface = await page.$('.board-surface')
  if (surface) await surface.screenshot({ path: `${outDir}/_board.png` })

  const river = await page.$('.river-text')
  if (river) await river.screenshot({ path: `${outDir}/_river.png` })

  const piece = await page.$('.piece')
  if (piece) await piece.screenshot({ path: `${outDir}/_piece.png` })

  for (const [sel, name] of [
    ['.rail-left', '_rail_left'],
    ['.rail-right', '_rail_right'],
    ['.relay-console', '_relay'],
    ['.topbar', '_topbar'],
  ]) {
    const el = await page.$(sel)
    if (el) await el.screenshot({ path: `${outDir}/${name}.png` })
  }

  // 河流文字的几何：看 SVG 文本有没有被压扁
  const riverBox = await page.evaluate(() => {
    const g = document.querySelector('.river-text')
    if (!g) return null
    const r = g.getBoundingClientRect()
    return { w: Math.round(r.width), h: Math.round(r.height) }
  })
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
  await page.waitForTimeout(700)
  try {
    await reset(page)
    // 引擎执红，对手（黑）走这些棋
    for (const mv of ['b9c7', 'h9g7', 'i9h9', 'h7h3', 'c6c5', 'c9e7']) {
      await relay(page, mv)
    }
    await page.waitForTimeout(1800)
    await page.screenshot({ path: `${outDir}/midgame.png` })
    console.log('✓ midgame')

    const surface = await page.$('.board-surface')
    if (surface) await surface.screenshot({ path: `${outDir}/_board_midgame.png` })

    // 引擎思考中的瞬间
    await relay(page, 'g6g5')
    await page.waitForTimeout(450)
    await page.screenshot({ path: `${outDir}/thinking.png` })
    console.log('✓ thinking')

    await page.waitForTimeout(2500)
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
  await page.waitForTimeout(700)
  try {
    await reset(page)
    const box = await (await page.$('.board-surface')).boundingBox()
    // 点红方九宫左侧的「仕」/「相」附近，确认可走点显示
    await page.mouse.click(box.x + box.width * 0.36, box.y + box.height * 0.86)
    await page.waitForTimeout(500)
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
  await page.waitForTimeout(700)
  try {
    // 长考：把「引擎正在算」这个窗口撑到足够宽
    await page.evaluate(async () => {
      await fetch('/api/new', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ engine_side: 'red', think_ms: 2500 }),
      })
    })
    await page.waitForTimeout(250)

    // 引擎还在算开局的应手，人已经抢先把手里的棋敲进来了
    const usableWhileThinking = await page.evaluate(
      () => !document.querySelector('.relay-field input').disabled,
    )
    await page.fill('.relay-field input', 'b9c7')
    await page.press('.relay-field input', 'Enter')
    await page.waitForTimeout(400)

    const chip = await page.evaluate(
      () => document.querySelector('.queue-chip')?.textContent?.trim() ?? null,
    )
    const settle = await page.evaluate(async () => {
      const s = (await (await fetch('/api/state')).json()).state
      return { settled: !!s.pending, thinking: !!(s.task && s.task.status === 'running') }
    })
    await page.screenshot({ path: `${outDir}/queued.png` })
    console.log('✓ queued  排队提示:', JSON.stringify(chip))

    if (!settle.thinking) problems.push('[race] 引擎没有进入思考状态，场景无效')
    if (!usableWhileThinking) problems.push('[race] 引擎思考时输入框不该被禁用')
    if (!settle.settled) problems.push('[race] 服务端没有把抢先录入的那一步记下来')
    if (!chip) problems.push('[race] 界面上没有出现排队提示')

    // 等排队那一步落地（引擎收手后服务端自动落子）
    await page.waitForFunction(
      async () => {
        const s = (await (await fetch('/api/state')).json()).state
        return !s.pending && s.game.records.some((r) => r.iccs === 'b9c7')
      },
      { timeout: 30000, polling: 150 },
    )
    notes.push(`抢录 b9c7 自动落地；期间 /api/move 只发了 ${movePosts} 次，409 ${conflicts} 次`)
    if (conflicts > 0) problems.push(`[race] 不该再出现 409（出现了 ${conflicts} 次）`)
    if (movePosts > 1) problems.push(`[race] 录入一步发起了 ${movePosts} 次请求，应该只发一次`)
  } catch (e) {
    problems.push('race: ' + e.message.split('\n')[0] + ' :: ' + (await diagnose(page)))
  }
  await ctx.close()
}

await browser.close()

console.log('\n—— 指标 ——')
for (const n of notes) console.log('  ' + n)
console.log(`  409（排队重试，属正常信号）共 ${conflict409 + 0} 次`)

if (problems.length) {
  console.log('\n—— 发现的问题 ——')
  for (const p of problems) console.log('  ✗ ' + p)
  process.exitCode = 1
} else {
  console.log('\n—— 无控制台错误、无溢出、无过小点击目标、无未决竞态 ——')
}
