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
    <div className="replay-coach-bar flex flex-col gap-2 my-1 shrink-0">
      {/* 第 1 栏：核心行动主按钮（双列均分对齐，干脆利落） */}
      <div className="grid grid-cols-2 gap-2">
        {onDrillSpecificGame ? (
          <button
            type="button"
            className="h-8 px-3 rounded-lg text-xs font-semibold bg-gradient-to-r from-cinnabar to-rose-600 hover:from-rose-600 hover:to-cinnabar text-white shadow-xs transition-all cursor-pointer border-0 flex items-center justify-center gap-1.5 active:scale-[0.98]"
            onClick={onDrillSpecificGame}
            title="将整局棋谱载入名师特训营，进行全盘三阶段因果拆解与变式大考"
          >
            <span>🎯</span>
            <span className="whitespace-nowrap">入营拆解本局</span>
          </button>
        ) : (
          <div />
        )}

        <button
          type="button"
          className="h-8 px-3 rounded-lg text-xs font-medium bg-paper-1 hover:bg-paper-2 text-ink-1 border border-hairline transition-all cursor-pointer flex items-center justify-center gap-1.5 active:scale-[0.98]"
          onClick={onContinueGame}
          title="从此局面开始，切入实战棋盘与引擎对练"
        >
          <span>⚔️</span>
          <span className="whitespace-nowrap">从此局面接着下</span>
        </button>
      </div>

      {/* 第 2 栏：战术巡航与微操工具胶囊条 */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {turningCount > 0 && (
          <button
            type="button"
            className="h-7 px-2.5 rounded-md text-[11.5px] font-medium bg-amber-500/10 hover:bg-amber-500/20 text-amber-900 border border-amber-300/60 transition cursor-pointer flex items-center gap-1"
            onClick={onNextTurningPly}
            title="一键循环跳转到本局所有胜负转折手/大漏着"
          >
            <span>🔥</span>
            <span>胜负手巡航</span>
            <span className="text-[10px] px-1 rounded-full bg-amber-500/25 font-bold font-num">
              {turningCount}
            </span>
          </button>
        )}

        {!sandboxSnap && (
          <button
            type="button"
            disabled={!hasVisualClues}
            className={`h-7 px-2.5 rounded-md text-[11.5px] font-medium transition flex items-center gap-1 border ${
              !hasVisualClues
                ? 'opacity-30 cursor-not-allowed text-ink-3 border-hairline'
                : showClues
                ? 'bg-cinnabar text-white border-cinnabar font-semibold shadow-xs cursor-pointer'
                : 'bg-paper-1 hover:bg-paper-2 text-ink-1 border-hairline cursor-pointer'
            }`}
            onClick={hasVisualClues ? onToggleClues : undefined}
            title={
              hasVisualClues
                ? '在回放棋盘上高亮显示当前局面的关键薄弱格与攻击线'
                : '当前局面无需法眼点拨'
            }
          >
            <span>👁️</span>
            <span>{showClues ? '收起法眼' : '法眼点拨'}</span>
          </button>
        )}

        {!sandboxSnap ? (
          <button
            type="button"
            className="h-7 px-2.5 rounded-md text-[11.5px] font-medium bg-paper-1 hover:bg-paper-2 text-ink-1 border border-hairline transition cursor-pointer disabled:opacity-40 flex items-center gap-1 ml-auto"
            disabled={sandboxBusy}
            onClick={onEnterSandbox}
            title="在当前回放局面上直接落子测试分支（沙盒模式，不破坏原谱）"
          >
            <span>🔀</span>
            <span>盘上试走分支</span>
          </button>
        ) : (
          <div className="flex items-center gap-1.5 ml-auto">
            <button
              type="button"
              className="h-7 px-2.5 rounded-md text-[11.5px] font-medium bg-paper-1 hover:bg-paper-2 text-ink-2 border border-hairline transition cursor-pointer disabled:opacity-40"
              disabled={sandboxBusy || !canRetrySandbox}
              onClick={onRetrySandbox}
              title="重新回到进入沙盒时的分支起点"
            >
              ↺ 重摆此分支
            </button>
            <button
              type="button"
              className="h-7 px-2.5 rounded-md text-[11.5px] font-semibold bg-emerald-600 hover:bg-emerald-700 text-white transition cursor-pointer border-0 shadow-xs"
              onClick={onExitSandbox}
              title="退出沙盒，返回原对局记录"
            >
              ✕ 退出试走
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
