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
  onUndo: () => void
  onStartBadAnim: () => void
  onStartGoodAnim: () => void
  onMirrorDrill: () => void
  onNextPuzzle: () => void
  onHoverChoice: (opt: ChoiceOption | null) => void
  onSelectChoiceRehearse: (opt: ChoiceOption) => void
  onMakeMove: (iccs: string) => void
}

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
  onUndo,
  onStartBadAnim,
  onStartGoodAnim,
  onMirrorDrill,
  onNextPuzzle,
  onHoverChoice,
  onSelectChoiceRehearse,
  onMakeMove,
}) => {
  const getFeedbackToneClasses = (tone: 'info' | 'success' | 'warn' | 'error') => {
    switch (tone) {
      case 'success':
        return 'bg-emerald-50 text-emerald-900 border-emerald-200'
      case 'warn':
        return 'bg-amber-50 text-amber-900 border-amber-200'
      case 'error':
        return 'bg-rose-50 text-rose-900 border-rose-200'
      case 'info':
      default:
        return 'bg-blue-50/80 text-blue-900 border-blue-200'
    }
  }

  const getStatusChip = (status?: string) => {
    switch (status) {
      case 'mastered':
        return (
          <span className="text-[11px] px-2 py-0.5 rounded-full font-semibold bg-emerald-100 text-emerald-800 border border-emerald-300">
            ★ 已掌握
          </span>
        )
      case 'solved_with_hints':
        return (
          <span className="text-[11px] px-2 py-0.5 rounded-full font-semibold bg-blue-100 text-blue-800 border border-blue-300">
            ✓ 已通关(用过提示)
          </span>
        )
      case 'in_progress':
        return (
          <span className="text-[11px] px-2 py-0.5 rounded-full font-semibold bg-amber-100 text-amber-800 border border-amber-300">
            练习中
          </span>
        )
      default:
        return (
          <span className="text-[11px] px-2 py-0.5 rounded-full font-semibold bg-stone-100 text-stone-600 border border-stone-200">
            待挑战
          </span>
        )
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {/* 1. 题目信息卡 */}
      {currentPuzzle && (
        <div className="p-3 bg-paper-0 rounded-lg border border-hairline shadow-xs">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[11px] font-bold text-white bg-[#2b5c8f] px-2 py-0.5 rounded">
              {currentPuzzle.plain_motif_label || currentPuzzle.target}
            </span>
            {getStatusChip(currentPuzzle.status)}
          </div>
          <h3 className="m-0 mb-1 text-sm font-bold text-ink-0">{currentPuzzle.title}</h3>
          {currentPuzzle.plain_subtitle && (
            <p className="m-0 mb-2 text-xs leading-relaxed text-ink-2">{currentPuzzle.plain_subtitle}</p>
          )}
          <div className="flex items-center gap-3 text-[11.5px] text-ink-3 flex-wrap">
            <span>难度：{'★'.repeat(currentPuzzle.difficulty)}</span>
            <span className="font-bold text-cinnabar">{userSideLabel}</span>
            <span>已试：{currentPuzzle.attempts} 次</span>
          </div>
        </div>
      )}

      {/* 2. 实时大白话解说横幅 */}
      <div className={`p-3 rounded-lg text-xs leading-relaxed border ${getFeedbackToneClasses(feedback.tone)}`}>
        <div className="font-medium">{feedback.text}</div>

        {/* 师傅当场反击引导 */}
        {inRebuttal && (
          <div className="flex items-center flex-wrap gap-2 mt-2 pt-2 border-t border-rose-200">
            <button
              type="button"
              className="px-2.5 py-1 rounded bg-cinnabar hover:bg-cinnabar-bright text-white text-[11px] font-semibold transition-colors cursor-pointer shadow-xs"
              onClick={onUndo}
            >
              ↩ 看懂了，退回重走这步
            </button>
            <button
              type="button"
              className="px-2 py-1 rounded bg-white/70 hover:bg-white text-ink-1 text-[11px] font-medium border border-rose-300 transition-colors cursor-pointer"
              onClick={onStartBadAnim}
            >
              ▶ 重播走错 {badStepsCount} 步动画
            </button>
            <button
              type="button"
              className="px-2 py-1 rounded bg-white/70 hover:bg-white text-ink-1 text-[11px] font-medium border border-rose-300 transition-colors cursor-pointer"
              onClick={onStartGoodAnim}
            >
              ✅ 看走对应该怎么赢
            </button>
          </div>
        )}

        {/* 通关复盘解析 */}
        {solved && currentPuzzle?.explanation && (
          <div className="mt-2.5 pt-2 border-t border-dashed border-emerald-300">
            <h4 className="m-0 mb-1 text-xs font-bold text-emerald-950">🎉 通关总结：为什么这步是好棋？</h4>
            <p className="m-0 text-xs leading-relaxed text-emerald-900">{currentPuzzle.explanation}</p>
            {currentPuzzle.key_square_info && (
              <div className="mt-1.5 p-2 rounded bg-emerald-100/70 border border-emerald-300 text-[11.5px] text-emerald-950">
                <span className="font-bold">📍 关键位置依据（{currentPuzzle.key_square_info.zone_name} · {currentPuzzle.key_square_info.dest_square}）：</span>
                <span>{currentPuzzle.key_square_info.why_key}</span>
              </div>
            )}
            <div className="flex items-center gap-2 mt-2.5">
              <button
                type="button"
                className="min-h-[30px] px-3 py-1 rounded bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold transition-colors cursor-pointer shadow-xs"
                onClick={onMirrorDrill}
                title="水平镜像翻转该残局，考验是否真正理解棋理"
              >
                🔄 立即挑战镜像变式
              </button>
              <button
                type="button"
                className="min-h-[30px] px-3 py-1 rounded bg-white/80 hover:bg-white text-emerald-900 text-xs font-medium border border-emerald-300 transition-colors cursor-pointer"
                onClick={onNextPuzzle}
                title="进入下一道精训题"
              >
                ⏭ 下一题
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 3. 三选一演练试探卡片 */}
      {choiceMode && choiceOptions.length > 0 && !solved && animMode === 'none' && (
        <div className="p-3 rounded-lg bg-paper-1 border border-hairline-strong">
          <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
            <span className="text-xs font-bold text-ink-0">🎯 三选一演练试探（鼠标悬停预览盘面残影）</span>
            <span className="text-[11px] text-ink-3">或直接在盘上落子</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {choiceOptions.map((opt) => {
              const isHovered = hoveredChoice?.id === opt.id
              return (
                <div
                  key={opt.id}
                  className={`p-2.5 rounded-md bg-paper-0 border-1.5 flex flex-col justify-between gap-2 transition-all cursor-pointer ${
                    isHovered
                      ? 'border-blue-600 -translate-y-0.5 shadow-md'
                      : 'border-hairline shadow-xs hover:border-blue-400'
                  }`}
                  onMouseEnter={() => onHoverChoice(opt)}
                  onMouseLeave={() => onHoverChoice(null)}
                >
                  <div className="flex items-center justify-between gap-1.5">
                    <span className="w-5 h-5 rounded-full bg-ink-0 text-paper-0 text-[11px] font-extrabold flex items-center justify-center shrink-0">
                      {opt.label}
                    </span>
                    <span className="text-sm font-bold text-ink-0 font-display">{opt.chinese}</span>
                    <span
                      className={`text-[10.5px] px-1.5 py-0.5 rounded font-semibold ${
                        opt.is_correct ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
                      }`}
                    >
                      {opt.verdict_tag}
                    </span>
                  </div>
                  <p className="m-0 text-[11.5px] leading-relaxed text-ink-2">{opt.teaser}</p>
                  <div className="flex items-center gap-1.5 mt-1">
                    <button
                      type="button"
                      className="flex-1 min-h-[30px] px-2 py-0.5 text-xs font-medium text-ink-2 hover:text-ink-0 bg-transparent hover:bg-black/5 rounded border border-hairline transition-colors cursor-pointer"
                      onClick={() => onSelectChoiceRehearse(opt)}
                      title="在棋盘上动画播放这步棋的连锁演练动画"
                    >
                      🎬 演练({opt.steps?.length || 0}步)
                    </button>
                    <button
                      type="button"
                      className={`flex-1 min-h-[30px] px-2 py-0.5 text-xs font-semibold rounded transition-colors cursor-pointer shadow-xs ${
                        opt.is_correct
                          ? 'bg-cinnabar hover:bg-cinnabar-bright text-white'
                          : 'bg-paper-2 hover:bg-paper-3 text-ink-1 border border-hairline'
                      }`}
                      onClick={() => onMakeMove(opt.iccs)}
                      title="确认在棋盘上走出这步棋"
                    >
                      落子 ♟️
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
