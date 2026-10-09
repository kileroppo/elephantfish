import { useMemo, type CSSProperties } from 'react'
import type { GameSnapshot, SearchTask } from '../types'
import { compactNumber, PAWN_VALUE, scoreRatio, scoreText, seconds } from '../lib/format'

interface Props {
  game: GameSnapshot
  task: SearchTask | null
  thinking: boolean
}

/** 把引擎评分翻译成一句人话。转述的人要的是「现在谁占优」，不是一个小数。 */
function verdict(score: number | null, mate: boolean): { text: string; tone: string } {
  if (score === null) return { text: '待评估', tone: 'even' }
  if (mate || Math.abs(score) >= 1304) {
    const n = Math.max(1, Math.round((3696 - Math.abs(score)) / 2) + 1)
    return score > 0
      ? { text: `红方 ${n} 步内将死`, tone: 'red' }
      : { text: `黑方 ${n} 步内将死`, tone: 'black' }
  }
  const units = Math.abs(score) / PAWN_VALUE
  const side = score > 0 ? '红方' : '黑方'
  if (units < 0.35) return { text: '均势', tone: 'even' }
  if (units < 1.2) return { text: `${side}略优`, tone: score > 0 ? 'red' : 'black' }
  if (units < 3) return { text: `${side}占优`, tone: score > 0 ? 'red' : 'black' }
  if (units < 6) return { text: `${side}大优`, tone: score > 0 ? 'red' : 'black' }
  return { text: `${side}胜势`, tone: score > 0 ? 'red' : 'black' }
}

/** 深度阶梯的格数。iteration deepening 一层一层往下钻，
 *  这个东西的意义就是让「钻」这件事看得见。 */
const LADDER = 12

export function AnalysisPanel({ game, task, thinking }: Props) {
  const progress = task?.progress ?? null

  const lastEngineRecord = useMemo(() => {
    for (let i = game.records.length - 1; i >= 0; i -= 1) {
      if (game.records[i].eval !== null) return game.records[i]
    }
    return null
  }, [game.records])

  const score = progress?.score ?? lastEngineRecord?.eval ?? null
  const mate = progress?.mate ?? false
  const ratio = scoreRatio(score)
  const call = verdict(score, mate)
  const depth = progress?.depth ?? lastEngineRecord?.depth ?? 0
  const lit = Math.min(depth, LADDER)

  // 棋势走势：评分条讲「此刻」，这条线讲「这一局」。
  // 横轴是手数、纵轴是胜势占比（与评分条同一 logistic 映射）。
  // d 只在 records 变化时重算一次，130ms 轮询不会碰它。
  const trend = useMemo(() => {
    const pts = game.records.filter((r) => r.eval !== null)
    if (pts.length < 2) return null
    const maxPly = Math.max(...pts.map((r) => r.ply), 2)
    const W = 100
    const H = 26
    const PAD = 2
    return pts
      .map((r, i) => {
        const x = PAD + (r.ply / maxPly) * (W - PAD * 2)
        const y = H - PAD - scoreRatio(r.eval) * (H - PAD * 2)
        return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
      })
      .join(' ')
  }, [game.records])

  // 搜索结束时算出的主变，第一步往往就是引擎刚刚落下的那一步。
  // 那步棋已经在「引擎应手」里了，这里再显示一遍只会让人以为有两步。
  const pvText = useMemo(() => {
    const raw = progress?.pv_detail ?? (progress?.pv ?? []).map((iccs) => ({ iccs, chinese: '' }))
    const played = lastEngineRecord?.iccs
    const dropLeading = raw.length > 0 && played && raw[0].iccs === played && !thinking
    return (dropLeading ? raw.slice(1) : raw)
      .map((step) => ({ ...step, chinese: step.chinese || '' }))
      .slice(0, 8)
  }, [progress?.pv_detail, progress?.pv, lastEngineRecord?.iccs, thinking])

  return (
    <section className="panel analysis" aria-label="引擎分析">
      <header className="panel-head">
        <h2>引擎分析</h2>
        {thinking && <span className="live-dot" title="实时" />}
      </header>

      <div className="eval-block">
        <div className="eval-verdict">
          <span className={`eval-call tone-${call.tone}`}>{call.text}</span>
          <span className="eval-score" title="引擎评分，一个兵算 1.0">
            {score === null ? '—' : `${scoreText(score, mate)}${mate ? '' : ' 兵'}`}
          </span>
        </div>
        <div className="eval-bar" role="img" aria-label={`红方胜势 ${Math.round(ratio * 100)}%`}>
          <div className="eval-red" style={{ width: `${ratio * 100}%` }} />
          <div className="eval-black" style={{ width: `${(1 - ratio) * 100}%` }} />
          <div className="eval-mid" />
          {/* tick 由全宽轨道承载：translateX 的百分比以轨道自身（=评分条宽）为参照，
              这样位移走 transform，不再用 left 过渡 */}
          <div className="eval-tick-track" style={{ '--er': ratio } as CSSProperties}>
            <div className="eval-tick" />
          </div>
        </div>
        {trend && (
          <svg
            className="eval-trend"
            viewBox="0 0 100 26"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <line className="eval-trend-mid" x1="0" y1="13" x2="100" y2="13" />
            <path d={trend} />
          </svg>
        )}
        <div className="eval-scale">
          <span className="scale-red">红</span>
          <span className="scale-mid">均势</span>
          <span className="scale-black">黑</span>
        </div>
      </div>

      <div className={`depth-ladder ${thinking ? 'is-live' : ''}`}>
        <span className="ladder-label">搜索深度</span>
        <span className="ladder-rungs" aria-hidden="true">
          {Array.from({ length: LADDER }, (_, i) => (
            <i key={i} className={i < lit ? 'rung lit' : 'rung'} />
          ))}
        </span>
        <span className="ladder-value">{depth ? `${depth} 层` : '—'}</span>
      </div>

      <div className="stat-grid">
        <Stat label="节点数" value={compactNumber(progress?.nodes)} />
        <Stat label="节点/秒" value={progress?.nps ? compactNumber(progress.nps) : '—'} />
        <Stat label="本步耗时" value={seconds(progress?.time ?? lastEngineRecord?.time)} />
      </div>

      <div className="pv-block">
        <h3>
          主变
          <span className="pv-note">{pvText.length ? `引擎算的接下来 ${pvText.length} 步` : ''}</span>
        </h3>
        {pvText.length ? (
          <ol className="pv-list">
            {pvText.map((step, i) => (
              <li key={`${step.iccs}-${i}`} className={i % 2 === 0 ? 'pv-red' : 'pv-black'}>
                <span className="pv-num">{i + 1}</span>
                <span className="pv-cn">{step.chinese || step.iccs}</span>
                <span className="pv-iccs">{step.iccs}</span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="hint">引擎出招后这里会显示它算到的后续几步。</p>
        )}
      </div>
    </section>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
    </div>
  )
}
