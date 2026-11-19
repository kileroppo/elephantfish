import React, { useEffect, useRef, useState } from 'react'
import type { ChoiceOption, TrainingPuzzle } from '../../types'

export interface FloatingTacticalCapsuleProps {
  currentPuzzle: TrainingPuzzle | null
  solved: boolean
  inRebuttal: boolean
  stage?: 'demo' | 'drill' | 'exam' | 'mirror'
  reveal?: boolean
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
  onMirrorDrill?: () => void
  onNextPuzzle?: () => void
}

// 阶段徽章语义色归队：玉=演示（看正着），墨=实训（中性），朱砂=无提示检验（高压）
const STAGE_BADGES: Record<'demo' | 'drill' | 'exam' | 'mirror', { text: string; cls: string }> = {
  demo: { text: '演示', cls: 'bg-jade/10 text-jade border-jade/25' },
  drill: { text: '实训', cls: 'bg-paper-2 text-ink-1 border-hairline-strong' },
  exam: { text: '无提示检验', cls: 'bg-cinnabar/10 text-cinnabar border-cinnabar/25' },
  mirror: { text: '镜像变式', cls: 'bg-paper-3 text-ink-2 border-hairline-strong' },
}

/**
 * FloatingTacticalCapsule (盘面沉浸悬浮灵动胶囊)
 * 吸附于棋盘正上方，将局势要害、候选分支（直接试看/落子）融为一体。
 * 让用户手眼 100% 聚焦在棋盘战区，无需来回在左盘和右栏之间费力对焦。
 * 决策态默认不泄露正着：候选芯片保持中性样式，仅 demo 阶段（reveal）标注对错。
 */
