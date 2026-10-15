// 动效品质断言：把「界面动效够不够奖项级」从一句形容词，变成几条能被改红的断言。
//
// 为什么需要它：动效是最容易**悄悄退化**的一类东西 —— 删掉一条 transition、
// 把 --ease-enter 改回 linear、把编排的 delay 抹平，页面照样能跑、能下棋，
// 五套既有的自检（几何 / 拖拽 / 键盘 / 位移机制 / 滑行）会全绿，于是没人知道
// 手感已经没了。这一套专守「动效还在不在、编排还成不成序列」。
//
// 十一条断言，各守一件事：
//   1 开场编排成序列     顶栏 → 回合条 → 棋盘，animation-delay 必须递增
//   2 棋子落盘成波次     pieceEnter 的 delay 至少 3 个不同值，最大 ≤ 700ms
//   3 悬停预告           可走的棋子悬停时盘面真的欠身（face 的 translateY 上移）
//   4 按压反馈           按钮按下时真的缩小（不是只换个颜色）
//   5 无 transition:all  构建产物里一条都不许有（显式列属性才是纪律）
//   6 reduced-motion     开启该偏好后，时长与延迟都必须压到 1ms
//   7 开场不拖沓         压轴那段（棋盘 delay + 棋子波次最大 delay + 时长）≤ 1200ms
//   8 可走点成波次       选中后 3 枚以上可走点的 delay 不能是同一个值
//   9 弹层退场           关掉之后还带 is-leaving 多活一程（真播退场动画），随后卸载
//  10 翻转视角           盘面真的收窄过，且**换视角那一下发生在最窄处**（换早了还是硬切）
//  11 开场不掉帧         开场编排播放期的 rAF 帧间隔 p50 与最长帧都要站得住
//
// 牙齿检验（--teeth）：注入一段 CSS 把开场编排、弹层退场与翻转视角一起关掉
// （animation:none），第 1、2、7、9、10 条必须红 —— 证明它们盯的是真东西，不是摆设。
//
//   node motion.mjs [url] [--teeth]

import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import { urlFromArgv, openBrowser, waitIdle } from './_contract.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const url = urlFromArgv(process.argv)
const teeth = process.argv.includes('--teeth')

const problems = []
const notes = []
const ok = (msg) => notes.push(`  [ok] ${msg}`)
const bad = (msg) => problems.push(msg)
const num = (v) => Number.parseFloat(v) || 0

const { browser, ctx, page } = await openBrowser({ width: 1600, height: 980 })

// 牙齿：在页面脚本之前塞一条「不许动画」，把开场编排整体关掉。
if (teeth) {
  await ctx.addInitScript(() => {
    const kill = () => {
      const s = document.createElement('style')
      s.textContent =
        '.topbar,.stage-head,.board,.piece{animation:none!important}' +
        '.board-surface.is-flipping{animation:none!important}' +
        '.overlay.is-leaving,.sheet.is-leaving,.result-veil.is-leaving{animation:none!important}'
      document.head.appendChild(s)
    }
    if (document.head) kill()
    else document.addEventListener('DOMContentLoaded', kill)
  })
}

// -------------------- 1 / 2 / 7：开场编排 -------------------- //
// 边加载边抓：pieceEnter 是一次性动画，等页面稳了再读就只剩 none（类已被摘）。
const nav = page.goto(url, { waitUntil: 'domcontentloaded' })
const wave = { delays: [], seen: 0, dur: 340 }
const deadline = Date.now() + 15000
await nav
while (Date.now() < deadline && wave.delays.length === 0) {
  const shot = await page.evaluate(() => {
    const anims = document.getAnimations().filter((a) => a.animationName === 'pieceEnter')
    const el = document.querySelector('.piece.is-entering')
    const cs = el ? getComputedStyle(el) : null
    return {
      delays: anims.map((a) => Math.round(a.effect.getComputedTiming().delay)),
      dur: cs ? Number.parseFloat(cs.animationDuration) * 1000 : null,
    }
  })
  if (shot.delays.length) wave.delays = shot.delays
  if (shot.dur) wave.dur = shot.dur
  else await page.waitForTimeout(40)
}
wave.seen = wave.delays.length

await page.waitForSelector('.board [data-piece]', { timeout: 15000 })
await page.waitForTimeout(400)

// ---- 断言 1：三段入场成序列 ----
const order = await page.evaluate(() => {
  const read = (sel) => {
    const el = document.querySelector(sel)
    if (!el) return null
    const cs = getComputedStyle(el)
    return {
      name: cs.animationName,
      delay: Number.parseFloat(cs.animationDelay) * 1000,
      dur: Number.parseFloat(cs.animationDuration) * 1000,
    }
  }
  return { topbar: read('.topbar'), head: read('.stage-head'), board: read('.board') }
})

