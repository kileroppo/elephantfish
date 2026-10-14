// 自检截图：把界面在几种尺寸、几种状态下抓下来，用于自我评审视觉品质。
// 用法： node shot.mjs [url] [outDir]
//
// **每一段都先 reset 一局。** 以前不 reset，截图内容取决于服务端当时停在什么局面 ——
// 于是同一份代码，第二次跑出来的图跟第一次不是一回事。而 playMoves 走的是
// `legal_moves[0]`（引擎列出的第一个合法着法，通常是步臭棋），对着同一个服务连跑两轮
// 之后我方就被将死了；此时 legal_moves 为空，`legal_moves[0].iccs` 直接抛异常，
// thinking / help 两张图再也出不来 —— 而且因为第一轮的图是好的，这个烂法悄无声息。
// 局面不是自己造的，就别说它是"截图"。
import { chromium } from 'playwright-core'
import { mkdir } from 'node:fs/promises'
// 录入走契约里那一份：`/` 展开 + `[data-relay-input]`。别在这里再抄一遍选择器 ——
// 以前那套 `.relay-field input` 就是这么烂掉的（类名没了、折叠状态也赌错了）。
import { typeMove, waitIdle, waitOpponentTurn, reset } from './_contract.mjs'

const url = process.argv[2] || 'http://127.0.0.1:8020/'
const outDir = (process.argv[3] || 'E:/work/codework/elephantfish/.devtools/shots').replace(/\/$/, '')

const VIEWPORTS = [
  { name: 'desktop', width: 1600, height: 980 },
  { name: 'laptop', width: 1366, height: 800 },
  { name: 'tablet', width: 1024, height: 1180 },
  { name: 'phone', width: 414, height: 900 },
]

await mkdir(outDir, { recursive: true })

const browser = await chromium.launch({ channel: 'chrome' })
const problems = []

async function newPage(vp) {
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 2,
  })
  const page = await ctx.newPage()
  page.on('console', (m) => {
    if (m.type() === 'error' && !/favicon/i.test(m.text())) {
      problems.push(`[${vp.name}] console: ${m.text()}`)
    }
  })
  page.on('pageerror', (e) => problems.push(`[${vp.name}] pageerror: ${e.message}`))
  return { ctx, page }
}

/** 连录几手「对方」的棋，把局面推到中局。
 *
 *  走法**不能写死**：对方的走法是引擎现算出来的（按时间窗搜，每次跑出来的局面都
 *  不完全一样），所以写死的走法迟早踩到非法着法、被服务端 400 挡回来。
 *  以前这里是一串写死的 ICCS，一半的请求都是 400 —— 而且它从来没被发现过，因为
 *  那一段卡在失效选择器上直接超时了，根本没走到。现在每手都从合法着法里现取。
 *  （audit.mjs 的 relay() 里有一段同样的教训，两处口径一致。） */
async function playMoves(page, count) {
  for (let i = 0; i < count; i += 1) {
    const state = await waitOpponentTurn(page)
    const mv = state.game.legal_moves[0]
    if (!mv) break
    await typeMove(page, mv.iccs)
    await waitIdle(page)
  }
}

for (const vp of VIEWPORTS) {
  const { ctx, page } = await newPage(vp)
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.waitForSelector('[data-board]', { timeout: 10000 })
  await reset(page) // 四档尺寸必须是同一个局面，否则没法互相比较
  await page.waitForTimeout(800)
  await page.screenshot({ path: `${outDir}/${vp.name}.png` })
  console.log(`✓ ${vp.name}  ${vp.width}x${vp.height}`)
  await ctx.close()
}

// 中局：连续录入几步，看信息密度和棋盘状态
{
  const { ctx, page } = await newPage(VIEWPORTS[0])
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.waitForSelector('[data-board]', { timeout: 10000 })
  await reset(page)
  await page.waitForTimeout(400)
  try {
    await playMoves(page, 6)
    await page.waitForTimeout(1200)
    await page.screenshot({ path: `${outDir}/midgame.png` })
    console.log('✓ midgame')

    // 引擎思考中的瞬间：录一步之后**不等**它收手，趁它还在算的时候抓
    const st = await waitOpponentTurn(page)
    await typeMove(page, st.game.legal_moves[0].iccs)
    await page.waitForTimeout(700)
    await page.screenshot({ path: `${outDir}/thinking.png` })
    console.log('✓ thinking')

    // 帮助面板
    await page.keyboard.press('Escape')
    await page.keyboard.press('?')
    await page.waitForTimeout(500)
    await page.screenshot({ path: `${outDir}/help.png` })
    console.log('✓ help')
  } catch (e) {
    problems.push('scene: ' + e.message)
  }
  await ctx.close()
}

// 选中棋子：可走点位
{
  const { ctx, page } = await newPage({ name: 'selected', width: 1600, height: 980 })
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.waitForSelector('[data-board]', { timeout: 10000 })
  await reset(page)
  try {
    await waitOpponentTurn(page)
    await page.click('[data-board]', { position: { x: 340, y: 620 } })
    await page.waitForTimeout(600)
    await page.screenshot({ path: `${outDir}/selected.png` })
    console.log('✓ selected')
  } catch (e) {
    problems.push('selected: ' + e.message)
  }
  await ctx.close()
}

await browser.close()

if (problems.length) {
  console.log('\n发现的问题：')
  for (const p of problems) console.log('  ' + p)
  process.exitCode = 1
} else {
  console.log('\n无控制台错误')
}
