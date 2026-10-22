export interface ReplayCoachBarProps {
  turningCount: number
  hasVisualClues: boolean
  showClues: boolean
  sandboxSnap: boolean
  sandboxBusy: boolean
  canRetrySandbox: boolean
  onContinueGame: () => void
  onNextTurningPly: () => void
  onDrillSpecificGame?: () => void
  onToggleClues: () => void
  onEnterSandbox: () => void
  onRetrySandbox: () => void
  onExitSandbox: () => void
}

export function ReplayCoachBar({
  turningCount,
  hasVisualClues,
  showClues,
  sandboxSnap,
  sandboxBusy,
  canRetrySandbox,
  onContinueGame,
  onNextTurningPly,
  onDrillSpecificGame,
  onToggleClues,
  onEnterSandbox,
  onRetrySandbox,
  onExitSandbox,
}: ReplayCoachBarProps) {
  return (
    <div className="replay-coach-bar flex items-center gap-1.5 flex-wrap my-1.5">
      <button
        type="button"
        className="btn btn-ghost btn-sm text-xs px-2.5 py-1 rounded border border-hairline hover:bg-paper-1 cursor-pointer transition-colors"
        onClick={onContinueGame}
        title="从此局面开始，进入实战对局与引擎对练"
      >
        ⚔️ 从此局面接着下
      </button>

      {onDrillSpecificGame && (
        <button
          type="button"
          className="btn btn-primary btn-sm text-xs px-2.5 py-1 rounded cursor-pointer transition-colors !bg-cinnabar !text-white"
          onClick={onDrillSpecificGame}
          title="将整盘对局载入训练营进行三阶段全盘拆解与闯关特训"
        >
          🎯 入营拆解本局
        </button>
      )}

      {turningCount > 0 && (
        <button
          type="button"
          className="btn btn-ghost btn-sm text-xs px-2.5 py-1 rounded border border-hairline hover:bg-paper-1 cursor-pointer transition-colors"
          onClick={onNextTurningPly}
          title="一键跳转到本局关键失误/胜负手"
        >
          🔥 胜负手巡航 ({turningCount})
        </button>
      )}

      {hasVisualClues && !sandboxSnap && (
        <button
          type="button"
          className={`btn btn-ghost btn-sm text-xs px-2.5 py-1 rounded border border-hairline hover:bg-paper-1 cursor-pointer transition-colors ${
            showClues ? 'is-on !bg-paper-2 font-medium text-cinnabar' : ''
          }`}
          onClick={onToggleClues}
          title="在回放棋盘上高亮标出此手薄弱格与正解主攻路线"
        >
          {showClues ? '👁️ 收起法眼' : '👁️ 法眼点拨'}
        </button>
      )}

      {!sandboxSnap ? (
        <button
          type="button"
          className="btn btn-ghost btn-sm text-xs px-2.5 py-1 rounded border border-hairline hover:bg-paper-1 cursor-pointer transition-colors disabled:opacity-40"
          disabled={sandboxBusy}
          onClick={onEnterSandbox}
          title="在当前回放局面上直接落子试走新分支（只读沙盒，不改动原存档）"
        >
          🔀 盘上试走分支
        </button>
      ) : (
        <>
          <button
            type="button"
            className="btn btn-ghost btn-sm text-xs px-2.5 py-1 rounded border border-hairline hover:bg-paper-1 cursor-pointer transition-colors disabled:opacity-40"
            disabled={sandboxBusy || !canRetrySandbox}
            onClick={onRetrySandbox}
          >
            ↺ 重试此分支
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm text-xs px-2.5 py-1 rounded cursor-pointer"
            onClick={onExitSandbox}
          >
            ✕ 退出试走（回原谱）
          </button>
        </>
      )}
    </div>
  )
}
