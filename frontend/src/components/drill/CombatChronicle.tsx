import React, { useState } from 'react'
import type { AnimatedStep, ChoiceOption, ProsConsAnalysis, TrainingPuzzle } from '../../types'

export interface CombatChronicleProps {
  currentPuzzle: TrainingPuzzle | null
  solved: boolean
  inRebuttal: boolean
  feedback: { text: string; tone: 'info' | 'success' | 'warn' | 'error' }
  prosCons?: ProsConsAnalysis | null
  badStepsCount: number
  hoveredChoice?: ChoiceOption | null
  choiceOptions?: ChoiceOption[]
  reveal?: boolean
  hints?: string[]
  hintLevel?: number
  moveHistory: Array<{
    turn: 'user' | 'engine'
    chinese: string
    iccs: string
    evalText?: string
    isFault?: boolean
    comment?: string
  }>
  elapsedSeconds: number
  animMode?: 'none' | 'bad' | 'good' | 'threat'
  animSteps?: AnimatedStep[]
  animStep?: number
  onHoverChoice?: (opt: ChoiceOption | null) => void
  onSelectChoiceRehearse?: (opt: ChoiceOption) => void
  onMakeMove?: (iccs: string) => void
}

const formatClock = (total: number) => {
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

const ANIM_MODE_LABEL: Record<'bad' | 'good' | 'threat', string> = {
  bad: '后果推演',
  good: '路线演示',
  threat: '威胁预览',
}

/**
 * 战况解说屏（Combat Chronicle）
 * 只呈现真实数据与解说：判词来自服务端 pros_cons，人设文案来自 moveHistory.comment，
 * 推演摘要在分步动画播放时列出每一步 —— 不放假胜串、不重复盘面胶囊上的操作按钮。
 */
export const CombatChronicle: React.FC<CombatChronicleProps> = ({
  currentPuzzle,
  solved,
  inRebuttal,
  feedback,
  prosCons,
  hoveredChoice,
  choiceOptions = [],
  reveal = false,
  hints = [],
  hintLevel = 0,
  moveHistory,
  elapsedSeconds,
  animMode = 'none',
  animSteps = [],
  animStep = 0,
  onHoverChoice,
  onSelectChoiceRehearse,
  onMakeMove,
}) => {
  // 对局记录的人设文案：失着行默认展开，其余行点击展开
  const [expandedComments, setExpandedComments] = useState<Set<number>>(() => new Set())
  const toggleComment = (idx: number) =>
    setExpandedComments((prev) => {
      const next = new Set(prev)
      if (next.has(idx)) next.delete(idx)
      else next.add(idx)
      return next
    })

  const motifLabel = currentPuzzle?.plain_motif_label || currentPuzzle?.target
  const keySquare = currentPuzzle?.key_square_info?.dest_square

  return (
    <div className="flex flex-col h-full text-ink-1 font-ui select-none overflow-y-auto px-2 py-1 space-y-6">
      {/* 1. 顶部：题名与本局用时 */}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <h2 className="m-0 text-xl font-bold text-ink-0 tracking-tight font-kai truncate">
            {currentPuzzle?.title || '训练准备中…'}
          </h2>
          <div className="flex items-center gap-2 font-num text-xs shrink-0">
            <span className="text-ink-3" title="本局用时">{formatClock(elapsedSeconds)}</span>
            <span
              className={`w-2 h-2 rounded-full ${
                solved ? 'bg-jade' : inRebuttal ? 'bg-cinnabar animate-ping' : 'bg-paper-4'
              }`}
            />
          </div>
        </div>

        {/* 单行流式微数据（全部来自当前题目真实数据，缺省即隐藏） */}
        {(motifLabel || keySquare) && (
          <div className="flex items-center gap-2.5 text-xs text-ink-2 font-num flex-wrap">
            {motifLabel && (
              <span className="font-semibold text-ink-1 bg-paper-2 px-2 py-0.5 rounded-full font-ui">
                {motifLabel}
              </span>
            )}
            {keySquare && (
              <>
                <span className="text-ink-4">•</span>
                <span>
                  要害 <b className="text-ink-0 font-bold">{keySquare}</b>
                </span>
              </>
            )}
          </div>
        )}
      </div>

      {/* 2. 候选分支对比流（与盘面胶囊一致：默认中性呈现，不泄露正着） */}
      {choiceOptions.length > 0 && !solved && !inRebuttal && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-[11px] font-num text-ink-3 pb-1">
            <span>候选分支</span>
            <span className="text-[10px]">悬停可在盘面预览，点击即落子</span>
          </div>

          <div className="space-y-1">
            {choiceOptions.map((opt) => {
              const isHovered = hoveredChoice?.id === opt.id

              return (
                <div
                  key={opt.id}
                  className={`group px-3 py-2 rounded-xl transition-[background-color,color,box-shadow] duration-150 cursor-pointer flex items-center justify-between gap-3 ${
                    isHovered
                      ? 'bg-paper-2 text-ink-0 shadow-3xs'
                      : 'hover:bg-paper-1 text-ink-1'
                  }`}
                  onMouseEnter={() => onHoverChoice?.(opt)}
                  onMouseLeave={() => onHoverChoice?.(null)}
                  onClick={() => onMakeMove?.(opt.iccs)}
                >
                  {/* 左侧：标号 + 走法名 + 精炼要害 */}
                  <div className="flex items-center gap-3 min-w-0">
                    <span
                      className={`w-5 h-5 rounded-md font-num text-[11px] font-bold flex items-center justify-center shrink-0 transition-colors ${
                        isHovered ? 'bg-ink-1 text-paper-0' : 'bg-paper-2 text-ink-2'
                      }`}
                    >
                      {opt.label}
                    </span>

                    <div className="flex items-baseline gap-2 min-w-0">
                      <b className="text-sm font-kai text-ink-0 whitespace-nowrap">
                        {opt.chinese}
                      </b>
                      {reveal && (
                        <span
                          className={`text-[10px] font-num px-1.5 py-0.5 rounded font-semibold whitespace-nowrap ${
                            opt.is_correct
                              ? 'text-jade bg-jade/10'
                              : 'text-cinnabar bg-cinnabar/10'
                          }`}
                        >
                          {opt.is_correct ? '正着' : opt.verdict_tag || '失着'}
                        </span>
                      )}
                      <span className="text-xs text-ink-3 truncate max-w-[180px] font-ui">
                        {opt.teaser?.replace(/！.*/, '') || ''}
                      </span>
                    </div>
                  </div>

                  {/* 右侧：试看推演图标 */}
                  <div className="flex items-center gap-1.5 opacity-60 group-hover:opacity-100 transition-opacity shrink-0">
                    <button
                      type="button"
                      className="h-6 px-2 text-[11px] font-num text-ink-2 hover:text-ink-0 hover:bg-paper-0 rounded transition cursor-pointer border-0 bg-transparent flex items-center gap-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-cinnabar"
                      onClick={(e) => {
                        e.stopPropagation()
                        onSelectChoiceRehearse?.(opt)
                      }}
                      title="推演试看"
                    >
                      <span>🎬</span>
                      <span className="hidden sm:inline">试看</span>
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* 3. 走偏反噬告警（仅解说；回溯/看后果按钮集中在盘面胶囊，避免重复） */}
      {inRebuttal && (
        <div
          className="p-3.5 rounded-xl bg-cinnabar/10 text-ink-0 space-y-2.5 animate-fadeIn border border-cinnabar/25"
          role="status"
          aria-live="polite"
        >
          <div className="flex items-center justify-between text-xs font-num font-bold text-cinnabar">
            <span>⚠️ 偏离杀局主线</span>
          </div>
          {/* 服务端判词：「走错这步相当于白丢约 X 个兵」—— 亲眼看见代价的那一行 */}
          {prosCons?.verdict_headline && (
            <p className="m-0 text-sm font-display font-bold text-cinnabar leading-snug">
              {prosCons.verdict_headline}
            </p>
          )}
          <p className="m-0 text-xs text-ink-1 leading-relaxed font-ui">
            {feedback.text || '走法露出破绽，对手已抓住战机实施毁灭性反杀！'}
          </p>
          {prosCons?.best_chinese && (
            <p className="m-0 text-[11px] text-ink-2 leading-relaxed font-ui">
              这一局的正着是「<b className="font-kai text-jade">{prosCons.best_chinese}</b>
              」—— 先记住它，回溯后亲手走一遍。
            </p>
          )}
          <p className="m-0 text-[11px] text-ink-2 font-ui">
            可在盘面上方选择「↩ 回溯」或「🎬 看后果」。
          </p>
        </div>
      )}

      {/* 4. 连续绝杀破局通关（仅解说；镜像/下一关按钮集中在盘面胶囊） */}
      {solved && (
        <div
          className="p-4 rounded-xl bg-jade/10 text-ink-0 space-y-2.5 animate-fadeIn border border-jade/25"
          role="status"
          aria-live="polite"
        >
          <div className="flex items-center justify-between font-ui">
            <b className="text-sm text-jade flex items-center gap-1.5 font-kai">
              <span>🏆</span>
              <span>破局成功 · 心魔已击碎</span>
            </b>
            <span className="text-[10px] font-num text-jade bg-jade/15 px-2 py-0.5 rounded-full font-bold">
              已通关
            </span>
          </div>
          {currentPuzzle?.explanation && (
            <p className="m-0 text-xs leading-relaxed text-ink-1 font-ui">
              {currentPuzzle.explanation}
            </p>
          )}
        </div>
      )}

      {/* 5. 分步动画推演摘要：动画播放时列出每一步（减弱动效偏好下的主要阅读面） */}
      {animMode !== 'none' && animSteps.length > 0 && (
        <div className="space-y-1.5 pt-2 border-t border-hairline">
          <div className="flex items-center justify-between text-[11px] font-num text-ink-3">
            <span>推演摘要 · {ANIM_MODE_LABEL[animMode]}</span>
            <span>
              {animStep} / {animSteps.length}
            </span>
          </div>
          <div className="space-y-1">
            {animSteps.map((s, i) => {
              const isCurrent = i + 1 === animStep
              return (
                <div
                  key={`${s.step}-${i}`}
                  className={`flex items-baseline gap-2 text-[11px] leading-relaxed rounded px-1.5 py-0.5 ${
                    isCurrent ? 'bg-paper-2 text-ink-0' : 'text-ink-3'
                  }`}
                >
                  <span className="font-num text-[10px] shrink-0">{s.step}</span>
                  <span className="font-kai font-bold shrink-0">{s.chinese}</span>
                  <span className="font-ui truncate">{s.plain}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* 6. 连续对抗历史 (仅在已经走棋后平滑展开，未走棋时不占位) */}
      {moveHistory.length > 0 && (
        <div className="space-y-2 pt-2 border-t border-hairline">
          <div className="flex items-center justify-between text-[11px] font-num text-ink-3">
            <span>对局记录</span>
            <span>{moveHistory.length} 手</span>
          </div>

          <div className="space-y-1.5 font-num text-xs">
            {moveHistory.map((step, idx) => {
              const isUser = step.turn === 'user'
              const isFault = step.isFault
              const hasComment = !!step.comment
              // 失着行默认展开：代价要当场读完，不藏第二次点击
              const expanded = hasComment && (isFault || expandedComments.has(idx))

              return (
                <div
                  key={idx}
                  className={`rounded-lg text-xs ${
                    isFault
                      ? 'bg-cinnabar/10 text-ink-0'
                      : isUser
                      ? 'bg-paper-2 text-ink-1 font-semibold'
                      : 'text-ink-2'
                  }`}
                >
                  <div className="flex items-baseline justify-between px-2.5 py-1.5">
                    <div className="flex items-baseline gap-2">
                      <span className="text-[10px] text-ink-4">#{idx + 1}</span>
                      <span className="text-[11px]">{isUser ? '我方' : '对方'}:</span>
                      <span className="font-kai font-bold">{step.chinese}</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {step.evalText && (
                        <span className={`text-[10px] px-1 rounded ${
                          isFault ? 'text-cinnabar bg-cinnabar/12' : 'text-jade bg-jade/10'
                        }`}>
                          {step.evalText}
                        </span>
                      )}
                      {hasComment && (
                        <button
                          type="button"
                          className="text-[10px] text-ink-3 hover:text-ink-0 font-num cursor-pointer border-0 bg-transparent p-0 focus:outline-none focus-visible:ring-1 focus-visible:ring-cinnabar rounded"
                          aria-expanded={expanded}
                          onClick={() => toggleComment(idx)}
                        >
                          {expanded ? '收起' : '解说'}
                        </button>
                      )}
                    </div>
                  </div>
                  {expanded && (
                    <p className="m-0 px-2.5 pb-1.5 pl-6 text-[11px] leading-relaxed text-ink-2 font-ui animate-fadeIn">
                      {step.comment}
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* 7. 启发微提示 (仅在点击点拨后轻巧浮现) */}
      {hints.length > 0 && !solved && (
        <div className="pt-2 border-t border-hairline space-y-1 text-xs font-ui animate-fadeIn">
          <span className="font-num text-[10px] text-ink-2 font-bold">
            点拨 {hintLevel}/3
          </span>
          {hints.map((h, i) => (
            <p key={i} className="m-0 leading-relaxed text-ink-2">
              {h}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}
