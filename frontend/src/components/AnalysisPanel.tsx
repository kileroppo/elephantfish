import { useMemo, type CSSProperties } from 'react'
import type { AnalysisTask, GameSnapshot, MoveRecord, MoveReview, RankedLine, SearchTask } from '../types'
import {
  bestLineWord,
  boundMark,
  compactNumber,
  gradeDetail,
  gradeLabel,
  scoreRatio,
  scoreText,
  seconds,
  whySentence,
  CP_PAWN,
} from '../lib/format'

interface Props {
  game: GameSnapshot
  task: SearchTask | null
  /** 判分那次（低优先级的后台搜索）。与 task 分开，是两份不相干的读数。 */
  analysis: AnalysisTask | null
  thinking: boolean
}

/** 一句判定语 + 一个原始分值：转述的人要的是「现在谁占优」，不是一个小数。
 *  `evalRed` 必须是**红方视角**的 centipawn；`mateIn` 是「还有几步杀」，
 *  非 null 时优先于任何小数，方向照 `evalRed` 的正负。 */
function verdict(evalRed: number | null, mateIn: number | null): { text: string; tone: string } {
  if (evalRed === null) return { text: '待评估', tone: 'even' }
  if (mateIn !== null) {
    if (mateIn <= 0) {
      return evalRed > 0
        ? { text: '黑方已被将死', tone: 'red' }
        : { text: '红方已被将死', tone: 'black' }
    }
    return evalRed > 0
      ? { text: `红方 ${mateIn} 步内将死`, tone: 'red' }
      : { text: `黑方 ${mateIn} 步内将死`, tone: 'black' }
  }
  const units = Math.abs(evalRed) / CP_PAWN
  const side = evalRed > 0 ? '红方' : '黑方'
  if (units < 0.35) return { text: '均势', tone: 'even' }
  if (units < 1.2) return { text: `${side}略优`, tone: evalRed > 0 ? 'red' : 'black' }
  if (units < 3) return { text: `${side}占优`, tone: evalRed > 0 ? 'red' : 'black' }
  if (units < 6) return { text: `${side}大优`, tone: evalRed > 0 ? 'red' : 'black' }
  return { text: `${side}胜势`, tone: evalRed > 0 ? 'red' : 'black' }
}

/** 深度阶梯的格数。iteration deepening 一层一层往下钻，
 *  这个东西的意义就是让「钻」这件事看得见。 */
const LADDER = 12

/** 判分块里主变展示几步。存的是 6 步（服务端 REVIEW_PV_PLIES），这里只摆 4 步 ——
 *  栏宽有限，第 5、6 步在 300px 里只会挤成两行，讲不清反而像坏了。 */
const PV_SHOW = 4