if (!order.topbar || order.topbar.name === 'none') {
  bad(`顶栏没有入场动画（读到 ${order.topbar?.name ?? '找不到元素'}）`)
} else {
  const d = [order.topbar.delay, order.head?.delay ?? -1, order.board?.delay ?? -1]
  const rising = d[0] < d[1] && d[1] < d[2]
  if (!rising) bad(`开场三段没有成序列：delay 分别是 ${d.join(' / ')}ms，应当递增`)
  else
    ok(
      `开场编排成序列  顶栏 ${d[0]}ms → 回合条 ${d[1]}ms → 棋盘 ${d[2]}ms（${order.topbar.name} → ${order.head.name} → ${order.board.name}）`,
    )
}

// ---- 断言 2：棋子落盘成波次 ----
if (wave.seen === 0) {
  bad('棋子开场落盘没播：加载期间没观察到任何 pieceEnter 动画')
} else {
  const uniq = [...new Set(wave.delays)].sort((a, b) => a - b)
  const max = Math.max(...wave.delays)
  if (uniq.length < 3) bad(`落盘不是波次：同时播的 ${wave.seen} 颗只有 ${uniq.length} 种 delay（${uniq.join('/')}ms）`)
  else if (max > 700) bad(`落盘波次拖沓：最后一颗 delay ${max}ms > 700ms`)
  else ok(`棋子落盘成波次  ${wave.seen} 颗在跑 · delay ${uniq.length} 档 ${Math.min(...uniq)}~${max}ms`)
}

// ---- 断言 7：压轴段不拖沓 ----
// 开场是两条线并行：棋盘自己升起，棋子在它上面按波次落盘。压轴时长取两条里
// 「最后一段完成」的时刻 —— 波次的 delay 已经是算过基础延迟的最终值。
const boardTotal = (order.board?.delay ?? 0) + (order.board?.dur ?? 0)
const pieceTotal = wave.delays.length ? Math.max(...wave.delays) + wave.dur : 0
const tail = Math.max(boardTotal, pieceTotal)
if (tail > 1200)
  bad(`开场压轴太长：${Math.round(tail)}ms > 1200ms（棋盘段 ${Math.round(boardTotal)}ms / 落盘段 ${Math.round(pieceTotal)}ms）`)
else if (tail < 300)
  // 牙齿检验就是靠这一条兜住的：把编排整体关掉之后 tail 会掉到 0，
  // 「不拖沓」那条反而会判过 —— 光卡上限会放过「根本没有编排」。
  bad(`开场没有编排：压轴只有 ${Math.round(tail)}ms（棋盘段 ${Math.round(boardTotal)} · 落盘段 ${Math.round(pieceTotal)}）`)
else ok(`开场压轴 ${Math.round(tail)}ms ≤ 1200ms（棋盘段 ${Math.round(boardTotal)} · 落盘段 ${Math.round(pieceTotal)}）`)

// -------------------- 3：可走棋子的悬停预告 -------------------- //
const piece = page.locator('.piece.is-grabbable').first()
const pieceCount = await piece.count()
if (pieceCount === 0) {
  bad('找不到可走的棋子（.piece.is-grabbable），悬停预告无从验证')
} else {
  const faceOf = (el) => getComputedStyle(el.querySelector('.piece-face')).transform
  const before = await piece.evaluate(faceOf)
  await piece.hover()
  await page.waitForTimeout(220)
  const after = await piece.evaluate(faceOf)
  const ty = (m) => {
    const p = m.match(/matrix\(([^)]+)\)/)
    if (!p) return 0
    const v = p[1].split(',').map(Number.parseFloat)
    return v[5] ?? 0
  }
  const lift = ty(before) - ty(after)
  if (lift < 0.5) bad(`可走棋子悬停没有欠身：face 位移 ${lift.toFixed(2)}px（应当上移 ≥0.5px）`)
  else ok(`悬停预告  face 上移 ${lift.toFixed(2)}px`)
  await page.mouse.move(0, 0)
  await page.waitForTimeout(180)
}

