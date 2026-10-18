// 判分的措辞：`loss_kind` 说这个数有几分可信，界面上那句话就得有几分可信。
//
// 为什么值得单独一套：这句措辞全站只有一个出口（`frontend/src/lib/format.ts`
// 的 `gradeLabel`），而它写错的不是小数点，是「这一步能不能当真」—— 同一句
// 「差 0 兵」在界面上出现，学员就会把一次没证出来的比较当成正解去复盘。
// 这一类错已经手改出来过三次（带界的 0、杀棋的方向、第一选择的称呼），
// 而六套界面自检一条都拦不住：它们量画面，不量「这句话配不配得上那个数」。
//
// 只断言**什么不许说**，不抄一份措辞表：把 `gradeLabel` 的话在测试里重打一遍，
// 就有了两份，两份迟早分叉，分叉那天测试是绿的、话是假的。
//
//   node grade-wording.mjs
//
// 牙齿：往 format.ts 的 `at_least` 分支把「至少差」改成「差」，第 2 条必须红；
// 把杀棋那一段的 `if (!mateForMover)` 改成 `if (mateForMover && false)`（等于回到
// 「不看方向、照着 mate_in 念」的写法），第 4 条必须红。两处去掉即绿。
//
// 「为什么」那一句同样抽过三刀，每刀都有对应的一条红：把「都不吃子」那句改成
// 「差在位置上」→ 归因那条红；往 `eatText` 末尾塞一个主变里没有的「马」→ 子名
// 那条红（而且只点在它没出现的那几种形状上，说明这条不是在陪跑）；把
// `if (!r) return null` 改成 `return '引擎更看另一手'` → 「没看过就整个不说」那条红。

import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const mod = await import(
  pathToFileURL(join(resolve(here, '..', 'frontend', 'src', 'lib', 'format.ts'))).href
)
const { gradeLabel, bestLineWord, whySentence } = mod

const problems = []
const bad = (s) => problems.push(s)

/** 造一份判分。默认值是「精确、第 1 名、不差」这一最好过的形状，逐条往坏里改。 */
const review = (over = {}) => ({
  status: 'ok',
  width: 3,
  depth: 8,
  time: 1.2,
  played_iccs: 'h2e2',
  best_iccs: 'h2e2',
  rank: 1,
  loss: 0,
  loss_kind: 'exact',
  lines: [{ rank: 1, iccs: 'h2e2', score: 100, eval_red: 100, bound: 'exact', mate: false, mate_in: null, depth: 8, nodes: 1000, time: 1.2, pv: [] }],
  ...over,
})

// 覆盖面：界的方向四种都来一遍，杀棋两个方向都来，掉出前几名也来。
const RANK1_EXACT_ZERO = review()
const SAMPLES = [
  ['exact · 第 1 名 · 不差', RANK1_EXACT_ZERO],
  ['exact · 第 2 名 · 同分', review({ rank: 2, loss: 0, played_iccs: 'b0c2' })],
  ['exact · 第 2 名 · 差 4 兵', review({ rank: 2, loss: 400, played_iccs: 'b0c2' })],
  ['at_least · 第 1 名 · 带界的 0',
    review({ loss_kind: 'at_least', played_iccs: 'b0c2', played_bound: 'upperbound' })],
  ['at_least · 第 3 名 · 至少差 1.2 兵',
    review({ loss_kind: 'at_least', rank: 3, loss: 120, played_iccs: 'b0c2' })],
  ['at_most · 第 1 名 · 不差于最优',
    review({ loss_kind: 'at_most', played_iccs: 'b0c2', played_bound: 'lowerbound' })],
  ['at_most · 第 2 名 · 至多差 3 兵',
    review({ loss_kind: 'at_most', rank: 2, loss: 300, played_iccs: 'b0c2' })],
  ['uncertain · 两个界互相抵消', review({ loss_kind: 'uncertain', rank: 2, loss: 50, played_iccs: 'b0c2' })],
  ['below_top · 没进前几名',
    review({ status: 'outside', loss_kind: 'below_top', rank: null, loss: null, lines: [] })],
  ['mate · 杀棋是冲着对手去的',
    review({ loss_kind: 'mate', rank: 2, loss: null, played_iccs: 'b0c2', best_mate_in: 5,
      lines: [{ rank: 1, iccs: 'h2e2', score: 10000, eval_red: 10000, bound: 'exact',
        mate: true, mate_in: 5, depth: 8, nodes: 1000, time: 1.2, pv: [] }] })],
  ['mate · 杀棋是冲着自己来的',
    review({ loss_kind: 'mate', rank: 2, loss: null, played_iccs: 'b0c2', played_mate_in: 3,
      best_mate_in: 5,
      lines: [{ rank: 1, iccs: 'h2e2', score: -10000, eval_red: -10000, bound: 'exact',
        mate: true, mate_in: 5, depth: 8, nodes: 1000, time: 1.2, pv: [] }] })],
  // 这一手自己不带杀棋分（played_mate_in 为 null），而对手那一条是杀棋 ——
  // 不看方向的话这句会念成「你错过了 5 步杀」，把守不住的局面教人去攻。
  ['mate · 自己被将死、这一手不是杀棋',
    review({ loss_kind: 'mate', rank: 2, loss: null, played_iccs: 'b0c2',
      best_mate_in: 5,
      lines: [{ rank: 1, iccs: 'h2e2', score: -10000, eval_red: -10000, bound: 'exact',
        mate: true, mate_in: 5, depth: 8, nodes: 1000, time: 1.2, pv: [] }] })],
]

