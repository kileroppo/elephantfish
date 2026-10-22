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
    <div className="flex items-center justify-between gap-2 w-full mb-1 select-none flex-wrap">
      {/* 核心学习阶段：iOS 分段控制器 */}
      <div className="flex items-center p-0.5 bg-paper-1/90 rounded-xl border border-hairline shadow-inner">
        <button
          type="button"
          className={`h-7 px-3 rounded-lg text-xs font-medium transition cursor-pointer border-0 flex items-center gap-1 ${
            stage === 'drill' && animMode === 'none'
              ? 'bg-paper-0 text-cinnabar shadow-xs font-semibold'
              : 'bg-transparent text-ink-3 hover:text-ink-1'
          }`}
          onClick={onSwitchToDrill}
        >
          <span>①</span>
          <span>动手实训</span>
        </button>
        <button
          type="button"
          className={`h-7 px-3 rounded-lg text-xs font-medium transition cursor-pointer border-0 flex items-center gap-1 ${
            stage === 'exam'
              ? 'bg-paper-0 text-cinnabar shadow-xs font-semibold'
              : 'bg-transparent text-ink-3 hover:text-ink-1'
          }`}
          onClick={() => onReset('exam')}
        >
          <span>②</span>
          <span>实战检验</span>
        </button>
        <button
          type="button"
          className={`h-7 px-3 rounded-lg text-xs font-medium transition cursor-pointer border-0 flex items-center gap-1 ${
            stage === 'demo' || animMode === 'good'
              ? 'bg-paper-0 text-cinnabar shadow-xs font-semibold'
              : 'bg-transparent text-ink-3 hover:text-ink-1'
          }`}
          onClick={onStartGoodAnim}
        >
          <span>③</span>
          <span>正着演示</span>
        </button>

        {(solved || stage === 'mirror') && (
          <button
            type="button"
            className={`h-7 px-2.5 rounded-lg text-xs font-bold transition cursor-pointer border-0 flex items-center gap-1 ${
              stage === 'mirror'
                ? 'bg-purple-600 text-white shadow-xs'
                : 'text-purple-700 hover:bg-purple-50'
            }`}
            onClick={onMirrorDrill}
            title="左右镜像对称测试，检验是否真正理解棋理"
          >
            <span>🔄</span>
            <span>镜像测</span>
          </button>
        )}
      </div>

      {/* 辅助开关条：紧凑胶囊组 */}
      <div className="flex items-center p-0.5 bg-paper-1/80 rounded-xl border border-hairline">
        <button
          type="button"
          className={`h-6.5 px-2.5 text-[11px] font-medium rounded-lg transition cursor-pointer border-0 ${
            choiceMode
              ? 'bg-paper-0 text-ink-0 font-semibold shadow-xs'
              : 'bg-transparent text-ink-3 hover:text-ink-1'
          }`}
          onClick={onToggleChoiceMode}
          title="三选一模式：提供三种备选着法供直观对比"
        >
          🎯 选项{choiceMode ? '·开' : ''}
        </button>
        <button
          type="button"
          className={`h-6.5 px-2 text-[11px] font-medium rounded-lg transition cursor-pointer border-0 ${
            spotlightActive
              ? 'bg-paper-0 text-ink-0 font-semibold shadow-xs'
              : 'bg-transparent text-ink-3 hover:text-ink-1'
          }`}
          onClick={onToggleSpotlight}
          title="聚焦核心攻防子力"
        >
          🔦 聚光
        </button>
        <button
          type="button"
          className={`h-6.5 px-2 text-[11px] font-medium rounded-lg transition cursor-pointer border-0 ${
            xrayActive
              ? 'bg-paper-0 text-ink-0 font-semibold shadow-xs'
              : 'bg-transparent text-ink-3 hover:text-ink-1'
          }`}
          onClick={onToggleXray}
          title="透视炮架与线路"
        >
          👁️ 射线
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
  hintLevel?: number
  onRequestHint?: () => void
  onStartBadAnim: () => void
  onStartThreatAnim: () => void
  onStopAnim: () => void
  onUndo: () => void
  onReset: () => void
  onToggleSandbox: () => void
  onNextPuzzle: () => void
  // 动画控制扩展
  animStep?: number
  activeStepsCount?: number
  animPlaying?: boolean
  onResetAnimStep?: () => void
  onPrevAnimStep?: () => void
  onTogglePlayAnim?: () => void
  onNextAnimStep?: () => void
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
  hintLevel = 0,
  onRequestHint,
  onStartBadAnim,
  onStartThreatAnim,
  onStopAnim,
  onUndo,
  onReset,
  onToggleSandbox,
  onNextPuzzle,
  animStep = 0,
  activeStepsCount = 0,
  animPlaying = false,
  onResetAnimStep,
  onPrevAnimStep,
  onTogglePlayAnim,
  onNextAnimStep,
}) => {
  // 1. 如果当前处于动画演示模式：展示媒体播放器控制坞
  if (animMode !== 'none') {
    return (
      <div
        className="flex items-center justify-between flex-wrap gap-2 px-3 py-1.5 bg-paper-1/90 border border-hairline rounded-xl mt-1.5 w-full select-none"
        aria-label="动画播放控制"
      >
        <div className="flex items-center gap-1">
          <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-paper-0 text-ink-1 border border-hairline">
            {animMode === 'bad' ? '❌ 连锁吃亏演示' : animMode === 'good' ? '✅ 最佳正着演示' : '👁️ 对手企图演示'}
          </span>
          <span className="text-[11px] text-ink-3 font-num ml-1">
            第 {animStep} / {activeStepsCount} 步
          </span>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            className="h-7 px-2 text-xs font-medium rounded-lg border border-hairline bg-paper-0 hover:bg-paper-2 text-ink-2 hover:text-ink-0 transition cursor-pointer disabled:opacity-40"
            onClick={onResetAnimStep}
            disabled={animStep === 0}
            title="回到演示前初始盘面"
          >
            ⏮
          </button>
          <button
            type="button"
            className="h-7 px-2 text-xs font-medium rounded-lg border border-hairline bg-paper-0 hover:bg-paper-2 text-ink-2 hover:text-ink-0 transition cursor-pointer disabled:opacity-40"
            onClick={onPrevAnimStep}
            disabled={animStep <= 0}
            title="上一动"
          >
            ◀
          </button>
          <button
            type="button"
            className="h-7 px-3 text-xs font-semibold rounded-lg bg-cinnabar hover:bg-cinnabar-bright text-white transition cursor-pointer shadow-xs"
            onClick={onTogglePlayAnim}
            title={animPlaying ? '暂停连播' : '自动连播'}
          >
            {animPlaying ? '⏸ 暂停' : '▶ 播放'}
          </button>
          <button
            type="button"
            className="h-7 px-2 text-xs font-medium rounded-lg border border-hairline bg-paper-0 hover:bg-paper-2 text-ink-2 hover:text-ink-0 transition cursor-pointer disabled:opacity-40"
            onClick={onNextAnimStep}
            disabled={animStep >= activeStepsCount}
            title="下一动"
          >
            ▶
          </button>
          <button
            type="button"
            className="h-7 px-2.5 text-xs font-medium text-ink-3 hover:text-ink-0 bg-paper-0 hover:bg-paper-2 rounded-lg border border-hairline transition cursor-pointer ml-1"
            onClick={onStopAnim}
            title="退出动画演示，回到自己动手试走"
          >
            ✕ 退出
          </button>
        </div>
      </div>
    )
  }

  // 2. 正常实战与动手试走模式
  return (
    <div
      className="flex items-center justify-between flex-wrap gap-2 px-3 py-1.5 bg-paper-1/80 border border-hairline rounded-xl mt-1.5 w-full select-none"
      aria-label="实训控制"
    >
      {/* 左侧：启发提示 */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {onRequestHint && (
          <button
            type="button"
            className={`h-7 px-2.5 text-xs font-medium rounded-lg border transition cursor-pointer ${
              hintLevel > 0
                ? 'bg-amber-500/10 text-amber-800 border-amber-500/30 font-semibold'
                : 'bg-paper-0 border-hairline text-ink-2 hover:text-ink-0 hover:bg-paper-2'
            }`}
            onClick={onRequestHint}
            title="渐进式分步提示：第1级看破绽，第2级看关键子，第3级看路线"
          >
            💡 提示{hintLevel > 0 ? ` (${hintLevel}/3)` : ''}
          </button>
        )}

        {threatStepsCount > 0 && !inRebuttal && (
          <button
            type="button"
            className="h-7 px-2 text-xs font-medium rounded-lg text-ink-2 hover:text-ink-0 bg-paper-0 hover:bg-paper-2 border border-hairline transition cursor-pointer"
            onClick={onStartThreatAnim}
            title="看若我不设防，对手接下来的致命企图"
          >
            👁️ 敌方企图
          </button>
        )}

        {/* 处于走错惩罚反击态时，高亮突出「为什么亏」和「退回重走」 */}
        {inRebuttal && (
          <>
            <button
              type="button"
              className="h-7 px-2.5 text-xs font-bold rounded-lg bg-cinnabar hover:bg-cinnabar-bright text-white border border-cinnabar transition cursor-pointer shadow-xs animate-pulse"
              onClick={onUndo}
              title="退回到走错之前重走"
            >
              ↩ 退回重走
            </button>
            {badStepsCount > 0 && (
              <button
                type="button"
                className="h-7 px-2 text-xs font-semibold rounded-lg text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-300 transition cursor-pointer"
                onClick={onStartBadAnim}
                title="观看走错后对手的反制杀招"
              >
                🎬 为什么亏 ({badStepsCount}步)
              </button>
            )}
          </>
        )}
      </div>

      {/* 右侧：常用盘面动作 */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {!inRebuttal && (
          <button
            type="button"
            className="h-7 px-2.5 text-xs font-medium text-ink-2 hover:text-ink-0 bg-paper-0 hover:bg-paper-2 rounded-lg border border-hairline transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            onClick={onUndo}
            disabled={!hasGame || !hasHistory || thinking}
            title="撤回上一步走子"
          >
            ↩ 撤回
          </button>
        )}

        <button
          type="button"
          className="h-7 px-2.5 text-xs font-medium text-ink-2 hover:text-ink-0 bg-paper-0 hover:bg-paper-2 rounded-lg border border-hairline transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          onClick={onReset}
          disabled={!hasGame || thinking}
          title="恢复到本题初始局面"
        >
          🔄 重置
        </button>

        <button
          type="button"
          className={`h-7 px-2 text-xs font-medium rounded-lg border transition cursor-pointer ${
            sandbox
              ? 'bg-blue-600 text-white border-blue-600 shadow-xs font-semibold'
              : 'text-ink-3 hover:text-ink-1 bg-paper-0 hover:bg-paper-2 border-hairline'
          }`}
          onClick={onToggleSandbox}
          title="开启自由试走模式，不计入失误统计"
        >
          🧪 试走{sandbox ? '·开' : ''}
        </button>

        <button
          type="button"
          className="h-7 px-3 text-xs font-semibold text-white bg-cinnabar hover:bg-cinnabar-bright rounded-lg border border-cinnabar transition cursor-pointer shadow-xs active:scale-95"
          onClick={onNextPuzzle}
          title="进入下一道精训题"
        >
          下一题 ⏭
        </button>
      </div>
    </div>
  )
}
