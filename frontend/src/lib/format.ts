import type { LossKind, MoveReview, PvCapture, ScoreBound, Side } from '../types'

export function compactNumber(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—'
  if (n < 1000) return String(Math.round(n))
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`
  return `${(n / 1_000_000).toFixed(2)}M`
}

export function seconds(v: number | null | undefined): string {
  if (v === null || v === undefined) return '—'
  if (v < 1) return `${Math.round(v * 1000)}ms`
  return `${v.toFixed(2)}s`
}

/**
 * 服务端接缝只往外说一种分数单位：centipawn，一兵 = 100。
 * 这里**不再有 44 那个分母** —— 那是内置引擎子力价值表里一兵的分值，
 * 而皮卡鱼从一开始就给 centipawn。以前两边共用一个 44 去除，结果是
 * 「让一车」被显示成「1197 步杀」，真杀棋又被兜底成永远「1 步杀」。
 */
export const CP_PAWN = 100

/** 杀棋在分数轴上的锚点，与服务端 engine.MATE_CP 同一约定。 */
export const MATE_CP = 10000

/**
 * 引擎评分 -> 人话。
 *
 * `evalRed` 一律是**红方视角**的 centipawn（正=红方有利）。
 * `mateIn` 是接缝给的「还有几步杀」（0 = 已经被杀死了），方向看 `evalRed`
 * 的正负。给了 mateIn 就绝不报小数 —— 一个数字在这种局面下只会误导。
 */
export function scoreText(evalRed: number | null | undefined, mateIn?: number | null): string {
  if (evalRed === null || evalRed === undefined) return '—'
  if (mateIn !== null && mateIn !== undefined) {
    const side = evalRed > 0 ? '红方' : '黑方'
    if (mateIn <= 0) return `${side}已被将死`
    return `${side} ${mateIn} 步杀`
  }
  const v = evalRed / CP_PAWN
  const sign = v > 0 ? '+' : ''
  return `${sign}${v.toFixed(1)}`
}

/**
 * 评分 -> 0..1 的胜势占比（红方在左）。
 *
 * 杀棋不是「很大的优势」而是「优势到头了」，所以直接打满，
 * 不再让 logistic 去近似一个无穷。
 */
export function scoreRatio(evalRed: number | null | undefined, mateIn?: number | null): number {
  if (evalRed === null || evalRed === undefined) return 0.5
  if (mateIn !== null && mateIn !== undefined) return evalRed > 0 ? 1 : 0
  const clamped = Math.max(-1200, Math.min(1200, evalRed))
  // logistic，中心点 0；±1200 分（约 12 兵，差不多一车多）基本打满
  return 1 / (1 + Math.exp(-clamped / 320))
}

export function sideName(side: Side | null | undefined): string {
  return side === 'red' ? '红方' : side === 'black' ? '黑方' : '—'
}

export function shortSide(side: Side | null | undefined): string {
  return side === 'red' ? '红' : side === 'black' ? '黑' : '·'
}

export function relativeTime(ts: number | null): string {
  if (!ts) return '从未'
  const s = Math.max(0, Date.now() / 1000 - ts)
  if (s < 60) return `${Math.round(s)} 秒前`
  if (s < 3600) return `${Math.round(s / 60)} 分钟前`
  return `${Math.round(s / 3600)} 小时前`
}

/** 截断来的分数怎么说：界的方向。`exact` 没有记号 —— 精确值不需要装饰。 */
export function boundMark(bound: ScoreBound | null | undefined): string {
  if (bound === 'lowerbound') return '≥'
  if (bound === 'upperbound') return '≤'
  return ''
}

/** centipawn 折算成「兵」。一个兵 = 100，服务端已经折好了，这里只除这一个分母。 */
export function pawnText(cp: number): string {
  return (Math.abs(cp) / CP_PAWN).toFixed(1)
}

/** 判分颜色的语言。chip 与面板共用，所以只在这一个地方决定。 */
export type GradeTone = 'good' | 'soft' | 'warn' | 'bad' | 'mate' | 'mute'

/** 每种 loss_kind 到底证到了什么 —— 悬停时给的一句话，别在界面里各写一遍。 */
const LOSS_KIND_TEXT: Record<LossKind, string> = {
  exact: '两条线都是全窗搜出来的精确值，差多少就是多少。',
  at_least: '至少差这么多：真值只会更大，截断来的分数撑不起「只差这么多」。',
  at_most: '至多差这么多：真值只会更小。',
  uncertain: '两个界的方向互相抵消，证不出差多少 —— 所以只报名次，不编数字。',
  mate: '有一条线是杀棋：centipawn 的减法在这里没有意义，只看杀多远。',
  below_top: '这一手没进引擎的前几名，连它自己的分都没搜出来。',
}

/** 差多少兵 -> 颜色。阈值按「值不值一子」划：一兵以内是瑕疵，一车上下是漏着。 */
function lossTone(cp: number): GradeTone {
  const units = Math.abs(cp) / CP_PAWN
  if (units < 0.6) return 'soft'
  if (units < 2) return 'warn'
  return 'bad'
}

/** 往轻一档：`at_most` 是个上限，真值只会更小，不许按上限吓人。 */
function softer(tone: GradeTone): GradeTone {
  if (tone === 'bad') return 'warn'
  if (tone === 'warn') return 'soft'
  return tone
}

/**
 * 排名第一那条线该怎么称呼。**「正解」是对错层面的断言，名次只是引擎的排序**：
 * 只有差值两侧都证得出来（`exact`）、或那条线本身就是杀棋时，第 1 名才当得起
 * 这两个字。带界、证不出差值、这一手掉出前几名之后引擎那第 1 名 —— 说得出口的
 * 只有「引擎眼下排第一的是这一手」。
 *
 * 称呼放在这里而不是各写一遍：`gradeLabel` 已经按 loss_kind 收着说了，
 * 副标题与悬停要是自己硬说「正解」，同一手的两块文案就互相打脸。
 */
export function bestLineWord(review: MoveReview): string {
  return review.loss_kind === 'exact' || review.loss_kind === 'mate' ? '正解' : '引擎第一选择'
}

/**
 * 子力大小只用来回答一件事：两条线都要吃子时，哪一条吃得更重。
 *
 * 这套「车 9 / 马炮 6 / 士象 2 / 兵 1」是**中文常识**，不是引擎的分值表
 * （那边一兵是 44、一车是 233，与服务对外唯一的 centipawn 刻度不同）。
 * 所以这里只比谁大，绝不拿它做减法 —— 拿它去减「差几兵」就是把两把尺混成一把。
 */
const PIECE_WEIGHT: Record<string, number> = {
  车: 9, 马: 6, 炮: 6, 士: 2, 仕: 2, 象: 2, 相: 2, 兵: 1, 卒: 1,
}

function pieceWeight(name: string): number {
  return PIECE_WEIGHT[name] ?? 0
}

/** 这颗子是谁吃的、吃掉了谁的 —— 「你」在这里指被打分那一手的行棋方。 */
function eatText(c: PvCapture, gradedSide: Side): string {
  return `${c.by === gradedSide ? '吃掉他的' : '吃掉你的'}${c.captured}`
}

function sameCapture(a: PvCapture, b: PvCapture): boolean {
  return a.ply === b.ply && a.by === b.by && a.captured === b.captured
}

/**
 * 判分 -> 一句「为什么」。`gradeLabel` 说这一手差多少，这一句从引擎自己的主变里
 * 挑出一件**盘上真会发生的事**：两条线各自第一次吃到子的那一手。
 *
 * 三条边界，都是这份数据只有这么多可说：
 * * `reason` 不在 = 没看过（这一手压根没进排名线，它没有可比的主变），
 *   一句话都不编；「六步内都不吃子」是看过且没有，两者不许混。
 * * 主变是引擎替双方走的**一条**线，不是必然发生的棋，所以句子永远带着
 *   「第几手 / 几步内」这个窗口，不说「他就丢车」这种脱离窗口的话。
 * * 先吃到子不等于更好。人常常以为吃子就是赚，所以「你这手先吃、引擎还是不选它」
 *   这一档必须讲得出来，而且要明说差的不在吃子上 —— 那句才是功课。
 *
 * 杀棋不套这套：`gradeLabel` 那句已经把因果说完了（几步杀、撑几步），再补一刀
 * 「主变里第 3 手吃马」只会稀释它。
 */
export function whySentence(review: MoveReview | null | undefined): string | null {
  if (!review || review.loss_kind === 'mate') return null
  const r = review.reason
  if (!r) return null
  const word = bestLineWord(review)
  const b = r.best
  const p = r.played

  if (!b && !p) return `${r.pv_plies} 步内两条主变都不吃子，这一句给不出吃子层面的原因。`
  if (!b) {
    return `先吃到子的是你这手那条线（第 ${p!.ply} 步${eatText(p!, r.side)}），` +
      `可引擎还是更看${word}那一手 —— 差的不在吃子上。`
  }
  if (!p) {
    return `${word}第 ${b.ply} 步就${eatText(b, r.side)}（${b.chinese}），` +
      `你这手之后 ${r.pv_plies} 步内吃不到子。`
  }
  if (sameCapture(b, p)) return `两条线都在第 ${b.ply} 步${eatText(b, r.side)} —— 差不在吃子上。`
  const bestHitsHarder = b.ply < p.ply || pieceWeight(b.captured) > pieceWeight(p.captured)
  if (bestHitsHarder) {
    return `${word}第 ${b.ply} 步${eatText(b, r.side)}（${b.chinese}），` +
      `你这手要到第 ${p.ply} 步才${eatText(p, r.side)}（${p.chinese}）。`
  }
  return `你这手第 ${p.ply} 步就${eatText(p, r.side)}（${p.chinese}），比${word}那条还早，` +
    `可引擎仍然更看那一手 —— 差的不在吃子上。`
}

/**
 * 判分 -> 一句人话。**全站唯一的措辞出口**：棋谱里的 chip 和右侧面板的判分块
 * 都调它，两边各自措辞早晚会漂移，而这里漂错的不是小数点，是「这个数能不能当真」。
 *
 * 规矩只有一条：`loss_kind` 说这个 loss 有几分可信，措辞就得有几分可信。
 * 最容易说谎的一处是 `loss === 0` 带界 —— 内置引擎把 fail-low 的根着法报成
 * 零窗口值加 `upperbound`，于是差值算出来是 0。那**不是**「这一步是正解」，
 * 更不是「差 0 兵」，只能说名次层面的话。
 *
 * 返回 null = 这一手没有判分（和「判了、而且没问题」是两件事，界面要分得开）。
 */
export function gradeLabel(
  review: MoveReview | null | undefined,
): { text: string; tone: GradeTone } | null {
  if (!review) return null

  const kind = review.loss_kind
  const rank = review.rank ?? null
  const loss = review.loss ?? null

  // 掉出前几名：不知道差多少，也不是差 0。width 是「前几名」的那个几。
  if (review.status === 'outside' || kind === 'below_top') {
    return { text: `没进引擎前 ${review.width} 名`, tone: 'bad' }
  }

  // 杀棋：只谈杀多远，centipawn 的减法在这里算不出任何东西。
  //
  // `mate_in` 只是**距离**，方向在分数的符号里（接缝里杀棋分钉在 ±MATE_CP）。
  // 不看符号就照着「错过 N 步杀」念，会把「他被将死了」念成「你错过了杀他」——
  // 而这恰恰是这一层最不能出错的地方：学员会照着这句话去攻一个攻不动的局。
  if (kind === 'mate') {
    const mateForMover = (review.lines?.[0]?.score ?? review.best_eval_red ?? 0) > 0
    const bestIn = review.best_mate_in ?? null
    const playedIn = review.played_mate_in ?? null

    if (!mateForMover) {
      // 杀棋是冲着自己来的：这时「最优」是**撑得最久**的那一手，没什么可错过的。
      if (playedIn !== null && bestIn !== null && playedIn < bestIn) {
        return {
          text: `只撑 ${playedIn} 步，最优能撑 ${bestIn} 步`,
          tone: 'bad',
        }
      }
      return {
        text: bestIn !== null ? `挡不住 ${bestIn} 步杀` : '已是杀局',
        tone: 'mate',
      }
    }

    if (rank === 1) return { text: '正解', tone: 'good' }
    if (playedIn === null && bestIn !== null) {
      return { text: `错过 ${bestIn} 步杀`, tone: 'mate' }
    }
    if (playedIn !== null && bestIn !== null && playedIn > bestIn) {
      return {
        text: `这手 ${playedIn} 步杀，最优 ${bestIn} 步`,
        tone: 'warn',
      }
    }
    return { text: rank ? `第 ${rank} 名 · 也是杀棋` : '杀棋局面', tone: 'mate' }
  }

  // 证不出差值，或这一手压根没分：只许报名次。
  if (kind === 'uncertain' || loss === null) {
    return rank ? { text: `第 ${rank} 名`, tone: 'soft' } : { text: '名次未定', tone: 'mute' }
  }

  if (kind === 'exact') {
    if (loss === 0) {
      // 第 1 名 + 精确的 0：这才是可以说「正解」的那一种 0。
      return rank === 1
        ? { text: '正解', tone: 'good' }
        : { text: `第 ${rank} 名 · 与最优同分`, tone: 'soft' }
    }
    return { text: `比最优差 ${pawnText(loss)} 兵`, tone: lossTone(loss) }
  }

  if (kind === 'at_least') {
    // 带界的 0：「至少不差」不等于「不差」，更不等于正解 —— 落回名次的话。
    // 名次是唯一还能当真的东西：第 1 名就是引擎的第一选择，但「和前几名
    // 不分上下」要的是等号，而下界只给得出 ≥，编不出那个等号。
    if (loss <= 0) {
      return rank === 1
        ? { text: '引擎第一选择', tone: 'soft' }
        : { text: `第 ${rank} 名`, tone: 'soft' }
    }
    return { text: `至少差 ${pawnText(loss)} 兵`, tone: lossTone(loss) }
  }

  if (kind === 'at_most') {
    if (loss <= 0) return { text: '不差于最优', tone: 'soft' }
    return { text: `至多差 ${pawnText(loss)} 兵`, tone: softer(lossTone(loss)) }
  }

  // 服务端以后加一种 loss_kind 也不该在这里编一句话糊过去：宁可退到名次。
  return rank ? { text: `第 ${rank} 名`, tone: 'soft' } : { text: '名次未定', tone: 'mute' }
}

/**
 * 判分的完整一句话（chip 的悬停提示与面板副标题共用）。
 * 数字一律 centipawn 折兵，视角写在文案里，免得「+1.4」被当成红方的优势。
 */
export function gradeDetail(review: MoveReview | null | undefined): string {
  if (!review) return '这一手还没有判分：轮到你的时候，引擎会在空档里算出前几名。'
  const parts: string[] = []
  const kindText = review.loss_kind ? LOSS_KIND_TEXT[review.loss_kind] : null
  if (kindText) parts.push(kindText)
  parts.push(
    `${bestLineWord(review)} ${review.best_iccs || '—'} · 这一手 ${review.played_iccs || '—'}` +
      (review.rank ? ` · 第 ${review.rank} 名` : ''),
  )
  parts.push(`${review.width} 条排名线 · ${review.depth} 层 · ${seconds(review.time)}`)
  if (review.played_eval_red !== null && review.played_eval_red !== undefined) {
    parts.push(
      `走完这一手：${scoreText(review.played_eval_red, review.played_mate_in ?? null)}（红方视角）`,
    )
  }
  return parts.join('　|　')
}