const GAP = /差\s*[\d.]+\s*兵/
const HEDGE = /至少|至多/
const TONES = new Set(['good', 'soft', 'warn', 'bad', 'mate', 'mute'])

// 1) 没有判分要说「没有」，不许退化成一句「没问题」。
if (gradeLabel(null) !== null || gradeLabel(undefined) !== null)
  bad('gradeLabel(null) 不是 null —— 「没判」会被念成「判了、而且没问题」')

let checked = 0
for (const [name, r] of SAMPLES) {
  const g = gradeLabel(r)
  if (!g || !g.text) { bad(`「${name}」没给出这句话`); continue }
  checked += 1
  if (!TONES.has(g.tone)) bad(`「${name}」的 tone「${g.tone}」不在颜色表里`)

  // 2) 只有两侧都证得出精确差值时，才许裸说「差 N 兵」。
  if (GAP.test(g.text) && r.loss_kind !== 'exact' && !HEDGE.test(g.text))
    bad(`「${name}」裸说了差几个兵 —— ${r.loss_kind} 撑不起这句话，界的方向必须带在话里`)

  // 3) 「正解」是对错层面的断言：带界的 0、掉出前几名都不许说。
  if (g.text.includes('正解') &&
      !(r.loss_kind === 'exact' && r.rank === 1 && r.loss === 0) &&
      r.loss_kind !== 'mate')
    bad(`「${name}」说了「正解」—— ${r.loss_kind} 只证到名次，证不到对错`)

  // 4) 杀棋不谈兵数，更不许把「他被将死」念成「你错过了杀他」。
  if (r.loss_kind === 'mate' && GAP.test(g.text))
    bad(`「${name}」在杀棋局面上报了兵数 —— centipawn 的减法在这里算不出东西`)
  const againstMover = (r.lines?.[0]?.score ?? 0) < 0
  if (r.loss_kind === 'mate' && againstMover && g.text.includes('错过'))
    bad(`「${name}」把冲着自己来的杀棋说成「错过」—— 方向在分数的符号里，不在 mate_in 里`)

  // 5) 掉出前几名 = 不知道差多少，一个数都不许编。
  if ((r.status === 'outside' || r.loss_kind === 'below_top') && GAP.test(g.text))
    bad(`「${name}」给没搜出来的那一手编了个差值`)

  // 6) 同一条判分的称呼与 chip 不能互相打脸。
  const word = bestLineWord(r)
  if (word === '正解' && r.loss_kind !== 'exact' && r.loss_kind !== 'mate')
    bad(`「${name}」把第 1 名称成「正解」—— ${r.loss_kind} 只给得出名次`)
  if (word !== '正解' && r.loss_kind === 'exact' && r.rank === 1 && r.loss === 0)
    bad(`「${name}」是精确的第 1 名却不叫「正解」—— 该说的时候也得说`)
}

// -------------------------------------------------------------------------- //
// 7) 「为什么」那一句：只许报主变里真发生的事
// -------------------------------------------------------------------------- //
//
// 这一句全站也只有 format.ts 一个出口。它比 chip 更容易说谎：chip 顶多说错
// 差多少，这句会说出一件**盘上没发生过的事**。所以这里不比措辞，只划四条边界 ——
// 不许报兵数（那是 chip 的事，两处各报一个数早晚会打架）、不许出现主变里
// 没有的子名、不许出现「将/帅」（主变里吃掉王将不是一条合法的象棋事实）、
// 不许替人归因（两条线都不吃子时，「差在位置」这句是给不出来的）。
const cap = (over = {}) => ({
  ply: 3, iccs: 'h2e2', chinese: '炮二平五', by: 'red', captured: '车', ...over,
})
const reason = (over = {}) => ({ side: 'red', pv_plies: 6, best: null, played: null, ...over })
const WITH_REASON = [
  ['正解先吃、你这手六步内吃不到子',
    review({ rank: 2, loss: 140, played_iccs: 'b0c2', reason: reason({ best: cap() }) })],
  ['两条都要吃，正解更早',
    review({ rank: 2, loss: 140, played_iccs: 'b0c2',
      reason: reason({ best: cap({ ply: 2 }), played: cap({ ply: 5, captured: '马' }) }) })],
  ['你这手反而先吃到子',
    review({ rank: 2, loss: 140, played_iccs: 'b0c2',
      reason: reason({ best: cap({ ply: 5, captured: '兵' }), played: cap({ ply: 1 }) }) })],
  ['两条线吃到同一颗子',
    review({ rank: 2, loss: 40, played_iccs: 'b0c2',
      reason: reason({ best: cap(), played: cap() }) })],
  ['只有你这手那条线吃到子',
    review({ rank: 2, loss: 90, played_iccs: 'b0c2',
      reason: reason({ played: cap({ by: 'black', captured: '炮', ply: 4 }) }) })],
  ['六步内两条都不吃子', review({ rank: 2, loss: 60, played_iccs: 'b0c2', reason: reason() })],
]
const ALL_PIECES = ['车', '马', '炮', '兵', '卒', '士', '仕', '象', '相']
const VERDICT_WORDS = /好棋|更好|更稳|优势|赚|亏了/

