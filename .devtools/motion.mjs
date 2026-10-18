// 动效品质断言：把「界面动效够不够奖项级」从一句形容词，变成几条能被改红的断言。
//
// 为什么需要它：动效是最容易**悄悄退化**的一类东西 —— 删掉一条 transition、
// 把 --ease-enter 改回 linear、把编排的 delay 抹平，页面照样能跑、能下棋，
// 五套既有的自检（几何 / 拖拽 / 键盘 / 位移机制 / 滑行）会全绿，于是没人知道
// 手感已经没了。这一套专守「动效还在不在、编排还成不成序列」。
//
// 十八条断言，各守一件事：
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
//  11 应手区换态         等待/思考/应手三态挂载都播 heroSwap，底色变化是过渡不是瞬跳
//  12 落笔反馈           录一手之后：应手卡 stampIn、应手区 heroSwap、棋谱最新一手 stampIn
//  13 吃子有因果         被吃的一路看得见，直到落地那一拍才被撞飞（撞得够远、真在播动画）
//  14 落点同拍           涟漪、落点框、撞飞、落子音 —— 都挤在落地那一拍上
//  15 退场有一程         取消选中后可走点与月牙环还多活一程，真在播 targetOut /
//                       crescentOut，且动画播完了才摘（animationend 发得出来）
//  16 开场不掉帧         开场编排播放期的 rAF 帧间隔 p50 与最长帧都要站得住
//  17 帧预算             常驻动画只许动 transform/opacity；动画与过渡都不许碰布局属性与
//                        backdrop-filter；盘上不许有 SMIL，落点框还得进思考停摆清单
//  18 将军那一响         被将的王身上真播 checkAlarm，且挤在落地那一拍上、只响一次，
//                        散掉之后静态朱砂环还在
//
// 牙齿检验（--teeth）：注入一段 CSS 把开场编排、弹层退场、翻转视角、应手区入场、
// 落点时钟、「可走点 / 月牙环退场」与将军那一响一起关掉（animation:none），再把落点上的
// 死子直接 display:none，第 1、2、7、9、10、11、12、13、14、15、18 条必须红 ——
// 证明它们盯的是真东西，不是摆设。
//
// 牙齿检验（--teeth-audio）：把每一次 WebAudio 排声都往后推 120ms。
// 第 14 条必须红 —— 它盯的是「音画同拍」这件事，不是「有没有动画」。
//
//   node motion.mjs [url] [--teeth] [--teeth-audio]

import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import {
  urlFromArgv,
  openBrowser,
  waitIdle,
  typeMove,
  reset,
  getState,
  calibrate,
  squareCenter,
} from './_contract.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const url = urlFromArgv(process.argv)
const teeth = process.argv.includes('--teeth')
const teethAudio = process.argv.includes('--teeth-audio')

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
        '.overlay.is-leaving,.sheet.is-leaving,.result-veil.is-leaving{animation:none!important}' +
        '.hero-thinking,.hero-content,.hero-idle,.hero-action-card,.move-cell.is-last{animation:none!important}' +
        '.target.is-leaving,.selected-crescent-ring.is-leaving{animation:none!important}' +
        '.piece.is-check-alarm::before{animation:none!important}' +
        // 第 13 条盯的是「被吃的那颗在落地之前一直看得见」。用 display:none 复现它最坏的
        // 样子（等于滑行途中落点是空的），而不是删元素 —— 判据数的是**看得见**的死子，
        // 所以这条 CSS 必须把它逼红；只写「类还在不在」的判据是骗人的。
        '.piece.is-doomed{display:none!important}'
      document.head.appendChild(s)
    }
    if (document.head) kill()
    else document.addEventListener('DOMContentLoaded', kill)
  })
}

