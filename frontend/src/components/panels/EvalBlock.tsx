import type { CSSProperties } from 'react'
import { CP_PAWN, scoreRatio, scoreText } from '../../lib/format'

export interface EvalBlockProps {
  evalRed: number | null
  mateIn: number | null
  trend: string | null
}

export function verdict(
  evalRed: number | null,
  mateIn: number | null,
): { text: string; tone: string } {
  if (evalRed === null) return { text: '待评估', tone: 'even' }
  if (mateIn !== null) {
    if (mateIn <= 0) {
      return evalRed > 0
        ? { text: '黑方已被将死', tone: 'red' }
        : { text: '红方已被将死', tone: 'black' }
    }
    return evalRed > 0
      ? { text: `红方 ${mateIn} 步内将死`, tone: 'red' }
      : { text: `黑方 ${mateIn} 步内将死`, tone: 'black' }
  }
  const units = Math.abs(evalRed) / CP_PAWN
  const side = evalRed > 0 ? '红方' : '黑方'
  if (units < 0.35) return { text: '均势', tone: 'even' }
  if (units < 1.2) return { text: `${side}略优`, tone: evalRed > 0 ? 'red' : 'black' }
  if (units < 3) return { text: `${side}占优`, tone: evalRed > 0 ? 'red' : 'black' }
  if (units < 6) return { text: `${side}大优`, tone: evalRed > 0 ? 'red' : 'black' }
  return { text: `${side}胜势`, tone: evalRed > 0 ? 'red' : 'black' }
}

export function EvalBlock({ evalRed, mateIn, trend }: EvalBlockProps) {
  const call = verdict(evalRed, mateIn)
  const ratio = scoreRatio(evalRed, mateIn)

  const getToneBadgeClass = (tone: string) => {
    switch (tone) {
      case 'red':
        return 'text-piece-red font-bold bg-rose-50 border-rose-200'
      case 'black':
        return 'text-ink-0 font-bold bg-stone-100 border-stone-300'
      default:
        return 'text-ink-2 font-semibold bg-paper-2 border-hairline'
    }
  }

  return (
    <div className="eval-block flex flex-col gap-2.5 p-3 rounded-2xl bg-paper-0/95 border border-hairline/80 shadow-2xs select-none">
      <div className="eval-verdict flex items-center justify-between">
        <span
          className={`eval-call px-2.5 py-0.5 rounded-lg text-xs border tracking-wide shadow-3xs ${getToneBadgeClass(
            call.tone,
          )}`}
        >
          {call.text}
        </span>
        <span
          className="eval-score font-num text-xs font-bold text-ink-1 tabular-nums"
          title="引擎评分，一个兵算 1.0"
        >
          {evalRed === null ? '—' : `${scoreText(evalRed, mateIn)}${mateIn !== null ? '' : ' 兵'}`}
        </span>
      </div>

      {/* Apple 级动态胜势进度槽 */}
      <div
        className="eval-bar relative h-3 w-full rounded-full overflow-hidden flex bg-paper-2 border border-hairline/80 shadow-inner"
        role="img"
        aria-label={`红方胜势 ${Math.round(ratio * 100)}%`}
      >
        <div
          className="eval-red h-full bg-gradient-to-r from-cinnabar to-[#ea5848] transition-all duration-400 ease-out"
          style={{ width: `${ratio * 100}%` }}
        />
        <div
          className="eval-black h-full bg-gradient-to-r from-[#2f333c] to-[#191b20] transition-all duration-400 ease-out"
          style={{ width: `${(1 - ratio) * 100}%` }}
        />
        <div className="eval-mid absolute left-1/2 top-0 bottom-0 w-[1.5px] bg-white/70 -translate-x-1/2 z-10" />
        <div
          className="eval-tick-track absolute inset-0 pointer-events-none"
          style={{ '--er': ratio } as CSSProperties}
        >
          <div
            className="eval-tick absolute top-0 bottom-0 w-1.5 -ml-0.75 bg-amber-300 rounded-full shadow-xs border border-amber-500/50"
            style={{ left: `${ratio * 100}%` }}
          />
        </div>
      </div>

      {trend && (
        <div className="w-full my-0.5">
          <svg
            className="eval-trend w-full h-[26px] stroke-cinnabar fill-none stroke-[1.8] overflow-visible"
            viewBox="0 0 100 26"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <line
              className="eval-trend-mid stroke-hairline-strong stroke-[1] stroke-dasharray-[2_2]"
              x1="0"
              y1="13"
              x2="100"
              y2="13"
            />
            <path d={trend} strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      )}

      <div className="eval-scale flex items-center justify-between text-[10.5px] font-num text-ink-mute tracking-wider px-1">
        <span className="scale-red text-piece-red font-bold">红方</span>
        <span className="scale-mid opacity-75">均势中线</span>
        <span className="scale-black text-ink-1 font-bold">黑方</span>
      </div>
    </div>
  )
}
