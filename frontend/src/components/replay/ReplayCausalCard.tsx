import type { causalBreakdown } from '../../lib/format'

export interface ReplayCausalCardProps {
  causal: ReturnType<typeof causalBreakdown> | null
  pvMode: 'none' | 'best' | 'refute'
  onTogglePvMode: (mode: 'best' | 'refute') => void
}

export function ReplayCausalCard({
  causal,
  pvMode,
  onTogglePvMode,
}: ReplayCausalCardProps) {
  if (!causal || (!causal.bestMove && !causal.punishMove)) return null

  return (
    <div className="causal-card my-2 p-2.5 sm:p-3 rounded-lg bg-paper-1 border border-hairline-strong flex flex-col gap-1.5 shadow-xs">
      <div className="flex items-center justify-between flex-wrap gap-1.5">
        <span className="text-[13px] font-semibold text-ink-0">
          因果拆解与双轨演播
        </span>
        <div className="flex items-center gap-1.5">
          {causal.bestPv.length > 0 && (
            <button
              type="button"
              className={`btn btn-sm text-xs px-2.5 py-1 rounded cursor-pointer transition-colors ${
                pvMode === 'best'
                  ? 'btn-primary !bg-cinnabar !text-white'
                  : 'btn-ghost border border-hairline hover:bg-paper-2'
              }`}
              onClick={() => onTogglePvMode('best')}
              title="在棋盘上高亮演练正解攻杀路线"
            >
              {pvMode === 'best' ? '收起正解线' : '正解线演示'}
            </button>
          )}
          {causal.refutePv.length > 0 && (
            <button
              type="button"
              className={`btn btn-sm text-xs px-2.5 py-1 rounded cursor-pointer transition-colors ${
                pvMode === 'refute'
                  ? 'btn-danger !bg-red-600 !text-white'
                  : 'btn-ghost border border-hairline hover:bg-paper-2'
              }`}
              onClick={() => onTogglePvMode('refute')}
              title="在棋盘上高亮演练走错后对方反扑反击路线"
            >
              {pvMode === 'refute' ? '收起受罚线' : '受罚反扑演示'}
            </button>
          )}
        </div>
      </div>

      {causal.explanation && (
        <p className="m-0 text-xs leading-relaxed text-ink-2 opacity-95">
          {causal.explanation}
        </p>
      )}

      {pvMode === 'best' && causal.bestPv.length > 0 && (
        <div className="flex items-center gap-1 flex-wrap text-[11px] mt-0.5">
          <span className="px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-700 font-semibold text-[10.5px]">
            正解演进
          </span>
          {causal.bestPv.slice(0, 6).map((st, i) => (
            <span
              key={i}
              className="px-1.5 py-0.5 rounded bg-paper-2 border border-hairline text-ink-2 text-[10.5px]"
            >
              {st.chinese || st.iccs}
            </span>
          ))}
        </div>
      )}

      {pvMode === 'refute' && causal.refutePv.length > 0 && (
        <div className="flex items-center gap-1 flex-wrap text-[11px] mt-0.5">
          <span className="px-1.5 py-0.5 rounded bg-red-500/15 text-red-600 font-semibold text-[10.5px]">
            受罚反击
          </span>
          {causal.refutePv.slice(0, 6).map((st, i) => (
            <span
              key={i}
              className="px-1.5 py-0.5 rounded bg-paper-2 border border-hairline text-ink-2 text-[10.5px]"
            >
              {st.chinese || st.iccs}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
