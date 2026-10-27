import type { ReplayReply } from '../../types'
import { describeSource } from '../../lib/replay'
import { relativeTime, shortSide } from '../../lib/format'

export interface ReplayHeaderProps {
  head?: ReplayReply['game']
  seedGameId?: string
  onClose: () => void
}

export function ReplayHeader({ head, seedGameId, onClose }: ReplayHeaderProps) {
  return (
    <header className="flex items-center justify-between pb-3 mb-2 border-b border-hairline select-none shrink-0">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="w-6 h-6 rounded-lg bg-cinnabar text-white font-kai text-xs font-bold flex items-center justify-center shadow-xs">
            谱
          </span>
          <h2 className="text-sm sm:text-base font-bold text-ink-0 m-0">对局复盘台</h2>
        </div>
        <p className="font-num text-[11px] text-ink-3 hidden sm:flex items-center gap-2 m-0">
          <span>
            {head
              ? `${describeSource(head.source)} · 引擎执${shortSide(head.engine_side)} · ` +
                `${head.ply_count} 手 · ${relativeTime(head.updated_at)}`
              : seedGameId
                ? `对局 ID: ${seedGameId}`
                : '对局历史'}
          </span>

          {head?.state && head.state !== 'playing' && (
            <span className="text-[11px] px-2 py-0.5 rounded-full font-medium bg-paper-2 text-ink-1 border border-hairline/60">
              {head.winner ? `${shortSide(head.winner)}胜` : '和局'}
              {head.reason ? ` · ${head.reason}` : ''}
            </span>
          )}
        </p>
      </div>
      <button
        type="button"
        className="w-7 h-7 flex items-center justify-center text-ink-3 hover:text-ink-0 hover:bg-paper-2 rounded-full text-sm transition cursor-pointer"
        onClick={onClose}
        aria-label="关闭复盘台"
        title="返回主界面 (Esc)"
      >
        ✕
      </button>
    </header>
  )
}
