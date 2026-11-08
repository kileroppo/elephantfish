import type { ReplayReply } from '../../types'
import { relativeTime, shortSide } from '../../lib/format'

export interface ReplayHeaderProps {
  head?: ReplayReply['game']
  seedGameId?: string
  onClose: () => void
  onExportGame?: (format: 'pgn' | 'jsonl') => void
}

export function ReplayHeader({ head, seedGameId, onClose, onExportGame }: ReplayHeaderProps) {
  const isRelay = head?.play_mode === 'relay'
  const isSetup = head?.source === 'setup'
  const modeTag = isSetup
    ? '排局'
    : isRelay
    ? `信使代下${head?.opponent_model ? ` · ${head.opponent_model}` : ''}`
    : '实战对战'

  return (
    <header className="flex items-center justify-between pb-3 mb-2 border-b border-hairline select-none shrink-0 gap-2">
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex items-center gap-2 shrink-0">
          <span className="w-6 h-6 rounded-lg bg-cinnabar text-white font-kai text-xs font-bold flex items-center justify-center shadow-xs">
            谱
          </span>
          <h2 className="text-sm sm:text-base font-bold text-ink-0 m-0">对局复盘台</h2>
        </div>
        <div className="font-num text-[11px] text-ink-3 hidden sm:flex items-center gap-2 m-0 truncate">
          <span
            className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
              isRelay
                ? 'text-indigo-500 bg-indigo-500/10'
                : isSetup
                ? 'text-fg-muted bg-fg-muted/10'
                : 'text-cinnabar bg-cinnabar/10'
            }`}
          >
            {modeTag}
          </span>
          <span>
            {head
              ? `引擎执${shortSide(head.engine_side)} · ${head.ply_count} 手 · ${relativeTime(head.updated_at)}`
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
        </div>
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
        {onExportGame && (
          <div className="flex items-center gap-1">
            <button
              type="button"
              className="h-6.5 px-2 text-[11px] font-medium rounded bg-paper-2 hover:bg-paper-3 text-ink-1 border border-hairline transition cursor-pointer flex items-center gap-1"
              onClick={() => onExportGame('pgn')}
              title="导出此局为标准 PGN 棋谱"
            >
              <span>📥</span>
              <span>PGN</span>
            </button>
            <button
              type="button"
              className="h-6.5 px-2 text-[11px] font-medium rounded bg-paper-2 hover:bg-paper-3 text-ink-1 border border-hairline transition cursor-pointer flex items-center gap-1"
              onClick={() => onExportGame('jsonl')}
              title="导出此局为训练 JSONL 格式（含每手 FEN、评分、PV 与正误诊断）"
            >
              <span>📥</span>
              <span>训练集</span>
            </button>
          </div>
        )}
        <button
          type="button"
          className="w-7 h-7 flex items-center justify-center text-ink-3 hover:text-ink-0 hover:bg-paper-2 rounded-full text-sm transition cursor-pointer ml-1"
          onClick={onClose}
          aria-label="关闭复盘台"
          title="返回主界面 (Esc)"
        >
          ✕
        </button>
      </div>
    </header>
  )
}
