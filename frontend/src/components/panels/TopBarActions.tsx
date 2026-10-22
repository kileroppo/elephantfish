export interface TopBarActionsProps {
  theme: 'xuan' | 'wumu'
  onCycleTheme?: () => void
  connected: boolean
  zenMode: boolean
  soundOn: boolean
  railR?: boolean
  onToggleRailR?: () => void
  onRefresh: () => void
  onToggleZen?: () => void
  onToggleSound: () => void
  onHelp: () => void
}

export function TopBarActions({
  theme,
  onCycleTheme,
  connected,
  zenMode,
  soundOn,
  railR,
  onToggleRailR,
  onRefresh,
  onToggleZen,
  onToggleSound,
  onHelp,
}: TopBarActionsProps) {
  return (
    <nav className="topbar-actions flex items-center gap-1.5 md:gap-2 ml-auto select-none shrink-0" aria-label="快捷工具">
      {/* 1. 材质主题切换 (乌墨 / 宣纸) */}
      {onCycleTheme && (
        <button
          type="button"
          className="h-7 px-2.5 rounded-lg text-xs tracking-wide text-ink-2 hover:text-cinnabar hover:bg-paper-2 transition-all cursor-pointer border border-transparent flex items-center gap-1.5"
          onClick={onCycleTheme}
          title="切换棋盘材质主题 (快捷键 T)"
          aria-label="切换材质主题"
        >
          <span className="text-[12px] opacity-80">🎨</span>
          <span className="hidden md:inline font-medium">{theme === 'wumu' ? '乌墨' : '宣纸'}</span>
        </button>
      )}

      {/* 2. 专注模式切换 */}
      {onToggleZen && (
        <button
          type="button"
          className={`h-7 px-2.5 rounded-lg text-xs tracking-wide transition-all cursor-pointer flex items-center gap-1.5 border ${
            zenMode
              ? 'text-cinnabar border-cinnabar/40 bg-cinnabar/5 font-semibold'
              : 'text-ink-2 hover:text-cinnabar border-transparent hover:bg-paper-2'
          }`}
          onClick={onToggleZen}
          title={zenMode ? '退出沉浸专注 (快捷键 Z / Esc)' : '沉浸专注模式 (快捷键 Z)'}
          aria-pressed={zenMode}
        >
          <span className="text-[12px]">🎯</span>
          <span className="hidden md:inline font-medium">{zenMode ? '已专注' : '专注'}</span>
        </button>
      )}

      {/* 3. 音效开关 */}
      <button
        type="button"
        className={`h-7 px-2.5 rounded-lg text-xs tracking-wide transition-all cursor-pointer flex items-center gap-1.5 border ${
          soundOn
            ? 'text-ink-2 hover:text-cinnabar border-transparent hover:bg-paper-2'
            : 'text-ink-4 border-dashed border-hairline hover:bg-paper-2'
        }`}
        onClick={onToggleSound}
        title={soundOn ? '关闭落子与将军音效' : '开启落子音效'}
        aria-pressed={soundOn}
      >
        <span className="text-[12px]">{soundOn ? '🔔' : '🔕'}</span>
        <span className="hidden md:inline font-medium">{soundOn ? '音效' : '静音'}</span>
      </button>

      {/* 4. 右侧分析栏展开/收起开关 */}
      {onToggleRailR && (
        <button
          type="button"
          className={`h-7 px-2.5 rounded-lg text-xs tracking-wide transition-all cursor-pointer flex items-center gap-1.5 border ${
            railR
              ? 'text-cinnabar border-cinnabar/40 bg-cinnabar/5 font-semibold'
              : 'text-ink-2 hover:text-cinnabar border-transparent hover:bg-paper-2'
          }`}
          onClick={onToggleRailR}
          title={railR ? '收起右侧分析栏 (快捷键 ])' : '展开右侧分析栏 (快捷键 ])'}
          aria-pressed={railR}
        >
          <span className="text-[12px]">📊</span>
          <span className="hidden md:inline font-medium">{railR ? '收起侧栏' : '分析侧栏'}</span>
        </button>
      )}

      {/* 5. 快捷键帮助 */}
      <button
        type="button"
        className="h-7 w-7 rounded-lg text-xs tracking-wide text-ink-3 hover:text-ink-0 hover:bg-paper-2 transition-all cursor-pointer flex items-center justify-center border border-transparent font-medium"
        onClick={onHelp}
        title="帮助与对弈快捷键说明 (?)"
        aria-label="帮助与快捷键说明"
      >
        ?
      </button>

      {/* 断线提示重连 */}
      {!connected && (
        <button
          type="button"
          className="h-7 px-2.5 rounded-lg text-xs tracking-wide text-cinnabar bg-cinnabar/10 border border-cinnabar/30 transition-colors cursor-pointer flex items-center font-medium animate-pulse ml-1"
          onClick={onRefresh}
          title="引擎服务未连接，点击重试"
        >
          重连
        </button>
      )}
    </nav>
  )
}
