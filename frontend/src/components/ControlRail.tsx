import { useState } from 'react'
import type { AppState, Side } from '../types'
import { compactNumber } from '../lib/format'

interface Props {
  state: AppState
  onNewGame: (side: Side) => void
  onUndo: () => void
  onResign: () => void
  onSettings: (patch: Partial<AppState['settings']>) => void
  onLoadFen: (fen: string) => void
  onOpponentConfig: (patch: Record<string, unknown>) => void
  onOpponentPoll: () => void
}

const THINK_PRESETS = [
  { ms: 400, label: '闪电' },
  { ms: 1200, label: '快速' },
  { ms: 2500, label: '标准' },
  { ms: 5000, label: '深思' },
  { ms: 9000, label: '长考' },
]

export function ControlRail({
  state,
  onNewGame,
  onUndo,
  onResign,
  onSettings,
  onLoadFen,
  onOpponentConfig,
  onOpponentPoll,
}: Props) {
  const { game, settings, stats, game_stats: gameStats, opponent } = state
  const [fen, setFen] = useState('')
  const [confirmResign, setConfirmResign] = useState(false)

  const thinkSeconds = (settings.think_ms / 1000).toFixed(1)
  const over = game.status.state !== 'playing'

  return (
    <aside className="rail rail-left" aria-label="对局控制">
      <section className="panel">
        <header className="panel-head">
          <h2>执子方</h2>
        </header>
        <p className="hint">
          引擎执哪一边，就是「我方」。另一边由你在转述台录入。
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
          <span className="panel-count">{thinkSeconds}s 上限</span>
        </header>
        <input
          type="range"
          className="slider"
          min={300}
          max={12000}
          step={100}
          value={settings.think_ms}
          onChange={(e) => onSettings({ think_ms: Number(e.target.value) })}
          aria-label="引擎每步思考时间上限"
        />
        <div className="preset-row">
          {THINK_PRESETS.map((p) => (
            <button
              key={p.ms}
              type="button"
              className={`preset ${Math.abs(settings.think_ms - p.ms) < 60 ? 'is-on' : ''}`}
              onClick={() => onSettings({ think_ms: p.ms })}
            >
              {p.label}
            </button>
          ))}
        </div>
        <p className="hint">
          这是硬上限。引擎用迭代加深，到点就交出当前最好的一步，
          所以它永远不会超时摆烂。
        </p>
      </section>

      <section className="panel">
        <header className="panel-head">
          <h2>自动应手</h2>
        </header>
        <label className="switch">
          <input
            type="checkbox"
            checked={settings.auto_reply}
            onChange={(e) => onSettings({ auto_reply: e.target.checked })}
          />
          <span className="switch-track">
            <span className="switch-knob" />
          </span>
          <span className="switch-text">
            {settings.auto_reply ? '录完对方走法立刻算应手' : '录完后手动点「让引擎出招」'}
          </span>
        </label>
      </section>

      <section className="panel">
        <header className="panel-head">
          <h2>对局操作</h2>
        </header>
        <div className="action-grid">
          <button type="button" className="btn btn-ghost" onClick={onUndo} disabled={!game.ply}>
            悔一步
          </button>
          <button
            type="button"
            className={`btn ${confirmResign ? 'btn-danger' : 'btn-ghost'}`}
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
            {confirmResign ? '再点一次确认' : '认输'}
          </button>
        </div>
      </section>

      <section className="panel">
        <header className="panel-head">
          <h2>本局统计</h2>
          <span className="panel-count">引擎执{game.engine_side === 'red' ? '红' : '黑'}</span>
        </header>
        <dl className="stat-list">
          <div>
            <dt>手数</dt>
            <dd>{game.ply}</dd>
          </div>
          <div>
            <dt>引擎出招</dt>
            <dd>{gameStats.moves}</dd>
          </div>
          <div>
            <dt>搜索节点</dt>
            <dd>{compactNumber(gameStats.nodes)}</dd>
          </div>
          <div>
            <dt>思考耗时</dt>
            <dd>{gameStats.think_time.toFixed(1)}s</dd>
          </div>
        </dl>
        <div className="record-row">
          <span className="record-label">累计战绩</span>
          <span className="record-tally">
            <b className="tally-win">{stats.wins}</b>
            <i>胜</i>
            <b>{stats.draws}</b>
            <i>和</i>
            <b className="tally-loss">{stats.losses}</b>
            <i>负</i>
          </span>
        </div>
      </section>

      <details className="panel details">
        <summary>载入局面</summary>
        <p className="hint">粘贴象棋 FEN，直接把对局挪到某个局面继续转述。</p>
        <textarea
          className="fen-box"
          rows={3}
          value={fen}
          spellCheck={false}
          placeholder="rnbakabnr/9/1c5c1/…"
          onChange={(e) => setFen(e.target.value)}
        />
        <div className="action-grid">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => {
              setFen(game.fen)
            }}
          >
            填入当前
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={!fen.trim()}
            onClick={() => {
              onLoadFen(fen.trim())
              setFen('')
            }}
          >
            载入
          </button>
        </div>
      </details>

      <details className="panel details">
        <summary>对手模型接入</summary>
        <p className="hint">
          默认是手动转述。若对手模型能提供 HTTP 接口返回它的走法，填上地址就能半自动拉取。
        </p>
        <div className="field-row">
          <label>模式</label>
          <select
            value={opponent.mode}
            onChange={(e) => onOpponentConfig({ mode: e.target.value })}
          >
            <option value="manual">手动转述</option>
            <option value="http">HTTP 自动拉取</option>
          </select>
        </div>
        {opponent.mode === 'http' && (
          <>
            <div className="field-row">
              <label>地址</label>
              <input
                value={opponent.url}
                spellCheck={false}
                placeholder="http://127.0.0.1:9000/next-move"
                onChange={(e) => onOpponentConfig({ url: e.target.value })}
              />
            </div>
            <div className="field-row">
              <label>字段</label>
              <input
                value={opponent.move_field}
                spellCheck={false}
                onChange={(e) => onOpponentConfig({ move_field: e.target.value })}
              />
            </div>
            <button type="button" className="btn btn-primary btn-sm wide" onClick={onOpponentPoll}>
              现在拉取一步
            </button>
            {opponent.last_error && <p className="hint warn">{opponent.last_error}</p>}
          </>
        )}
      </details>
    </aside>
  )
}
