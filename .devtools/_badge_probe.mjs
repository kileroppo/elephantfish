// 一次性诊断：`.turn-badge` 在 tablet 宽度下被棋盘顶边压住多少、被谁压住。
//
// 用法： node _badge_probe.mjs [url]
//
// 这是一次性探针，不进 run.mjs 的 CHECKS —— 它量的是一个具体缺陷，修完就该失效。
import { chromium } from 'playwright-core'
import { mkdir } from 'node:fs/promises'

const url = (process.argv[2] || 'http://127.0.0.1:8060/').replace(/\/$/, '') + '/'
const outDir = 'E:/work/codework/elephantfish/.devtools/shots/_probe'

const VIEWPORTS = [
  { name: 'desktop', width: 1600, height: 980 },
  { name: 'laptop', width: 1366, height: 800 },
  { name: 'tablet', width: 1024, height: 1180 },
  { name: 'phone', width: 414, height: 900 },
]

await mkdir(outDir, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome' })

const probe = (page) =>
  page.evaluate(() => {
    const q = (sel) => document.querySelector(sel)
    const rect = (el) => {
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { top: +r.top.toFixed(2), bottom: +r.bottom.toFixed(2), left: +r.left.toFixed(2), right: +r.right.toFixed(2), w: +r.width.toFixed(2), h: +r.height.toFixed(2) }
    }
    const badge = q('.turn-badge')
    const head = q('.stage-head')
    const board = q('.board')
    const wrap = q('.board-wrap')
    const stage = q('.stage')

    const bR = rect(board)
    const beforeCS = board ? getComputedStyle(board, '::before') : null
    const padTop = bR && beforeCS ? +(bR.top + parseFloat(beforeCS.top)).toFixed(2) : null
    const padLeft = bR && beforeCS ? +(bR.left + parseFloat(beforeCS.left)).toFixed(2) : null
    const padRight = bR && beforeCS ? +(bR.right - parseFloat(beforeCS.right)).toFixed(2) : null

    const bdR = rect(badge)
    // 重叠量：棋盘垫顶边吃进 badge 底边多少
    const overlap = bdR && padTop !== null ? +Math.max(0, bdR.bottom - padTop).toFixed(2) : null

    const boardCS = board ? getComputedStyle(board) : null
    return {
      viewport: { w: innerWidth, h: innerHeight },
      stage: rect(stage),
      head: rect(head),
      headMinHeight: head ? getComputedStyle(head).minHeight : null,
      badge: bdR,
      badgeOverflowBelowHead: bdR && head ? +Math.max(0, bdR.bottom - rect(head).bottom).toFixed(2) : null,
      wrap: rect(wrap),
      board: bR,
      pad: { top: padTop, left: padLeft, right: padRight, insetRaw: beforeCS ? `${beforeCS.top} ${beforeCS.right} ${beforeCS.bottom} ${beforeCS.left}` : null, zIndex: beforeCS?.zIndex },
      boardExtra: {
        transform: boardCS?.transform,
        animationName: boardCS?.animationName,
        boxShadow: boardCS?.boxShadow?.slice(0, 60),
      },
      overlap,
    }
  })

for (const vp of VIEWPORTS) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 2 })
  const page = await ctx.newPage()
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)

  const r = await probe(page)
  console.log(`\n===== ${vp.name}  ${vp.width}x${vp.height} =====`)
  console.log(`  .stage       ${JSON.stringify(r.stage)}`)
  console.log(`  .stage-head  ${JSON.stringify(r.head)}  min-height=${r.headMinHeight}`)
  console.log(`  .turn-badge  ${JSON.stringify(r.badge)}`)
  console.log(`     badge 底边溢出 .stage-head：${r.badgeOverflowBelowHead}px`)
  console.log(`  .board-wrap  ${JSON.stringify(r.wrap)}`)
  console.log(`  .board       ${JSON.stringify(r.board)}`)
  console.log(`  .board::before  inset=${r.pad.insetRaw}  z=${r.pad.zIndex}`)
  console.log(`     垫顶边 y=${r.pad.top}   垫左 x=${r.pad.left}   垫右 x=${r.pad.right}`)
  console.log(`  >>> 重叠量（垫顶边吃进 badge）= ${r.overlap}px`)
  console.log(`  .board transform=${r.boardExtra.transform}  anim=${r.boardExtra.animationName}`)

  // 头部特写：把 badge 上下各留 40px 取景
  if (r.badge) {
    const y = Math.max(0, r.badge.top - 40)
    const h = Math.min(r.viewport.h - y, r.badge.h + 80)
    await page.screenshot({ path: `${outDir}/${vp.name}-head.png`, clip: { x: 0, y, width: r.viewport.w, height: h } })
  }
  await ctx.close()
}

await browser.close()
