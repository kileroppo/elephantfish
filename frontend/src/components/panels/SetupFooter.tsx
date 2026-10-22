export interface SetupFooterProps {
  turn: 'red' | 'black'
  engineSide: 'red' | 'black'
  valid: boolean
  onTurnChange: (turn: 'red' | 'black') => void
  onEngineSideChange: (side: 'red' | 'black') => void
  onExitSetup: () => void
  onStartGame: () => void
}

export function SetupFooter({
  turn,
  engineSide,
  valid,
  onTurnChange,
  onEngineSideChange,
  onExitSetup,
  onStartGame,
}: SetupFooterProps) {
  return (
    <div className="setup-bottom-bar flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 pt-2 border-t border-hairline/60">
      <div className="setup-settings-box flex flex-col sm:flex-row items-start sm:items-center gap-3">
        <div className="setup-options flex items-center gap-4 flex-wrap">
          {/* 谁先走 */}
          <div className="option-group flex items-center gap-2">
            <span className="option-label text-xs text-ink-3 font-medium whitespace-nowrap">
              轮到走棋:
            </span>
            <div className="segmented-sm flex rounded border border-hairline bg-paper-2 p-0.5 gap-0.5">
              <button
                type="button"
                className={`seg-btn flex items-center gap-1.5 px-2.5 py-1 rounded-xs text-xs font-medium transition-colors cursor-pointer ${
                  turn === 'red'
                    ? 'is-active bg-paper-0 text-ink-0 font-semibold shadow-xs'
                    : 'text-ink-3 hover:text-ink-1'
                }`}
                onClick={() => onTurnChange('red')}
              >
                <span className="dot red-dot w-2 h-2 rounded-full bg-piece-red" />
                <span>轮到红方</span>
              </button>
              <button
                type="button"
                className={`seg-btn flex items-center gap-1.5 px-2.5 py-1 rounded-xs text-xs font-medium transition-colors cursor-pointer ${
                  turn === 'black'
                    ? 'is-active bg-paper-0 text-ink-0 font-semibold shadow-xs'
                    : 'text-ink-3 hover:text-ink-1'
                }`}
                onClick={() => onTurnChange('black')}
              >
                <span className="dot black-dot w-2 h-2 rounded-full bg-piece-black" />
                <span>轮到黑方</span>
              </button>
            </div>
          </div>

          {/* 引擎执子 */}
          <div className="option-group flex items-center gap-2">
            <span className="option-label text-xs text-ink-3 font-medium whitespace-nowrap">
              引擎执子:
            </span>
            <div className="segmented-sm flex rounded border border-hairline bg-paper-2 p-0.5 gap-0.5">
              <button
                type="button"
                className={`seg-btn px-2.5 py-1 rounded-xs text-xs font-medium transition-colors cursor-pointer ${
                  engineSide === 'red'
                    ? 'is-active bg-paper-0 text-ink-0 font-semibold shadow-xs'
                    : 'text-ink-3 hover:text-ink-1'
                }`}
                onClick={() => onEngineSideChange('red')}
              >
                执红（朝下）
              </button>
              <button
                type="button"
                className={`seg-btn px-2.5 py-1 rounded-xs text-xs font-medium transition-colors cursor-pointer ${
                  engineSide === 'black'
                    ? 'is-active bg-paper-0 text-ink-0 font-semibold shadow-xs'
                    : 'text-ink-3 hover:text-ink-1'
                }`}
                onClick={() => onEngineSideChange('black')}
              >
                执黑（朝下）
              </button>
            </div>
          </div>
        </div>

        <div className="setup-scenario-hint text-[11px] text-ink-mute">
          <span className="scenario-text">
            开局状态：引擎执{engineSide === 'red' ? '红' : '黑'}（朝下），
            {turn === engineSide
              ? '开局由引擎自动出招'
              : `开局轮到${turn === 'red' ? '红' : '黑'}方（请在盘面落子）`}
          </span>
        </div>
      </div>

      <div className="setup-action-btns flex items-center gap-2 justify-end">
        <button
          type="button"
          className="btn btn-ghost h-9 px-4 rounded text-xs font-medium bg-paper-2 hover:bg-paper-3 text-ink-1 border border-hairline transition-colors flex items-center justify-center cursor-pointer"
          onClick={onExitSetup}
          title="退出补棋模式，放弃未保存的摆子更改"
        >
          放弃并退出
        </button>
        <button
          type="button"
          className="btn btn-primary h-9 px-5 rounded text-xs font-semibold bg-cinnabar hover:bg-cinnabar-bright text-white transition-colors shadow-xs flex items-center justify-center cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed border-0"
          disabled={!valid}
          onClick={onStartGame}
          title={valid ? '载入该局面并开启新对局' : '请先修正盘面错误后再开局'}
        >
          确认并开始对局
        </button>
      </div>
    </div>
  )
}
