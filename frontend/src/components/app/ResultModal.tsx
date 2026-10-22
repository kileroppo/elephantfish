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
  const winner = game.status.winner
  const isDraw = winner === null
  const isHumanWin = winner !== null && winner !== game.engine_side

  const humanRecords = (game.records ?? []).filter((r) => r.by !== 'engine')
  const goodCount = humanRecords.filter((r) => r.review?.rank === 1).length
  const badRecords = humanRecords.filter(
    (r) => r.review && (r.review.status === 'outside' || (r.review.loss ?? 0) >= 90),
  )

  return (
    <div
      className={`absolute inset-0 z-30 flex items-center justify-center p-4 bg-ink-0/35 backdrop-blur-xs transition-opacity duration-200 ${
        overLeaving ? 'opacity-0 pointer-events-none' : 'opacity-100'
      }`}
    >
      {/* 胜负底纹大印章 */}
      <div
        className="absolute w-36 h-36 rounded-full border-4 border-dashed border-cinnabar/20 flex items-center justify-center pointer-events-none -rotate-12 select-none"
        aria-hidden="true"
      >
        <span className="text-7xl font-kai font-bold text-cinnabar/20">
          {isDraw ? '和' : isHumanWin ? '胜' : '负'}
        </span>
      </div>

      {/* 结果卡片 */}
      <div className="relative z-10 w-full max-w-[340px] max-h-[92%] overflow-y-auto bg-paper-0 border border-hairline-strong rounded-2xl p-5 sm:p-6 text-center shadow-2xl animate-in zoom-in-95 duration-200">
        <button
          type="button"
          className="absolute top-3.5 right-3.5 w-7 h-7 rounded-full flex items-center justify-center text-ink-3 hover:text-ink-1 hover:bg-paper-2 transition-colors text-sm"
          onClick={onClose}
          title="收起弹窗，仔细查看棋盘"
        >
          ✕
        </button>

        <span className="inline-block text-xs font-semibold uppercase tracking-wider text-cinnabar mb-1">
          {isDraw ? '和棋' : isHumanWin ? '您获胜了！' : '引擎获胜'}
        </span>

        <h2 className="text-xl font-bold font-display text-ink-0 mb-1">
          {game.status.reason || '对局结束'}
        </h2>

        <p className="text-xs text-ink-3 mb-1">
          共 {game.ply} 手 · 引擎应手 {engineMoves} 次
        </p>
        <p className="text-xs text-ink-mute mb-5">
          本局正着 {goodCount} 步 · 关键失先 {badRecords.length} 处
        </p>

        <div className="flex flex-wrap gap-2 justify-center">
          <button
            type="button"
            className="flex-1 min-w-[120px] py-2 px-3 rounded-lg bg-cinnabar hover:bg-cinnabar-bright text-paper-0 text-xs font-medium transition shadow-sm active:scale-95"
            onClick={onNewGame}
          >
            再来一局
          </button>
          <button
            type="button"
            className="flex-1 min-w-[120px] py-2 px-3 rounded-lg bg-paper-2 hover:bg-paper-3 text-ink-1 border border-hairline text-xs font-medium transition active:scale-95"
            onClick={onReplayCurrent}
            title="打开复盘台，自动定位到本局关键胜负手"
          >
            🔍 复盘本局
          </button>
          {badRecords.length > 0 && onOpenDrillAt && (
            <button
              type="button"
              className="w-full py-1.5 px-3 rounded-lg bg-paper-1 hover:bg-paper-2 text-ink-1 border border-hairline text-xs font-medium transition active:scale-95 flex items-center justify-center gap-1.5"
              onClick={() => {
                onClose()
                onOpenDrillAt(undefined, game.game_id ?? undefined)
              }}
              title="将本局拆解为开局、中局、残局三阶段，按序重练胜负手"
            >
              <span>⚔️ 拆解本局特训</span>
              <span className="text-cinnabar font-semibold">({badRecords.length}处失先)</span>
            </button>
          )}
          <button
            type="button"
            className="py-1 px-3 text-ink-3 hover:text-ink-1 text-xs transition"
            onClick={onUndoRound}
          >
            退回一步
          </button>
          <button
            type="button"
            className="py-1 px-3 text-ink-3 hover:text-ink-1 text-xs transition"
            onClick={onClose}
          >
            查看残局
          </button>
        </div>
      </div>
    </div>
  )
}