// -------------------- 4：按钮按压反馈 -------------------- //
// 只挑**可见**的按钮：侧栏收起时里面的 .btn 仍在 DOM 里，但它们 visibility:hidden，
// 鼠标压根命中不到，:hover/:active 都不生效 —— 量出来会是一副「按压没做」的假象。
let btn = page.locator('.btn:not(:disabled):visible').first()
let kind = '.btn'
if ((await btn.count()) === 0) {
  btn = page.locator('.icon-btn:visible').first()
  kind = '.icon-btn'
}
if ((await btn.count()) === 0) {
  bad('找不到可见的按钮，按压反馈无从验证')
} else {
  const box = await btn.boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.waitForTimeout(200)
  const rest = await btn.evaluate((el) => getComputedStyle(el).transform)
  await page.mouse.down()
  await page.waitForTimeout(160)
  const pressed = await btn.evaluate((el) => getComputedStyle(el).transform)
  const label = await btn.evaluate((el) => `${el.textContent?.trim()} disabled=${el.disabled}`)
  // 先把鼠标挪开再松手：这样不构成一次 click，纯粹量「按下」这一瞬的形变，
  // 不会真的把那个按钮点下去（否则后面的断言会撞上被打开的面板 / 弹层）
  await page.mouse.move(4, 4)
  await page.mouse.up()
  const scale = (m) => {
    const p = m.match(/matrix\(([^)]+)\)/)
    return p ? Number.parseFloat(p[1].split(',')[0]) : 1
  }
  if (scale(pressed) > 0.99)
    bad(
      `按钮按下没有缩小：静止 ${scale(rest)} → 按下 ${scale(pressed)}（应当 <0.99）` +
        `  [诊断] ${kind}「${label}」 rest=${rest} pressed=${pressed}`,
    )
  else ok(`按压反馈  ${kind} scale ${scale(rest)} → ${scale(pressed)}`)
}

// -------------------- 5：构建产物里不许有 transition:all -------------------- //
const distDir = join(here, '..', 'frontend', 'dist', 'assets')
let cssText = ''
try {
  const files = readdirSync(distDir).filter((f) => f.endsWith('.css'))
  for (const f of files) cssText += readFileSync(join(distDir, f), 'utf8')
} catch {
  /* 拿不到就下面报 */
}
if (!cssText) {
  bad(`读不到构建产物 CSS（${distDir}）—— 改了样式要先 npm run build`)
} else {
  const hits = cssText.match(/transition:\s*all/gi) || []
  if (hits.length) bad(`构建产物里还有 ${hits.length} 处 transition:all —— 显式列属性`)
  else ok('无 transition:all  （构建产物已扫，属性值全部显式列出）')
}

// -------------------- 6：reduced-motion -------------------- //
const rmBrowser = await chromium.launch({ channel: 'chrome' })
const rmCtx = await rmBrowser.newContext({ reducedMotion: 'reduce', viewport: { width: 1200, height: 800 } })
const rmPage = await rmCtx.newPage()
await rmPage.goto(url, { waitUntil: 'domcontentloaded' })
await rmPage.waitForSelector('.board', { timeout: 15000 })
const rm = await rmPage.evaluate(() => {
  const cs = getComputedStyle(document.querySelector('.board'))
  return {
    dur: Number.parseFloat(cs.animationDuration) * 1000,
    delay: Number.parseFloat(cs.animationDelay) * 1000,
  }
})
if (rm.dur > 1 || rm.delay > 1) {
  bad(`减弱动效偏好下棋盘仍在拖时间：时长 ${rm.dur}ms / 延迟 ${rm.delay}ms（都应 ≤1ms）`)
} else {
  ok(`reduced-motion  时长 ${rm.dur}ms / 延迟 ${rm.delay}ms`)
}
await rmBrowser.close()
// （主 browser 留到帧采样那段之后再关）

