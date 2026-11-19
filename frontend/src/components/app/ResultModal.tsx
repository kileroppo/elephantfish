import { useEffect, useRef } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { GameSnapshot } from '../../types'

interface ResultModalProps {
  game: GameSnapshot
  overLeaving: boolean
  engineMoves: number
  onClose: () => void
  onNewGame: () => void
  onReplayCurrent: () => void
  onUndoRound: () => void
  onOpenDrillAt?: (motif?: string, gameId?: string) => void
}

export function ResultModal({
  game,
  overLeaving,
  engineMoves,
  onClose,
  onNewGame,
  onReplayCurrent,
  onUndoRound,
  onOpenDrillAt,
}: ResultModalProps) {
  const cardRef = useRef<HTMLDivElement>(null)

  const winner = game.status.winner
  const isDraw = winner === null
  const isHumanWin = winner !== null && winner !== game.engine_side
  const isMate = game.status.state === 'checkmate'

  const humanRecords = (game.records ?? []).filter((r) => r.by !== 'engine')
  const goodCount = humanRecords.filter((r) => r.review?.rank === 1).length
  const badRecords = humanRecords.filter(
    (r) => r.review && (r.review.status === 'outside' || (r.review.loss ?? 0) >= 90),
  )

  // ---- 焦点合约（修 F12：title 承诺了 (Esc)，Esc 就必须能关）----
  // 打开即聚焦卡片（读屏随之播报对局结果）；Esc 关；关闭后焦点归还打开前
  // 那个元素。onClose 只取挂载时那一个闭包 —— 它最终只是 setDismissedOver(true)，
  // state setter 恒定，不存在读到过期状态的问题。
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    const raf = requestAnimationFrame(() => cardRef.current?.focus())
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('keydown', onKey)
      prev?.focus?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 焦点留在仪式里：Tab 在卡片内的出口之间循环，不往背后的棋盘与顶栏跑
  const onCardKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab') return
    const card = cardRef.current
    if (!card) return
    const stops = Array.from(card.querySelectorAll<HTMLElement>('button:not([disabled])'))
    if (stops.length === 0) return
    const first = stops[0]
    const last = stops[stops.length - 1]
    const active = document.activeElement
    if (e.shiftKey && (active === first || active === card)) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && active === last) {
      e.preventDefault()
      first.focus()
    }
  }

  // ---- 仪式文案：kicker 判词 + 教练点睛 + 棋理（服务端 reason）+ 统计注脚 ----
  const kicker = isDraw
    ? '和棋'
    : isHumanWin
      ? isMate
        ? '绝杀得手'
        : '胜局已定'
      : isMate
        ? '被绝杀'
        : '憾负'

  const coachLine = isDraw
    ? '这一局，谁也没能赢下谁。想赢，再来。'
    : isHumanWin
      ? '该断则断。这一局，你断得干净。'
      : '胜负手往往只有一两步，复盘台里都标好了。'

  // 胜负有画面差异：绝杀胜盖朱砂印，被绝杀 / 失利与和棋盖墨印
  const sealChar = isDraw ? '和' : isHumanWin ? '胜' : '负'
  const winnerClass = isDraw
    ? 'winner-none'
    : isHumanWin
      ? winner === 'red'
        ? 'winner-red'
        : 'winner-black'
      : 'winner-engine'

  return (
    <div className={`result-veil select-none ${winnerClass}${overLeaving ? ' is-leaving' : ''}`}>
      {/* 盖印：从上方落定、回弹，墨渍环随之散开（时序见 result-modal.css） */}
      <div className="seal" aria-hidden="true">
        <span>{sealChar}</span>
      </div>

      <div
        ref={cardRef}
        className="result-card"
        role="dialog"
        aria-modal="true"
        aria-label="对局结果"
        tabIndex={-1}
        onKeyDown={onCardKeyDown}
      >
        <button
          type="button"
          className="modal-close-btn"
          onClick={onClose}
          title="收起弹窗，查看棋盘 (Esc)"
          aria-label="收起弹窗，查看棋盘"
        >
          ✕
        </button>

        <span className="result-kicker">{kicker}</span>
        <h2>{game.status.reason || '对局结束'}</h2>
        <p className="result-coach">{coachLine}</p>

        {/* 本局统计：降格为仪式的注脚，一行带过 */}
        <p className="result-stats">
          共 <b>{game.ply}</b> 手 · 引擎应手 <b>{engineMoves}</b> 次 · 正着 <b>{goodCount}</b> 步
          {badRecords.length > 0 && (
            <>
              {' · '}
              <span className="is-bad">
                关键失先 <b>{badRecords.length}</b> 处
              </span>
            </>
          )}
        </p>

        <div className="result-actions">
          <div className="result-actions-row">
            <button type="button" className="btn btn-primary" onClick={onNewGame}>
              再来一局
            </button>
            <button
              type="button"
              className="btn"
              onClick={onReplayCurrent}
              title="打开复盘台，自动定位到本局关键胜负手"
            >
              复盘本局
            </button>
          </div>

          {badRecords.length > 0 && onOpenDrillAt && (
            <button
              type="button"
              className="btn wide"
              onClick={() => {
                onClose()
                onOpenDrillAt(undefined, game.game_id ?? undefined)
              }}
              title="按序重练本局关键胜负手"
            >
              特训失误点 · <b>{badRecords.length}</b> 处
            </button>
          )}

          <div className="result-foot">
            <button type="button" onClick={onUndoRound}>
              退回一步
            </button>
            <span aria-hidden="true">·</span>
            <button type="button" onClick={onClose}>
              看盘面
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
