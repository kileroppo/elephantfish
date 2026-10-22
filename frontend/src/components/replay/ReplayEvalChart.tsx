import type { ReplayReply } from '../../types'
import { scoreText } from '../../lib/format'

export interface ReplayEvalChartProps {
  plies: ReplayReply['plies']
  currentIndex: number
  onSelectPly: (ply: number) => void
  isTurningPly: (p: ReplayReply['plies'][number] | undefined) => boolean
}

export function ReplayEvalChart({
  plies,
  currentIndex,
  onSelectPly,
  isTurningPly,
}: ReplayEvalChartProps) {
  if (plies.length === 0) return null

  return (
    <div
      className="replay-eval-chart relative flex items-stretch h-12 bg-paper-2 border border-hairline rounded-sm px-1.5 py-0.5 my-2 overflow-x-auto scrollbar-none shrink-0 after:content-[''] after:absolute after:inset-x-0 after:top-1/2 after:h-px after:bg-hairline-strong after:pointer-events-none after:z-1"
      role="group"
      aria-label="全局胜势波形图"
      data-replay-eval-chart=""
    >
      {plies.map((p) => {
        const ev = p.eval_red ?? p.review?.played_eval_red ?? 0
        const clamped = Math.max(-800, Math.min(800, ev))
        const isRedAdv = clamped >= 0
        const barHeight = Math.max(3, Math.round((Math.abs(clamped) / 800) * 20))
        const isSelected = p.ply === currentIndex
        const rv = p.review
        const isBlunder =
          isTurningPly(p) ||
          rv?.status === 'outside' ||
          (typeof rv?.loss === 'number' && rv.loss >= 90)

        return (
          <div
            key={p.ply}
            className={`eval-bar-col flex-1 min-w-[8px] max-w-[22px] h-full relative cursor-pointer flex items-center justify-center transition-all duration-150 hover:opacity-85 hover:bg-black/5 ${
              isSelected ? 'is-selected' : ''
            } ${isBlunder ? 'is-blunder' : ''}`}
            onClick={() => onSelectPly(p.ply)}
            title={`第 ${p.ply} 手 (${p.chinese || p.iccs})：评分 ${scoreText(
              p.eval_red,
              p.mate ? p.mate_in : null,
            )}${isBlunder ? ' [胜负转折点]' : ''} · 点击跳转`}
          >
            <div className="eval-bar-track w-1 h-full relative flex items-center justify-center">
              <div
                className={`eval-bar-fill absolute inset-x-0 rounded-xs z-2 ${
                  isRedAdv ? 'is-red bg-piece-red' : 'is-black bg-piece-black'
                } ${isBlunder ? '!bg-amber-500 shadow-[0_0_3px_#f59e0b]' : ''}`}
                style={{
                  height: `${barHeight}px`,
                  [isRedAdv ? 'bottom' : 'top']: '50%',
                }}
              />
            </div>
            {isSelected && (
              <div className="eval-cursor absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-cinnabar z-3" />
            )}
          </div>
        )
      })}
    </div>
  )
}
