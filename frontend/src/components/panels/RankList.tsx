import type { RankedLine } from '../../types'
import { boundMark, compactNumber, scoreText, seconds } from '../../lib/format'
import { useUIContext } from '../../context/UIContext'

export interface RankListProps {
  lines: RankedLine[]
  playedIccs: string | null
  withPv: boolean
}

const PV_SHOW = 4

export function RankList({ lines, playedIccs, withPv }: RankListProps) {
  const ui = useUIContext()
  if (!lines.length) return null

  return (
    <ul className="rank-list flex flex-col gap-1 list-none p-0 m-0">
      {lines.map((line) => {
        const played = playedIccs !== null && line.iccs === playedIccs
        const pvMoves = [line.iccs, ...(line.pv?.map((s) => s.iccs) ?? [])].filter(Boolean)
        const isBest = line.rank === 1

        return (
          <li
            key={`${line.rank}-${line.iccs}`}
            className={`rank-row flex items-center gap-2 px-2 py-1 rounded text-xs transition-colors cursor-pointer border ${
              played
                ? 'is-played bg-cinnabar/10 border-cinnabar/30 font-medium'
                : isBest
                ? 'is-best bg-paper-0 border-hairline-strong shadow-xs'
                : 'bg-paper-2/40 hover:bg-paper-2/80 border-hairline/60'
            }`}
            title={`${line.iccs} · ${line.depth} 层 · ${compactNumber(line.nodes)} 节点 · ${seconds(
              line.time,
            )} · 鼠标悬停预览盘面`}
            onMouseEnter={() => {
              ui.handlePreviewBoard(null, pvMoves, null)
            }}
            onMouseLeave={() => {
              ui.handlePreviewBoard(null, [], null)
            }}
          >
            <span
              className={`rank-no font-num text-[11px] w-4 text-center ${
                isBest ? 'text-cinnabar font-bold' : 'text-ink-mute'
              }`}
            >
              {line.rank}
            </span>
            <span className="rank-cn font-medium text-ink-1 flex-1">
              {line.chinese || line.iccs}
            </span>
            <span className="rank-score font-num text-[11px] text-ink-2 tabular-nums">
              {boundMark(line.bound)}
              {scoreText(line.eval_red, line.mate ? line.mate_in : null)}
            </span>
            <span className="rank-depth font-num text-[10.5px] text-ink-mute">{line.depth}层</span>

            {played && (
              <span className="rank-flag text-[10px] font-medium text-cinnabar bg-cinnabar/15 px-1.5 py-0.2 rounded">
                你走的
              </span>
            )}

            {withPv && isBest && line.pv.length > 1 && (
              <span
                className="rank-pv hidden sm:inline-flex items-center gap-1 text-[11px] text-ink-mute ml-1 font-kai"
                aria-label="排名第一那手的后续"
              >
                {line.pv.slice(1, PV_SHOW + 1).map((step, i) => (
                  <em key={`${step.iccs}-${i}`} className="not-italic">
                    {step.chinese || step.iccs}
                  </em>
                ))}
              </span>
            )}
          </li>
        )
      })}
    </ul>
  )
}
