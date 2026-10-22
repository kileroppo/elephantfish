import { useMemo } from 'react'
import type { AnalysisTask, GameSnapshot, SearchTask } from '../types'
import { scoreRatio } from '../lib/format'
import { useGameContext } from '../context/GameContext'
import { EvalBlock } from './panels/EvalBlock'
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
      className="analysis flex flex-col gap-2.5 select-none"
      aria-label="局势分析与推荐"
      data-analysis=""
    >
      <header className="flex items-center justify-between px-1">
        <h2 className="text-xs font-bold text-ink-1">局势分析与推荐</h2>
        {thinking && (
          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 border border-rose-200">
            <span
              className="live-dot w-2 h-2 rounded-full bg-cinnabar animate-ping"
              title="实时思考中"
            />
            <span className="text-[10px] font-semibold">思考中</span>
          </div>
        )}
      </header>

      <EvalBlock evalRed={evalRed} mateIn={mateIn} trend={trend} />

      <PvBlock pvText={pvText} />

      <LearnBlock game={game} analysis={analysis} />
    </section>
  )
}
