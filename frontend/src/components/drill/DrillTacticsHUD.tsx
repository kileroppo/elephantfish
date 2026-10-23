import React from 'react'
import type { ChoiceOption, TrainingPuzzle } from '../../types'

export interface DrillTacticsHUDProps {
  currentPuzzle: TrainingPuzzle | null
  feedback: { text: string; tone: 'info' | 'success' | 'warn' | 'error' }
  inRebuttal: boolean
  badStepsCount: number
  solved: boolean
  userSideLabel: string
  choiceMode: boolean
  choiceOptions: ChoiceOption[]
  animMode: 'none' | 'bad' | 'good' | 'threat'
  hoveredChoice: ChoiceOption | null
  hints?: string[]
  hintLevel?: number
  onUndo: () => void
  onStartBadAnim: () => void
  onStartGoodAnim: () => void
  onMirrorDrill: () => void
  onNextPuzzle: () => void
  onHoverChoice: (opt: ChoiceOption | null) => void
  onSelectChoiceRehearse: (opt: ChoiceOption) => void
  onMakeMove: (iccs: string) => void
}

/**
 * 现代冷精密战术 HUD (Precision Light Decision Matrix)
 */
export const DrillTacticsHUD: React.FC<DrillTacticsHUDProps> = ({
  currentPuzzle,
  feedback,
  inRebuttal,
  badStepsCount,
  solved,
  userSideLabel,
  choiceMode,
  choiceOptions,
  animMode,
  hoveredChoice,
  hints = [],
  hintLevel = 0,
  onUndo,
  onStartBadAnim,
  onStartGoodAnim,
  onMirrorDrill,
  onNextPuzzle,
  onHoverChoice,
  onSelectChoiceRehearse,
  onMakeMove,
}) => {
  const getStatusBadge = (status?: string) => {
    switch (status) {
      case 'mastered':
        return (
          <span className="text-[11px] px-2 py-0.5 rounded font-mono font-bold bg-emerald-50 text-emerald-700 border border-emerald-300 shadow-xs flex items-center gap-1">
            <span className="text-emerald-600">★</span>
            <span>MASTERED</span>
          </span>
        )
      case 'solved_with_hints':
        return (
          <span className="text-[11px] px-2 py-0.5 rounded font-mono font-medium bg-sky-50 text-sky-700 border border-sky-300 flex items-center gap-1">
            <span>✓</span>
            <span>SOLVED</span>
          </span>
        )
      case 'in_progress':
        return (
          <span className="text-[11px] px-2 py-0.5 rounded font-mono font-medium bg-amber-50 text-amber-700 border border-amber-300">
            TRAINING
          </span>
        )
      default:
        return (
          <span className="text-[11px] px-2 py-0.5 rounded font-mono text-slate-500 bg-slate-100 border border-slate-200">
            PENDING
          </span>
        )
    }
  }

  return (
    <div className="flex flex-col gap-3 select-none text-slate-800 font-sans">
      {/* 1. 战术态势舱 (Tactical Mission Header) */}
      {currentPuzzle && (
        <div className="p-3.5 bg-white rounded-xl border border-slate-200/90 shadow-sm flex flex-col gap-2.5 transition-all">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-bold text-red-700 bg-red-50 border border-red-200 px-2.5 py-0.5 rounded tracking-wider uppercase font-mono">
                {currentPuzzle.plain_motif_label || currentPuzzle.target}
              </span>
              <span className="text-xs font-semibold text-red-600 font-mono tracking-wide">
                {userSideLabel}
              </span>
            </div>
            <div className="flex items-center gap-2">
              {getStatusBadge(currentPuzzle.status)}
            </div>
          </div>

          <div>
            <h3 className="m-0 text-base sm:text-lg font-bold text-slate-900 tracking-tight flex items-center gap-2">
              <span>{currentPuzzle.title}</span>
            </h3>
            {currentPuzzle.master_quote && (
              <p className="m-0 mt-1 text-xs text-slate-500 leading-relaxed font-sans">
                “{currentPuzzle.master_quote}”
              </p>
            )}
          </div>

          <div className="flex items-center justify-between text-[11px] text-slate-500 pt-2 border-t border-slate-100 font-mono flex-wrap gap-2">
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1">
                <span className="text-slate-400">DIFFICULTY:</span>
                <span className="text-amber-500 font-bold tracking-widest">
                  {'★'.repeat(currentPuzzle.difficulty || 1)}
                </span>
              </span>
              <span className="text-slate-300">|</span>
              <span>
                <span className="text-slate-400">ATTEMPTS:</span>{' '}
                <b className="text-slate-800 font-bold">{currentPuzzle.attempts}</b>
              </span>
            </div>
            {currentPuzzle.key_square_info && (
              <div className="text-[11px] text-sky-600 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-sky-500 animate-pulse" />
                <span>要害格: {currentPuzzle.key_square_info.dest_square}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 2. 状态警报/成功态势舱 (Resolved / Rebuttal Alert) */}
      {solved ? (
        <div className="p-3.5 rounded-xl bg-emerald-50/90 border border-emerald-300 text-emerald-950 flex flex-col gap-2.5 shadow-sm animate-fadeIn">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
              <span className="text-xs font-bold text-emerald-800 tracking-wider font-mono uppercase">
                CRITICAL TARGET DESTROYED · 成功破局
              </span>
            </div>
            <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-emerald-200/80 text-emerald-800 border border-emerald-300">
              ACCURACY 100%
            </span>
          </div>

          {currentPuzzle?.explanation && (
            <p className="m-0 text-xs leading-relaxed text-emerald-900 font-sans">
              {currentPuzzle.explanation}
            </p>
          )}

          {currentPuzzle?.key_square_info && (
            <div className="p-2.5 rounded bg-emerald-100/60 border border-emerald-300/80 text-xs text-emerald-950 font-sans">
              <div className="font-bold text-emerald-800 font-mono mb-0.5 flex items-center gap-1.5">
                <span>⚡ 破局要害：</span>
                <span className="text-white font-mono bg-emerald-700 px-1 py-0.2 rounded">
                  {currentPuzzle.key_square_info.zone_name} · {currentPuzzle.key_square_info.dest_square}
                </span>
              </div>
              <div className="text-[11px] text-emerald-900/90 leading-relaxed">
                {currentPuzzle.key_square_info.why_key}
              </div>
            </div>
          )}

          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              className="flex-1 min-h-[34px] px-3 py-1 rounded bg-white hover:bg-slate-50 border border-sky-300 text-sky-700 text-xs font-semibold font-mono transition-all cursor-pointer shadow-xs active:scale-[0.98] flex items-center justify-center gap-1.5"
              onClick={onMirrorDrill}
              title="水平镜像翻转该残局，考验是否真正理解棋理而非死记坐标"
            >
              <span>🔄</span>
              <span>MIRROR DRILL (镜像变式)</span>
            </button>
            <button
              type="button"
              className="flex-1 min-h-[34px] px-3 py-1 rounded bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold font-mono transition-all cursor-pointer shadow-xs active:scale-[0.98] flex items-center justify-center gap-1.5"
              onClick={onNextPuzzle}
              title="进入下一道精训题"
            >
              <span>NEXT PUZZLE (下一题)</span>
              <span>➔</span>
            </button>
          </div>
        </div>
      ) : inRebuttal ? (
        <div className="p-3.5 rounded-xl bg-rose-50/90 border border-rose-300 text-rose-950 flex flex-col gap-2.5 shadow-sm animate-fadeIn">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-rose-500 animate-ping" />
              <span className="text-xs font-bold text-rose-800 tracking-wider font-mono uppercase">
                TACTICAL FLAW DETECTED · 遭敌方强力反制
              </span>
            </div>
            <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-rose-200 text-rose-800 border border-rose-300">
              EVAL DROP
            </span>
          </div>

          <p className="m-0 text-xs leading-relaxed text-rose-900 font-sans">
            {feedback.text}
          </p>

          <div className="flex items-center gap-2 pt-1 flex-wrap font-mono">
            <button
              type="button"
              className="flex-1 min-h-[34px] px-3 py-1 rounded bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold transition-all cursor-pointer shadow-xs active:scale-[0.98] flex items-center justify-center gap-1"
              onClick={onUndo}
            >
              <span>↩</span>
              <span>UNDO & RETRY (撤回重试)</span>
            </button>
            {badStepsCount > 0 && (
              <button
                type="button"
                className="px-3 min-h-[34px] rounded bg-white hover:bg-rose-50 text-rose-700 text-xs font-semibold border border-rose-300 transition-all cursor-pointer shadow-xs active:scale-[0.98]"
                onClick={onStartBadAnim}
              >
                🎬 反制回放 ({badStepsCount}手)
              </button>
            )}
            <button
              type="button"
              className="px-3 min-h-[34px] rounded bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold border border-slate-200 transition-all cursor-pointer shadow-xs active:scale-[0.98]"
              onClick={onStartGoodAnim}
            >
              ✓ 正解演示
            </button>
          </div>
        </div>
      ) : null}

      {/* 3. 决策分支矩阵 (Decision Matrix Table) */}
      {choiceMode && choiceOptions.length > 0 && !solved && animMode === 'none' && !inRebuttal && (
        <div className="p-3 bg-white rounded-xl border border-slate-200/90 shadow-sm flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2 pb-1.5 border-b border-slate-100">
            <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5 font-mono">
              <span className="text-sky-600">❖</span>
              <span>DECISION BRANCH MATRIX (着法决策矩阵)</span>
            </span>
            <span className="text-[10px] font-mono text-slate-400">
              HOVER TO PREVIEW · DIRECT PLAY ENABLED
            </span>
          </div>

          <div className="flex flex-col gap-1.5">
            {choiceOptions.map((opt) => {
              const isHovered = hoveredChoice?.id === opt.id
              const isCorrect = opt.is_correct

              return (
                <div
                  key={opt.id}
                  className={`px-3 py-2.5 rounded-lg border transition-all duration-150 cursor-pointer flex items-center justify-between gap-3 ${
                    isHovered
                      ? 'bg-sky-50/70 border-sky-400 shadow-sm ring-1 ring-sky-300/40'
                      : 'bg-slate-50/70 border-slate-200/80 hover:bg-slate-100/80 hover:border-slate-300'
                  }`}
                  onMouseEnter={() => onHoverChoice(opt)}
                  onMouseLeave={() => onHoverChoice(null)}
                >
                  {/* 左侧：标签、着法名称、胜率条 */}
                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    <span
                      className={`w-5 h-5 rounded font-mono text-[11px] font-bold flex items-center justify-center shrink-0 ${
                        isCorrect
                          ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                          : 'bg-slate-200 text-slate-600 border border-slate-300'
                      }`}
                    >
                      {opt.label}
                    </span>

                    <div className="flex flex-col min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs sm:text-sm font-bold text-slate-900 font-mono tracking-tight">
                          {opt.chinese}
                        </span>
                        <span
                          className={`text-[10px] font-mono px-1.5 py-0.2 rounded font-semibold shrink-0 ${
                            isCorrect
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                              : 'bg-rose-50 text-rose-700 border border-rose-200'
                          }`}
                        >
                          {isCorrect ? '+M1 绝杀' : opt.verdict_tag || '失着'}
                        </span>
                      </div>
                      <p
                        className="m-0 text-[11px] text-slate-500 truncate max-w-[240px] sm:max-w-[320px] font-sans leading-tight mt-0.5"
                        title={opt.teaser}
                      >
                        {opt.teaser}
                      </p>
                    </div>
                  </div>

                  {/* 右侧：动作按钮 (演练 / 落子) */}
                  <div className="flex items-center gap-1.5 shrink-0 font-mono">
                    <button
                      type="button"
                      className="h-7 px-2 text-[11px] text-slate-700 hover:text-slate-900 bg-white hover:bg-slate-100 rounded border border-slate-200 transition cursor-pointer active:scale-95 flex items-center gap-1 shadow-3xs"
                      onClick={(e) => {
                        e.stopPropagation()
                        onSelectChoiceRehearse(opt)
                      }}
                      title="推演试看该分支走法"
                    >
                      <span className="text-[10px]">🎬</span>
                      <span className="hidden sm:inline">推演</span>
                    </button>
                    <button
                      type="button"
                      className="h-7 px-2.5 text-[11px] font-bold text-white bg-red-600 hover:bg-red-700 rounded border border-red-600 transition cursor-pointer shadow-xs active:scale-95 flex items-center gap-1"
                      onClick={(e) => {
                        e.stopPropagation()
                        onMakeMove(opt.iccs)
                      }}
                      title="落子确认"
                    >
                      <span>♟</span>
                      <span>落子</span>
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* 4. 启发式点拨锦囊 (Telemetry Hint Feed) */}
      {hints.length > 0 && !solved && (
        <div className="p-3 bg-amber-50/80 rounded-xl border border-amber-200 flex flex-col gap-2 shadow-sm animate-fadeIn">
          <div className="flex items-center justify-between text-xs font-mono font-bold text-amber-900">
            <span className="flex items-center gap-1.5">
              <span>💡</span>
              <span>HEURISTIC HINTS (启发点拨 {hintLevel || hints.length}/3 级)</span>
            </span>
          </div>
          <div className="flex flex-col gap-1.5">
            {hints.map((h, i) => (
              <div key={i} className="text-xs text-amber-900 leading-relaxed flex items-start gap-2 font-sans">
                <span className="font-mono font-bold shrink-0 bg-amber-100 text-amber-900 border border-amber-300 px-1 py-0.2 rounded text-[10px]">
                  LV.{i + 1}
                </span>
                <span>{h}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
