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
    <header className="sheet-head replay-head flex items-center justify-between pb-3 mb-3 border-b border-hairline">
      <div>
        <h2 className="text-base font-bold text-ink-0 m-0">复盘台</h2>
        <p className="replay-sub font-num text-[11px] text-ink-3 mt-1 m-0">
          {head
            ? `${describeSource(head.source)} ${head.game_id} · 引擎执${shortSide(head.engine_side)} · ` +
              `${head.ply_count} 手 · ${relativeTime(head.updated_at)}`
            : seedGameId
              ? `读存档 ${seedGameId} 中的那一局`
              : '读存档里的那一局'}
        </p>
      </div>
      <button
        type="button"
        className="icon-btn text-ink-3 hover:text-ink-0 text-base w-7 h-7 flex items-center justify-center rounded hover:bg-paper-2 transition-colors cursor-pointer"
        onClick={onClose}
        aria-label="关闭复盘台"
      >
        ✕
      </button>
    </header>
  )
}
