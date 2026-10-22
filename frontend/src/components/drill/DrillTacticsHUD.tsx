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
  const getStatusChip = (status?: string) => {
    switch (status) {
      case 'mastered':
        return (
          <span className="text-[11px] px-2.5 py-0.5 rounded-full font-bold bg-emerald-100 text-emerald-800 border border-emerald-300 shadow-3xs">
            ★ 已掌握
          </span>
        )
      case 'solved_with_hints':
        return (
          <span className="text-[11px] px-2.5 py-0.5 rounded-full font-semibold bg-blue-100 text-blue-800 border border-blue-300 shadow-3xs">
            ✓ 已通关
          </span>
        )
      case 'in_progress':
        return (
          <span className="text-[11px] px-2.5 py-0.5 rounded-full font-semibold bg-amber-100 text-amber-800 border border-amber-300 shadow-3xs">
            练习中
          </span>
        )
      default:
        return (
          <span className="text-[11px] px-2.5 py-0.5 rounded-full font-medium bg-stone-100 text-stone-600 border border-stone-200 shadow-3xs">
            待挑战
          </span>
        )
    }
  }

  return (
    <div className="flex flex-col gap-3 select-none">
      {/* 1. 战术使命与心法卡片 */}
      {currentPuzzle && (
        <div className="p-3.5 bg-paper-0/95 rounded-2xl border border-hairline/80 shadow-2xs flex flex-col gap-2 transition-all duration-200">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <span className="text-[11px] font-bold text-white bg-cinnabar px-2.5 py-0.5 rounded-lg shadow-3xs">
              {currentPuzzle.plain_motif_label || currentPuzzle.target}
            </span>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-cinnabar font-display tracking-wide">{userSideLabel}</span>
              {getStatusChip(currentPuzzle.status)}
            </div>
          </div>

          <div>
            <h3 className="m-0 text-base font-bold text-ink-0 font-display tracking-wide">
              {currentPuzzle.title}
            </h3>
            {currentPuzzle.master_quote && (
              <p className="m-0 mt-1 text-xs text-ink-2 italic font-kai leading-relaxed">
                “{currentPuzzle.master_quote}”
              </p>
            )}
          </div>

          <div className="flex items-center gap-3 text-[11px] text-ink-3 pt-1.5 border-t border-hairline/60">
            <span>难度：{'★'.repeat(currentPuzzle.difficulty || 1)}</span>
            <span>已试走：<b className="font-num text-ink-1">{currentPuzzle.attempts}</b> 次</span>
          </div>
        </div>
      )}

      {/* 2. 动态教练指导与复盘总结 */}
      {solved ? (
        <div className="p-4 rounded-2xl bg-gradient-to-br from-emerald-500/12 via-emerald-500/5 to-paper-0 border border-emerald-500/35 text-emerald-950 flex flex-col gap-2.5 shadow-sm animate-fadeIn">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-emerald-900 flex items-center gap-1.5">
              <span className="text-sm">🎉</span>
              <span>精彩！一击毙命，成功破局！</span>
            </span>
            <span className="text-[11px] font-bold text-emerald-800 bg-emerald-100/90 px-2.5 py-0.5 rounded-full border border-emerald-200 shadow-3xs">
              通关复盘
            </span>
          </div>

          {currentPuzzle?.explanation && (
            <p className="m-0 text-xs leading-relaxed text-emerald-900 font-normal">
              {currentPuzzle.explanation}
            </p>
          )}

          {currentPuzzle?.key_square_info && (
            <div className="p-2.5 rounded-xl bg-emerald-100/80 border border-emerald-300/80 text-xs text-emerald-950 shadow-3xs">
              <div className="font-bold mb-0.5">
                📍 关键位置依据（{currentPuzzle.key_square_info.zone_name} · {currentPuzzle.key_square_info.dest_square}）：
              </div>
              <div className="text-[11.5px] leading-relaxed text-emerald-900">
                {currentPuzzle.key_square_info.why_key}
              </div>
            </div>
          )}

          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              className="flex-1 min-h-[34px] px-3 py-1 rounded-xl bg-gradient-to-r from-purple-700 to-indigo-700 hover:from-purple-800 hover:to-indigo-800 text-white text-xs font-bold transition-all duration-200 cursor-pointer shadow-[0_4px_12px_rgba(126,34,206,0.25)] active:scale-95 flex items-center justify-center gap-1.5"
              onClick={onMirrorDrill}
              title="水平镜像翻转该残局，考验是否真正理解棋理而非死记坐标"
            >
              <span>🔄</span>
              <span>挑战镜像变式</span>
            </button>
            <button
              type="button"
              className="flex-1 min-h-[34px] px-3 py-1 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-700 hover:from-emerald-700 hover:to-teal-800 text-white text-xs font-bold transition-all duration-200 cursor-pointer shadow-[0_4px_12px_rgba(5,150,105,0.25)] active:scale-95 flex items-center justify-center gap-1.5"
              onClick={onNextPuzzle}
              title="进入下一道精训题"
            >
              <span>下一题</span>
              <span>⏭</span>
            </button>
          </div>
        </div>
      ) : inRebuttal ? (
        <div className="p-4 rounded-2xl bg-gradient-to-br from-rose-500/12 via-rose-500/5 to-paper-0 border border-rose-500/35 text-rose-950 flex flex-col gap-2.5 shadow-sm animate-fadeIn">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-rose-900 flex items-center gap-1.5">
              <span className="text-sm">⚠️</span>
              <span>走漏了！对手已借机反扑</span>
            </span>
            <span className="text-[11px] font-bold text-rose-800 bg-rose-100/90 px-2.5 py-0.5 rounded-full border border-rose-200 shadow-3xs">
              反击警戒
            </span>
          </div>

          <p className="m-0 text-xs leading-relaxed text-rose-900">
            {feedback.text}
          </p>

          <div className="flex items-center gap-2 pt-1 flex-wrap">
            <button
              type="button"
              className="flex-1 min-h-[34px] px-3 py-1 rounded-xl bg-cinnabar hover:bg-cinnabar-bright text-white text-xs font-bold transition-all duration-200 cursor-pointer shadow-[0_4px_12px_rgba(217,72,56,0.3)] active:scale-95"
              onClick={onUndo}
            >
              ↩ 看懂了，退回重走
            </button>
            {badStepsCount > 0 && (
              <button
                type="button"
                className="px-3 min-h-[34px] rounded-xl bg-paper-0 hover:bg-paper-2 text-rose-900 text-xs font-semibold border border-rose-300 transition-all cursor-pointer shadow-3xs active:scale-95"
                onClick={onStartBadAnim}
              >
                ▶ 演示走错后果 ({badStepsCount}步)
              </button>
            )}
            <button
              type="button"
              className="px-3 min-h-[34px] rounded-xl bg-paper-0 hover:bg-paper-2 text-ink-1 text-xs font-semibold border border-hairline transition-all cursor-pointer shadow-3xs active:scale-95"
              onClick={onStartGoodAnim}
            >
              ✅ 看正着演示
            </button>
          </div>
        </div>
      ) : (
        <div className="p-3 rounded-2xl bg-paper-0/80 border border-hairline/80 text-ink-1 text-xs leading-relaxed flex items-center gap-2.5 shadow-3xs">
          <span className="text-sm shrink-0">💡</span>
          <span className="leading-relaxed">{feedback.text}</span>
        </div>
      )}

      {/* 3. 三选一演练试探卡片 (Awwwards / Apple Spring 交互卡片) */}
      {choiceMode && choiceOptions.length > 0 && !solved && animMode === 'none' && (
        <div className="p-3.5 bg-paper-0/95 rounded-2xl border border-hairline/80 shadow-2xs flex flex-col gap-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-bold text-ink-0 flex items-center gap-1.5">
              <span>🎯</span>
              <span>三选一试探（悬停预览盘面虚影）</span>
            </span>
            <span className="text-[10.5px] text-ink-3">亦可在棋盘直走</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {choiceOptions.map((opt) => {
              const isHovered = hoveredChoice?.id === opt.id
              return (
                <div
                  key={opt.id}
                  className={`p-2.5 rounded-2xl bg-paper-1/80 border flex flex-col justify-between gap-2 transition-all duration-200 cursor-pointer ${
                    isHovered
                      ? 'border-blue-600 -translate-y-1 shadow-md bg-paper-0 ring-2 ring-blue-500/20'
                      : 'border-hairline/80 hover:border-blue-400 hover:-translate-y-0.5'
                  }`}
                  onMouseEnter={() => onHoverChoice(opt)}
                  onMouseLeave={() => onHoverChoice(null)}
                >
                  <div className="flex items-center justify-between">
                    <span className="w-5.5 h-5.5 rounded-full bg-ink-0 text-white text-[11px] font-bold flex items-center justify-center shadow-inner">
                      {opt.label}
                    </span>
                    <span className="text-sm font-bold text-ink-0 font-display">{opt.chinese}</span>
                  </div>

                  <p className="m-0 text-[11px] leading-relaxed text-ink-2 min-h-[2.5em] line-clamp-2">
                    {opt.teaser}
                  </p>

                  <div className="flex items-center gap-1.5 mt-1">
                    <button
                      type="button"
                      className="flex-1 h-7.5 px-2 text-[11px] font-medium text-ink-2 hover:text-ink-0 bg-paper-0 hover:bg-paper-2 rounded-xl border border-hairline transition cursor-pointer active:scale-95 shadow-3xs"
                      onClick={() => onSelectChoiceRehearse(opt)}
                      title="在棋盘上播放这步棋的演练动画"
                    >
                      🎬 演练
                    </button>
                    <button
                      type="button"
                      className="flex-1 h-7.5 px-2 text-[11px] font-bold text-white bg-cinnabar hover:bg-cinnabar-bright rounded-xl border border-cinnabar transition cursor-pointer shadow-xs active:scale-95"
                      onClick={() => onMakeMove(opt.iccs)}
                      title="确认走出这步棋"
                    >
                      落子 ♟
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* 4. 渐进式启发提示展示 */}
      {hints.length > 0 && !solved && (
        <div className="p-3.5 bg-gradient-to-br from-amber-500/10 via-amber-500/5 to-paper-0 rounded-2xl border border-amber-500/30 flex flex-col gap-2 shadow-2xs animate-fadeIn">
          <div className="flex items-center justify-between text-xs font-bold text-amber-950">
            <span>💡 启发点拨锦囊（已揭晓 {hintLevel || hints.length}/3 级）</span>
          </div>
          <div className="flex flex-col gap-1.5">
            {hints.map((h, i) => (
              <div key={i} className="text-xs text-amber-900 leading-relaxed flex items-start gap-1.5">
                <span className="font-bold shrink-0 bg-amber-200/80 text-amber-950 px-1.5 py-0.2 rounded-md text-[10.5px]">
                  第 {i + 1} 级
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
