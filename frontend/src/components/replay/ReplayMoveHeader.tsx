import type { ReplayReply } from '../../types'
import { gradeDetail, scoreText, sideName } from '../../lib/format'

export interface ReplayMoveHeaderProps {
  current: ReplayReply['plies'][number] | null
  grade: { tone: string; text: string } | null
}

export function ReplayMoveHeader({ current, grade }: ReplayMoveHeaderProps) {
  return (
    <div
      className="replay-now flex items-center justify-between gap-2 p-2 rounded-xl bg-paper-1/70 border border-hairline/70 text-xs shrink-0 select-none"
      data-replay-now=""
    >
      {current ? (
        <>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-num text-xs font-semibold px-1.5 py-0.5 rounded bg-paper-2 text-ink-3">
              #{current.ply}
            </span>
            <b className="font-display text-base font-bold text-ink-0 tracking-wide">
              {current.chinese || current.iccs}
            </b>
            <span
              className={`replay-by by-${current.by} side-${current.side} text-[11px] font-medium px-1.5 py-0.5 rounded ${
                current.side === 'red'
                  ? 'text-piece-red bg-red-500/10'
                  : 'text-piece-black bg-slate-500/10'
              }`}
            >
              {sideName(current.side)}
              {current.by === 'engine' ? '·引擎' : '·录入'}
            </span>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {grade && (
              <span
                className={`grade-chip tone-${grade.tone} text-[11px] px-2 py-0.5 rounded-full font-semibold shadow-3xs`}
                title={gradeDetail(current.review)}
              >
                {grade.text}
              </span>
            )}
            {current.eval_red !== null && (
              <span
                className="replay-eval text-xs font-num font-semibold text-ink-2 px-1.5 py-0.5 rounded bg-paper-2"
                title="走完这一手之后的评估（红方视角）"
              >
                {scoreText(current.eval_red, current.mate_in)}
              </span>
            )}
          </div>
        </>
      ) : (
        <span className="replay-start text-xs text-ink-mute py-1">对局起始局面（第 0 手未行棋）</span>
      )}
    </div>
  )
}
