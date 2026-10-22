import { useUIContext } from '../../context/UIContext'

export interface PvStepItem {
  iccs: string
  chinese: string
}

export interface PvBlockProps {
  pvText: PvStepItem[]
}

export function PvBlock({ pvText }: PvBlockProps) {
  const ui = useUIContext()

  return (
    <div className="pv-block flex flex-col gap-1.5 p-2.5 rounded bg-paper-1/60 border border-hairline/80">
      <div className="flex items-baseline justify-between mb-0.5">
        <h3 className="text-xs font-semibold text-ink-2">主变</h3>
        <span className="pv-note text-[10.5px] text-ink-mute">
          {pvText.length ? `接下来 ${pvText.length} 步 (悬停看盘面)` : ''}
        </span>
      </div>

      {pvText.length ? (
        <ol className="pv-list flex flex-wrap gap-1.5 list-none p-0 m-0">
          {pvText.map((step, i) => {
            const isRed = i % 2 === 0
            return (
              <li
                key={`${step.iccs}-${i}`}
                className={`pv-step flex items-center gap-1 px-2 py-0.5 rounded text-xs transition-colors cursor-pointer border ${
                  isRed
                    ? 'pv-red bg-rose-50/70 hover:bg-rose-100/80 text-piece-red border-rose-200/60'
                    : 'pv-black bg-paper-2 hover:bg-paper-3 text-ink-1 border-hairline'
                }`}
                onMouseEnter={() => {
                  const moves = pvText.slice(i).map((s) => s.iccs).filter(Boolean)
                  ui.handlePreviewBoard(null, moves, null)
                }}
                onMouseLeave={() => {
                  ui.handlePreviewBoard(null, [], null)
                }}
                title={`悬停在棋盘上预览该步后续走法：${step.chinese || step.iccs}`}
              >
                <span className="pv-num font-num text-[10px] opacity-60">{i + 1}</span>
                <span className="pv-cn font-medium">{step.chinese || step.iccs}</span>
                <span className="pv-iccs font-num text-[10px] opacity-70 ml-0.5">
                  {step.iccs}
                </span>
              </li>
            )
          })}
        </ol>
      ) : (
        <p className="hint text-xs text-ink-mute font-kai py-2 m-0">
          引擎出招后这里会显示它算到的后续几步。
        </p>
      )}
    </div>
  )
}