// 起手先把局面复位：服务端的棋是**持久**的，上一轮跑到将死就停在那儿 ——
// 那时「找不到可走的棋子 / legal_moves 为空」全是假红，跟动效一点关系没有。
// 必须在 goto 之前做（走 Node 侧 fetch，about:blank 上发不了相对请求）；
// 在页面里 reset 的话，这一页的开场演的是旧局面，复位触发的重渲染又把
// bootedRef 置位了，第 2 条「落盘成波次」从此再也量不到。
await fetch(new URL('/api/new', url), {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ engine_side: 'red', think_ms: 900 }),
}).catch(() => {})

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
// 开场是引擎先手（reset 时 engine_side:'red'），必须等它思考完、真正轮到人，
// 盘上才会有 is-grabbable 的子 —— 不等的话量到的是「引擎思考中」的假空盘。
await waitIdle(page)
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
// 挑控件有两条教训：
//  · 侧栏收起时里面的 .btn 仍在 DOM 里，但 visibility:hidden，鼠标命中不到，
//    :hover/:active 都不生效 —— 量出来是一副「按压没做」的假象。
//  · 引擎思考时的「采用当前最优步」是**过客**：引擎一落子它就卸载。
//    count() 时它还在、evaluate() 时就没了，撞出 30s 超时。
// 所以先等引擎思考结束（轮到人），再挑**全程可见**的顶栏 icon-btn。
await waitIdle(page)
let btn = page.locator('.icon-btn:visible').first()
let kind = '.icon-btn'
if ((await btn.count()) === 0) {
  btn = page.locator('.btn:not(:disabled):visible').first()
  kind = '.btn'
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
      // :not(.is-leaving) —— 上一轮的点要等多久才摘？它自己不收尾，别把尸体数进来：
      // 退场那一程的 delay 是 0（重写 animation 简写），混进来就成「没有成波次」的假红
      await page.waitForSelector('.target:not(.is-leaving)', { timeout: 3000 })
    } catch {
      await page.keyboard.press('Escape').catch(() => {})
      continue
    }
    const got = await page.$$eval('.target:not(.is-leaving)', (els) =>
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

// -------------------- 11：应手区换态有入场 -------------------- //
// 应手区是全站的「应答链」：等待 → 思考 → 应手，每换一次都是界面在回话。
// 硬切的话这条链是哑的。守两件事：三态各自挂载时都播 heroSwap，
// 以及底色的「染」是过渡（transition 里有 background-color）不是瞬跳。
{
  const hero = await page.evaluate(() => {
    const box = document.querySelector('.engine-hero')
    const inner = box?.querySelector('.hero-thinking, .hero-content, .hero-idle')
    return {
      tp: box ? getComputedStyle(box).transitionProperty : '',
      state: inner ? inner.className.split(' ')[0] : null,
      anim: inner ? getComputedStyle(inner).animationName : '',
    }
  })
  if (!hero.state) {
    bad('应手区三态一个都不在（hero-thinking / hero-content / hero-idle）—— 结构变了，断言要跟着改')
  } else if (hero.anim !== 'heroSwap') {
    bad(`应手区「${hero.state}」挂载时没有入场动画（animation-name = ${hero.anim || '空'}）—— 换态是硬切`)
  } else if (!hero.tp.includes('background-color')) {
    bad(`应手区底色没有过渡（transition-property = ${hero.tp}）—— 思考一开始底色是跳过去的`)
  } else {
    ok(`应手区换态  ${hero.state} 入场播 heroSwap · 底色走过渡`)
  }
}

// -------------------- 12：录一手之后，应手与棋谱都「落笔」 -------------------- //
// 走一手（走文本录入这条路，跟人一样），等引擎回完：
// 应手卡要重新盖印（stampIn）、应手区整体要播换态入场（heroSwap）、
// 棋谱里最新那一手要播盖印（stampIn 在 .move-cell.is-last 上）。
{
  const mv = await page.evaluate(async () => {
    const st = await fetch('/api/state').then((r) => r.json())
    return st.state?.game?.legal_moves?.[0]?.iccs ?? null
  })
  if (!mv) {
    bad('读不到合法走法（legal_moves 为空）—— 没法录棋，这条无从验证')
  } else {
    await typeMove(page, mv)
    await waitIdle(page)
    await page.waitForSelector('.hero-action-card', { timeout: 15000 }).catch(() => {})
    const after = await page.evaluate(() => {
      const card = document.querySelector('.hero-action-card')
      const content = document.querySelector('.hero-content')
      const last = document.querySelector('.move-cell.is-last')
      return {
        card: card ? getComputedStyle(card).animationName : null,
        content: content ? getComputedStyle(content).animationName : null,
        last: last ? getComputedStyle(last).animationName : null,
      }
    })
    const misses = []
    if (after.card === null) misses.push('应手卡不在')
    else if (!after.card.includes('stampIn')) misses.push(`应手卡没盖印（${after.card}）`)
    if (after.content !== 'heroSwap') misses.push(`应手区没播换态入场（${after.content ?? '不在'}）`)
    if (after.last !== 'stampIn') misses.push(`棋谱最新一手没盖印（${after.last ?? '不在'}）`)
    if (misses.length) bad(`录完一手之后：${misses.join('；')}`)
    else ok(`录一手  应手卡 stampIn · 应手区 heroSwap · 棋谱 is-last stampIn`)
    // 别把这手棋留给别人：复位到初始局面，后面的采样与别的套件都按开局来
    await reset(page)
  }
}

// -------------------- 13 / 14：吃子这一手的「落点时钟」 -------------------- //
// 这两条管的是同一件事：**落点上的四样反馈必须挤在同一拍上**。
//
//   被吃的那颗还看得见（.is-doomed）── 落地那一拍 ──┬─ 撞飞（pieceKnockback）
//                                                   ├─ 涟漪（pieceImpactSquash）
//                                                   ├─ 落点框（.last-to 的 fadeIn）
//                                                   └─ 落子音（WebAudio 第一声 start）
//
// 以前坏在两头：被吃子在滑行第 1 帧就被服务端摘掉，撞飞发生在一颗两百多毫秒前
// 就消失的子上（等于没有因果）；涟漪排在滑行终点、音效排在 87.5%，同一下落子响两次。
//
// 判据一律**拿滑行自己当尺子**（那条 transform transition 的 startTime 与时长），
// 不写死毫秒：跨度改了（近手 210 / 远手 360），断言不用跟着改。
//
// 采样窗口里只许有这一个动作在动：先关掉引擎的自动应手，再把局面摆成
// 「红车 a0 吃黑马 h0」—— 跨度拉满（7），滑行最长，各拍之间最好分辨。
{
  const CAPTURE_FEN = '4k4/9/9/9/9/9/9/9/3K5/R6n1 w - - 0 1'
  const postJson = (path, body) =>
    fetch(new URL(path, url), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => {})

  const snap = await fetch(new URL('/api/state', url), { cache: 'no-store' })
    .then((r) => r.json())
    .catch(() => null)
  const autoReply = snap?.state?.settings?.auto_reply ?? true

  await postJson('/api/settings', { auto_reply: false })
  await postJson('/api/load', { fen: CAPTURE_FEN, engine_side: 'black' })

  // 声音挂钩：记的是**真正发出来的那一刻** —— 拿实际排下去的 when 换算成墙上时间。
  // 这里踩过一次：先按调用参数记时刻、再另算一遍推迟后的 when 去排声，
  // 结果 --teeth-audio 把声音推后 120ms，量出来的还是 305ms，断言照样绿。
  // 只记「JS 调到 start 的那一刻」的写法同理骗不过这个牙齿。
  await ctx.addInitScript((delay) => {
    window.__beats = []
    const wrap = (Proto) => {
      if (!Proto) return
      const origin = Proto.prototype.start
      Proto.prototype.start = function (when) {
        const c = this.context
        const req = when === undefined ? c.currentTime : when
        const sched = delay ? req + delay : req
        try {
          window.__beats.push(performance.now() + Math.max(0, sched - c.currentTime) * 1000)
        } catch {
          /* 挂钩不许把页面搞崩 */
        }
        return delay ? origin.call(this, sched) : origin.apply(this, arguments)
      }
    }
    wrap(window.AudioBufferSourceNode)
    wrap(window.OscillatorNode)
  }, teethAudio ? 0.12 : 0)

  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.board [data-piece]', { timeout: 15000 })
  await page.waitForTimeout(1200) // 等开场落盘的编排播完，不然量到的是它

  const st = await getState(page)
  const mv = st.game.legal_moves.find((m) => m.iccs === 'a0h0')
  // legal_moves 里没有 captured 这个字段，只能自己确认落点上确实站着颗敌子
  const mover = st.game.pieces.find((p) => p.square === 'a0')
  const victim = st.game.pieces.find((p) => p.square === 'h0')
  if (!mv || !mover || !victim || victim.side === mover.side) {
    bad('摆不出「红车 a0 吃黑马 h0」这一手，落点时钟的两条无从验证')
  } else {
    const from = await calibrate(page, mv.from)
    const to = await squareCenter(page, mv.to)
    await page.mouse.click(from.x, from.y) // 选中，不产生位移
    await page.waitForTimeout(150)

    // 逐帧采。这里**不能**夹 page.screenshot：它会同时掐停 rAF 与主线程上的定时器，
    // 于是残影采不到峰值、音效那一拍被推到几百毫秒之后（实测过，590ms）。
    // 要看画面另外单独跑一遍（.devtools/_capture_check.mjs）。
    const sampling = page.evaluate(
      ([dst]) =>
        new Promise((resolve) => {
          const t0 = performance.now()
          const frames = []
          const seen = { glide: null, knock: null, impact: null, lastTo: null }
          let peak = 0
          const startOf = (name) => {
            for (const a of document.getAnimations()) {
              if (a.animationName === name && typeof a.startTime === 'number') return a.startTime
            }
            return null
          }
          const loop = () => {
            const now = performance.now()
            // 「看得见」才算数：display:none 的死子跟没渲染是一回事，
            // 只数 querySelectorAll 的条数会把它当成还在盘上
            let doomed = 0
            for (const el of document.querySelectorAll('.piece.is-doomed')) {
              if (el.getBoundingClientRect().width > 1) doomed += 1
            }
            const mvr = document.querySelector(`[data-piece][data-square="${dst}"]`)
            const tr = mvr
              ? mvr.getAnimations().find((a) => a.transitionProperty === 'transform')
              : null
            if (!seen.glide && tr && typeof tr.startTime === 'number') {
              seen.glide = { start: tr.startTime, dur: tr.effect.getComputedTiming().duration }
            }
            if (!seen.knock) seen.knock = startOf('pieceKnockback')
            if (!seen.impact) seen.impact = startOf('pieceImpactSquash')
            if (!seen.lastTo && mvr) {
              const box = document.querySelector('.last-to')
              const fa = box?.getAnimations().find((a) => a.animationName === 'fadeIn')
              if (fa && typeof fa.startTime === 'number') seen.lastTo = fa.startTime
            }
            const kn = document.querySelector('.piece.piece-ghost-knockback')
            if (kn && mvr) {
              const a = kn.getBoundingClientRect()
              const b = mvr.getBoundingClientRect()
              if (b.width > 1) {
                const off = Math.hypot(
                  a.x + a.width / 2 - (b.x + b.width / 2),
                  a.y + a.height / 2 - (b.y + b.height / 2),
                )
                // 按「几颗子宽」计，这样与窗口大小、--u 无关
                peak = Math.max(peak, off / b.width)
              }
            }
            frames.push({ at: now, doomed })
            if (now - t0 < 900) requestAnimationFrame(loop)
            else resolve({ seen, frames, peak, beats: (window.__beats || []).slice() })
          }
          requestAnimationFrame(loop)
        }),
      [mv.to],
    )
    const beatBase = await page.evaluate(() => (window.__beats || []).length)
    await page.mouse.click(to.x, to.y) // 这一步是吃子：起点点击即确认
    const s = await sampling

    const g = s.seen.glide
    if (!g || !g.dur) {
      bad('滑行没有起步（读不到 transform transition），落点时钟的两条无从对齐')
    } else {
      // 这一拍的允许区间：滑行后段，且不许拖到落定之后
      const lo = g.start + g.dur * 0.55
      const hi = g.start + g.dur + 60
      const at = (v) => (v === null ? '—' : Math.round(v - g.start))
      const inBeat = (v) => v !== null && v >= lo && v <= hi
      const dur = Math.round(g.dur)

      // ---- 断言 13：吃子有因果 ---- //
      // 60ms 这个数是**残影的挂载**留给的：死子改类发生在 React 提交那一刻，
      // 而 pieceKnockback 的 startTime 要等提交之后的那一帧才落下 —— 两者天然差
      // 一到两个帧间隔（实测 33ms）。坏味道的那一头差得远：滑行一开始就把子摘掉，
      // 死子最后的画面在起步后十几毫秒，任你怎么量都够不着落点。
      const SLACK = 60
      const firstDoomed = s.frames.find((f) => f.doomed > 0)
      const lastDoomed = [...s.frames].reverse().find((f) => f.doomed > 0)
      const knock = s.seen.knock
      const misses = []
      if (!firstDoomed)
        misses.push('落点上的被吃子在滑行一开始就看不见了（撞飞发生在一颗不在画面上的子身上）')
      else if (firstDoomed.at - g.start > 80)
        misses.push(`被吃子迟了 ${Math.round(firstDoomed.at - g.start)}ms 才显形`)
      else if (!lastDoomed || (knock !== null && lastDoomed.at < knock - SLACK))
        misses.push(
          `被吃子没活到落地那一拍（它最后的画面在 ${
            lastDoomed ? Math.round(lastDoomed.at - g.start) : '无'
          }ms，撞飞在 ${at(knock)}ms）`,
        )
      else {
        const holes = s.frames.filter(
          (f) => f.at >= firstDoomed.at + 40 && f.at <= knock - SLACK && f.doomed === 0,
        )
        if (holes.length)
          misses.push(
            `滑行途中落点空了 ${holes.length} 帧（第 ${Math.round(holes[0].at - g.start)}ms 起）`,
          )
      }
      if (!inBeat(knock))
        misses.push(
          `残影不在落地那一拍上（起步后 ${at(knock)}ms，滑行 ${dur}ms；应当在 ${Math.round(
            dur * 0.55,
          )}~${dur + 60}ms 之间）`,
        )
      if (s.peak < 0.3)
        misses.push(`残影只被推出 ${s.peak.toFixed(2)} 颗子宽，几乎是在原地淡出（应当 ≥0.3）`)
      if (misses.length) bad(`吃子这一手：${misses.join('；')}`)
      else
        ok(
          `吃子有因果  死子一路可见 ${Math.round(firstDoomed.at - g.start)}~${Math.round(
            lastDoomed.at - g.start,
          )}ms · 残影第 ${at(knock)}ms 挂上（滑行 ${dur}ms）· 被推出 ${s.peak.toFixed(2)} 子宽`,
        )

      // ---- 断言 14：涟漪、落点框、撞飞、落子音同拍 ---- //
      const beats = s.beats.slice(beatBase)
      const beat = beats.length ? Math.min(...beats) : null
      const impact = s.seen.impact
      const lastTo = s.seen.lastTo
      const late = []
      if (!inBeat(impact)) late.push(`涟漪起步后 ${at(impact)}ms`)
      if (!inBeat(lastTo)) late.push(`落点框起步后 ${at(lastTo)}ms`)
      if (!inBeat(knock)) late.push(`残影起步后 ${at(knock)}ms`)
      if (beat === null) late.push('没有听到落子音（WebAudio 一次 start 都没有）')
      const gaps = []
      if (impact !== null && beat !== null) gaps.push(['音 vs 涟漪', Math.abs(beat - impact)])
      if (impact !== null && lastTo !== null) gaps.push(['涟漪 vs 落点框', Math.abs(lastTo - impact)])
      if (impact !== null && knock !== null) gaps.push(['涟漪 vs 残影', Math.abs(knock - impact)])
      const worst = gaps.reduce((m, [, v]) => Math.max(m, v), 0)
      if (late.length) bad(`落点这几拍没挤在一起：${late.join('；')}（滑行 ${dur}ms）`)
      else if (worst > 35)
        bad(
          `落点上响了好几次：${gaps
            .filter(([, v]) => v > 35)
            .map(([k, v]) => `${k} 差 ${Math.round(v)}ms`)
            .join('、')}`,
        )
      else
        ok(
          `落点同拍  音 ${at(beat)} · 涟漪 ${at(impact)} · 落点框 ${at(lastTo)} · 残影 ${at(
            knock,
          )}ms（滑行 ${dur}ms，最大错位 ${Math.round(worst)}ms）`,
        )
    }
  }

  // 采样用的是测试局面，别把它留给下一条与别的套件：复原成开局 + 原来的应手设置
  await postJson('/api/new', { engine_side: 'red', think_ms: 900 })
  await postJson('/api/settings', { auto_reply: autoReply })
}

// -------------------- 15：可走点与月牙环收走时有一程 -------------------- //
// 「开」有编舞（可走点按 --i 一颗颗荡开、月牙环淡入上浮），「关」如果还是一帧剪掉，
// 落子那一下就像被剪刀裁了画面。守四件事：关掉之后节点还带 is-leaving 多活一程、
// 那一程里**真在播** targetOut / crescentOut（只挂类不算，见第 9 条同样的骗法）、
// 播完确实卸载、而且**动画先跑完再摘**（靠 animationend 报，不靠逐帧读 opacity）。
// 最后那条是 CSS 时长与卸载定时器必须错开一帧的理由，详见 app.css 的 targetOut。
//
// 用「再点一次同一颗子」取消选中来触发退场，而不是走一手棋：走棋会改局面，
// 后面几条与别的套件都得先复位；取消选中什么都不改，量完接着用。
{
  await waitIdle(page)
  await page.keyboard.press('Escape')
  await page.mouse.move(4, 4)
  // 挑一颗「点多」的子：兵常常只有一两步，只有一枚点的退场既看不出波次、animationend
  // 也只数得到一次 —— 挨个试到至少 3 枚为止（跟第 8 条同一个理由）。试完都 Escape 清干净，
  // 最后再点赢的那颗，保证下面采到的是「一次完整的退场」而不是试错过程的尾巴。
  const grabs = page.locator('.piece.is-grabbable')
  const total = await grabs.count()
  let pick = -1
  let dots = 0
  for (let i = 0; i < total; i++) {
    await grabs.nth(i).click()
    let n = 0
    try {
      await page.waitForSelector('[data-target]:not(.is-leaving)', { timeout: 3000 })
      n = await page.$$eval('[data-target]:not(.is-leaving)', (els) => els.length)
    } catch {
      /* 这颗子点不出东西，换下一颗 */
    }
    await page.keyboard.press('Escape')
    if (n > dots) {
      dots = n
      pick = i
    }
    if (n >= 3) break
  }
  if (pick < 0) {
    bad('找不到可走的棋子，可走点退场无从验证')
  } else {
    const grab = grabs.nth(pick)
    await grab.click()
    let shown = true
    try {
      await page.waitForSelector('[data-target]:not(.is-leaving)', { timeout: 3000 })
    } catch {
      shown = false
    }
    if (!shown) {
      bad('选中一颗子之后盘上没有 [data-target] —— 可走点没渲染出来，退场无从验证')
    } else {
      const box = await grab.boundingBox()
      // 「收干净了没有」不能靠逐帧读 opacity 判：最后一帧落在动画的哪一档全看帧边界跟
      // 提交时刻怎么对齐，同一段退场两次量到 0.00 与 0.45，门槛只要往下压就误报。
      // animationend 是动画自己报的完工时刻 —— 节点还挂在 DOM 上才发得出来，摘早了
      // 只会转成 animationcancel。这条既没有采样运气，也正是「剪子落在看不见之后」本意。
      await page.evaluate(() => {
        window.__markEnds = {}
        document.addEventListener(
          'animationend',
          (e) => {
            window.__markEnds[e.animationName] = (window.__markEnds[e.animationName] || 0) + 1
          },
          true,
        )
      })
      const sampling = page.evaluate(
        () =>
          new Promise((resolve) => {
            const t0 = performance.now()
            const rec = {
              targetAnim: '',
              targetSeen: false,
              targetFirst: null,
              targetLast: null,
              targetGone: null,
              crescentAnim: '',
              crescentFirst: null,
              crescentLast: null,
              crescentGone: null,
              frames: 0,
            }
            const loop = () => {
              const now = performance.now() - t0
              const t = document.querySelector('.target.is-leaving')
              const c = document.querySelector('[data-crescent].is-leaving')
              if (t) {
                rec.frames += 1
                if (!rec.targetSeen) {
                  rec.targetSeen = true
                  rec.targetFirst = now
                  rec.targetAnim = getComputedStyle(t).animationName
                }
                rec.targetLast = now
              } else if (rec.targetSeen && rec.targetGone === null) rec.targetGone = now
              if (c) {
                if (rec.crescentFirst === null) {
                  rec.crescentFirst = now
                  rec.crescentAnim = getComputedStyle(c).animationName
                }
                rec.crescentLast = now
              } else if (rec.crescentFirst !== null && rec.crescentGone === null)
                rec.crescentGone = now
              if (now < 900) requestAnimationFrame(loop)
              else resolve(rec)
            }
            requestAnimationFrame(loop)
          }),
      )
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2) // 再点一次 = 取消选中
      const r = await sampling

      const misses = []
      if (!r.targetSeen) misses.push('可走点一帧摘掉：没捕捉到 is-leaving')
      if (r.crescentFirst === null) misses.push('月牙环一帧摘掉：没捕捉到 is-leaving')
      if (r.targetSeen && r.targetAnim !== 'targetOut')
        misses.push(`可走点退了个空（animation-name = ${r.targetAnim}）`)
      if (r.crescentFirst !== null && r.crescentAnim !== 'crescentOut')
        misses.push(`月牙环退了个空（animation-name = ${r.crescentAnim}）`)
      // 80ms 而不是 140ms：两头都要被帧间隔吃掉一点 —— is-leaving 挂上之后要等下一帧
      // 才采得到，卸载前的最后一帧又采不到尾巴（实测 140ms 的一程量出来 99~124ms）。
      // 真正要抓的是「一帧剪掉」与「挂个类就走」，那一档量出来是 0~17ms。
      if (r.targetSeen && r.targetLast - r.targetFirst < 80)
        misses.push(`可走点多活的那一程只有 ${Math.round(r.targetLast - r.targetFirst)}ms，来不及播`)
      if (r.targetGone === null) misses.push('可走点赖着不走：is-leaving 挂着没卸载')
      if (r.crescentGone === null) misses.push('月牙环赖着不走：is-leaving 挂着没卸载')
      // 剪子要落在看不见的地方：两条退场动画都得在节点被摘掉**之前**跑完。
      // CSS 时长与卸载定时器一样长时这条必红 —— is-leaving 随 React 提交挂上，动画最早
      // 也要等下一次绘制才起步，而 --ease-exit 把最陡的一段全压在末尾，于是节点正收得
      // 最快时被摘掉（把两条动画改回 140ms，animationend 一次都发不出来）。
      const ends = await page.evaluate(() => window.__markEnds || {})
      const done = ends.targetOut || 0
      if (r.targetSeen && done < dots)
        misses.push(`可走点收在半路被摘掉（${dots} 枚里 targetOut 只播完了 ${done} 枚）`)
      if (r.crescentFirst !== null && !ends.crescentOut)
        misses.push('月牙环收在半路被摘掉（crescentOut 没播完，节点先没了）')
      if (misses.length) bad(`收走这一程：${misses.join('；')}`)
      else
        ok(
          `退场有一程  ${dots} 枚可走点播 targetOut 多活 ${Math.round(r.targetLast - r.targetFirst)}ms` +
            `（${r.frames} 帧），${done} 枚都播完了才摘 · 月牙环播 crescentOut 多活 ` +
            `${Math.round(r.crescentLast - r.crescentFirst)}ms 后卸载`,
        )
    }
  }
}

