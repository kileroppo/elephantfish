import { createPortal } from 'react-dom'
import { useRef } from 'react'
import type { GameSnapshot, MoveTactics, VisualClues } from '../../types'
import { useUIContext } from '../../context/UIContext'
import { useExitPhase } from '../../hooks/useExitPhase'

/** 退场时长：退场动画与 useExitPhase 的卸载定时器共用这一个常量，动画播完才卸载 */
const EXIT_MS = 170
/** 入场时长：落章 220ms，缓动 --ease-spring（tokens.css 的印章类动画惯用曲线） */
const ENTER_MS = 220

/* 「落章」编舞：入场如印章自上 8px 落下、微放大 1.02 收拢到 1（spring 带一点回弹）；
   退场轻轻下沉 6px、缩到 0.98 散掉。keyframes 只作用于内层卡片，外层定位壳的
   transform 恒为 none，动画与定位彻底隔离。 */
const STAMP_KEYFRAMES = `
@keyframes coach-interrupt-stamp-in {
  from { opacity: 0; transform: translateY(-8px) scale(1.02); }
  to   { opacity: 1; transform: translateY(0) scale(1); }
}
@keyframes coach-interrupt-stamp-out {
  from { opacity: 1; transform: translateY(0) scale(1); }
  to   { opacity: 0; transform: translateY(6px) scale(0.98); }
}
@media (prefers-reduced-motion: reduce) {
  [data-coach-interrupt] { animation: none !important; }
}
`.trim()

/** 退场那几百毫秒里卡片还要照常渲染，记住最后一次真正展示过的内容 */
interface InterruptContent {
  tactics: MoveTactics
  move: GameSnapshot['records'][number]
}

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

  // 挂载/退场相位（同 App/Overlays 的 useExitPhase 模式）：业务可见条件折叠成
  // visible，变 false 时不立刻卸载，先播 170ms 退场再由钩子收尾卸载；退场中重开
  // 会立刻清掉 leaving 打断退场。
  const hasContent = !!tactics && !!lastHumanMove
  const visible = show && hasContent && !ui.drillOpen && !ui.replay
  const [mounted, leaving] = useExitPhase(visible, EXIT_MS)

  // 退场窗口里 tactics/lastHumanMove 可能已被换掉（用户落子、悔棋都会动 records），
  // 记住最后一次真正展示过的内容，退场期间照旧渲染它——否则退场动画没内容可播，
  // 又是一帧硬切。
  const lastShownRef = useRef<InterruptContent | null>(null)
  if (visible && tactics && lastHumanMove) {
    lastShownRef.current = { tactics, move: lastHumanMove }
  }

  if (!mounted) return null

  const shown =
    visible && tactics && lastHumanMove ? { tactics, move: lastHumanMove } : lastShownRef.current
  if (!shown) return null
  const { tactics: shownTactics, move: shownMove } = shown

  // 严禁使用带有 translateX(-50%) 的居中动画，防止卡片向左漂移出屏幕
  // 在桌面端固定在屏幕左下角（24px），常驻控制岛在场时智能靠右（284px），完全远离中央棋盘（棋盘在 700px+）
  const isLargeScreen = typeof window !== 'undefined' ? window.innerWidth >= 1024 : true
  const leftPx = !ui.zenMode ? 284 : 24

  const cardNode = (
    <div
      /* 外层只当定位壳：fixed 定位 + 尺寸 + transform:none，不参与动画 */
      className={`fixed bottom-4 lg:bottom-6 z-[9999]${leaving ? ' pointer-events-none' : ''}`}
      style={{
        left: isLargeScreen ? `${leftPx}px` : '16px',
        right: isLargeScreen ? 'auto' : '16px',
        width: isLargeScreen ? '380px' : 'auto',
        maxWidth: 'calc(100vw - 32px)',
        transform: 'none', // 彻底切断任何旧 css 对 translateX 的影响，杜绝漂移
      }}
    >
      <style>{STAMP_KEYFRAMES}</style>
      {/* 内层卡片承载观感与落章动画：translate/scale 只动这一层，动画结束回到
          关键帧终态，不污染外层定位；退场期间 pointer-events 已在外层切断 */}
      <div
        className={`shadow-2xl p-4 rounded-xl border bg-paper-0/98 backdrop-blur-md select-none ${
          shownTactics.severity === 'critical'
            ? 'border-cinnabar shadow-red-950/20 ring-1 ring-cinnabar/30'
            : 'border-amber-400 shadow-amber-950/15 ring-1 ring-amber-400/30'
        }`}
        role="region"
        aria-label="师傅扶手关键手点拨"
        data-coach-interrupt=""
        style={{
          animation: leaving
            ? `coach-interrupt-stamp-out ${EXIT_MS}ms var(--ease-out) forwards`
            : `coach-interrupt-stamp-in ${ENTER_MS}ms var(--ease-spring) both`,
        }}
      >
        <div className="flex items-center justify-between gap-2 flex-wrap mb-2 pb-1.5 border-b border-hairline relative">
          <span className="inline-flex items-center px-2 py-0.5 rounded text-[11.5px] font-bold text-cinnabar bg-[var(--cinnabar-wash)] border border-[var(--cinnabar-edge)]">
            ⚠️ 走错失先 · #{shownTactics.motif_label}
          </span>
          <div className="flex items-center gap-2">
            <span className="text-xs text-ink-3 font-num">
              第 {shownMove.ply} 手「{shownMove.chinese}」
              {shownMove.review?.loss
                ? `（约亏 ${(shownMove.review.loss / 100).toFixed(1)} 个兵）`
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
          {shownTactics.coach_summary}
        </p>
  
        <div className="flex items-center gap-2 flex-wrap mt-2.5">
          {onUndo && (
            <button
              type="button"
              className="btn btn-primary btn-sm min-h-8 h-8 px-3 text-xs leading-none rounded cursor-pointer shadow-sm hover:scale-[1.02] active:scale-95 transition-all"
              onClick={onUndo}
              onMouseEnter={() => {
                if (shownTactics.visual_clues?.best_move) {
                  onPreviewBoard(null, [shownTactics.visual_clues.best_move], null)
                }
              }}
              onMouseLeave={() => {
                onPreviewBoard(null, [], null)
              }}
              title={
                shownTactics.visual_clues?.best_move
                  ? `悬停预览正解「${shownTactics.visual_clues.best_move}」· 点击撤回重走`
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
    </div>
  )

  return typeof document !== 'undefined' ? createPortal(cardNode, document.body) : cardNode
}