export function AnalysisPanel({ game, task, analysis, thinking }: Props) {
  const progress = task?.progress ?? null

  const lastEngineRecord = useMemo(() => {
    for (let i = game.records.length - 1; i >= 0; i -= 1) {
      if (game.records[i].eval !== null) return game.records[i]
    }
    return null
  }, [game.records])

  // 一律按红方视角读。progress.score 是**走子方**视角，黑方思考时直接用它
  // 会让整块面板左右反过来 —— 以前就是拿它填红方视角的位置的。
  const evalRed = progress?.eval_red ?? lastEngineRecord?.eval ?? null
  const mateIn = progress?.mate_in ?? lastEngineRecord?.mate_in ?? null
  const ratio = scoreRatio(evalRed, mateIn)
  const call = verdict(evalRed, mateIn)
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
        const y = H - PAD - scoreRatio(r.eval, r.mate_in ?? null) * (H - PAD * 2)
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
    <section className="panel analysis" aria-label="引擎分析" data-analysis="">
      <header className="panel-head">
        <h2>引擎分析</h2>
        {thinking && <span className="live-dot" title="实时" />}
      </header>

      <div className="eval-block">
        <div className="eval-verdict">
          <span className={`eval-call tone-${call.tone}`}>{call.text}</span>
          <span className="eval-score" title="引擎评分，一个兵算 1.0">
            {evalRed === null ? '—' : `${scoreText(evalRed, mateIn)}${mateIn !== null ? '' : ' 兵'}`}
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

      <LearnBlock game={game} analysis={analysis} />
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

/** 排名线还是不是**眼前**这个局面的。服务端拿 epoch/board/red_to_move/ply 四把键
 *  判同一件事，前端没有 epoch，但换局会把 records 清空 —— 后三把对上了，
 *  上一局的排名线就绝不会安到这一局头上。对上不了就不许当提示摆出来：
 *  「眼前这局面的第 1 名」说成上一局的，比不说更糟。 */
function isFreshFor(analysis: AnalysisTask, game: GameSnapshot): boolean {
  const s = analysis.subject
  if (!s) return false
  return s.ply === game.ply && s.board === game.board && s.red_to_move === (game.turn === 'red')
}

/** 判分：轮到人的时候那次低优先级搜索的产物，加上刚刚那一步的判分。 */
function LearnBlock({ game, analysis }: { game: GameSnapshot; analysis: AnalysisTask | null }) {
  // 最后一条**有判分**的人步。往后翻不必找：引擎应手之后仍是「刚刚那一步」的判分，
  // 而那一刻排名线正在为新局面重算，两块各自讲各自的事。
  const graded = useMemo(() => lastGradedHuman(game.records), [game.records])
  const review = graded?.review ?? null
  const grade = gradeLabel(review)
  const why = review ? whySentence(review) : null
  const lines = analysis?.lines ?? []
  const fresh = analysis ? isFreshFor(analysis, game) : false

  // 关掉判分（analysis 为 null）且这局还没判过任何一步：这块整块不占地方
  if (!analysis && !review) return null

  return (
    <section className="learn-block" aria-label="判分提示" data-learn="">
      <header className="learn-head">
        <h3>判分</h3>
        <LearnStatus analysis={analysis} fresh={fresh} lines={lines.length} />
      </header>

      {review && (
        <div className="learn-review">
          <div className="learn-verdict">
            {grade && (
              <span className={`grade-chip tone-${grade.tone}`} title={gradeDetail(review)}>
                {grade.text}
              </span>
            )}
            <span className="learn-played">
              {graded?.chinese ?? review.played_iccs}
              <em>{review.played_iccs}</em>
            </span>
          </div>
          <p className="learn-sub">
            {bestLineWord(review)} <b>{bestLineText(review)}</b>
            {review.rank !== 1 && review.rank !== null && (
              <>
                {' · '}你这手第 {review.rank} 名
              </>
            )}
            {` · 摆在引擎前 ${review.width} 名里 · ${review.depth} 层`}
          </p>
          {/* 这一句只从 whySentence 出来：它讲得出「主变里第几步吃到什么」，
              讲不出就整个消失 —— 空占一行的「引擎更看那一手」不如没有。 */}
          {why && <p className="learn-why">{why}</p>}
          <RankList lines={review.lines} playedIccs={review.played_iccs} withPv />
        </div>
      )}

      {lines.length > 0 && fresh && (
        <div className="live-lines">
          <p className="learn-sub">
            {game.engine_to_move ? '引擎正在想，前几名先摆着' : '轮到你 —— 引擎眼下的前几名'}
          </p>
          <RankList lines={lines} playedIccs={null} withPv />
        </div>
      )}

      {/* 排名线是给上一手算的（人已经走完了），继续挂着会被读成「眼前这局面该这么走」。
          判分没跑成的那两种说法也要说出口，不然界面就是「转不完的圈」。 */}
      {lines.length > 0 && !fresh && (
        <p className="hint learn-hint">上一手的排名线已经翻篇了，轮到你的时候会重新算。</p>
      )}
    </section>
  )
}

/** 判分那次的状态行。running 只说「在算」，不摆会转个不停的圈：
 *  它借的是空闲算力，随时可能被引擎叫停，圈转不完就是撒谎。 */
function LearnStatus({
  analysis,
  fresh,
  lines,
}: {
  analysis: AnalysisTask | null
  fresh: boolean
  lines: number
}) {
  if (!analysis) return <span className="learn-state">这一手没有判分</span>
  if (analysis.status === 'skipped')
    return (
      <span className="learn-state is-warn">
        {analysis.result?.message || '引擎正忙，这一手先不判'}
      </span>
    )
  if (analysis.status === 'error')
    return <span className="learn-state is-bad">判分没跑成</span>
  if (analysis.status === 'running')
    return (
      <span className="learn-state is-live">
        正在算{fresh ? '' : '下一步'}前几名{analysis.progress ? ` · ${analysis.progress.depth} 层` : ''}
      </span>
    )
  return (
    <span className="learn-state">
      {lines ? `${lines} 条排名线${fresh ? '' : ' · 已翻篇'}` : '这一手没排出前几名'}
    </span>
  )
}

/** 前几名的表。`playedIccs` 不为 null 时把那一行标成「你走的」。 */
function RankList({
  lines,
  playedIccs,
  withPv,
}: {
  lines: RankedLine[]
  playedIccs: string | null
  withPv: boolean
}) {
  if (!lines.length) return null
  return (
    <ul className="rank-list">
      {lines.map((line) => {
        const played = playedIccs !== null && line.iccs === playedIccs
        return (
          <li
            key={`${line.rank}-${line.iccs}`}
            className={`rank-row${line.rank === 1 ? ' is-best' : ''}${played ? ' is-played' : ''}`}
            title={`${line.iccs} · ${line.depth} 层 · ${compactNumber(line.nodes)} 节点 · ${seconds(line.time)}`}
          >
            <span className="rank-no">{line.rank}</span>
            <span className="rank-cn">{line.chinese || line.iccs}</span>
            <span className="rank-score">
              {boundMark(line.bound)}
              {scoreText(line.eval_red, line.mate ? line.mate_in : null)}
            </span>
            <span className="rank-depth">{line.depth} 层</span>
            {played && <span className="rank-flag">你走的</span>}
            {withPv && line.rank === 1 && line.pv.length > 1 && (
              <span className="rank-pv" aria-label="排名第一那手的后续">
                {line.pv.slice(1, PV_SHOW + 1).map((step, i) => (
                  <em key={`${step.iccs}-${i}`}>{step.chinese || step.iccs}</em>
                ))}
              </span>
            )}
          </li>
        )
      })}
    </ul>
  )
}

/** 最后一条**带判分**的人步；没有就 null（「没判」与「判了没问题」不能混为一谈）。 */
function lastGradedHuman(records: MoveRecord[]): MoveRecord | null {
  for (let i = records.length - 1; i >= 0; i -= 1) {
    const r = records[i]
    if (r.by === 'opponent' && r.review) return r
  }
  return null
}

/** 排名第一那手的中文记谱。判分块里报这一手必须跟着是哪一手，否则那句话没法核对。 */
function bestLineText(review: MoveReview): string {
  const best = review.lines.find((l) => l.rank === 1) ?? review.lines[0]
  return best ? best.chinese || best.iccs : review.best_iccs || '—'
}