// -------------------- 8：可走点成波次出场 -------------------- //
// 选中一颗子之后，它的可走点该一枚一枚荡开，不是「唰」地一起冒出来。
// 注意挑子：兵/将往往只有一两枚可走点，一档 delay 无从验证「成波次」，
// 所以挨个点过去，取第一颗「可走点 ≥3 枚」的子来量。
if (pieceCount === 0) {
  bad('找不到可走的棋子，可走点波次无从验证')
} else {
  await waitIdle(page)
  // 上一段为了量「按下」把鼠标压在了按钮上（虽已挪开再松手），这里先收干净：
  // 关掉任何可能被打开的弹层，并把鼠标移出盘面，免得点棋子时命中到别的东西。
  await page.keyboard.press('Escape')
  await page.mouse.move(4, 4)
  await page.waitForTimeout(200)
  let delays = []
  let tries = 0
  for (let i = 0; i < 8 && delays.length < 3; i++) {
    await waitIdle(page)
    const list = page.locator('.piece.is-grabbable')
    if (i >= (await list.count())) break
    tries++
    try {
      await list.nth(i).click({ timeout: 5000 })
      await page.waitForSelector('.target', { timeout: 3000 })
    } catch {
      await page.keyboard.press('Escape').catch(() => {})
      continue
    }
    const got = await page.$$eval('.target', (els) =>
      els.map((el) => Math.round(Number.parseFloat(getComputedStyle(el).animationDelay) * 1000)),
    )
    if (got.length > delays.length) delays = got
    await page.keyboard.press('Escape')
  }
  const uniq = [...new Set(delays)].sort((a, b) => a - b)
  if (delays.length < 3) {
    bad(`试了 ${tries} 颗子，最多只有 ${delays.length} 枚可走点 —— 波次无从验证`)
  } else if (uniq.length < 2) {
    bad(`可走点没有成波次：${delays.length} 枚的 delay 全是 ${uniq[0]}ms`)
  } else {
    ok(`可走点成波次  ${delays.length} 枚 · delay ${uniq.length} 档 ${uniq[0]}~${Math.max(...uniq)}ms`)
  }
}

// -------------------- 9：弹层关掉时有退场 -------------------- //
// 入场有编舞、退场一刀切，是不对等的 —— 用户每次关掉弹层都在被「闪」一下。
// 这条盯两件事：关掉之后节点还该带着 is-leaving 多活一会儿（退场动画真的在播），
// 以及播完确实卸载（不是赖着不走）。
{
  await page.keyboard.press('Shift+Slash')
  let opened = true
  try {
    await page.waitForSelector('.overlay .sheet', { timeout: 5000 })
  } catch {
    opened = false
  }
  if (!opened) {
    bad('打不开帮助弹层（`?` 没反应）—— 退场无从验证')
  } else {
    await page.waitForTimeout(260)
    await page.keyboard.press('Escape')
    let leavingAnim = ''
    let sawLeaving = false
    const t0 = Date.now()
    while (Date.now() - t0 < 600) {
      const s = await page.evaluate(() => {
        const o = document.querySelector('.overlay')
        const sh = document.querySelector('.sheet')
        if (!o) return null
        return {
          oc: o.className,
          sc: sh ? sh.className : '',
          anim: sh ? getComputedStyle(sh).animationName : '',
        }
      })
      if (s && (s.oc.includes('is-leaving') || s.sc.includes('is-leaving'))) {
        sawLeaving = true
        leavingAnim = s.anim
        break
      }
      await page.waitForTimeout(16)
    }
    let gone = false
    try {
      await page.waitForSelector('.overlay', { state: 'detached', timeout: 1200 })
      gone = true
    } catch {
      /* 下面按「赖着不走」报 */
    }
    if (!sawLeaving) bad('弹层关掉时一帧摘掉：没捕捉到 is-leaving —— 退场动画来不及播')
    else if (!leavingAnim || leavingAnim === 'none')
      bad(`弹层退场只是挂了个类，没真播动画（animation-name 读到 ${leavingAnim || '空'}）—— 类名骗得过人，闪一下骗不过眼神`)
    else if (!gone) bad('弹层退场后没卸载：is-leaving 挂着不走，弹层留在页面上')
    else ok(`弹层退场  关闭时多活一程播 ${leavingAnim}，随后卸载`)
  }
}

// -------------------- 10：翻转视角有中间过程 -------------------- //
// 按 F 换视角，最容易的写法是直接换 state —— 盘面连同 32 颗子和所有标记「唰」地
// 镜像过去，全站唯一一处纯切的硬边。要守的是：盘面真的收窄过，而且**换视角那一下
// 发生在收窄里**（换早了等于没躲，还是硬切）。
{
  const before = await page.evaluate(
    () => document.querySelector('.board-surface')?.dataset.flipped,
  )
  const scaleX = (m) => {
    const p = m.match(/matrix\(([^)]+)\)/)
    return p ? Number.parseFloat(p[1].split(',')[0]) : 1
  }
  await page.keyboard.press('f')
  const samples = []
  const t0 = Date.now()
  while (Date.now() - t0 < 620) {
    const s = await page.evaluate(() => {
      const el = document.querySelector('.board-surface')
      return {
        flip: el?.dataset.flipped,
        flipping: el ? el.className.includes('is-flipping') : false,
        anim: el ? getComputedStyle(el).animationName : '',
        tf: el ? getComputedStyle(el).transform : '',
      }
    })
    samples.push({ at: Date.now() - t0, ...s, scale: scaleX(s.tf) })
    await page.waitForTimeout(16)
  }
  const narrowest = Math.min(...samples.map((s) => s.scale))
  const swap = samples.find((s) => s.flip !== before)
  const endCls = samples[samples.length - 1]
  if (narrowest > 0.97) {
    bad(`翻转视角没有中间过程：盘面最窄只到 ${narrowest.toFixed(3)}（应当 ≤0.97）—— 直接镜像过去了`)
  } else if (!swap || !swap.flipping) {
    bad('翻转视角时盘面没在收窄（没捕捉到 is-flipping），换视角与形变不同步')
  } else if (swap.scale > 0.97) {
    bad(
      `换视角发生在盘面还没收窄的时候（第 ${swap.at}ms，宽度仍有 ${swap.scale.toFixed(3)}）` +
        ' —— 换早了等于没躲，还是硬切',
    )
  } else if (endCls.flipping || endCls.anim !== 'none') {
    bad(`翻转动画结束后没收干净：is-flipping=${endCls.flipping} / animation=${endCls.anim}`)
  } else {
    ok(
      `翻转视角  收窄到 ${narrowest.toFixed(2)} · 第 ${swap.at}ms 在最窄处换视角 · 620ms 内收干净`,
    )
  }
}

