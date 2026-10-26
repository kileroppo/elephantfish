import type { RefObject } from 'react'
import type { ReplayReply } from '../../types'
import { gradeDetail, gradeLabel } from '../../lib/format'

export interface ReplayMoveListProps {
  plies: ReplayReply['plies']
  currentIndex: number
  stripRef: RefObject<HTMLDivElement>
  onSelectPly: (ply: number) => void
}

export function ReplayMoveList({
  plies,
  currentIndex,
  stripRef,
  onSelectPly,
}: ReplayMoveListProps) {
  return (
    <div
      className="replay-strip relative flex-none h-[240px] sm:h-[250px] min-h-[180px] flex flex-col gap-0.5 m-0 p-0 list-none overflow-y-auto scrollbar-thin"
      ref={stripRef}
      data-replay-strip=""
    >
      {plies.map((p) => {
        const g = p.by === 'engine' ? null : gradeLabel(p.review)
        const on = p.ply === currentIndex

        return (
          <button
            type="button"
            key={p.ply}
            className={`replay-row by-${p.by} side-${p.side} flex flex-wrap items-baseline gap-x-2 gap-y-0.5 w-full min-h-8 py-1.5 px-2.5 rounded-md border border-transparent bg-paper-1 font-inherit text-left text-ink-2 cursor-pointer transition-all duration-150 hover:border-hairline-strong hover:bg-paper-0 ${
              p.by === 'engine' ? 'by-engine !bg-transparent text-ink-3' : ''
            } ${
              on
                ? 'is-on !border-[var(--cinnabar-edge)] !bg-gradient-to-b !from-paper-0 !to-[#fbf3e8] !text-ink-0'
                : ''
            }`}
            data-replay-row=""
            data-ply={p.ply}
            data-graded={p.review ? '1' : '0'}
            aria-current={on ? 'step' : undefined}
            onClick={() => onSelectPly(p.ply)}
            title={g ? gradeDetail(p.review) : undefined}
          >
            <span className="replay-n font-num tabular-nums text-[10px] text-ink-4 min-w-5">
              {p.ply}
            </span>
            <span
              className={`replay-cn font-display text-xs text-ink-1 ${
                on ? '!text-cinnabar font-bold' : ''
              }`}
            >
              {p.chinese || p.iccs}
            </span>
            {p.captured && (
              <em className="tag tag-capture not-italic text-[10px] px-1 py-px rounded bg-amber-100/70 text-amber-800 border border-amber-200">
                吃{p.captured}
              </em>
            )}
            {p.gives_check && (
              <em className="tag tag-check not-italic text-[10px] px-1 py-px rounded bg-red-100/70 text-red-700 border border-red-200 font-semibold">
                将
              </em>
            )}
            {p.mate && (
              <em className="tag tag-mate not-italic text-[10px] px-1 py-px rounded bg-red-200 text-red-900 border border-red-300 font-bold">
                杀
              </em>
            )}
            {g ? (
              <em className={`grade-chip tone-${g.tone} not-italic text-[10.5px] px-1.5 py-px rounded`}>
                {g.text}
              </em>
            ) : (
              p.by !== 'engine' &&
              !p.review && (
                <em
                  className="grade-chip tone-mute not-italic text-[10px] px-1 py-px rounded opacity-60 text-ink-mute"
                  title="这一手没有判分：判分关着、或引擎当时腾不出空档"
                >
                  未判分
                </em>
              )
            )}
          </button>
        )
      })}
    </div>
  )
}
