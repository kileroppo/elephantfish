import type { Side } from '../types'

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

/** 子力价值表里一个兵 44 分，所以「分」除以 44 才是人习惯的「兵」。 */
export const PAWN_VALUE = 44

/**
 * 引擎评分（红方视角）-> 人话。
 *
 * 只给数字不给单位是耍流氓：这里的原始分一个兵=44，直接除 100 得到的小数
 * 既不是兵也不是标准 centipawn。统一按「兵」折算，读的人一眼知道差多少。
 */
export function scoreText(score: number | null | undefined, mate = false): string {
  if (score === null || score === undefined) return '—'
  if (mate || Math.abs(score) >= 1304) {
    const n = Math.max(1, Math.round((3696 - Math.abs(score)) / 2) + 1)
    return score > 0 ? `红方 ${n} 步杀` : `黑方 ${n} 步杀`
  }
  const v = score / PAWN_VALUE
  const sign = v > 0 ? '+' : ''
  return `${sign}${v.toFixed(1)}`
}

/** 评分 -> 0..1 的胜势占比，用于评分条（红方在左）。 */
export function scoreRatio(score: number | null | undefined): number {
  if (score === null || score === undefined) return 0.5
  const clamped = Math.max(-1200, Math.min(1200, score))
  // logistic，中心点 0，±1200 分基本打满
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
