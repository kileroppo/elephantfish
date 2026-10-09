// 自检截图：把界面在几种尺寸、几种状态下抓下来，用于自我评审视觉品质。
// 用法： node shot.mjs [url] [outDir]
import { chromium } from 'playwright-core'
import { mkdir } from 'node:fs/promises'

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

/** 等到转述输入框可用：说明轮到「对方」走，界面进入了可录入状态 */
async function waitRelayReady(page, timeout = 25000) {
  await page.waitForFunction(
    () => {
      const input = document.querySelector('.relay-field input')
      return !!input && !(input).disabled
    },
    { timeout },
  )
}

async function playMoves(page, moves) {
  for (const mv of moves) {
    await waitRelayReady(page)
    await page.fill('.relay-field input', mv)
    await page.press('.relay-field input', 'Enter')
    await page.waitForTimeout(120)
  }
}

for (const vp of VIEWPORTS) {
  const { ctx, page } = await newPage(vp)
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)
  await page.screenshot({ path: `${outDir}/${vp.name}.png` })
  console.log(`✓ ${vp.name}  ${vp.width}x${vp.height}`)
  await ctx.close()
}

// 中局：连续录入几步，看信息密度和棋盘状态
{
  const { ctx, page } = await newPage(VIEWPORTS[0])
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.waitForTimeout(800)
  try {
    await playMoves(page, ['b2e2', 'b9c7', 'b0c2', 'h9g7', 'a0b0', 'i9h9', 'h0g2', 'h7h3'])
    await page.waitForTimeout(3200)
    await page.screenshot({ path: `${outDir}/midgame.png` })
    console.log('✓ midgame')

    // 引擎思考中的瞬间
    await waitRelayReady(page)
    await page.fill('.relay-field input', 'h2e2')
    await page.press('.relay-field input', 'Enter')
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
  try {
    await waitRelayReady(page)
    await page.click('.board-surface', { position: { x: 340, y: 620 } })
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
