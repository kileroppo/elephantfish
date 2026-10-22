export interface SparringTier {
  id: 'apprentice' | 'club' | 'master' | 'god'
  label: string
  depth: number
  ms: number
  engine: 'builtin' | 'pikafish'
}

export const SPARRING_TIERS: SparringTier[] = [
  { id: 'apprentice', label: '🌱 启蒙学徒', depth: 4, ms: 400, engine: 'builtin' },
  { id: 'club', label: '🍵 街头棋摊', depth: 6, ms: 900, engine: 'builtin' },
  { id: 'master', label: '⚔️ 省冠名手', depth: 12, ms: 1500, engine: 'pikafish' },
  { id: 'god', label: '👑 绝顶宗师', depth: 20, ms: 3000, engine: 'pikafish' },
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
  onSelectTier,
  onToggleCoachGuard,
}: SparringTierSelectProps) {
  return (
    <section className="flex flex-col gap-2">
      <header className="flex items-center justify-between pb-1 border-b border-hairline/60">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-3">对弈段位</h3>
        <span
          className={`panel-count text-[11px] font-num px-2 py-0.5 rounded-full border ${
            coachGuardOn
              ? 'bg-jade/10 text-jade border-jade/30 font-medium'
              : 'bg-paper-2 text-ink-mute border-hairline'
          }`}
        >
          {coachGuardOn ? '指导中' : '静音'}
        </span>
      </header>

      {/* 棋力段位：单列通栏排列，字体饱满不挤压变形 */}
      <div className="preset-column flex flex-col gap-1.5">
        {SPARRING_TIERS.map((t) => {
          const isOn = activeTier === t.id
          return (
            <button
              key={t.id}
              type="button"
              className={`preset w-full h-8 px-3 rounded text-xs tracking-wide transition-all border flex items-center justify-center font-medium cursor-pointer ${
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

      <div className="flex flex-col gap-1.5 pt-1">
        <button
          type="button"
          className={`preset w-full h-8 px-2.5 rounded text-xs transition-all border flex items-center justify-center text-center font-medium cursor-pointer whitespace-nowrap ${
            coachGuardOn
              ? 'is-on bg-jade/15 text-jade border-jade/40 font-semibold'
              : 'bg-paper-1/50 hover:bg-paper-2 text-ink-3 border-hairline'
          }`}
          aria-pressed={coachGuardOn}
          onClick={onToggleCoachGuard}
          title="开启后，当你在实战中走出严重漏着或丢子缓手时，教练台立即弹出棋理归因与听劝重走提示"
        >
          {coachGuardOn ? '🛡️ 走错实时提醒：已开启' : '走错实时提醒：已关闭'}
        </button>
      </div>
    </section>
  )
}
