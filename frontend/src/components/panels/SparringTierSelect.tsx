export interface SparringTier {
  id: 'apprentice' | 'club' | 'master' | 'god'
  label: string
  depth: number
  ms: number
  engine: 'builtin' | 'pikafish'
}

export const SPARRING_TIERS: SparringTier[] = [
  { id: 'apprentice', label: '🌱 启蒙学徒 (4层)', depth: 4, ms: 400, engine: 'builtin' },
  { id: 'club', label: '🍵 街头棋摊 (6层)', depth: 6, ms: 900, engine: 'builtin' },
  { id: 'master', label: '⚔️ 省冠名手 (12层)', depth: 12, ms: 1500, engine: 'pikafish' },
  { id: 'god', label: '👑 绝顶宗师 (20层)', depth: 20, ms: 3000, engine: 'pikafish' },
]

export interface SparringTierSelectProps {
  activeTier: 'apprentice' | 'club' | 'master' | 'god'
  coachGuardOn: boolean
  playMode: 'sparring' | 'relay'
  shadowGuess: boolean
  onSelectTier: (tier: SparringTier) => void
  onToggleCoachGuard: () => void
  onTogglePlayMode?: () => void
  onToggleShadowGuess?: () => void
}

export function SparringTierSelect({
  activeTier,
  coachGuardOn,
  playMode,
  shadowGuess,
  onSelectTier,
  onToggleCoachGuard,
  onTogglePlayMode,
  onToggleShadowGuess,
}: SparringTierSelectProps) {
  return (
    <section className="panel bg-paper-0/80 rounded-md border border-hairline p-3 shadow-xs">
      <header className="panel-head flex items-center justify-between pb-2 mb-2.5 border-b border-hairline/60">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-3">陪练段位与扶手</h2>
        <span
          className={`panel-count text-[11px] font-num px-2 py-0.5 rounded-full border ${
            coachGuardOn
              ? 'bg-jade/10 text-jade border-jade/30 font-medium'
              : 'bg-paper-2 text-ink-mute border-hairline'
          }`}
        >
          {coachGuardOn ? '扶手开' : '静默'}
        </span>
      </header>

      <div className="preset-column flex flex-col gap-1.5">
        {SPARRING_TIERS.map((t) => {
          const isOn = activeTier === t.id
          return (
            <button
              key={t.id}
              type="button"
              className={`preset w-full h-8 px-2 rounded text-xs tracking-wide transition-all border flex items-center justify-center font-medium cursor-pointer ${
                isOn
                  ? 'is-on bg-cinnabar text-white border-cinnabar shadow-xs font-semibold'
                  : 'bg-paper-1/60 hover:bg-paper-2 text-ink-2 border-hairline hover:border-ink-4/40'
              }`}
              onClick={() => onSelectTier(t)}
            >
              {t.label}
            </button>
          )
        })}
      </div>

      <div className="preset-column flex flex-col gap-1.5 mt-2.5 pt-2 border-t border-hairline/40">
        <button
          type="button"
          className={`preset w-full min-h-[34px] py-1 px-2.5 rounded text-xs transition-all border flex items-center justify-center text-center font-medium cursor-pointer leading-tight ${
            coachGuardOn
              ? 'is-on bg-jade/15 text-jade border-jade/40 font-semibold'
              : 'bg-paper-1/50 hover:bg-paper-2 text-ink-3 border-hairline'
          }`}
          aria-pressed={coachGuardOn}
          onClick={onToggleCoachGuard}
          title="开启后，当你在实战中走出严重漏着或丢子缓手时，教练台立即弹出棋理归因与听劝重走提示"
        >
          {coachGuardOn ? '⚡ 师傅扶手 · 败着实时点拨' : '师傅扶手已关 · 自由对弈'}
        </button>

        {onTogglePlayMode && (
          <button
            type="button"
            className={`preset w-full min-h-[34px] py-1 px-2.5 rounded text-xs transition-all border flex items-center justify-center text-center font-medium cursor-pointer leading-tight ${
              playMode === 'relay'
                ? 'is-on bg-cinnabar/10 text-cinnabar border-cinnabar/40 font-semibold'
                : 'bg-paper-1/50 hover:bg-paper-2 text-ink-2 border-hairline'
            }`}
            onClick={onTogglePlayMode}
            title="切换实战陪练模式与外部棋局信使转述模式"
          >
            {playMode === 'relay' ? '📡 当前：信使代打转述' : '🎯 当前：认知教练陪练'}
          </button>
        )}

        {playMode === 'relay' && onToggleShadowGuess && (
          <button
            type="button"
            className={`preset w-full min-h-[32px] py-1 px-2.5 rounded text-xs transition-all border flex items-center justify-center text-center font-medium cursor-pointer leading-tight ${
              shadowGuess
                ? 'is-on bg-cinnabar text-white border-cinnabar font-semibold shadow-xs'
                : 'bg-paper-1/50 hover:bg-paper-2 text-ink-3 border-hairline'
            }`}
            onClick={onToggleShadowGuess}
          >
            {shadowGuess ? '👁️ 跟师盲猜：已开启' : '跟师盲猜：已关闭'}
          </button>
        )}
      </div>
    </section>
  )
}