// -------------------- 16：开场这段不掉帧 -------------------- //
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
// 顺手在关页面之前数一遍 SMIL：第 17 条要用它。落点框那圈弧环原来就是
// <animateTransform> 转的 —— 扫 DOM 比扫源码准，不管它从哪个组件、以什么写法长出来，
// 挂上了就数得到。但**空页扫出来的 0 什么都不证明**：落点框只在有「上一手」时才在盘上，
// 所以先落一手把它请出来，量不到就按「无从验证」报红。
let smil = -1
let smilOnBoard = false
{
  const mv = await page.evaluate(async () => {
    const st = await fetch('/api/state').then((r) => r.json())
    return st.state?.game?.legal_moves?.[0]?.iccs ?? null
  })
  if (mv) {
    await typeMove(page, mv)
    await page.waitForSelector('.last-to', { timeout: 8000 }).catch(() => {})
    smilOnBoard = await page.locator('.last-to').count() > 0
  }
  smil = await page.evaluate(
    () => document.querySelectorAll('animate, animateTransform, animateMotion, animateColor').length,
  )
}
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

// -------------------- 17：帧预算 -------------------- //
// 动效退化的第二种死法不是「动画没了」，是「动画一直在跑」。一条 8s 的无限旋转从
// 第一手棋挂到终局，每一帧都要重画一圈带模糊的描边 —— 走子时那 16.7ms 就分给了它，
// 而前 16 条断言一条都不会为它红（它确实「在播」）。所以这条不量好不好看，只算账：
//   A 常驻（infinite）动画只许动 transform / opacity —— 这两个归合成器管，不碰布局不碰绘制
//   B 布局属性（left/top/width/height/margin/padding/grid-template-*）不许出现在动画里
//   C backdrop-filter 谁都不许动（整块糊，每帧重算，是全列表里最贵的一档）
//   D 盘上不许有 SMIL，而且思考期间落点框要真的停得下来
// 扫的是构建产物 + 真实 DOM：源码里注释掉一条不算躲过去。
{
  if (!cssText) {
    bad('帧预算无从扫起：读不到构建产物 CSS')
  } else {
    const misses = []
    // @keyframes 名 → 这条动画改过哪些属性。用花括号配对切块，正则数深度即可，
    // 因为关键帧块里不会再套 @media。
    const kfProps = new Map()
    const kre = /@keyframes\s+([\w-]+)/g
    let km
    while ((km = kre.exec(cssText))) {
      const open = cssText.indexOf('{', km.index)
      let depth = 0
      let j = open
      for (; j < cssText.length; j++) {
        if (cssText[j] === '{') depth++
        else if (cssText[j] === '}') {
          depth--
          if (!depth) break
        }
      }
      const body = cssText.slice(open + 1, j)
      const props = new Set()
      for (const d of body.matchAll(/([-a-z]+)\s*:/g)) if (!d[1].startsWith('--')) props.add(d[1])
      kfProps.set(km[1], props)
      kre.lastIndex = j
    }

    // 规则 → 声明块。@media 包着的选择器会连着上一条的尾巴，取最后一段。
    const rules = []
    for (const m of cssText.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const sel = m[1].slice(m[1].lastIndexOf('}') + 1).trim().replace(/\s+/g, ' ')
      if (!sel.startsWith('@')) rules.push({ sel, body: m[2] })
    }
    const transitions = []
    for (const r of rules)
      for (const d of r.body.split(';')) {
        const mm = d.match(/^\s*transition(?:-property)?\s*:\s*(.+)$/s)
        if (mm) for (const part of mm[1].split(',')) transitions.push({ sel: r.sel, prop: part.trim().split(/\s+/)[0] })
      }

    const LAYOUT = new Set([
      'left', 'right', 'top', 'bottom', 'inset', 'width', 'height',
      'min-width', 'max-width', 'min-height', 'max-height',
      'margin', 'margin-left', 'margin-right', 'margin-top', 'margin-bottom',
      'padding', 'padding-left', 'padding-right', 'padding-top', 'padding-bottom',
      'grid-template-columns', 'grid-template-rows',
    ])
    // A：哪些动画是常驻的
    const infinite = new Set()
    for (const m of cssText.matchAll(/animation:\s*([^;}]+)/g))
      for (const part of m[1].split(','))
        if (/\binfinite\b/.test(part))
          for (const tok of part.trim().split(/\s+/)) if (kfProps.has(tok)) infinite.add(tok)
    // 例外点名放行：breathe 是「扩散的一圈光」，用 box-shadow 的 spread 画。
    // 五个使用者（warn-dot / check-flag / live-dot / rung / boot-mark）都是 ≤16px 的
    // 小点，每帧重绘的面积不到 24×24；换成 transform 的伪元素要给每个使用者各加一层
    // 结构，换来的收益是零 —— 帧预算这条规矩是为了省下贵的，不是为了零而零。
    const INFINITE_OK = new Set(['breathe'])
    for (const n of [...infinite].sort()) {
      if (INFINITE_OK.has(n)) continue
      const bad = [...kfProps.get(n)].filter((p) => p !== 'transform' && p !== 'opacity')
      if (bad.length) misses.push(`常驻动画 ${n} 每帧重算 ${bad.join('/')}`)
    }
    // B：布局属性。这一档没有例外 —— 曾经唯一动 left 的旅行墨点（inkIn）已随死代码一起删掉。
    for (const [n, props] of kfProps) {
      const hit = [...props].filter((p) => LAYOUT.has(p))
      if (hit.length) misses.push(`@keyframes ${n} 动了布局属性 ${hit.join('/')}`)
    }
    // 过渡这一侧只有两处已论证的例外：抽屉开合本身就是宽度的变化（app.css 里
    // .workspace 那条 grid-template-columns，收 0 与展开之间没有任何「可以不改布局」的中间态），
    // 和评分条的 width（那一格是数值本身，用 transform 缩放会把刻度一起拉花）。
    const TRANS_OK = [
      ['.workspace', 'grid-template-columns'],
      ['.eval-red', 'width'],
      ['.eval-black', 'width'],
    ]
    for (const t of transitions) {
      if (!LAYOUT.has(t.prop)) continue
      if (TRANS_OK.some(([s, p]) => p === t.prop && t.sel.includes(s))) continue
      misses.push(`${t.sel} 的 transition 动了布局属性 ${t.prop}`)
    }
    // C：backdrop-filter
    for (const [n, props] of kfProps)
      if (props.has('backdrop-filter')) misses.push(`@keyframes ${n} 每帧重糊一遍整块背景`)
    for (const t of transitions)
      if (t.prop === 'backdrop-filter') misses.push(`${t.sel} 的 transition 动了 backdrop-filter`)
    // D：SMIL 与思考停摆
    if (!smilOnBoard) misses.push('盘上没有落点框，SMIL 这一扫是空的（先落一手再测）')
    else if (smil > 0) misses.push(`DOM 里还有 ${smil} 个 SMIL 动画元素（<animate*>），CSS 停摆清单管不着它`)
    if (!/\.app\.is-thinking\s+\.last-to-rotator\s*\{\s*animation:\s*none\s*\}/.test(cssText))
      misses.push('落点框没进「引擎思考期间全站停摆」清单')

    if (misses.length) bad(`帧预算：${misses.join('；')}`)
    else
      ok(
        `帧预算  常驻动画 ${infinite.size} 条只动 transform/opacity · ` +
          `${kfProps.size} 条 @keyframes 无布局/无 backdrop-filter · 盘上 SMIL 0 个`,
      )
  }
}

