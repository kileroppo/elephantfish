import { createPortal } from 'react-dom'
import type { GameSnapshot, MoveTactics, VisualClues } from '../../types'
import { useUIContext } from '../../context/UIContext'

export interface CoachInterruptCardProps {
  show: boolean
  lastHumanMove: GameSnapshot['records'][number] | null
  tactics: MoveTactics | null
  cluesActive: boolean
  onUndo?: () => void
  onToggleClues?: (clues: VisualClues | null) => void
  onOpenDrill?: () => void
  onOpenThreatHelper: () => void
  onDismiss: () => void
  onMuteThisGame?: () => void
  onPreviewBoard: (
    overrideGame: GameSnapshot | null,
    pv: string[],
    clues: VisualClues | null,
  ) => void
}

export function CoachInterruptCard({
  show,
  lastHumanMove,
  tactics,
  onUndo,
  onOpenDrill,
  onOpenThreatHelper,
  onDismiss,
  onMuteThisGame,
  onPreviewBoard,
}: CoachInterruptCardProps) {
  const ui = useUIContext()

  if (!show || !tactics || !lastHumanMove || ui.drillOpen || !!ui.replay) return null

  // 严禁使用带有 translateX(-50%) 的居中动画，防止卡片向左漂移出屏幕
  // 在桌面端固定在屏幕左下角（24px），展开左侧栏时智能靠右（284px），完全远离中央棋盘（棋盘在 700px+）
  const isLargeScreen = typeof window !== 'undefined' ? window.innerWidth >= 1024 : true
  const leftPx = ui.railL && !ui.zenMode ? 284 : 24

  const cardNode = (
    <div
      className={`fixed bottom-4 lg:bottom-6 z-[9999] shadow-2xl p-4 rounded-xl border bg-paper-0/98 backdrop-blur-md select-none transition-opacity duration-200 ${
        tactics.severity === 'critical'
          ? 'border-cinnabar shadow-red-950/20 ring-1 ring-cinnabar/30'
          : 'border-amber-400 shadow-amber-950/15 ring-1 ring-amber-400/30'
      }`}
      role="region"
      aria-label="师傅扶手关键手点拨"
      data-coach-interrupt=""
      style={{
        left: isLargeScreen ? `${leftPx}px` : '16px',
        right: isLargeScreen ? 'auto' : '16px',
        width: isLargeScreen ? '380px' : 'auto',
        maxWidth: 'calc(100vw - 32px)',
        transform: 'none', // 彻底切断任何旧 css 对 translateX 的影响，杜绝漂移
      }}
    >
      <div className="flex items-center justify-between gap-2 flex-wrap mb-2 pb-1.5 border-b border-hairline relative">
        <span className="inline-flex items-center px-2 py-0.5 rounded text-[11.5px] font-bold text-cinnabar bg-[var(--cinnabar-wash)] border border-[var(--cinnabar-edge)]">
          ⚠️ 走错失先 · #{tactics.motif_label}
        </span>
        <div className="flex items-center gap-2">
          <span className="text-xs text-ink-3 font-num">
            第 {lastHumanMove.ply} 手「{lastHumanMove.chinese}」
            {lastHumanMove.review?.loss
              ? `（约亏 ${(lastHumanMove.review.loss / 100).toFixed(1)} 个兵）`
              : ''}
          </span>
          <button
            type="button"
            className="w-6 h-6 rounded-full flex items-center justify-center text-ink-3 hover:text-ink-0 hover:bg-paper-2 text-sm transition-colors cursor-pointer"
            onClick={onDismiss}
            title="关闭提示并继续对局"
            aria-label="关闭提示"
          >
            ✕
          </button>
        </div>
      </div>

      <p className="text-xs text-ink-1 leading-relaxed my-2">
        {tactics.coach_summary}
      </p>

      <div className="flex items-center gap-2 flex-wrap mt-2.5">
        {onUndo && (
          <button
            type="button"
            className="btn btn-primary btn-sm min-h-8 h-8 px-3 text-xs leading-none rounded cursor-pointer shadow-sm hover:scale-[1.02] active:scale-95 transition-all"
            onClick={onUndo}
            onMouseEnter={() => {
              if (tactics.visual_clues?.best_move) {
                onPreviewBoard(null, [tactics.visual_clues.best_move], null)
              }
            }}
            onMouseLeave={() => {
              onPreviewBoard(null, [], null)
            }}
            title={
              tactics.visual_clues?.best_move
                ? `悬停预览正解「${tactics.visual_clues.best_move}」· 点击撤回重走`
                : '撤回并重试'
            }
          >
            ↺ 悔棋重走这步
          </button>
        )}
        <button
          type="button"
          className="btn btn-ghost btn-sm min-h-8 h-8 px-2.5 text-xs leading-none rounded cursor-pointer border border-hairline hover:bg-paper-1 hover:border-hairline-strong transition-colors"
          onClick={onOpenThreatHelper}
        >
          🎬 动画看怎么吃亏
        </button>
        {onOpenDrill && (
          <button
            type="button"
            className="btn btn-ghost btn-sm min-h-8 h-8 px-2.5 text-xs leading-none rounded cursor-pointer border border-hairline hover:bg-paper-1 transition-colors"
            onClick={onOpenDrill}
          >
            🎯 练同类题
          </button>
        )}
        <div className="flex items-center gap-2 ml-auto">
          {onMuteThisGame && (
            <button
              type="button"
              className="text-[11.5px] text-ink-4 hover:text-cinnabar transition-colors cursor-pointer bg-transparent border-0 p-0 underline decoration-dotted underline-offset-2"
              onClick={onMuteThisGame}
              title="关闭当前模式走错弹窗提醒，保持专注静默记录"
            >
              本局不再提醒
            </button>
          )}
          <button
            type="button"
            className="btn btn-ghost btn-sm min-h-8 h-8 px-2 text-xs leading-none rounded cursor-pointer text-ink-3 hover:text-ink-1 hover:bg-paper-2 transition-colors"
            onClick={onDismiss}
          >
            忽略继续下
          </button>
        </div>
      </div>
    </div>
  )

  return typeof document !== 'undefined' ? createPortal(cardNode, document.body) : cardNode
}
