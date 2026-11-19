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

// 语义色归队：朱砂=危险/后果，玉=正确/演示，墨=中性
const ANIM_BADGES: Record<'bad' | 'good' | 'threat', { text: string; cls: string }> = {
  bad: { text: '后果推演', cls: 'bg-cinnabar text-paper-0' },
  good: { text: '路线演示', cls: 'bg-jade text-paper-0' },
  threat: { text: '威胁预览', cls: 'bg-cinnabar/10 text-cinnabar' },
}

/**
 * 特训控制坞（Contextual Dock）
 * 高频三键【回溯】【重试】【点拨】 + 右侧【下一关】；威胁可见时追加【看威胁】。
 * 动画播放时切换为步进控制条。
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
        className="flex items-center justify-between px-3 py-1 bg-paper-0/90 border border-hairline rounded-full mt-2 w-full max-w-[min(100%,480px)] mx-auto select-none font-num text-xs shadow-xs text-ink-2"
        aria-label="动画推演控制"
      >
        <div className="flex items-center gap-2">
          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded font-ui ${badge.cls}`}>
            {badge.text}
          </span>
          <span className="text-ink-3 text-xs font-num">
            {animStep} / {activeStepsCount}
          </span>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            className="w-6 h-6 flex items-center justify-center text-xs rounded-full hover:bg-paper-2 transition cursor-pointer disabled:opacity-30 border-0 bg-transparent focus:outline-none focus-visible:ring-2 focus-visible:ring-cinnabar"
            onClick={onPrevAnimStep}
            disabled={animStep <= 0}
            title="后退"
          >
            ◀
          </button>
          <button
            type="button"
            className="h-6 px-2.5 text-xs font-bold rounded-full bg-ink-1 text-paper-0 transition cursor-pointer shadow-xs border-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-cinnabar"
            onClick={onTogglePlayAnim}
            title={animPlaying ? '暂停' : '播放'}
          >
            <span>{animPlaying ? '⏸' : '▶'}</span>
          </button>
          <button
            type="button"
            className="w-6 h-6 flex items-center justify-center text-xs rounded-full hover:bg-paper-2 transition cursor-pointer disabled:opacity-30 border-0 bg-transparent focus:outline-none focus-visible:ring-2 focus-visible:ring-cinnabar"
            onClick={onNextAnimStep}
            disabled={animStep >= activeStepsCount}
            title="前进"
          >
            ▶
          </button>
          <button
            type="button"
            className="h-6 px-2 text-[11px] text-ink-2 hover:text-ink-0 rounded-full hover:bg-paper-2 transition cursor-pointer ml-1 border-0 bg-transparent focus:outline-none focus-visible:ring-2 focus-visible:ring-cinnabar"
            onClick={onStopAnim}
          >
            退出
          </button>
        </div>
      </div>
    )
  }

  // 2. 正常实战对战 Dock
  return (
    <div
      className="flex items-center justify-between px-3 py-1 bg-paper-0/90 border border-hairline rounded-full mt-2 w-full max-w-[min(100%,480px)] mx-auto select-none font-num text-xs shadow-xs text-ink-2 h-11"
      aria-label="特训控制坞"
    >
      {/* 左侧：核心三键【回溯】【重试】【点拨】+ 威胁预览 */}
      <div className="flex items-center gap-1 font-ui">
        {/* 回溯：受罚瞬间的一按即回溯，朱砂实底 —— 全坞最重的一枚键 */}
        <button
          type="button"
          className={`h-9 px-2.5 rounded-full text-xs font-medium transition cursor-pointer flex items-center gap-1 border-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-cinnabar ${
            inRebuttal
              ? 'bg-cinnabar text-paper-0 font-bold hover:bg-cinnabar-bright shadow-xs'
              : 'bg-transparent text-ink-2 hover:text-ink-0 hover:bg-paper-2 disabled:opacity-30'
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
          className="h-9 px-2 text-xs rounded-full text-ink-2 hover:text-ink-0 hover:bg-paper-2 transition cursor-pointer flex items-center gap-1 border-0 bg-transparent disabled:opacity-30 focus:outline-none focus-visible:ring-2 focus-visible:ring-cinnabar"
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
            className={`h-9 px-2 rounded-full text-xs transition cursor-pointer flex items-center gap-1 border-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-cinnabar ${
              hintLevel >= 3
                ? 'bg-paper-2 text-ink-4 cursor-not-allowed'
                : hintLevel > 0
                ? 'bg-paper-3 text-ink-0 font-bold'
                : 'text-ink-2 hover:text-ink-0 hover:bg-paper-2 bg-transparent'
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
            className="h-9 px-2 rounded-full text-xs text-ink-2 hover:text-cinnabar hover:bg-cinnabar/10 transition cursor-pointer flex items-center gap-1 border-0 bg-transparent disabled:opacity-30 focus:outline-none focus-visible:ring-2 focus-visible:ring-cinnabar"
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
        className="h-9 px-3 text-xs font-bold rounded-full bg-ink-1 hover:bg-ink-0 text-paper-0 transition cursor-pointer shadow-xs active:scale-95 flex items-center gap-1 border-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-cinnabar"
        onClick={onNextPuzzle}
        title="进入下一题 (N)"
      >
        <span>下一关</span>
        <span>➔</span>
      </button>
    </div>
  )
}
