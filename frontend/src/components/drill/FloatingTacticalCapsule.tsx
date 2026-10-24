import React from 'react'
import type { ChoiceOption, TrainingPuzzle } from '../../types'

export interface FloatingTacticalCapsuleProps {
  currentPuzzle: TrainingPuzzle | null
  solved: boolean
  inRebuttal: boolean
  feedback: { text: string; tone: 'info' | 'success' | 'warn' | 'error' }
  choiceOptions?: ChoiceOption[]
  hoveredChoice?: ChoiceOption | null
  badStepsCount?: number
  animMode?: 'none' | 'bad' | 'good' | 'threat'
  onHoverChoice?: (opt: ChoiceOption | null) => void
  onSelectChoiceRehearse?: (opt: ChoiceOption) => void
  onMakeMove?: (iccs: string) => void
  onUndo?: () => void
  onStartBadAnim?: () => void
  onStartGoodAnim?: () => void
  onMirrorDrill?: () => void
  onNextPuzzle?: () => void
}

/**
 * FloatingTacticalCapsule (盘面沉浸悬浮灵动胶囊)
 * 纯粹冷精密特质，吸附于棋盘正上方，将局势要害、候选分支（直接试看/落子）融为一体。
 * 让用户手眼 100% 聚焦在棋盘战区，无需来回在左盘和右栏之间费力对焦。
 */
