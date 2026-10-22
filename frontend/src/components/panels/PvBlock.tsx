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
    <div className="pv-block flex flex-col gap-2 p-3 rounded-2xl bg-paper-0/95 border border-hairline/80 shadow-2xs select-none">
      <div className="flex items-center justify-between mb-0.5">
        <h3 className="text-xs font-bold text-ink-1">推荐后续走向</h3>
        <span className="pv-note text-[11px] text-ink-3">
          {pvText.length ? `后续 ${pvText.length} 步 · 悬停探查` : ''}
        </span>
      </div>

      {pvText.length ? (
        <ol className="pv-list flex flex-wrap gap-1.5 list-none p-0 m-0">
          {pvText.map((step, i) => {
            const isRed = i % 2 === 0
            return (
              <li
                key={`${step.iccs}-${i}`}
                className={`pv-step flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs transition-all duration-150 cursor-pointer border ${
                  isRed
                    ? 'pv-red bg-rose-50/80 hover:bg-rose-100 text-piece-red border-rose-200/80 shadow-3xs hover:-translate-y-0.5 hover:shadow-xs'
                    : 'pv-black bg-paper-1 hover:bg-paper-2 text-ink-1 border-hairline/80 shadow-3xs hover:-translate-y-0.5 hover:shadow-xs'
                }`}
                onMouseEnter={() => {
                  const moves = pvText.slice(i).map((s) => s.iccs).filter(Boolean)
                  ui.handlePreviewBoard(null, moves, null)
                }}
                onMouseLeave={() => {
                  ui.handlePreviewBoard(null, [], null)
                }}
                title={`悬停预览该步盘面走向：${step.chinese || step.iccs}`}
              >
                <span className="pv-num font-num text-[10px] opacity-60 font-bold">{i + 1}</span>
                <span className="pv-cn font-semibold">{step.chinese || step.iccs}</span>
              </li>
            )
          })}
        </ol>
      ) : (
        <p className="hint text-xs text-ink-3 font-kai py-1.5 m-0 leading-relaxed">
          落子后此处将展示名师与引擎算出的后续关键招法走向。
        </p>
      )}
    </div>
  )
}