// -------------------- 18：将军在盘上有那一响 -------------------- //
// 被将这件事声音早就报了（useGame 把它排在 landMs 那一拍），盘上以前只有一圈**静态**朱砂。
// 静态那圈说的是「还被将着」，而「刚刚被将了」这一下没有画面接住 —— 一个事件被做成了状态。
// 守四件事：那一响真播了（getAnimations 拿得到 checkAlarm）；它挤在**落地那一拍**上
// （不是服务端那一帧 —— 早三百多毫秒的话，环都散完了棋子才落定，声音还没响）；
// 它只响一次（iteration-count 必须是 1，王上有圈东西整局闪比不闪还吵）；
// 响完之后朱砂环还在（事件过去了，状态不能跟着丢）。
{
  // 红车在 a0，黑王在 e9，中间空着 —— a0e0 一走就是将军。
  // 关掉自动应手：这一响要停在「被将着」上让后面那半条断言量得到，不是让引擎马上解将。
  const CHECK_FEN = '4k4/9/9/9/9/9/9/9/8K/R8 w - - 0 1'
  const postJson = (path, body) =>
    fetch(new URL(path, url), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => {})

  await waitIdle(page)
  const before = await getState(page)
  const autoReply = before?.settings?.auto_reply ?? true
  await postJson('/api/settings', { auto_reply: false })
  await postJson('/api/load', { fen: CHECK_FEN, engine_side: 'black' })
  await page.waitForSelector('.board [data-piece]', { timeout: 15000 })
  await waitIdle(page)

  const st = await getState(page)
  const rook = st?.game?.pieces?.find((p) => p.square === 'a0')
  const bking = st?.game?.pieces?.find(
    (p) => p.side === 'black' && p.char.toLowerCase() === 'k',
  )
  if (!rook || !bking || bking.square !== 'e9' || st.game.in_check) {
    bad('摆不出「红走 a0e0 一将军」这个局面（a0 没有车 / e9 没有黑王 / 一载入就在将）')
  } else {
    // 尺子还是滑行自己那条 transform 过渡（跟第 13、14 条同一个理由：
    // 写死毫秒的话，跨度一改这条就要跟着改，而它本来该跟着滑行走）。
    const sampling = page.evaluate(
      () =>
        new Promise((resolve) => {
          const t0 = performance.now()
          const seen = { glide: null, alarm: null, host: '', iters: null }
          const loop = () => {
            const now = performance.now()
            const mvr = document.querySelector('[data-piece][data-square="e0"]')
            const tr = mvr
              ? mvr.getAnimations().find((a) => a.transitionProperty === 'transform')
              : null
            if (!seen.glide && tr && typeof tr.startTime === 'number')
              seen.glide = { start: tr.startTime, dur: tr.effect.getComputedTiming().duration }
            if (!seen.alarm)
              for (const a of document.getAnimations()) {
                if (a.animationName !== 'checkAlarm' || typeof a.startTime !== 'number') continue
                seen.alarm = a.startTime
                // 伪元素上的动画，target 报的是它挂在那个元素上
                seen.host = a.effect?.target?.className ?? ''
                seen.iters = a.effect?.getTiming?.().iterations ?? null
                break
              }
            if (now - t0 < 1100) requestAnimationFrame(loop)
            else resolve(seen)
          }
          requestAnimationFrame(loop)
        }),
    )
    await typeMove(page, 'a0e0')
    const s = await sampling

    const misses = []
    if (!s.glide?.dur) {
      bad('将军那一响无从对齐：滑行没有起步（读不到 transform transition）')
    } else {
      const dur = s.glide.dur
      const lo = s.glide.start + dur * 0.55
      const hi = s.glide.start + dur + 60
      if (s.alarm === null)
        misses.push('没观察到 checkAlarm 在播 —— 将军在盘上没有那一响')
      else {
        if (s.alarm < lo)
          misses.push(
            `那一响早了 ${Math.round(lo - s.alarm)}ms（起步后 ${Math.round(
              s.alarm - s.glide.start,
            )}ms，滑行 ${Math.round(dur)}ms）—— 它跟的是服务端那一帧，不是棋子落定那一拍`,
          )
        else if (s.alarm > hi)
          misses.push(`那一响迟了 ${Math.round(s.alarm - hi)}ms（起步后 ${Math.round(s.alarm - s.glide.start)}ms）`)
        if (!/\bis-check\b/.test(s.host))
          misses.push(`那一响不在被将的王身上（挂在「${s.host || '读不到'}」上）`)
        if (s.iters !== 1) misses.push(`那一响不是一次性的（iteration-count = ${s.iters}）`)
      }
      // 响完之后：事件过去了，状态得留着 —— 朱砂环还在，而那圈动画已经散了、不会常驻
      //
      // 「散得掉」必须等事件类真的摘下去再读，不能按一个固定毫秒数猜：那一响在 DOM 上
      // 留 700ms，是从**棋子看着落定**那一刻起算的，而这里距采样起步才 1100ms，两个时钟
      // 本来就没对齐 —— 机器一慢就会在类还挂着的时候读，把一次性的动画误判成常驻动画。
      let dropped = true
      try {
        await page.waitForFunction(
          () => !document.querySelector('.piece.is-check-alarm'),
          undefined,
          { timeout: 2500 },
        )
      } catch {
        dropped = false
      }
      const after = await page.evaluate(() => {
        const el = document.querySelector('.piece.is-check')
        if (!el) return null
        return {
          // 类摘了却还算得出 checkAlarm，说明有别处把它挂成了**状态**（常驻）
          alarmStill: getComputedStyle(el, '::before').animationName === 'checkAlarm',
          ring: getComputedStyle(el.querySelector('.piece-face') || el).boxShadow !== 'none',
        }
      })
      if (!after) misses.push('响过之后被将的黑王身上没有静态朱砂环（is-check 没了？）')
      else {
        if (!dropped) misses.push('那一响散不掉 —— is-check-alarm 到 2.5s 还挂在王身上')
        if (after.alarmStill) misses.push('那一响散不掉 —— 事件做成了常驻动画')
        if (!after.ring) misses.push('那一响散掉之后，把「还被将着」也一起带走了')
      }
    }
    if (misses.length) bad(`将军那一响：${misses.join('；')}`)
    else
      ok(
        `将军那一响  黑王身上 checkAlarm 起步后 ${Math.round(
          s.alarm - s.glide.start,
        )}ms（滑行 ${Math.round(s.glide.dur)}ms）· 只响一次 · 散掉之后朱砂环还在`,
      )
  }

  // 采样用的是测试局面，别把它留给别的套件
  await postJson('/api/new', { engine_side: 'red', think_ms: 900 })
  await postJson('/api/settings', { auto_reply: autoReply })
}

// 浏览器留到最后一条断言之后才关：第 16、17 条量的是**已经采到的数据**与构建产物，
// 以前这里在 16 之后就 close，等于默认后面不会再碰页面 —— 第 18 条要现走一手棋，
// 关早了它只会拿到「Target page has been closed」，而不是任何关于动效的结论。
await browser.close()

// -------------------- 汇总 -------------------- //
console.log('='.repeat(64))
console.log('  动效品质自检')
if (teeth)
  console.log(
    '  （--teeth：动画已人为关掉、落点上的死子被 display:none，凡靠动画与「看得见」说事的断言——1/2/7/9/10/11/12/13/14/15/18——都应当红）',
  )
if (teethAudio)
  console.log('  （--teeth-audio：落子音被推迟 120ms，第 14 条「落点同拍」应当红）')
console.log('='.repeat(64))
for (const line of notes) console.log(line)
if (problems.length) {
  for (const p of problems) console.log(`  [FAIL] ${p}`)
  console.log(`\n  ${problems.length} 条不合格`)
  process.exit(1)
}
console.log(`\n  —— ${notes.length} 条全过 ——`)
process.exit(0)