export const FloatingTacticalCapsule: React.FC<FloatingTacticalCapsuleProps> = ({
  currentPuzzle,
  solved,
  inRebuttal,
  feedback,
  choiceOptions = [],
  hoveredChoice,
  badStepsCount = 0,
  onHoverChoice,
  onSelectChoiceRehearse,
  onMakeMove,
  onUndo,
  onStartBadAnim,
  onMirrorDrill,
  onNextPuzzle,
}) => {
  // 1. 成功通关破局态 (Victory State)
  if (solved) {
    return (
      <div className="w-full max-w-[min(100%,500px)] mx-auto px-3.5 py-2 rounded-2xl bg-white/95 backdrop-blur-md border border-emerald-500/30 shadow-sm flex items-center justify-between gap-3 text-xs select-none animate-fadeIn transition-all">
        <div className="flex items-center gap-2 min-w-0">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shrink-0" />
          <span className="font-bold text-emerald-950 font-sans truncate">
            🏆 破局成功 · 心魔击碎
          </span>
          {currentPuzzle?.key_square_info?.dest_square && (
            <span className="font-mono text-[10px] text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded">
              要害 {currentPuzzle.key_square_info.dest_square}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5 shrink-0 font-mono">
          <button
            type="button"
            className="h-7 px-2.5 rounded-lg text-emerald-800 bg-emerald-50 hover:bg-emerald-100 text-xs font-semibold transition cursor-pointer border-0"
            onClick={onMirrorDrill}
            title="镜像变式测验"
          >
            🔄 镜像
          </button>
          <button
            type="button"
            className="h-7 px-3 rounded-lg text-white bg-slate-900 hover:bg-black text-xs font-bold transition cursor-pointer shadow-xs border-0 active:scale-95"
            onClick={onNextPuzzle}
          >
            下一关 ➔
          </button>
        </div>
      </div>
    )
  }

  // 2. 走偏惩罚态 (Rebuttal State)
  if (inRebuttal) {
    return (
      <div className="w-full max-w-[min(100%,500px)] mx-auto px-3.5 py-2 rounded-2xl bg-white/95 backdrop-blur-md border border-rose-500/30 shadow-sm flex items-center justify-between gap-3 text-xs select-none animate-fadeIn transition-all">
        <div className="flex items-center gap-2 min-w-0">
          <span className="w-2 h-2 rounded-full bg-rose-500 animate-ping shrink-0" />
          <span className="font-bold text-rose-900 font-sans truncate">
            ⚠️ 偏离杀局主线
          </span>
          <span className="text-[11px] text-slate-500 truncate hidden sm:inline font-sans">
            {feedback.text || '露出破绽遭反击'}
          </span>
        </div>

        <div className="flex items-center gap-1.5 shrink-0 font-mono">
          {badStepsCount > 0 && (
            <button
              type="button"
              className="h-7 px-2.5 rounded-lg text-rose-700 bg-rose-50 hover:bg-rose-100 text-xs font-medium transition cursor-pointer border-0"
              onClick={onStartBadAnim}
              title="查看走错后的反杀推演"
            >
              🎬 看后果
            </button>
          )}
          <button
            type="button"
            className="h-7 px-3 rounded-lg text-white bg-rose-600 hover:bg-rose-700 text-xs font-bold transition cursor-pointer shadow-xs border-0 active:scale-95"
            onClick={onUndo}
          >
            ↩ 回溯
          </button>
        </div>
      </div>
    )
  }

  // 3. 正常决策态 (Decision HUD with Candidate Move Badges)
  return (
    <div className="w-full max-w-[min(100%,500px)] mx-auto px-3 py-1.5 rounded-2xl bg-white/90 backdrop-blur-md border border-slate-200/80 shadow-3xs flex items-center justify-between gap-2 text-xs select-none transition-all">
      {/* 左侧：战术要害小标 */}
      <div className="flex items-center gap-2 shrink-0">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
        <span className="font-bold text-slate-900 font-sans text-xs whitespace-nowrap">
          {currentPuzzle?.plain_motif_label || currentPuzzle?.target || '先手取势'}
        </span>
        {currentPuzzle?.key_square_info?.dest_square && (
          <span className="font-mono text-[10px] text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded whitespace-nowrap hidden sm:inline">
            要害 {currentPuzzle.key_square_info.dest_square}
          </span>
        )}
      </div>

      {/* 中右侧：直接铺排候选走法微胶囊（零跳转，盘面一触即试） */}
      {choiceOptions.length > 0 ? (
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5 min-w-0">
          {choiceOptions.map((opt) => {
            const isHovered = hoveredChoice?.id === opt.id
            const isCorrect = opt.is_correct

            return (
              <div
                key={opt.id}
                className={`group flex items-center gap-1 px-2 py-1 rounded-xl transition-all duration-150 cursor-pointer shrink-0 border ${
                  isHovered
                    ? 'bg-slate-900 text-white border-slate-900 shadow-2xs scale-[1.02]'
                    : isCorrect
                    ? 'bg-emerald-50/80 text-emerald-900 border-emerald-200/80 hover:bg-emerald-100/80'
                    : 'bg-slate-50 text-slate-700 border-slate-200/60 hover:bg-slate-100'
                }`}
                onMouseEnter={() => onHoverChoice?.(opt)}
                onMouseLeave={() => onHoverChoice?.(null)}
                onClick={() => onMakeMove?.(opt.iccs)}
                title={`点击直接落子: ${opt.chinese} (${isCorrect ? '推荐正着' : '演练分支'})`}
              >
                <b className="font-sans text-xs tracking-tight">{opt.chinese}</b>
                <span
                  className={`text-[9.5px] font-mono px-1 rounded font-bold ${
                    isHovered
                      ? 'bg-white/20 text-white'
                      : isCorrect
                      ? 'text-emerald-700 bg-emerald-100/70'
                      : 'text-slate-500 bg-slate-200/60'
                  }`}
                >
                  {isCorrect ? '+M1' : opt.verdict_tag || '分支'}
                </span>

                {/* 微型推演试看图标 */}
                {opt.steps && opt.steps.length > 0 && (
                  <button
                    type="button"
                    className={`p-0.5 rounded hover:bg-black/10 border-0 bg-transparent text-[10px] opacity-60 hover:opacity-100 transition cursor-pointer ${
                      isHovered ? 'text-white' : 'text-slate-400'
                    }`}
                    onClick={(e) => {
                      e.stopPropagation()
                      onSelectChoiceRehearse?.(opt)
                    }}
                    title="在盘面推演试看该分支走法"
                  >
                    🎬
                  </button>
                )}
              </div>
            )
          })}
        </div>
      ) : (
        <div className="text-[11px] font-mono text-slate-400 truncate">
          在棋盘上直接推子破局
        </div>
      )}
    </div>
  )
}
