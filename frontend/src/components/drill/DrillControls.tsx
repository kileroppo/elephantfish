import React from 'react'

export interface DrillStageBarProps {
  stage: 'demo' | 'drill' | 'exam' | 'mirror'
  animMode: 'none' | 'bad' | 'good' | 'threat'
  choiceMode: boolean
  spotlightActive: boolean
  xrayActive: boolean
  solved: boolean
  onStartGoodAnim: () => void
  onSwitchToDrill: () => void
  onReset: (stage?: 'demo' | 'drill' | 'exam' | 'mirror') => void
  onMirrorDrill: () => void
  onToggleChoiceMode: () => void
  onToggleSpotlight: () => void
  onToggleXray: () => void
}

export const DrillStageBar: React.FC<DrillStageBarProps> = ({
  stage,
  animMode,
  choiceMode,
  spotlightActive,
  xrayActive,
  solved,
  onStartGoodAnim,
  onSwitchToDrill,
  onReset,
  onMirrorDrill,
  onToggleChoiceMode,
  onToggleSpotlight,
  onToggleXray,
}) => {
  return (
    <div className="flex flex-col gap-1.5 w-full mb-2">
      {/* 学习阶段切换栏 */}
      <div className="flex items-center gap-2 w-full">
        <button
          type="button"
          className={`flex-1 min-h-[32px] px-2 py-1 text-xs font-semibold rounded-md border transition-all text-center whitespace-nowrap cursor-pointer ${
            stage === 'demo' || animMode === 'good'
              ? 'bg-cinnabar text-white border-cinnabar shadow-xs'
              : 'bg-paper-1 text-ink-2 border-hairline hover:bg-paper-0 hover:text-ink-0 hover:border-hairline-strong'
          }`}
          onClick={onStartGoodAnim}
        >
          ① 正着演示
        </button>
        <button
          type="button"
          className={`flex-1 min-h-[32px] px-2 py-1 text-xs font-semibold rounded-md border transition-all text-center whitespace-nowrap cursor-pointer ${
            stage === 'drill' && animMode === 'none'
              ? 'bg-cinnabar text-white border-cinnabar shadow-xs'
              : 'bg-paper-1 text-ink-2 border-hairline hover:bg-paper-0 hover:text-ink-0 hover:border-hairline-strong'
          }`}
          onClick={onSwitchToDrill}
        >
          ② 动手实训
        </button>
        <button
          type="button"
          className={`flex-1 min-h-[32px] px-2 py-1 text-xs font-semibold rounded-md border transition-all text-center whitespace-nowrap cursor-pointer ${
            stage === 'exam'
              ? 'bg-cinnabar text-white border-cinnabar shadow-xs'
              : 'bg-paper-1 text-ink-2 border-hairline hover:bg-paper-0 hover:text-ink-0 hover:border-hairline-strong'
          }`}
          onClick={() => onReset('exam')}
        >
          ③ 实战检验
        </button>
        {(solved || stage === 'mirror') && (
          <button
            type="button"
            className={`flex-1 min-h-[32px] px-2 py-1 text-xs font-bold rounded-md border transition-all text-center whitespace-nowrap cursor-pointer ${
              stage === 'mirror'
                ? 'bg-gradient-to-r from-purple-600 to-indigo-600 text-white border-purple-700 shadow-xs'
                : 'bg-gradient-to-r from-purple-100 to-indigo-100 text-purple-900 border-purple-300 hover:from-purple-200 hover:to-indigo-200'
            }`}
            onClick={onMirrorDrill}
            title="举一反三：将棋局左右水平对称翻转，检验你是否真正掌握了攻防算路"
          >
            🔄 举一反三秒测
          </button>
        )}
      </div>

      {/* 辅助开关条 */}
      <div className="flex items-center gap-2 my-0.5 flex-wrap">
        <button
          type="button"
          className={`px-2.5 py-1 text-[11.5px] font-semibold rounded-full border transition-all cursor-pointer ${
            choiceMode
              ? 'bg-ink-0 text-paper-0 border-ink-0 shadow-xs'
              : 'bg-paper-1 text-ink-2 border-hairline hover:bg-paper-2 hover:text-ink-0'
          }`}
          onClick={onToggleChoiceMode}
          title="三选一模式：提供最佳着法、诱惑陷阱与平庸缓手供直观对比"
        >
          {choiceMode ? '🎯 三选一: 开' : '🎯 三选一: 关'}
        </button>
        <button
          type="button"
          className={`px-2.5 py-1 text-[11.5px] font-semibold rounded-full border transition-all cursor-pointer ${
            spotlightActive
              ? 'bg-ink-0 text-paper-0 border-ink-0 shadow-xs'
              : 'bg-paper-1 text-ink-2 border-hairline hover:bg-paper-2 hover:text-ink-0'
          }`}
          onClick={onToggleSpotlight}
          title="战术聚光灯：仅聚焦攻防核心子力，其余子力降噪半透明"
        >
          {spotlightActive ? '🔦 聚焦: 开' : '🔦 聚焦: 关'}
        </button>
        <button
          type="button"
          className={`px-2.5 py-1 text-[11.5px] font-semibold rounded-full border transition-all cursor-pointer ${
            xrayActive
              ? 'bg-ink-0 text-paper-0 border-ink-0 shadow-xs'
              : 'bg-paper-1 text-ink-2 border-hairline hover:bg-paper-2 hover:text-ink-0'
          }`}
          onClick={onToggleXray}
          title="暗线透视：显示炮架金环、别马腿锁与无根大子警示"
        >
          {xrayActive ? '👁️ 透视: 开' : '👁️ 透视: 关'}
        </button>
      </div>
    </div>
  )
}