// -------------------- 11：开场这段不掉帧 -------------------- //
// 32 颗棋子同时落盘是整站最重的一帧序列。奖项级的底线不是「好看」而是
// 「不卡」：这里拿开场 1.8s 里的 rAF 帧间隔说事 —— p50 与最长帧都要站得住。
const perfCtx = await browser.newContext({ viewport: { width: 1600, height: 980 } })
await perfCtx.addInitScript(() => {
  window.__entrance = { frames: [], on: false, last: 0, t0: 0 }
  const loop = (t) => {
    const p = window.__entrance
    if (p.on) {
      if (!p.t0) p.t0 = t
      // 记下「这一帧结束于开场第几毫秒」：断言时要把最前面那 300ms 丢掉 ——
      // 那里是 React 挂载 + 棋盘 SVG 首绘，一次性成本，不属于「编排卡不卡」
      if (p.last) p.frames.push([t - p.t0, t - p.last])
      p.last = t
    }
    requestAnimationFrame(loop)
  }
  requestAnimationFrame(loop)
  const start = () => {
    window.__entrance.on = true
    window.setTimeout(() => (window.__entrance.on = false), 1800)
  }
  // 一上 DOM 就开采样：编排是在页面脚本跑起来之后才播的，开晚了就量不到
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start)
  else start()
})
const perfPage = await perfCtx.newPage()
await perfPage.goto(url, { waitUntil: 'domcontentloaded' })
await perfPage.waitForTimeout(2800)
const raw = await perfPage.evaluate(() => window.__entrance.frames.slice())
await perfCtx.close()
await browser.close()
// 只留「开场 300ms 之后」的帧：那之前是脚本挂载与首绘，量它只会污染结论
const frames = raw.filter(([at]) => at >= 300).map(([, d]) => d)
if (frames.length < 30) {
  bad(`开场帧采样太少（${frames.length} 帧）—— 采样器没跑起来，这条等于没测`)
} else {
  const sorted = [...frames].sort((a, b) => a - b)
  const p50 = sorted[Math.floor(sorted.length / 2)]
  const max = Math.max(...frames)
  const over33 = frames.filter((d) => d > 33).length
  const rate = over33 / frames.length
  if (p50 > 20 || rate > 0.08)
    bad(
      `开场掉帧：采 ${frames.length} 帧 · p50 ${p50.toFixed(1)}ms · 最长 ${max.toFixed(1)}ms · 超 33ms ${over33} 帧（${(rate * 100).toFixed(1)}% > 8%）`,
    )
  else
    ok(
      `开场不掉帧  采 ${frames.length} 帧 · p50 ${p50.toFixed(1)}ms · 最长 ${max.toFixed(1)}ms · 超 33ms ${over33} 帧（${(rate * 100).toFixed(1)}%）`,
    )
}

// -------------------- 汇总 -------------------- //
console.log('='.repeat(64))
console.log('  动效品质自检')
if (teeth) console.log('  （--teeth：开场编排已人为关掉，第 1、2 条应当红）')
console.log('='.repeat(64))
for (const line of notes) console.log(line)
if (problems.length) {
  for (const p of problems) console.log(`  [FAIL] ${p}`)
  console.log(`\n  ${problems.length} 条不合格`)
  process.exit(1)
}
console.log(`\n  —— ${notes.length} 条全过 ——`)
process.exit(0)
