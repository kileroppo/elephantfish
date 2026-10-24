import type { EngineInfo, GameSnapshot } from '../../types'

export interface TopBarSettingsProps {
  game: GameSnapshot
  engineInfo?: EngineInfo
  flipped?: boolean
  theme: 'xuan' | 'wumu'
  playMode?: 'sparring' | 'relay'
  onToggleEngine?: () => void
  onToggleEngineSide?: () => void
  onFlip?: () => void
  onCycleTheme?: () => void
}

export function TopBarSettings({
  game,
  theme,
  playMode = 'sparring',
  onToggleEngineSide,
  onCycleTheme,
}: TopBarSettingsProps) {
  const isEngineRed = game.engine_side === 'red'
  const isRelay = playMode === 'relay'

  const fullLabel = isRelay
    ? isEngineRed
      ? '引擎执红 · 先手'
      : '引擎执黑 · 后手'
    : isEngineRed
    ? '我执黑 · AI红'
    : '我执红 · AI黑'

  const shortLabel = isRelay
    ? isEngineRed
      ? '引擎执红'
      : '引擎执黑'
    : isEngineRed
    ? '我执黑'
    : '我执红'

  const tooltip = isRelay
    ? isEngineRed
      ? '当前引擎执红先行，点击切换为执黑'
      : '当前引擎执黑后手，点击切换为执红'
    : isEngineRed
    ? '当前我执黑、AI执红，点击切换'
    : '当前我执红、AI执黑，点击切换'

  return (
    <div
      className="topbar-setting flex items-center gap-1.5 pl-2 md:pl-6 border-l border-hairline text-xs"
      role="group"
      aria-label="对局设定"
    >
      <button
        key={game.engine_side}
        type="button"
        className={`setting-link side-${game.engine_side} px-1.5 py-1 rounded text-ink-2 hover:text-cinnabar transition-colors whitespace-nowrap tracking-wide bg-transparent border-0 cursor-pointer text-xs`}
        onClick={onToggleEngineSide}
        title={tooltip}
        aria-label={`切换执子方，当前${fullLabel}`}
      >
        <span className="inline md:hidden">{shortLabel}</span>
        <span className="hidden md:inline">{fullLabel}</span>
      </button>

      {onCycleTheme && (
        <>
          <span className="hidden md:inline setting-dot text-ink-4 select-none px-0.5" aria-hidden="true">
            ·
          </span>
          <button
            type="button"
            className="hidden md:inline-flex setting-link px-1.5 py-1 rounded text-ink-2 hover:text-cinnabar transition-colors whitespace-nowrap tracking-wide bg-transparent border-0 cursor-pointer text-xs"
            onClick={onCycleTheme}
            title="切换材质 (快捷键 T)"
            aria-label="切换材质主题"
          >
            {theme === 'wumu' ? '乌墨' : '宣纸'}
          </button>
        </>
      )}
    </div>
  )
}
