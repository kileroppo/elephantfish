import React from 'react'

export interface DrillStageBarProps {
  stage?: 'demo' | 'drill' | 'exam' | 'mirror'
  animMode?: 'none' | 'bad' | 'good' | 'threat'
  choiceMode?: boolean
  spotlightActive?: boolean
  xrayActive?: boolean
  solved?: boolean
  onStartGoodAnim?: () => void
  onSwitchToDrill?: () => void
  onReset?: (stage?: 'demo' | 'drill' | 'exam' | 'mirror') => void
  onMirrorDrill?: () => void
  onToggleChoiceMode?: () => void
  onToggleSpotlight?: () => void
  onToggleXray?: () => void
}

/**
 * 特斯拉极简原则：砍掉棋盘上方所有物理按钮，棋盘顶部 100% 纯净留白
 */
export const DrillStageBar: React.FC<DrillStageBarProps> = () => {
  return null
}

export interface DrillActionDockProps {
  animMode: 'none' | 'bad' | 'good' | 'threat'
  badStepsCount: number
  threatStepsCount: number
  inRebuttal: boolean
  hasGame: boolean
  hasHistory: boolean
  thinking: boolean
  sandbox?: boolean
  hintLevel?: number
  onRequestHint?: () => void
  onStartBadAnim: () => void
  onStartThreatAnim: () => void
  onStopAnim: () => void
  onUndo: () => void
  onReset: () => void
  onToggleSandbox?: () => void
  onNextPuzzle: () => void
  animStep?: number
  activeStepsCount?: number
  animPlaying?: boolean
  onResetAnimStep?: () => void
  onPrevAnimStep?: () => void
  onTogglePlayAnim?: () => void
  onNextAnimStep?: () => void
}

/**
 * 特斯拉极简一体化 Dock (Tesla Contextual Dock - 36px)
 * 极致收敛：高频三键【回溯】【重置】【点拨】 + 右侧【下一题】
 */
export const DrillActionDock: React.FC<DrillActionDockProps> = ({
  animMode,
  badStepsCount: _badStepsCount,
  inRebuttal,
  hasGame,
  hasHistory,
  thinking,
  hintLevel = 0,
  onRequestHint,
  onStopAnim,
  onUndo,
  onReset,
  onNextPuzzle,
  animStep = 0,
  activeStepsCount = 0,
  animPlaying = false,
  onResetAnimStep: _onResetAnimStep,
  onPrevAnimStep,
  onTogglePlayAnim,
  onNextAnimStep,
}) => {
  // 1. 动画演练状态
  if (animMode !== 'none') {
    return (
      <div
        className="flex items-center justify-between px-3 py-1 bg-white/90 backdrop-blur-md border border-slate-200/80 rounded-full mt-2 w-full max-w-[min(100%,480px)] mx-auto select-none font-mono text-xs shadow-xs text-slate-700"
        aria-label="动画推演控制"
      >
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold px-1.5 py-0.2 rounded bg-slate-100 text-slate-700">
            {animMode === 'bad' ? 'FLAW' : 'DEMO'}
          </span>
          <span className="text-slate-400 text-xs font-mono">
            {animStep} / {activeStepsCount}
          </span>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            className="w-6 h-6 flex items-center justify-center text-xs rounded-full hover:bg-slate-100 transition cursor-pointer disabled:opacity-30 border-0 bg-transparent"
            onClick={onPrevAnimStep}
            disabled={animStep <= 0}
            title="后退"
          >
            ◀
          </button>
          <button
            type="button"
            className="h-6 px-2.5 text-xs font-bold rounded-full bg-slate-900 text-white transition cursor-pointer shadow-xs border-0"
            onClick={onTogglePlayAnim}
          >
            <span>{animPlaying ? '⏸' : '▶'}</span>
          </button>
          <button
            type="button"
            className="w-6 h-6 flex items-center justify-center text-xs rounded-full hover:bg-slate-100 transition cursor-pointer disabled:opacity-30 border-0 bg-transparent"
            onClick={onNextAnimStep}
            disabled={animStep >= activeStepsCount}
            title="前进"
          >
            ▶
          </button>
          <button
            type="button"
            className="h-6 px-2 text-[11px] text-slate-500 hover:text-slate-900 rounded-full hover:bg-slate-100 transition cursor-pointer ml-1 border-0 bg-transparent"
            onClick={onStopAnim}
          >
            退出
          </button>
        </div>
      </div>
    )
  }

  // 2. 正常实战对战 Dock (36px)
  return (
    <div
      className="flex items-center justify-between px-3 py-1 bg-white/90 backdrop-blur-md border border-slate-200/80 rounded-full mt-2 w-full max-w-[min(100%,480px)] mx-auto select-none font-mono text-xs shadow-xs text-slate-700 h-9"
      aria-label="特斯拉控制Dock"
    >
      {/* 左侧：核心三键【回溯】【重置】【点拨】 */}
      <div className="flex items-center gap-1 font-sans">
        {/* 回溯 */}
        <button
          type="button"
          className={`h-7 px-2.5 rounded-full text-xs font-medium transition cursor-pointer flex items-center gap-1 border-0 ${
            inRebuttal
              ? 'bg-rose-600 text-white font-bold hover:bg-rose-700 shadow-xs'
              : 'bg-transparent text-slate-600 hover:text-slate-900 hover:bg-slate-100 disabled:opacity-30'
          }`}
          onClick={onUndo}
          disabled={!hasGame || !hasHistory || thinking}
          title="回溯上一动 (Z)"
        >
          <span>↩</span>
          <span>{inRebuttal ? '回溯重战' : '回溯'}</span>
        </button>

        {/* 重置 */}
        <button
          type="button"
          className="h-7 px-2 text-xs rounded-full text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition cursor-pointer flex items-center gap-1 border-0 bg-transparent disabled:opacity-30"
          onClick={onReset}
          disabled={!hasGame || thinking}
          title="整题复位 (R)"
        >
          <span>↻</span>
          <span>重试</span>
        </button>

        {/* 启发点拨 */}
        {onRequestHint && (
          <button
            type="button"
            className={`h-7 px-2 rounded-full text-xs transition cursor-pointer flex items-center gap-1 border-0 ${
              hintLevel > 0
                ? 'bg-amber-50 text-amber-700 font-bold'
                : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100 bg-transparent'
            }`}
            onClick={onRequestHint}
            title="启发点拨 (H)"
          >
            <span>💡</span>
            <span>点拨</span>
          </button>
        )}
      </div>

      {/* 右侧：下一题实体键 */}
      <button
        type="button"
        className="h-7 px-3 text-xs font-bold rounded-full bg-slate-900 hover:bg-black text-white transition cursor-pointer shadow-xs active:scale-95 flex items-center gap-1 border-0"
        onClick={onNextPuzzle}
        title="进入下一题"
      >
        <span>下一关</span>
        <span>➔</span>
      </button>
    </div>
  )
}