for (const [name, r] of WITH_REASON) {
  const why = whySentence(r)
  if (!why || !why.trim()) { bad(`「${name}」讲不出那一句主变里的事`); continue }
  if (GAP.test(why)) bad(`「${name}」在「为什么」里又报了一遍兵数 —— 差多少是 chip 那句话的事`)
  if (VERDICT_WORDS.test(why))
    bad(`「${name}」替这一手下了好坏的结论：${why}`)
  if (/将|帅/.test(why)) bad(`「${name}」说到了吃将/吃帅，那不是一条主变`)
  const named = ALL_PIECES.filter((p) => why.includes(p))
  // 允许点名的子：两条线各自吃到的那颗，加上那两手自己的记谱里出现的棋子名
  // （记谱本来就写着是谁吃的 —— 「炮二平五」吃掉车，炮与车都该能提）。
  const allowed = new Set([r.reason.best?.captured, r.reason.played?.captured])
  for (const c of [r.reason.best, r.reason.played])
    if (c?.chinese) for (const p of ALL_PIECES) if (c.chinese.includes(p)) allowed.add(p)
  const invented = named.filter((p) => !allowed.has(p))
  if (invented.length)
    bad(`「${name}」报出主变里没有的子名「${invented.join('」「')}」—— 只有吃到子的那一手才配被点名`)
  // 「第 N 步」只能来自主变里那两个 ply，编一个数出来就是编一件没发生过的事
  for (const m of why.matchAll(/第\s*(\d+)\s*步/g)) {
    const n = Number(m[1])
    if (n !== r.reason.best?.ply && n !== r.reason.played?.ply)
      bad(`「${name}」报出第 ${n} 步，而两条主变先吃到子分别是第 ${r.reason.best?.ply} 与第 ${r.reason.played?.ply} 步`)
  }
  if (r.reason.played && /吃不到子|吃不到/.test(why))
    bad(`「${name}」明明看到你这手那条线吃到子，还说「吃不到子」`)
  if (!r.reason.best && !r.reason.played && /位置|占优/.test(why))
    bad(`「${name}」两条主变都不吃子却归因到位置上 —— 这份数据只证得到「没吃到子」`)
}

// 没有 reason = 压根没看过（这一手掉出前几名，它没有可比的主变）。
// 「没看过」被念成「看了，都不吃子」，学员就丢掉了一次本该重做的题。
for (const [name, r] of [
  ['没有 reason 的判分', review({ rank: 2, loss: 140, played_iccs: 'b0c2' })],
  ['掉出前几名', review({ status: 'outside', loss_kind: 'below_top', rank: null, loss: null, lines: [] })],
  ['杀棋局面', review({ loss_kind: 'mate', rank: 2, loss: null, played_iccs: 'b0c2', best_mate_in: 5,
    reason: reason({ best: cap() }),
    lines: [{ rank: 1, iccs: 'h2e2', score: 10000, eval_red: 10000, bound: 'exact', mate: true,
      mate_in: 5, depth: 8, nodes: 1000, time: 1.2, pv: [] }] })],
]) {
  const why = whySentence(r)
  if (why !== null) bad(`「${name}」不该有「为什么」这一句，却给出了：${why}`)
}
if (whySentence(null) !== null || whySentence(undefined) !== null)
  bad('whySentence 对没有判分的那一手给出了句子 —— 没判过就没有主变可讲')

const WHY_N = WITH_REASON.length + 4
if (problems.length) {
  for (const p of problems) console.log(`  [FAIL] ${p}`)
  console.log(`\n  ${checked} 种判分形状，${problems.length} 条不合格`)
  process.exit(1)
}
console.log(`  [ok] 判分措辞  ${checked} 种形状只说 loss_kind 撑得起的话：界带在话里、` +
  `「正解」只给证得出对错的、杀棋不谈兵数、掉出前几名不编数`)
console.log(`  [ok] 「为什么」那一句  ${WHY_N} 种形状只报主变里真发生的事：不报兵数、` +
  `不点主变里没有的子名、不归因到位置、没看过就整个不说`)