export const FloatingTacticalCapsule: React.FC<FloatingTacticalCapsuleProps> = ({
  currentPuzzle,
  solved,
  inRebuttal,
  stage = 'drill',
  reveal = false,
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
  // 触屏两段式确认：首次点击=预览（同 hover ghost），再次点击=落子
  const [armedId, setArmedId] = useState<string | null>(null)
  const armedTimerRef = useRef<number | null>(null)
  const pointerTypeRef = useRef<string>('mouse')

  useEffect(() => {
    return () => {
      if (armedTimerRef.current !== null) window.clearTimeout(armedTimerRef.current)
    }
  }, [])

  const disarm = () => {
    setArmedId(null)
    if (armedTimerRef.current !== null) {
      window.clearTimeout(armedTimerRef.current)
      armedTimerRef.current = null
    }
  }

  const handleChipPointerDown = (e: React.PointerEvent) => {
    pointerTypeRef.current = e.pointerType || 'mouse'
  }

  const handleChipClick = (opt: ChoiceOption) => {
    if (pointerTypeRef.current === 'mouse') {
      disarm()
      onMakeMove?.(opt.iccs)
      return
    }
    if (armedId === opt.id) {
      disarm()
      onHoverChoice?.(null)
      onMakeMove?.(opt.iccs)
    } else {
      setArmedId(opt.id)
      onHoverChoice?.(opt)
      if (armedTimerRef.current !== null) window.clearTimeout(armedTimerRef.current)
      armedTimerRef.current = window.setTimeout(disarm, 3000)
    }
  }

  // 1. 成功通关破局态 (Victory State) —— 签名时刻：落定 + 琶音之后的这枚印章
  if (solved) {
    return (
      <div className="w-full max-w-[min(100%,500px)] mx-auto px-3.5 py-2 rounded-2xl bg-paper-0 border border-jade/30 shadow-sm flex items-center justify-between gap-3 text-xs select-none animate-fadeIn transition-[opacity,transform]">
        <div className="flex items-center gap-2 min-w-0">
          <span className="w-2 h-2 rounded-full bg-jade animate-pulse shrink-0" />
          <span className="font-bold text-ink-0 font-kai truncate">
            破局成功 · 心魔击碎
          </span>
          {/* 破局印章：stampImpact 盖下，与 win 琶音的尾音同拍 */}
          <span className="stamp-seal font-kai shrink-0" aria-hidden="true">
            破局
          </span>
          {currentPuzzle?.key_square_info?.dest_square && (
            <span className="font-num text-[10px] text-jade bg-jade/10 px-1.5 py-0.5 rounded">
              要害 {currentPuzzle.key_square_info.dest_square}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5 shrink-0 font-ui">
          <button
            type="button"
            className="h-11 px-3 rounded-lg text-jade bg-jade/10 hover:bg-jade/20 text-xs font-semibold transition cursor-pointer border-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-cinnabar"
            onClick={onMirrorDrill}
            title="镜像变式测验"
          >
            🔄 镜像
          </button>
          <button
            type="button"
            className="h-11 px-4 rounded-lg text-paper-0 bg-ink-1 hover:bg-ink-0 text-xs font-bold transition cursor-pointer shadow-xs border-0 active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-cinnabar"
            onClick={onNextPuzzle}
          >
            下一关 ➔
          </button>
        </div>
      </div>
    )
  }

  // 2. 走偏惩罚态 (Rebuttal State) —— 签名时刻：回溯与看后果是情绪最急时的入口，44px
  if (inRebuttal) {
    return (
      <div className="w-full max-w-[min(100%,500px)] mx-auto px-3.5 py-2 rounded-2xl bg-paper-0 border border-cinnabar/30 shadow-sm flex items-center justify-between gap-3 text-xs select-none animate-fadeIn transition-[opacity,transform]">
        <div className="flex items-center gap-2 min-w-0">
          <span className="w-2 h-2 rounded-full bg-cinnabar animate-ping shrink-0" />
          <span className="font-bold text-cinnabar font-kai truncate shrink-0">
            ⚠️ 偏离杀局主线
          </span>
          <span className="text-[11px] text-ink-2 truncate hidden sm:inline font-ui">
            {feedback.text || '露出破绽遭反击'}
          </span>
        </div>

        <div className="flex items-center gap-1.5 shrink-0 font-ui">
          {badStepsCount > 0 && (
            <button
              type="button"
              className="h-11 px-3 rounded-lg text-cinnabar bg-cinnabar/10 hover:bg-cinnabar/20 text-xs font-medium transition cursor-pointer border-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-cinnabar"
              onClick={onStartBadAnim}
              title="查看走错后的反杀推演"
            >
              🎬 看后果
            </button>
          )}
          <button
            type="button"
            className="h-11 px-4 rounded-lg text-paper-0 bg-cinnabar hover:bg-cinnabar-bright text-xs font-bold transition cursor-pointer shadow-xs border-0 active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-cinnabar"
            onClick={onUndo}
          >
            ↩ 回溯
          </button>
        </div>
      </div>
    )
  }

  // 3. 正常决策态 (Decision HUD with Candidate Move Badges)
  const stageBadge = STAGE_BADGES[stage]
  return (
    <div className="w-full max-w-[min(100%,500px)] mx-auto px-3 py-1.5 rounded-2xl bg-paper-0 border border-hairline shadow-3xs flex items-center justify-between gap-2 text-xs select-none transition-[opacity,transform]">
      {/* 左侧：阶段徽章 + 战术要害小标 */}
      <div className="flex items-center gap-2 shrink-0">
        <span
          className={`h-5 px-1.5 rounded-md border text-[10px] font-bold font-ui flex items-center whitespace-nowrap ${stageBadge.cls}`}
          title="当前训练阶段"
        >
          {stageBadge.text}
        </span>
        <span className="font-bold text-ink-0 font-kai text-xs whitespace-nowrap hidden sm:inline">
          {currentPuzzle?.plain_motif_label || currentPuzzle?.target || '先手取势'}
        </span>
      </div>

      {/* 中右侧：直接铺排候选走法微胶囊（零跳转，盘面一触即试；触屏首点预览、再点落子） */}
      {choiceOptions.length > 0 ? (
        <div className="relative min-w-0 flex-1 flex justify-end">
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5 min-w-0">
            {choiceOptions.map((opt) => {
              const isActive = hoveredChoice?.id === opt.id || armedId === opt.id
              const isArmed = armedId === opt.id

              return (
                <div
                  key={opt.id}
                  className={`group flex items-center gap-1 px-2 py-1 rounded-xl transition-[background-color,color,border-color,transform] duration-150 cursor-pointer shrink-0 border ${
                    isActive
                      ? 'bg-ink-1 text-paper-0 border-ink-1 shadow-2xs scale-[1.02]'
                      : reveal && opt.is_correct
                      ? 'bg-jade/10 text-jade border-jade/25 hover:bg-jade/20'
                      : 'bg-paper-2 text-ink-1 border-hairline hover:bg-paper-3'
                  }`}
                  onPointerDown={handleChipPointerDown}
                  onMouseEnter={() => onHoverChoice?.(opt)}
                  onMouseLeave={() => {
                    if (armedId !== opt.id) onHoverChoice?.(null)
                  }}
                  onClick={() => handleChipClick(opt)}
                  title={`点击直接落子: ${opt.chinese}`}
                >
                  <b className="font-kai text-xs tracking-tight">{opt.chinese}</b>
                  {reveal && (
                    <span
                      className={`text-[10px] font-num px-1 rounded font-bold ${
                        isActive
                          ? 'bg-paper-0/20 text-paper-0'
                          : opt.is_correct
                          ? 'text-jade bg-jade/15'
                          : 'text-ink-2 bg-paper-3'
                      }`}
                    >
                      {opt.is_correct ? '正着' : opt.verdict_tag || '分支'}
                    </span>
                  )}
                  {isArmed && (
                    <span className="text-[10px] font-bold text-paper-0 bg-ink-2 px-1 rounded animate-pulse">
                      再点确认
                    </span>
                  )}

                  {/* 微型推演试看图标 */}
                  {opt.steps && opt.steps.length > 0 && (
                    <button
                      type="button"
                      className={`p-0.5 rounded hover:bg-ink-0/10 border-0 bg-transparent text-[11px] opacity-60 hover:opacity-100 transition cursor-pointer focus:outline-none focus-visible:ring-1 focus-visible:ring-cinnabar ${
                        isActive ? 'text-paper-0' : 'text-ink-3'
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
          {/* 右缘渐隐提示：还有更多候选可横向滑动 */}
          {choiceOptions.length > 2 && (
            <div className="pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-paper-0 to-transparent rounded-r-xl" />
          )}
        </div>
      ) : (
        <div className="text-[11px] font-num text-ink-3 truncate">
          在棋盘上直接推子破局
        </div>
      )}
    </div>
  )
}
