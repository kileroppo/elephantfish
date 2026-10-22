import type { GameSnapshot, EngineInfo } from '../types'
import { useGameContext } from '../context/GameContext'
import { useUIContext } from '../context/UIContext'
import { TopBarBrand } from './panels/TopBarBrand'
import { TopBarSettings } from './panels/TopBarSettings'
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
  const setupMode = props.setupMode ?? false
  const drillMode = props.drillMode ?? ui.drillOpen
  const theme = props.theme ?? ui.theme
  const zenMode = props.zenMode ?? ui.zenMode
  const onToggleZen = props.onToggleZen ?? ui.toggleZen
  const onCycleTheme = props.onCycleTheme ?? ui.cycleTheme
  const onToggleSetup = props.onToggleSetup
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
  const isEngineRed = game.engine_side === 'red'
  const playMode = props.playMode ?? ui.playMode
  const onTogglePlayMode = props.onTogglePlayMode ?? ui.togglePlayMode

  const handleToggleEngineSide = () => {
    if (props.onToggleEngineSide) {
      props.onToggleEngineSide()
    } else {
      const nextSide = isEngineRed ? 'black' : 'red'
      if (playMode === 'sparring') {
        ui.setFlipOverride(nextSide === 'red')
      }
      void g.newGame(nextSide)
    }
  }

  const onFlip = props.onFlip ?? (() => ui.setFlipOverride(!ui.flipped))
  const onToggleSound = props.onToggleSound ?? ui.toggleSound
  const onHelp = props.onHelp ?? (() => ui.setHelp(true))
  const onRefresh = props.onRefresh ?? (() => void g.refresh())

  return (
    <header className="topbar relative z-40 flex items-center justify-between gap-2 md:gap-7 h-11 md:h-14 px-3 md:px-8 bg-paper-0/80 backdrop-blur-md border-b border-hairline shrink-0">
      <TopBarBrand />

      <TopBarSettings
        game={game}
        engineInfo={engineInfo}
        flipped={ui.flipped}
        theme={theme}
        onToggleEngine={onToggleEngine}
        onToggleEngineSide={handleToggleEngineSide}
        onFlip={onFlip}
        onCycleTheme={onCycleTheme}
      />

      <TopBarActions
        playMode={playMode}
        connected={connected}
        zenMode={zenMode}
        drillMode={drillMode}
        setupMode={setupMode}
        soundOn={soundOn}
        onTogglePlayMode={onTogglePlayMode}
        onRefresh={onRefresh}
        onToggleZen={onToggleZen}
        onToggleDrill={onToggleDrill}
        onToggleSetup={onToggleSetup}
        onToggleSound={onToggleSound}
        onHelp={onHelp}
      />
    </header>
  )
}
