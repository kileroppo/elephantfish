import { useMemo } from 'react'
import type { AnalysisTask, GameSnapshot, MoveRecord, MoveReview } from '../../types'
import {
  bestLineWord,
  gradeDetail,
  gradeLabel,
  whySentence,
} from '../../lib/format'
import { useUIContext } from '../../context/UIContext'
import { RankList } from './RankList'

export interface LearnBlockProps {
  game: GameSnapshot
  analysis: AnalysisTask | null
}

function isFreshFor(analysis: AnalysisTask, game: GameSnapshot): boolean {
  const s = analysis.subject
  if (!s) return false
  return s.ply === game.ply && s.board === game.board && s.red_to_move === (game.turn === 'red')
}

function lastGradedHuman(records: MoveRecord[]): MoveRecord | null {
  for (let i = records.length - 1; i >= 0; i -= 1) {
    const r = records[i]
    if (r.by === 'opponent' && r.review) return r
  }
  return null
}

function bestLineText(review: MoveReview): string {
  const best = review.lines.find((l) => l.rank === 1) ?? review.lines[0]
  return best ? best.chinese || best.iccs : review.best_iccs || '—'
}

export function LearnBlock({ game, analysis }: LearnBlockProps) {
  const ui = useUIContext()
  const { playMode, liveHelper } = ui

  const graded = useMemo(() => lastGradedHuman(game.records), [game.records])
  const review = graded?.review ?? null
  const grade = gradeLabel(review)
  const why = review ? whySentence(review) : null
  const lines = analysis?.lines ?? []
  const fresh = analysis ? isFreshFor(analysis, game) : false

  if (!analysis && !review) return null

  return (
    <section
      className="learn-block flex flex-col gap-2.5 p-3 rounded-2xl bg-paper-0/95 border border-hairline/80 shadow-2xs select-none"
      aria-label="推荐走法与评估"
      data-learn=""
    >
      <header className="learn-head flex items-center justify-between pb-1.5 border-b border-hairline/60">
        <h3 className="text-xs font-bold text-ink-1">候选走法与评估</h3>
        <LearnStatus analysis={analysis} fresh={fresh} lines={lines.length} />
      </header>

      {review && (
        <div className="learn-review flex flex-col gap-2">
          <div className="learn-verdict flex items-center justify-between">
            {grade && (
              <span
                className={`grade-chip tone-${grade.tone} px-2 py-0.5 rounded text-xs font-semibold border ${
                  grade.tone === 'bad' || grade.tone === 'mate'
                    ? 'bg-rose-100 text-rose-800 border-rose-300'
                    : grade.tone === 'warn'
                    ? 'bg-orange-100 text-orange-800 border-orange-300'
                    : grade.tone === 'soft'
                    ? 'bg-amber-100 text-amber-800 border-amber-300'
                    : grade.tone === 'good'
                    ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                    : 'bg-paper-2 text-ink-mute border-hairline'
                }`}
                title={gradeDetail(review)}
              >
                {grade.text}
              </span>
            )}
            <span className="learn-played flex items-center gap-1.5 font-medium text-xs text-ink-1">
              <span>{graded?.chinese ?? review.played_iccs}</span>
            </span>
          </div>

          <div className="learn-best-row flex items-center justify-between gap-2 text-xs">
            <span className="learn-best-label text-ink-1">
              {bestLineWord(review)}{' '}
              <b className="font-semibold text-cinnabar">{bestLineText(review)}</b>
            </span>
            <span className="learn-rank-meta font-num text-[11px] text-ink-3">
              {review.rank !== 1 && review.rank !== null ? `第 ${review.rank} 名 · ` : ''}
              前 {review.width} 名优选
            </span>
          </div>

          {why && !why.includes('给不出吃子层面的原因') && !why.includes('两条主变子力差不多') && (
            <p className="learn-why text-xs text-ink-2 bg-paper-0/70 p-2 rounded border border-hairline/60 leading-relaxed m-0 font-kai">
              {why}
            </p>
          )}

          {review.tactics && (
            <div className="learn-tactics-row flex items-center justify-between gap-2 p-2 rounded bg-amber-50/60 border border-amber-200/80">
              <p className="learn-tactics text-xs text-amber-900 m-0 flex-1">
                <span className="motif-chip font-semibold bg-amber-200/70 text-amber-950 px-1.5 py-0.5 rounded mr-1">
                  #{review.tactics.motif_label}
                </span>{' '}
                {review.tactics.coach_summary}
              </p>
              <button
                type="button"
                className="btn btn-ghost btn-xs min-h-[28px] px-2 py-0.5 rounded text-[11px] font-medium bg-paper-0 hover:bg-paper-2 text-ink-1 border border-amber-300/80 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                onClick={() =>
                  ui.openDrillAt(review.tactics?.motif ?? review.tactics?.primary_motif)
                }
                title={`一键前往实训营巩固「${review.tactics.motif_label}」专题题库`}
              >
                🎯 练同类题
              </button>
            </div>
          )}

          <RankList lines={review.lines} playedIccs={review.played_iccs} withPv />
        </div>
      )}

      {lines.length > 0 && fresh && (playMode === 'relay' || game.engine_to_move || liveHelper === 'live_hints') && (
        <div className="live-lines flex flex-col gap-1.5 mt-1 pt-1 border-t border-hairline/50">
          <p className="learn-sub text-[11px] text-ink-mute m-0">
            {game.engine_to_move ? '引擎正在推演候选走法…' : '轮到您出招 · 推荐候选走法'}
          </p>
          <RankList lines={lines} playedIccs={null} withPv />
        </div>
      )}

      {lines.length > 0 && !fresh && (
        <p className="hint learn-hint text-[11px] text-ink-mute m-0 leading-relaxed font-kai">
          上一手的推荐走法已结束，轮到出招时将实时更新。
        </p>
      )}
    </section>
  )
}

function LearnStatus({
  analysis,
  lines,
}: {
  analysis: AnalysisTask | null
  fresh?: boolean
  lines: number
}) {
  if (!analysis) return null
  if (analysis.status === 'skipped')
    return (
      <span className="learn-state is-warn text-[11px] text-amber-700 font-medium">
        {analysis.result?.message || '引擎繁忙'}
      </span>
    )
  if (analysis.status === 'error')
    return <span className="learn-state is-bad text-[11px] text-rose-700 font-medium">分析超时</span>
  if (analysis.status === 'running')
    return (
      <span className="learn-state is-live text-[11px] text-jade font-medium animate-pulse">
        推演候选走法中…
      </span>
    )
  return (
    <span className="learn-state text-[11px] text-ink-3 font-num">
      {lines ? `${lines} 条候选` : ''}
    </span>
  )
}
