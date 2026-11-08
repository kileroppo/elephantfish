import React from 'react'
import type { ChoiceOption, TrainingPuzzle } from '../../types'

export interface CombatChronicleProps {
  currentPuzzle: TrainingPuzzle | null
  solved: boolean
  inRebuttal: boolean
  feedback: { text: string; tone: 'info' | 'success' | 'warn' | 'error' }
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
  onHoverChoice?: (opt: ChoiceOption | null) => void
  onSelectChoiceRehearse?: (opt: ChoiceOption) => void
  onMakeMove?: (iccs: string) => void
}

const formatClock = (total: number) => {
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

/**
 * 丝滑极简 · 零边框高级战术面板 (Ultra-Smooth Seamless Console)
 * 只呈现真实数据与解说：不放假胜率、不重复盘面胶囊上的操作按钮。
 */
export const CombatChronicle: React.FC<CombatChronicleProps> = ({
  currentPuzzle,
  solved,
  inRebuttal,
  feedback,
  hoveredChoice,
  choiceOptions = [],
  reveal = false,
  hints = [],
  hintLevel = 0,
  moveHistory,
  elapsedSeconds,
  onHoverChoice,
  onSelectChoiceRehearse,
  onMakeMove,
}) => {
  const motifLabel = currentPuzzle?.plain_motif_label || currentPuzzle?.target
  const keySquare = currentPuzzle?.key_square_info?.dest_square

  return (
    <div className="flex flex-col h-full text-slate-800 font-sans select-none overflow-y-auto px-2 py-1 space-y-6">
      {/* 1. 顶部：极简大标题与单行状态微流 (Airy Telemetry Header) */}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <h2 className="m-0 text-xl font-bold text-slate-900 tracking-tight font-sans truncate">
            {currentPuzzle?.title || '训练准备中…'}
          </h2>
          <div className="flex items-center gap-2 font-mono text-xs shrink-0">
            <span className="text-slate-400" title="本局用时">{formatClock(elapsedSeconds)}</span>
            <span
              className={`w-2 h-2 rounded-full ${
                solved
                  ? 'bg-emerald-500'
                  : inRebuttal
                  ? 'bg-rose-500 animate-ping'
                  : 'bg-slate-300'
              }`}
            />
          </div>
        </div>

        {/* 单行流式微数据（全部来自当前题目真实数据，缺省即隐藏） */}
        {(motifLabel || keySquare) && (
          <div className="flex items-center gap-2.5 text-xs text-slate-500 font-mono flex-wrap">
            {motifLabel && (
              <span className="font-semibold text-slate-700 bg-slate-100 px-2 py-0.5 rounded-full font-sans">
                {motifLabel}
              </span>
            )}
            {keySquare && (
              <>
                <span className="text-slate-300">•</span>
                <span>
                  要害 <b className="text-slate-800 font-bold">{keySquare}</b>
                </span>
              </>
            )}
          </div>
        )}
      </div>

      {/* 2. 候选分支对比流（与盘面胶囊一致：默认中性呈现，不泄露正着） */}
      {choiceOptions.length > 0 && !solved && !inRebuttal && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-[11px] font-mono text-slate-400 pb-1">
            <span>候选分支</span>
            <span className="text-[10px]">悬停可在盘面预览，点击即落子</span>
          </div>

          <div className="space-y-1">
            {choiceOptions.map((opt) => {
              const isHovered = hoveredChoice?.id === opt.id

              return (
                <div
                  key={opt.id}
                  className={`group px-3 py-2 rounded-xl transition-all duration-150 cursor-pointer flex items-center justify-between gap-3 ${
                    isHovered
                      ? 'bg-slate-100 text-slate-900 shadow-3xs'
                      : 'hover:bg-slate-50 text-slate-700'
                  }`}
                  onMouseEnter={() => onHoverChoice?.(opt)}
                  onMouseLeave={() => onHoverChoice?.(null)}
                  onClick={() => onMakeMove?.(opt.iccs)}
                >
                  {/* 左侧：标号 + 走法名 + 精炼要害 */}
                  <div className="flex items-center gap-3 min-w-0">
                    <span
                      className={`w-5 h-5 rounded-md font-mono text-[11px] font-bold flex items-center justify-center shrink-0 transition-colors ${
                        isHovered ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-500'
                      }`}
                    >
                      {opt.label}
                    </span>

                    <div className="flex items-baseline gap-2 min-w-0">
                      <b className="text-sm font-sans text-slate-900 whitespace-nowrap">
                        {opt.chinese}
                      </b>
                      {reveal && (
                        <span
                          className={`text-[10px] font-mono px-1.5 py-0.5 rounded font-semibold whitespace-nowrap ${
                            opt.is_correct
                              ? 'text-emerald-700 bg-emerald-50'
                              : 'text-rose-600 bg-rose-50'
                          }`}
                        >
                          {opt.is_correct ? '正着' : opt.verdict_tag || '失着'}
                        </span>
                      )}
                      <span className="text-xs text-slate-400 truncate max-w-[180px] font-sans">
                        {opt.teaser?.replace(/！.*/, '') || ''}
                      </span>
                    </div>
                  </div>

                  {/* 右侧：试看推演图标 */}
                  <div className="flex items-center gap-1.5 opacity-60 group-hover:opacity-100 transition-opacity shrink-0">
                    <button
                      type="button"
                      className="h-6 px-2 text-[11px] font-mono text-slate-500 hover:text-slate-900 hover:bg-white rounded transition cursor-pointer border-0 bg-transparent flex items-center gap-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-300"
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
        <div className="p-3.5 rounded-xl bg-rose-50/90 text-rose-950 space-y-2.5 animate-fadeIn">
          <div className="flex items-center justify-between text-xs font-mono font-bold text-rose-700">
            <span>⚠️ 偏离杀局主线</span>
          </div>
          <p className="m-0 text-xs text-rose-900 leading-relaxed font-sans">
            {feedback.text || '走法露出破绽，对手已抓住战机实施毁灭性反杀！'}
          </p>
          <p className="m-0 text-[11px] text-rose-700/80 font-sans">
            可在盘面上方选择「↩ 回溯」或「🎬 看后果」。
          </p>
        </div>
      )}

      {/* 4. 连续绝杀破局通关（仅解说；镜像/下一关按钮集中在盘面胶囊） */}
      {solved && (
        <div className="p-4 rounded-xl bg-emerald-50/90 text-emerald-950 space-y-2.5 animate-fadeIn">
          <div className="flex items-center justify-between font-sans">
            <b className="text-sm text-emerald-900 flex items-center gap-1.5">
              <span>🏆</span>
              <span>破局成功 · 心魔已击碎</span>
            </b>
            <span className="text-[10px] font-mono text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full font-bold">
              已通关
            </span>
          </div>
          {currentPuzzle?.explanation && (
            <p className="m-0 text-xs leading-relaxed text-emerald-800/90 font-sans">
              {currentPuzzle.explanation}
            </p>
          )}
        </div>
      )}

      {/* 5. 连续对抗历史 (仅在已经走棋后平滑展开，未走棋时不占位) */}
      {moveHistory.length > 0 && (
        <div className="space-y-2 pt-2 border-t border-slate-100">
          <div className="flex items-center justify-between text-[11px] font-mono text-slate-400">
            <span>对局记录</span>
            <span>{moveHistory.length} 手</span>
          </div>

          <div className="space-y-1.5 font-mono text-xs">
            {moveHistory.map((step, idx) => {
              const isUser = step.turn === 'user'
              const isFault = step.isFault

              return (
                <div
                  key={idx}
                  className={`flex items-baseline justify-between px-2.5 py-1.5 rounded-lg text-xs ${
                    isFault
                      ? 'bg-rose-50 text-rose-900'
                      : isUser
                      ? 'bg-slate-50 text-slate-800 font-semibold'
                      : 'text-slate-500'
                  }`}
                >
                  <div className="flex items-baseline gap-2">
                    <span className="text-[10px] text-slate-400">#{idx + 1}</span>
                    <span className="text-[11px]">{isUser ? '我方' : '对方'}:</span>
                    <span className="font-sans font-bold">{step.chinese}</span>
                  </div>
                  {step.evalText && (
                    <span className={`text-[10px] px-1 rounded ${
                      isFault ? 'text-rose-600 bg-rose-100' : 'text-emerald-700 bg-emerald-50'
                    }`}>
                      {step.evalText}
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* 6. 启发微提示 (仅在点击点拨后轻巧浮现) */}
      {hints.length > 0 && !solved && (
        <div className="pt-2 border-t border-slate-100 space-y-1 text-xs font-sans animate-fadeIn">
          <span className="font-mono text-[10px] text-amber-600 font-bold">
            点拨 {hintLevel}/3
          </span>
          {hints.map((h, i) => (
            <p key={i} className="m-0 leading-relaxed text-slate-600">
              {h}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}
