import { useState } from 'react'
import type { Settings } from '../../types'

export const THINK_PRESETS = [
  { ms: 600, label: '极速 (0.6s)' },
  { ms: 1500, label: '快速 (1.5s)' },
  { ms: 3000, label: '标准 (3.0s)' },
  { ms: 6000, label: '深度 (6.0s)' },
]

export const ANALYZE_FIELDS = [
  {
    key: 'analyze_ms',
    label: '时限',
    unit: 'ms',
    min: 200,
    max: 15000,
    step: 100,
    hint: '判分搜索的时限。它只在轮到你、引擎空着的那段时间里跑',
  },
  {
    key: 'analyze_depth',
    label: '层数',
    unit: '层',
    min: 2,
    max: 50,
    step: 1,
    hint: '判分搜索的层数上限。到了时限就停，这个数只是天花板',
  },
  {
    key: 'analyze_width',
    label: '前几名',
    unit: '条',
    min: 1,
    max: 5,
    step: 1,
    hint: '排前几名。「没进引擎前 3 名」这句话里的 3 就是它',
  },
] as const

export interface AdvancedSettingsDrawerProps {
  settings: Settings
  analyzeOn: boolean
  onSettings: (patch: Partial<Settings>) => void
}

export function AdvancedSettingsDrawer({
  settings,
  analyzeOn,
  onSettings,
}: AdvancedSettingsDrawerProps) {
  return (
    <details className="pt-3 border-t border-hairline/80 group">
      <summary className="flex items-center justify-between cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden py-1 hover:text-cinnabar transition-colors">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-3 flex items-center gap-1.5 group-hover:text-cinnabar">
          <span>⚙️ 引擎计算高级设置</span>
        </h3>
        <div className="flex items-center gap-1.5">
          <span
            className={`panel-count text-[10.5px] font-num px-2 py-0.5 rounded-full border ${
              analyzeOn
                ? 'bg-jade/10 text-jade border-jade/30 font-medium'
                : 'bg-paper-2 text-ink-mute border-hairline'
            }`}
          >
            {analyzeOn ? '分析开' : '分析关'}
          </span>
          <span className="text-[10px] text-ink-4 group-open:rotate-180 transition-transform duration-200">
            ▼
          </span>
        </div>
      </summary>

      <div className="advanced-settings-body mt-2.5 pt-2.5 border-t border-hairline/50 flex flex-col gap-3">
        <div>
          <h3 className="text-[11.5px] font-semibold text-ink-2 mb-1.5">单步思考时间</h3>
          <div className="preset-column grid grid-cols-2 gap-1.5">
            {THINK_PRESETS.map((p) => {
              const isOn = Math.abs(settings.think_ms - p.ms) < 150
              return (
                <button
                  key={p.ms}
                  type="button"
                  className={`preset h-7 rounded text-[11.5px] tracking-tight transition-all border flex items-center justify-center font-medium cursor-pointer ${
                    isOn
                      ? 'is-on bg-cinnabar text-white border-cinnabar font-semibold shadow-xs'
                      : 'bg-paper-1/60 hover:bg-paper-2 text-ink-2 border-hairline'
                  }`}
                  onClick={() => onSettings({ think_ms: p.ms })}
                >
                  {p.label}
                </button>
              )
            })}
          </div>
        </div>

        <div>
          <h3 className="text-[11.5px] font-semibold text-ink-2 mb-1.5">走法质量分析</h3>
          <button
            type="button"
            className={`preset w-full h-8 px-2 rounded text-xs transition-all border flex items-center justify-center font-medium cursor-pointer ${
              analyzeOn
                ? 'is-on bg-jade/15 text-jade border-jade/40 font-semibold'
                : 'bg-paper-1/60 hover:bg-paper-2 text-ink-3 border-hairline'
            }`}
            aria-pressed={analyzeOn}
            onClick={() => onSettings({ analyze: !analyzeOn })}
            title="轮到你走棋时，后台分析局面候选走法并评估着法质量"
          >
            {analyzeOn ? '已开启走法质量分析' : '已关闭走法分析'}
          </button>

          <div className="field-grid flex flex-col gap-1.5 mt-2">
            {ANALYZE_FIELDS.map((f) => (
              <NumberField
                key={f.key}
                label={f.label}
                unit={f.unit}
                min={f.min}
                max={f.max}
                step={f.step}
                hint={f.hint}
                value={settings[f.key] ?? f.min}
                disabled={!analyzeOn}
                onCommit={(v) => onSettings({ [f.key]: v } as Partial<Settings>)}
              />
            ))}
          </div>
        </div>
      </div>
    </details>
  )
}

function NumberField({
  label,
  unit,
  hint,
  value,
  min,
  max,
  step,
  disabled,
  onCommit,
}: {
  label: string
  unit: string
  hint: string
  value: number
  min: number
  max: number
  step: number
  disabled: boolean
  onCommit: (value: number) => void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const shown = draft ?? String(value)

  const commit = () => {
    if (draft === null) return
    const parsed = Number.parseInt(draft, 10)
    setDraft(null)
    if (Number.isNaN(parsed)) return
    onCommit(Math.max(min, Math.min(max, parsed)))
  }

  return (
    <label
      className={`field grid grid-cols-[4.2em_1fr_2em] items-center gap-2 text-[11.5px] text-ink-mute ${
        draft !== null ? 'is-editing' : ''
      }`}
    >
      <span className="field-label text-ink-2 font-medium whitespace-nowrap">{label}</span>
      <input
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        step={step}
        value={shown}
        disabled={disabled}
        title={`${hint}（${min}–${max} ${unit}）`}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          if (e.key === 'Escape') setDraft(null)
        }}
        className="w-full px-2 py-1 rounded text-right font-num text-xs bg-paper-0 border border-hairline-strong text-ink-1 focus:border-cinnabar focus:outline-hidden disabled:opacity-40 disabled:bg-paper-2 transition-colors"
      />
      <span className="field-unit text-ink-mute select-none">{unit}</span>
    </label>
  )
}
