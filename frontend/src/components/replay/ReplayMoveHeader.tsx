import type { ReplayReply } from '../../types'
import { gradeDetail, scoreText, sideName } from '../../lib/format'

export interface ReplayMoveHeaderProps {
  current: ReplayReply['plies'][number] | null
  grade: { tone: string; text: string } | null
}

export function ReplayMoveHeader({ current, grade }: ReplayMoveHeaderProps) {
  return (
    <p
      className="replay-now flex flex-wrap items-baseline gap-x-2 gap-y-1 m-0 min-h-10 text-[12.5px] text-ink-1"
      data-replay-now=""
    >
      {current ? (
        <>
          <b className="font-display text-[15px] font-semibold text-ink-0">
            {current.chinese || current.iccs}
          </b>
          <span
            className={`replay-by by-${current.by} side-${current.side} text-[10.5px] font-medium ${
              current.side === 'red' ? 'text-piece-red' : 'text-piece-black'
            }`}
          >
            {sideName(current.side)}
            {current.by === 'engine' ? '·引擎' : '·录入'}
          </span>
          {grade && (
            <span
              className={`grade-chip tone-${grade.tone} text-[11px] px-1.5 py-0.5 rounded font-medium`}
              title={gradeDetail(current.review)}
            >
              {grade.text}
            </span>
          )}
          {current.eval_red !== null && (
            <span
              className="replay-eval text-xs font-num text-ink-2"
              title="走完这一手之后的评估（红方视角）"
            >
              {scoreText(current.eval_red, current.mate_in)}
            </span>
          )}
        </>
      ) : (
        <span className="replay-start text-[11.5px] text-ink-mute">开局那个局面，还没走</span>
      )}
    </p>
  )
}
