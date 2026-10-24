import React from 'react'
import type { ChoiceOption, ProsConsAnalysis, TrainingPuzzle } from '../../types'

export interface CombatChronicleProps {
  currentPuzzle: TrainingPuzzle | null
  solved: boolean
  inRebuttal: boolean
  userSideLabel: string
  feedback: { text: string; tone: 'info' | 'success' | 'warn' | 'error' }
  badStepsCount: number
  animMode: 'none' | 'bad' | 'good' | 'threat'
  hoveredChoice?: ChoiceOption | null
  choiceOptions?: ChoiceOption[]
  prosCons?: ProsConsAnalysis | null
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
  onUndo: () => void
  onStartBadAnim: () => void
  onStartGoodAnim?: () => void
  onMirrorDrill: () => void
  onNextPuzzle: () => void
  onHoverChoice?: (opt: ChoiceOption | null) => void
  onSelectChoiceRehearse?: (opt: ChoiceOption) => void
  onMakeMove?: (iccs: string) => void
}

/**
 * 丝滑极简 · 零边框高级战术面板 (Ultra-Smooth Seamless Console)
 * 彻底消除框套框、零多余零件、顶级排版节奏、呼吸感拉满
 */
export const CombatChronicle: React.FC<CombatChronicleProps> = ({
  currentPuzzle,
  solved,
  inRebuttal,
  userSideLabel: _userSideLabel,
  feedback,
  badStepsCount,
  hoveredChoice,
  choiceOptions = [],
  hints = [],
  hintLevel = 0,
  moveHistory,
  elapsedSeconds,
  onUndo,
  onStartBadAnim,
  onMirrorDrill,
  onNextPuzzle,
  onHoverChoice,
  onSelectChoiceRehearse,
  onMakeMove,
}) => {
  return (
    <div className="flex flex-col h-full text-slate-800 font-sans select-none overflow-y-auto px-2 py-1 space-y-6">
      {/* 1. 顶部：极简大标题与单行状态微流 (Airy Telemetry Header) */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="m-0 text-xl font-bold text-slate-900 tracking-tight font-sans">
            {currentPuzzle?.title || '铁门栓 · 沉底破门'}
          </h2>
          <div className="flex items-center gap-2 font-mono text-xs">
            <span className="text-slate-400">{elapsedSeconds}s</span>
            <span
              className={`w-2 h-2 rounded-full ${
                solved
                  ? 'bg-emerald-500'
                  : inRebuttal
                  ? 'bg-rose-500 animate-ping'
                  : 'bg-emerald-500 animate-pulse'
              }`}
            />
          </div>
        </div>

        {/* 单行流式微数据（无边框，极度透气） */}
        <div className="flex items-center gap-2.5 text-xs text-slate-500 font-mono flex-wrap">
          <span className="font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">
            +M1 绝杀
          </span>
          <span className="text-slate-300">•</span>
          <span>
            要害 <b className="text-slate-800 font-bold">{currentPuzzle?.key_square_info?.dest_square || 'b9'}</b>
          </span>
          <span className="text-slate-300">•</span>
          <span>中炮镇门 · 帅控肋道</span>
        </div>

        {/* 纤细动态胜率柱 (极简无框) */}
        <div className="w-full h-1 bg-slate-100 rounded-full overflow-hidden mt-1">
          <div
            className={`h-full rounded-full transition-all duration-700 ${
              inRebuttal
                ? 'bg-rose-500 w-[15%]'
                : solved
                ? 'bg-emerald-500 w-full'
                : 'bg-emerald-500 w-[95%]'
            }`}
          />
        </div>
      </div>

      {/* 2. 候选分支对比流 (极简紧凑型决策矩阵，与盘面胶囊形成呼应) */}
      {choiceOptions.length > 0 && !solved && !inRebuttal && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-[11px] font-mono text-slate-400 uppercase tracking-wider pb-1">
            <span>BRANCHES MATRIX</span>
            <span className="text-[10px]">盘上胶囊/此处均可一键落子</span>
          </div>

          <div className="space-y-1">
            {choiceOptions.map((opt) => {
              const isHovered = hoveredChoice?.id === opt.id
              const isCorrect = opt.is_correct

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
                        isCorrect
                          ? 'bg-emerald-50 text-emerald-700 group-hover:bg-emerald-600 group-hover:text-white'
                          : 'bg-slate-100 text-slate-500'
                      }`}
                    >
                      {opt.label}
                    </span>

                    <div className="flex items-baseline gap-2 min-w-0">
                      <b className="text-sm font-sans text-slate-900 whitespace-nowrap">
                        {opt.chinese}
                      </b>
                      <span
                        className={`text-[10px] font-mono px-1.5 py-0.2 rounded font-semibold whitespace-nowrap ${
                          isCorrect
                            ? 'text-emerald-700 bg-emerald-50'
                            : 'text-rose-600 bg-rose-50'
                        }`}
                      >
                        {isCorrect ? '+M1' : opt.verdict_tag || '失着'}
                      </span>
                      <span className="text-xs text-slate-400 truncate max-w-[180px] font-sans">
                        {opt.teaser?.replace(/！.*/, '') || ''}
                      </span>
                    </div>
                  </div>

                  {/* 右侧：试看推演图标 */}
                  <div className="flex items-center gap-1.5 opacity-60 group-hover:opacity-100 transition-opacity shrink-0">
                    <button
                      type="button"
                      className="h-6 px-2 text-[11px] font-mono text-slate-500 hover:text-slate-900 hover:bg-white rounded transition cursor-pointer border-0 bg-transparent flex items-center gap-1"
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

      {/* 3. 走偏反噬告警 (极简微提醒) */}
      {inRebuttal && (
        <div className="p-3.5 rounded-xl bg-rose-50/90 text-rose-950 space-y-2.5 animate-fadeIn">
          <div className="flex items-center justify-between text-xs font-mono font-bold text-rose-700">
            <span>⚠️ 偏离杀局主线</span>
            <span className="text-[10px] font-normal">DEVIATED</span>
          </div>
          <p className="m-0 text-xs text-rose-900 leading-relaxed font-sans">
            {feedback.text || '走法露出破绽，对手已抓住战机实施毁灭性反杀！'}
          </p>
          <div className="flex items-center gap-2 pt-1 font-mono">
            <button
              type="button"
              className="flex-1 h-7 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold transition cursor-pointer shadow-xs active:scale-95 border-0 flex items-center justify-center gap-1"
              onClick={onUndo}
            >
              <span>↩ 回溯一步重试</span>
            </button>
            {badStepsCount > 0 && (
              <button
                type="button"
                className="h-7 px-3 rounded-lg bg-white text-rose-700 text-xs font-medium hover:bg-rose-100 transition cursor-pointer border-0"
                onClick={onStartBadAnim}
              >
                🎬 看后果
              </button>
            )}
          </div>
        </div>
      )}

      {/* 4. 连续绝杀破局通关 */}
      {solved && (
        <div className="p-4 rounded-xl bg-emerald-50/90 text-emerald-950 space-y-3 animate-fadeIn">
          <div className="flex items-center justify-between font-sans">
            <b className="text-sm text-emerald-900 flex items-center gap-1.5">
              <span>🏆</span>
              <span>破局成功 · 心魔已击碎</span>
            </b>
            <span className="text-[10px] font-mono text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full font-bold">
              CLEARED
            </span>
          </div>
          {currentPuzzle?.explanation && (
            <p className="m-0 text-xs leading-relaxed text-emerald-800/90 font-sans">
              {currentPuzzle.explanation}
            </p>
          )}
          <div className="flex items-center gap-2 pt-1 font-mono">
            <button
              type="button"
              className="flex-1 h-8 rounded-lg bg-white hover:bg-slate-50 text-emerald-800 text-xs font-semibold transition cursor-pointer border border-emerald-200/80 shadow-3xs"
              onClick={onMirrorDrill}
            >
              🔄 镜像对决
            </button>
            <button
              type="button"
              className="flex-1 h-8 rounded-lg bg-slate-900 hover:bg-black text-white text-xs font-bold transition cursor-pointer shadow-xs active:scale-95 border-0"
              onClick={onNextPuzzle}
            >
              下一关 ➔
            </button>
          </div>
        </div>
      )}

      {/* 5. 连续对抗历史 (仅在已经走棋后平滑展开，未走棋时不占位) */}
      {moveHistory.length > 0 && (
        <div className="space-y-2 pt-2 border-t border-slate-100">
          <div className="flex items-center justify-between text-[11px] font-mono text-slate-400">
            <span>TIMELINE</span>
            <span>{moveHistory.length} PLIES</span>
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
        <div className="pt-2 border-t border-slate-100 space-y-1 text-xs text-amber-900/90 font-sans animate-fadeIn">
          <span className="font-mono text-[10px] text-amber-600 font-bold uppercase">
            HINT LV.{hintLevel}/3
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
