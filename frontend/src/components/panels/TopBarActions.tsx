export interface TopBarActionsProps {
  playMode: 'sparring' | 'relay'
  connected: boolean
  zenMode: boolean
  drillMode: boolean
  setupMode: boolean
  soundOn: boolean
  onTogglePlayMode?: () => void
  onRefresh: () => void
  onToggleZen?: () => void
  onToggleDrill: () => void
  onToggleSetup?: () => void
  onToggleSound: () => void
  onHelp: () => void
}

export function TopBarActions({
  playMode,
  connected,
  zenMode,
  drillMode,
  setupMode,
  soundOn,
  onTogglePlayMode: _onTogglePlayMode,
  onRefresh,
  onToggleZen,
  onToggleDrill,
  onToggleSetup,
  onToggleSound,
  onHelp,
}: TopBarActionsProps) {
  const isStandardSparring = !drillMode && !setupMode

  return (
    <nav className="topbar-actions flex items-center gap-1.5 md:gap-3 ml-auto select-none" aria-label="功能导航">
      {/* 1. 核心模式分段控件组（实战、精训营、排局补棋） */}
      <div className="mode-segmented inline-flex items-center p-0.5 bg-paper-2/90 rounded-lg border border-hairline text-xs shrink-0">
        <button
          type="button"
          className={`h-6 md:h-7 px-2 md:px-3 rounded-[6px] text-[11px] md:text-xs font-medium tracking-wide transition-all cursor-pointer border-0 flex items-center justify-center ${
            isStandardSparring
              ? 'bg-paper-0 text-cinnabar shadow-xs font-semibold'
              : 'bg-transparent text-ink-3 hover:text-ink-1'
          }`}
          onClick={() => {
            if (drillMode) onToggleDrill()
            if (setupMode && onToggleSetup) onToggleSetup()
          }}
          title="标准对弈实战"
        >
          <span className="hidden sm:inline">{playMode === 'relay' ? '信使代打' : '实战陪练'}</span>
          <span className="sm:hidden">{playMode === 'relay' ? '信使' : '实战'}</span>
        </button>

        <button
          type="button"
          className={`h-6 md:h-7 px-2 md:px-3 rounded-[6px] text-[11px] md:text-xs font-medium tracking-wide transition-all cursor-pointer border-0 flex items-center justify-center ${
            drillMode
              ? 'bg-paper-0 text-cinnabar shadow-xs font-semibold'
              : 'bg-transparent text-ink-3 hover:text-ink-1'
          }`}
          onClick={onToggleDrill}
          title={drillMode ? '退出精训营' : '进入精训营残局实战专题'}
        >
          <span className="hidden sm:inline">精训营</span>
          <span className="sm:hidden">精训</span>
        </button>

        {onToggleSetup && (
          <button
            type="button"
            className={`h-6 md:h-7 px-2 md:px-3 rounded-[6px] text-[11px] md:text-xs font-medium tracking-wide transition-all cursor-pointer border-0 flex items-center justify-center ${
              setupMode
                ? 'bg-paper-0 text-cinnabar shadow-xs font-semibold'
                : 'bg-transparent text-ink-3 hover:text-ink-1'
            }`}
            onClick={onToggleSetup}
            title={setupMode ? '退出排局补棋' : '进入自定义排局与补棋'}
          >
            补棋
          </button>
        )}
      </div>

      {/* 断线提示 */}
      {!connected && (
        <button
          type="button"
          className="h-6 md:h-7 px-2 md:px-2.5 rounded-md text-[11px] md:text-xs tracking-wide text-cinnabar bg-cinnabar/10 border border-cinnabar/30 transition-colors whitespace-nowrap cursor-pointer flex items-center justify-center font-medium"
          onClick={onRefresh}
          title="服务未连接，点击重试"
        >
          重连
        </button>
      )}

      {/* 2. 右侧系统辅助与视听工具组 */}
      <div className="tools-group inline-flex items-center gap-1 pl-1 md:pl-2 border-l border-hairline shrink-0">
        {onToggleZen && (
          <button
            type="button"
            className={`h-6 md:h-7 px-1.5 md:px-2 rounded-md text-[11px] md:text-xs tracking-wide transition-all whitespace-nowrap cursor-pointer hidden sm:flex items-center justify-center border ${
              zenMode
                ? 'text-cinnabar border-cinnabar/40 bg-cinnabar/5 font-medium'
                : 'text-ink-2 hover:text-ink-0 border-transparent hover:bg-paper-2'
            }`}
            onClick={onToggleZen}
            title={zenMode ? '退出专注 (Z / Esc)' : '专注模式 (快捷键 Z)'}
            aria-pressed={zenMode}
          >
            {zenMode ? '退出专注' : '专注'}
          </button>
        )}

        <button
          type="button"
          className={`h-6 md:h-7 px-1.5 md:px-2 rounded-md text-[11px] md:text-xs tracking-wide transition-all whitespace-nowrap cursor-pointer flex items-center justify-center border ${
            soundOn
              ? 'text-ink-2 hover:text-ink-0 border-transparent hover:bg-paper-2'
              : 'text-ink-4 border-dashed border-hairline hover:bg-paper-2'
          }`}
          onClick={onToggleSound}
          title={soundOn ? '静音' : '开启音效'}
          aria-pressed={soundOn}
        >
          <span className="hidden sm:inline">{soundOn ? '音效' : '静音'}</span>
          <span className="sm:hidden">{soundOn ? '🔔' : '🔕'}</span>
        </button>

        <button
          type="button"
          className="h-6 md:h-7 px-1.5 md:px-2 rounded-md text-[11px] md:text-xs tracking-wide text-ink-3 hover:text-ink-0 hover:bg-paper-2 transition-all whitespace-nowrap cursor-pointer flex items-center justify-center border border-transparent"
          onClick={onHelp}
          title="快捷键帮助 (?)"
        >
          <span className="hidden sm:inline">帮助</span>
          <span className="sm:hidden">?</span>
        </button>
      </div>
    </nav>
  )
}
