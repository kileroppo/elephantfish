import type { GameSnapshot, EngineInfo } from '../types'
import { useGameContext } from '../context/GameContext'
import { useUIContext } from '../context/UIContext'
import { TopBarBrand } from './panels/TopBarBrand'
import { TopBarActions } from './panels/TopBarActions'

export interface TopBarProps {
  game?: GameSnapshot
  engineInfo?: EngineInfo
  connected?: boolean
  flipped?: boolean
  soundOn?: boolean
  setupMode?: boolean
  drillMode?: boolean
  theme?: 'xuan' | 'wumu'
  zenMode?: boolean
  onToggleZen?: () => void
  onCycleTheme?: () => void
  onToggleSetup?: () => void
  onToggleDrill?: () => void
  onToggleEngine?: () => void
  onToggleEngineSide?: () => void
  onFlip?: () => void
  onToggleSound?: () => void
  onHelp?: () => void
  onRefresh?: () => void
  railR?: boolean
  onToggleRailR?: () => void
  playMode?: 'sparring' | 'relay'
  onTogglePlayMode?: () => void
}

export function TopBar(props: TopBarProps) {
  const g = useGameContext()
  const ui = useUIContext()

  const game = props.game ?? g.state?.game
  if (!game) return null

  const engineInfo = props.engineInfo ?? g.state?.engine_info
  const connected = props.connected ?? g.connected
  const soundOn = props.soundOn ?? ui.soundOn
  const drillMode = props.drillMode ?? ui.drillOpen
  const theme = props.theme ?? ui.theme
  const zenMode = props.zenMode ?? ui.zenMode
  const onToggleZen = props.onToggleZen ?? ui.toggleZen
  const onCycleTheme = props.onCycleTheme ?? ui.cycleTheme
  const onToggleDrill =
    props.onToggleDrill ??
    (() => {
      if (ui.drillOpen) ui.closeDrill()
      else ui.openDrillAt()
    })
  const onToggleEngine =
    props.onToggleEngine ??
    (() => {
      const current = g.state?.settings.engine_type ?? 'pikafish'
      const next = current === 'pikafish' ? 'builtin' : 'pikafish'
      void g.updateSettings({ engine_type: next })
    })

  const onToggleSound = props.onToggleSound ?? ui.toggleSound
  const onHelp = props.onHelp ?? (() => ui.setHelp(true))
  const onRefresh = props.onRefresh ?? (() => void g.refresh())

  return (
    <header className="topbar relative z-40 flex items-center justify-between h-12 md:h-13 px-3 md:px-7 bg-paper-0/85 backdrop-blur-md border-b border-hairline shrink-0 select-none">
      {/* 1. 左侧：品牌标志与引擎状态胶囊 */}
      <TopBarBrand engineInfo={engineInfo} onToggleEngine={onToggleEngine} />

      {/* 2. 中央对称模式分段器 (Apple HIG 标准中央定位) */}
      <div
        className="hidden sm:inline-flex absolute left-1/2 -translate-x-1/2 items-center p-0.5 bg-paper-2/90 rounded-xl border border-hairline text-xs font-medium select-none shadow-2xs"
        role="tablist"
        aria-label="模式切换"
      >
        <button
          type="button"
          role="tab"
          aria-selected={!drillMode}
          className={`h-7 px-3.5 rounded-lg text-xs font-medium tracking-wide transition-all cursor-pointer border-0 flex items-center justify-center gap-1.5 ${
            !drillMode
              ? 'bg-paper-0 text-cinnabar shadow-xs font-semibold'
              : 'bg-transparent text-ink-3 hover:text-ink-1'
          }`}
          onClick={() => {
            if (drillMode) onToggleDrill()
          }}
          title="标准对弈实战模式"
        >
          <span>♟️</span>
          <span>实战对弈</span>
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={drillMode}
          className={`h-7 px-3.5 rounded-lg text-xs font-medium tracking-wide transition-all cursor-pointer border-0 flex items-center justify-center gap-1.5 ${
            drillMode
              ? 'bg-paper-0 text-cinnabar shadow-xs font-semibold'
              : 'bg-transparent text-ink-3 hover:text-ink-1'
          }`}
          onClick={() => {
            if (!drillMode) onToggleDrill()
          }}
          title="特训营残局实战专题"
        >
          <span>🏹</span>
          <span>特训营</span>
        </button>
      </div>

      {/* 3. 右侧：系统工具胶囊组 (材质、专注、音效、侧栏、帮助) */}
      <TopBarActions
        theme={theme}
        onCycleTheme={onCycleTheme}
        connected={connected}
        zenMode={zenMode}
        soundOn={soundOn}
        railR={props.railR ?? ui.railR}
        onToggleRailR={props.onToggleRailR ?? ui.toggleRailR}
        onRefresh={onRefresh}
        onToggleZen={onToggleZen}
        onToggleSound={onToggleSound}
        onHelp={onHelp}
      />
    </header>
  )
}
