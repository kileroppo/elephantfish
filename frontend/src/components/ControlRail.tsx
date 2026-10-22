import type { AppState, Side } from '../types'
import { useGameContext } from '../context/GameContext'
import { useUIContext } from '../context/UIContext'
import { SparringTierSelect, type SparringTier } from './panels/SparringTierSelect'
import { AdvancedSettingsDrawer } from './panels/AdvancedSettingsDrawer'
import { GameActionGrid } from './panels/GameActionGrid'

export interface ControlRailProps {
  /** 抽屉是否展开。收起时整栏 inert：不可聚焦、读屏跳过，但保持挂载以便滑动过渡 */
  open?: boolean
  state?: AppState
  setupMode?: boolean
  onToggleSetup?: () => void
  onNewGame?: (side: Side) => void
  onUndo?: () => void
  onResign?: () => void
  onSettings?: (patch: Partial<AppState['settings']>) => void
  playMode?: 'sparring' | 'relay'
  shadowGuess?: boolean
  onTogglePlayMode?: () => void
  onToggleShadowGuess?: () => void
}

export function ControlRail(props: ControlRailProps) {
  const g = useGameContext()
  const ui = useUIContext()

  const open = props.open ?? ui.railL
  const state = props.state ?? g.state
  if (!state) return null

  const setupMode = props.setupMode ?? false
  const onToggleSetup = props.onToggleSetup
  const onNewGame = props.onNewGame ?? ((side: Side) => void g.newGame(side))
  const onUndo = props.onUndo ?? (() => void g.undoRound())
  const onResign = props.onResign ?? (() => void g.resign())
  const onSettings = props.onSettings ?? ((patch) => void g.updateSettings(patch))
  const playMode = props.playMode ?? ui.playMode
  const shadowGuess = props.shadowGuess ?? ui.shadowGuess
  const onTogglePlayMode = props.onTogglePlayMode ?? ui.togglePlayMode
  const onToggleShadowGuess = props.onToggleShadowGuess ?? ui.toggleShadowGuess

  const { game, settings } = state
  const over = game.status.state !== 'playing'
  const analyzeOn = settings.analyze !== false
  const coachGuardOn = settings.coach_guard !== false
  const activeTier = settings.sparring_level ?? 'master'

  const handleSelectTier = (t: SparringTier) => {
    onSettings({
      sparring_level: t.id,
      max_depth: t.depth,
      think_ms: t.ms,
      engine_type: t.engine,
    })
  }

  return (
    <aside
      className={`rail rail-left w-full max-w-[var(--rail-l,262px)] flex flex-col gap-3 p-3 bg-paper-1/95 border-r border-hairline overflow-y-auto transition-transform ${
        open ? 'is-open' : ''
      }`}
      aria-label="对局控制"
      aria-hidden={!open}
      {...(open ? {} : { inert: '' })}
    >
      <SparringTierSelect
        activeTier={activeTier}
        coachGuardOn={coachGuardOn}
        playMode={playMode}
        shadowGuess={shadowGuess}
        onSelectTier={handleSelectTier}
        onToggleCoachGuard={() => onSettings({ coach_guard: !coachGuardOn })}
        onTogglePlayMode={onTogglePlayMode}
        onToggleShadowGuess={onToggleShadowGuess}
      />

      <AdvancedSettingsDrawer
        settings={settings}
        analyzeOn={analyzeOn}
        onSettings={onSettings}
      />

      <GameActionGrid
        game={game}
        over={over}
        setupMode={setupMode}
        playMode={playMode}
        onNewGame={onNewGame}
        onUndo={onUndo}
        onResign={onResign}
        onToggleSetup={onToggleSetup}
        onSetFlipOverride={ui.setFlipOverride}
      />
    </aside>
  )
}
