import { useState } from 'react'
import type { AppState, Settings, Side } from '../types'

interface Props {
  /** 抽屉是否展开。收起时整栏 inert：不可聚焦、读屏跳过，但保持挂载以便滑动过渡 */
  open: boolean
  state: AppState
  setupMode?: boolean
  onToggleSetup?: () => void
  onNewGame: (side: Side) => void
  onUndo: () => void
  onResign: () => void
  onSettings: (patch: Partial<AppState['settings']>) => void
}

const THINK_PRESETS = [
  { ms: 600, label: '极速 (0.6s)' },
  { ms: 1500, label: '快速 (1.5s)' },
  { ms: 3000, label: '标准 (3.0s)' },
  { ms: 6000, label: '深度 (6.0s)' },
]

/** 判分那次的三个数。上下限抄的是服务端 `_SETTING_CLAMPS` 的白名单 ——
 *  这里写死一份只为让输入框自己提示范围，真按出格的值提交，服务端照样夹回来。 */
const ANALYZE_FIELDS = [
  { key: 'analyze_ms', label: '时限', unit: 'ms', min: 200, max: 15000, step: 100, hint: '判分搜索的时限。它只在轮到你、引擎空着的那段时间里跑' },
  { key: 'analyze_depth', label: '层数', unit: '层', min: 2, max: 50, step: 1, hint: '判分搜索的层数上限。到了时限就停，这个数只是天花板' },
  { key: 'analyze_width', label: '前几名', unit: '条', min: 1, max: 5, step: 1, hint: '排前几名。「没进引擎前 3 名」这句话里的 3 就是它' },
] as const

export function ControlRail({
  open,
  state,
  setupMode = false,
  onToggleSetup,
  onNewGame,
  onUndo,
  onResign,
  onSettings,
}: Props) {
  const { game, settings } = state
  const [confirmResign, setConfirmResign] = useState(false)
  const over = game.status.state !== 'playing'
  const analyzeOn = settings.analyze !== false

  return (
    <aside
      className={`rail rail-left${open ? ' is-open' : ''}`}
      aria-label="对局控制"
      aria-hidden={!open}
      {...(open ? {} : { inert: '' })}
    >
      <section className="panel">
        <header className="panel-head">
          <h2>思考时间</h2>
        </header>
        <div className="preset-column">
          {THINK_PRESETS.map((p) => (
            <button
              key={p.ms}
              type="button"
              className={`preset ${Math.abs(settings.think_ms - p.ms) < 150 ? 'is-on' : ''}`}
              onClick={() => onSettings({ think_ms: p.ms })}
            >
              {p.label}
            </button>
          ))}
        </div>
      </section>

      {/* ---- 判分：给「录棋的那个人」用的第二次搜索 ----
          与上面「思考时间」分开配置，是因为两者要的正好相反：走棋要赢，
          判分要在人正看着棋盘的这段时间里把前几名摆出来。 */}
      <section className="panel">
        <header className="panel-head">
          <h2>判分提示</h2>
          <span className="panel-count">{analyzeOn ? '开' : '关'}</span>
        </header>
        <div className="preset-column">
          <button
            type="button"
            className={`preset ${analyzeOn ? 'is-on' : ''}`}
            aria-pressed={analyzeOn}
            onClick={() => onSettings({ analyze: !analyzeOn })}
            title="轮到你走棋时，引擎在空档里算这个局面的前几名；你一走完就拿它给这一步打分"
          >
            {analyzeOn ? '开着 · 轮到你时算前几名' : '关着 · 不给人这一步打分'}
          </button>
        </div>
        <div className="field-grid">
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
              /* 计算键合出来的对象在 TS 眼里是 `{ [x: string]: number }`，
                 对不上 Partial<Settings>（那里头还有布尔项）。字段名来自上面那张
                 白名单表，值已经夹过分上下限，这层断言只是替编译器补上它推不出的那一步。 */
              onCommit={(v) => onSettings({ [f.key]: v } as Partial<Settings>)}
            />
          ))}
        </div>
        <p className="hint">
          {analyzeOn
            ? '判分用的是借来的算力：引擎一想棋就叫停，所以它随时可能只排出前几名的一部分。'
            : '关掉判分之后，棋谱里的人步会一直显示「未判分」。'}
        </p>
      </section>

      <section className="panel">
        <header className="panel-head">
          <h2>对局操作</h2>
        </header>
        <div className="action-grid">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => onNewGame(game.engine_side)}
          >
            新对局
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={onUndo}
            disabled={!game.ply}
          >
            悔一步
          </button>
        </div>
        <div style={{ marginTop: '8px' }}>
          <button
            type="button"
            className={`btn wide ${confirmResign ? 'btn-danger' : 'btn-ghost'}`}
            disabled={over}
            onClick={() => {
              if (confirmResign) {
                onResign()
                setConfirmResign(false)
              } else {
                setConfirmResign(true)
                window.setTimeout(() => setConfirmResign(false), 3000)
              }
            }}
          >
            {confirmResign ? '再点一次确认认输' : '认输'}
          </button>
        </div>
        <div style={{ marginTop: '8px' }}>
          <button
            type="button"
            className={`btn wide ${setupMode ? 'btn-warn' : 'btn-ghost'}`}
            onClick={onToggleSetup}
          >
            {setupMode ? '退出补棋' : '补棋 / 自定义排局'}
          </button>
        </div>
      </section>
    </aside>
  )
}

/**
 * 一个提交式的数字格。
 *
 * 为什么不直接 `value={settings.analyze_ms}` 交给服务端那份读数：状态是轮询回来的
 * （搜索时 130ms、空闲时 1s），输入框若跟着每轮重绘，打到一半就被上一次读数盖回去。
 * 所以「正在编辑」期间值归本地，失焦或回车才提交 —— 与转述台①的录入框同一个路子。
 *
 * 提交前自己夹一次：`min`/`max` 只是给浏览器的提示，按出格的值照样能发出去。
 * 服务端也会夹（白名单在那儿），两边夹的是同一个范围，所以不会出现「显示 16000 实际 15000」。
 */
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
  // 编辑期间用本地草稿，其余时间一律读服务端那份（别的标签页改了也看得见）
  const shown = draft ?? String(value)

  const commit = () => {
    if (draft === null) return
    const parsed = Number.parseInt(draft, 10)
    setDraft(null)
    if (Number.isNaN(parsed)) return
    onCommit(Math.max(min, Math.min(max, parsed)))
  }

  return (
    <label className={`field${draft !== null ? ' is-editing' : ''}`}>
      <span className="field-label">{label}</span>
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
      />
      <span className="field-unit">{unit}</span>
    </label>
  )
}
