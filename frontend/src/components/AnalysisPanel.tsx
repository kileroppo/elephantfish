import { useMemo } from 'react'
import type { AnalysisTask, GameSnapshot, SearchTask } from '../types'
import { scoreRatio } from '../lib/format'
import { useGameContext } from '../context/GameContext'
import { EvalBlock } from './panels/EvalBlock'
import { StatCompactBar } from './panels/StatCompactBar'
import { PvBlock } from './panels/PvBlock'
import { LearnBlock } from './panels/LearnBlock'

export interface AnalysisPanelProps {
  game?: GameSnapshot
  task?: SearchTask | null
  /** 判分那次（低优先级的后台搜索）。与 task 分开，是两份不相干的读数。 */
  analysis?: AnalysisTask | null
  thinking?: boolean
}

export function AnalysisPanel(props: AnalysisPanelProps) {
  const g = useGameContext()
  const game = props.game ?? g.state?.game
  if (!game) return null

  const task = props.task !== undefined ? props.task : g.task
  const analysis = props.analysis !== undefined ? props.analysis : (g.state?.analysis ?? null)
  const thinking = props.thinking !== undefined ? props.thinking : g.thinking
  const progress = task?.progress ?? null

  const lastEngineRecord = useMemo(() => {
    for (let i = game.records.length - 1; i >= 0; i -= 1) {
      if (game.records[i].eval !== null) return game.records[i]
    }
    return null
  }, [game.records])

  const evalRed = progress?.eval_red ?? lastEngineRecord?.eval ?? null
  const mateIn = progress?.mate_in ?? lastEngineRecord?.mate_in ?? null
  const depth = progress?.depth ?? lastEngineRecord?.depth ?? 0
  const rawTime = progress?.time ?? lastEngineRecord?.time

  // 棋势走势：评分条讲「此刻」，这条线讲「这一局」。
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

  // 搜索结束时算出的主变
  const pvText = useMemo(() => {
    const raw = progress?.pv_detail ?? (progress?.pv ?? []).map((iccs) => ({ iccs, chinese: '' }))
    const played = lastEngineRecord?.iccs
    const dropLeading = raw.length > 0 && played && raw[0].iccs === played && !thinking
    return (dropLeading ? raw.slice(1) : raw)
      .map((step) => ({ ...step, chinese: step.chinese || '' }))
      .slice(0, 8)
  }, [progress?.pv_detail, progress?.pv, lastEngineRecord?.iccs, thinking])

  return (
    <section
      className="panel analysis flex flex-col gap-2.5 pt-3 pb-1 border-t border-hairline"
      aria-label="引擎分析"
      data-analysis=""
    >
      <header className="panel-head flex items-center justify-between px-1">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-3">引擎分析</h2>
        {thinking && (
          <span
            className="live-dot w-2 h-2 rounded-full bg-cinnabar animate-ping"
            title="实时思考中"
          />
        )}
      </header>

      <EvalBlock evalRed={evalRed} mateIn={mateIn} trend={trend} />

      <StatCompactBar progress={progress} depth={depth} rawTime={rawTime} />

      <PvBlock pvText={pvText} />

      <LearnBlock game={game} analysis={analysis} />
    </section>
  )
}
