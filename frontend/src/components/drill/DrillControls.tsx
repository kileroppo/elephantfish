import React from 'react'

export interface DrillActionDockProps {
  animMode: 'none' | 'bad' | 'good' | 'threat'
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
  onPrevAnimStep?: () => void
  onTogglePlayAnim?: () => void
  onNextAnimStep?: () => void
}

const ANIM_BADGES: Record<'bad' | 'good' | 'threat', { text: string; cls: string }> = {
  bad: { text: '后果推演', cls: 'bg-rose-100 text-rose-700' },
  good: { text: '路线演示', cls: 'bg-emerald-100 text-emerald-700' },
  threat: { text: '威胁预览', cls: 'bg-amber-100 text-amber-800' },
}

/**
 * 特斯拉极简一体化 Dock (Tesla Contextual Dock - 36px)
 * 极致收敛：高频三键【回溯】【重试】【点拨】 + 右侧【下一关】；威胁可见时追加【看威胁】
 */
export const DrillActionDock: React.FC<DrillActionDockProps> = ({
  animMode,
  threatStepsCount,
  inRebuttal,
  hasGame,
  hasHistory,
  thinking,
  hintLevel = 0,
  onRequestHint,
  onStartThreatAnim,
  onStopAnim,
  onUndo,
  onReset,
  onNextPuzzle,
  animStep = 0,
  activeStepsCount = 0,
  animPlaying = false,
  onPrevAnimStep,
  onTogglePlayAnim,
  onNextAnimStep,
}) => {
  // 1. 动画演练状态
  if (animMode !== 'none') {
    const badge = ANIM_BADGES[animMode]
    return (
      <div
        className="flex items-center justify-between px-3 py-1 bg-white/90 border border-slate-200/80 rounded-full mt-2 w-full max-w-[min(100%,480px)] mx-auto select-none font-mono text-xs shadow-xs text-slate-700"
        aria-label="动画推演控制"
      >
        <div className="flex items-center gap-2">
          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded font-sans ${badge.cls}`}>
            {badge.text}
          </span>
          <span className="text-slate-400 text-xs font-mono">
            {animStep} / {activeStepsCount}
          </span>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            className="w-6 h-6 flex items-center justify-center text-xs rounded-full hover:bg-slate-100 transition cursor-pointer disabled:opacity-30 border-0 bg-transparent focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
            onClick={onPrevAnimStep}
            disabled={animStep <= 0}
            title="后退"
          >
            ◀
          </button>
          <button
            type="button"
            className="h-6 px-2.5 text-xs font-bold rounded-full bg-slate-900 text-white transition cursor-pointer shadow-xs border-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
            onClick={onTogglePlayAnim}
            title={animPlaying ? '暂停' : '播放'}
          >
            <span>{animPlaying ? '⏸' : '▶'}</span>
          </button>
          <button
            type="button"
            className="w-6 h-6 flex items-center justify-center text-xs rounded-full hover:bg-slate-100 transition cursor-pointer disabled:opacity-30 border-0 bg-transparent focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
            onClick={onNextAnimStep}
            disabled={animStep >= activeStepsCount}
            title="前进"
          >
            ▶
          </button>
          <button
            type="button"
            className="h-6 px-2 text-[11px] text-slate-500 hover:text-slate-900 rounded-full hover:bg-slate-100 transition cursor-pointer ml-1 border-0 bg-transparent focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
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
      className="flex items-center justify-between px-3 py-1 bg-white/90 border border-slate-200/80 rounded-full mt-2 w-full max-w-[min(100%,480px)] mx-auto select-none font-mono text-xs shadow-xs text-slate-700 h-9"
      aria-label="特训控制坞"
    >
      {/* 左侧：核心三键【回溯】【重试】【点拨】+ 威胁预览 */}
      <div className="flex items-center gap-1 font-sans">
        {/* 回溯 */}
        <button
          type="button"
          className={`h-7 px-2.5 rounded-full text-xs font-medium transition cursor-pointer flex items-center gap-1 border-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 ${
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

        {/* 重试 */}
        <button
          type="button"
          className="h-7 px-2 text-xs rounded-full text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition cursor-pointer flex items-center gap-1 border-0 bg-transparent disabled:opacity-30 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
          onClick={onReset}
          disabled={!hasGame || thinking}
          title="整题复位 (R)"
        >
          <span>↻</span>
          <span>重试</span>
        </button>

        {/* 启发点拨（第 3 层后置灰） */}
        {onRequestHint && (
          <button
            type="button"
            className={`h-7 px-2 rounded-full text-xs transition cursor-pointer flex items-center gap-1 border-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 ${
              hintLevel >= 3
                ? 'bg-amber-50 text-amber-500 cursor-not-allowed'
                : hintLevel > 0
                ? 'bg-amber-50 text-amber-700 font-bold'
                : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100 bg-transparent'
            }`}
            onClick={onRequestHint}
            disabled={hintLevel >= 3}
            title={hintLevel >= 3 ? '点拨已全部展开' : '启发点拨 (H)'}
          >
            <span>💡</span>
            <span>点拨{hintLevel > 0 ? ` ${hintLevel}/3` : ''}</span>
          </button>
        )}

        {/* 威胁预览：仅在题目带对手企图推演时出现 */}
        {threatStepsCount > 0 && animMode === 'none' && (
          <button
            type="button"
            className="h-7 px-2 rounded-full text-xs text-slate-500 hover:text-amber-800 hover:bg-amber-50 transition cursor-pointer flex items-center gap-1 border-0 bg-transparent disabled:opacity-30 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
            onClick={onStartThreatAnim}
            disabled={thinking}
            title="假设不设防，看对手接下来想怎么攻 (T)"
          >
            <span>👁️</span>
            <span>看威胁</span>
          </button>
        )}
      </div>

      {/* 右侧：下一题实体键 */}
      <button
        type="button"
        className="h-7 px-3 text-xs font-bold rounded-full bg-slate-900 hover:bg-black text-white transition cursor-pointer shadow-xs active:scale-95 flex items-center gap-1 border-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
        onClick={onNextPuzzle}
        title="进入下一题 (N)"
      >
        <span>下一关</span>
        <span>➔</span>
      </button>
    </div>
  )
}
