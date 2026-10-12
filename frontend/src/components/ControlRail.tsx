import { useState } from 'react'
import type { AppState, Side } from '../types'

interface Props {
  /** 抽屉是否展开。收起时整栏 inert：不可聚焦、读屏跳过，但保持挂载以便滑动过渡 */
  open: boolean
  state: AppState
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

export function ControlRail({
  open,
  state,
  onNewGame,
  onUndo,
  onResign,
  onSettings,
}: Props) {
  const { game, settings } = state
  const [confirmResign, setConfirmResign] = useState(false)
  const over = game.status.state !== 'playing'

  return (
    <aside
      className={`rail rail-left${open ? ' is-open' : ''}`}
      aria-label="对局控制"
      aria-hidden={!open}
      {...(open ? {} : { inert: '' })}
    >
      <section className="panel">
        <header className="panel-head">
          <h2>执子方</h2>
        </header>
        <p className="hint">
          引擎执哪一边，即由引擎出招应手；对方走法在盘上点录。
        </p>
        <div className="segmented">
          {(['red', 'black'] as Side[]).map((side) => (
            <button
              key={side}
              type="button"
              className={`seg seg-${side} ${game.engine_side === side ? 'is-on' : ''}`}
              onClick={() => onNewGame(side)}
            >
              <span className="seg-disc" />
              引擎执{side === 'red' ? '红' : '黑'}
            </button>
          ))}
        </div>
      </section>

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
      </section>
    </aside>
  )
}