export interface DrillActionDockProps {
  animMode: 'none' | 'bad' | 'good' | 'threat'
  badStepsCount: number
  threatStepsCount: number
  inRebuttal: boolean
  hasGame: boolean
  hasHistory: boolean
  thinking: boolean
  sandbox: boolean
  onStartBadAnim: () => void
  onStartThreatAnim: () => void
  onStopAnim: () => void
  onUndo: () => void
  onReset: () => void
  onToggleSandbox: () => void
  onNextPuzzle: () => void
}

export const DrillActionDock: React.FC<DrillActionDockProps> = ({
  animMode,
  badStepsCount,
  threatStepsCount,
  inRebuttal,
  hasGame,
  hasHistory,
  thinking,
  sandbox,
  onStartBadAnim,
  onStartThreatAnim,
  onStopAnim,
  onUndo,
  onReset,
  onToggleSandbox,
  onNextPuzzle,
}) => {
  return (
    <div className="flex items-center justify-between flex-wrap gap-2 px-3 py-1.5 bg-paper-1 border border-hairline rounded-lg mt-2 w-full" aria-label="实训控制">
      {/* 动画演示组 */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <button
          type="button"
          className={`min-h-[32px] px-2.5 py-1 text-xs font-semibold rounded-full border transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
            animMode === 'bad'
              ? 'bg-cinnabar text-white border-cinnabar shadow-xs'
              : 'text-cinnabar border-cinnabar/30 bg-cinnabar/10 hover:bg-cinnabar/20'
          }`}
          onClick={onStartBadAnim}
          disabled={badStepsCount === 0}
          title="在棋盘上一步步动画演示：走错这步棋后，接下来 3~4 步为什么会吃大亏"
        >
          ❌ 走错怎么亏 ({badStepsCount}步)
        </button>
        <button
          type="button"
          className={`min-h-[32px] px-2.5 py-1 text-xs font-semibold rounded-full border transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
            animMode === 'threat'
              ? 'bg-amber-600 text-white border-amber-600 shadow-xs'
              : 'text-amber-700 border-amber-500/30 bg-amber-500/10 hover:bg-amber-500/20'
          }`}
          onClick={onStartThreatAnim}
          disabled={threatStepsCount === 0}
          title="看不懂对手想干嘛？在棋盘上动画演示：如果我们不设防，对手接下来 2~3 步怎么杀我们"
        >
          👁️ 对手想干嘛 ({threatStepsCount}步)
        </button>
        {animMode !== 'none' && (
          <button
            type="button"
            className="min-h-[32px] px-2.5 py-1 text-xs font-medium text-ink-2 hover:text-ink-0 bg-transparent hover:bg-black/5 rounded-md border border-hairline transition-colors cursor-pointer"
            onClick={onStopAnim}
          >
            ✋ 退出演示
          </button>
        )}
      </div>

      <div className="w-px h-5 bg-hairline hidden sm:block" />

      {/* 棋盘动作组 */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <button
          type="button"
          className={`min-h-[32px] px-2.5 py-1 text-xs font-semibold rounded-md border transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
            inRebuttal
              ? 'bg-cinnabar hover:bg-cinnabar-bright text-white border-cinnabar shadow-xs'
              : 'text-ink-2 hover:text-ink-0 bg-transparent hover:bg-black/5 border-hairline'
          }`}
          onClick={onUndo}
          disabled={!hasGame || (!hasHistory && !inRebuttal) || thinking}
          title="退回到走错之前的那一步重新走"
        >
          ↩ {inRebuttal ? '退回重走' : '悔棋'}
        </button>
        <button
          type="button"
          className="min-h-[32px] px-2.5 py-1 text-xs font-medium text-ink-2 hover:text-ink-0 bg-transparent hover:bg-black/5 rounded-md border border-hairline transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          onClick={onReset}
          disabled={!hasGame || thinking}
          title="恢复到本题最开始的棋盘状态"
        >
          🔄 重做
        </button>
        <button
          type="button"
          className={`min-h-[32px] px-2.5 py-1 text-xs font-semibold rounded-md border transition-all cursor-pointer ${
            sandbox
              ? 'bg-cinnabar hover:bg-cinnabar-bright text-white border-cinnabar shadow-xs'
              : 'text-ink-2 hover:text-ink-0 bg-transparent hover:bg-black/5 border-hairline'
          }`}
          onClick={onToggleSandbox}
          title="开启自由试走模式后，随便试走任何分支都不计入失误次数"
        >
          {sandbox ? '🧪 试走中' : '🧪 试走'}
        </button>
        <button
          type="button"
          className="min-h-[32px] px-2.5 py-1 text-xs font-medium text-ink-2 hover:text-ink-0 bg-transparent hover:bg-black/5 rounded-md border border-hairline transition-colors cursor-pointer"
          onClick={onNextPuzzle}
          title="切换到下一道题"
        >
          ⏭ 下一题
        </button>
      </div>
    </div>
  )
}
