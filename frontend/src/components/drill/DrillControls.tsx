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
      {/* 核心学习阶段：iOS Segmented Control 质感分段器 */}
      <div className="flex items-center p-1 bg-paper-1/90 backdrop-blur-md rounded-2xl border border-hairline/70 shadow-3xs">
        <button
          type="button"
          className={`h-7 px-3.5 rounded-xl text-xs font-semibold transition-all duration-200 cursor-pointer border-0 flex items-center gap-1.5 ${
            stage === 'drill' && animMode === 'none'
              ? 'bg-paper-0 text-cinnabar shadow-xs scale-[1.02]'
              : 'bg-transparent text-ink-3 hover:text-ink-1'
          }`}
          onClick={onSwitchToDrill}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-cinnabar/80" />
          <span>动手实训</span>
        </button>
        <button
          type="button"
          className={`h-7 px-3.5 rounded-xl text-xs font-semibold transition-all duration-200 cursor-pointer border-0 flex items-center gap-1.5 ${
            stage === 'exam'
              ? 'bg-paper-0 text-cinnabar shadow-xs scale-[1.02]'
              : 'bg-transparent text-ink-3 hover:text-ink-1'
          }`}
          onClick={() => onReset('exam')}
        >
          <span>🎯</span>
          <span>实战检验</span>
        </button>
        <button
          type="button"
          className={`h-7 px-3.5 rounded-xl text-xs font-semibold transition-all duration-200 cursor-pointer border-0 flex items-center gap-1.5 ${
            stage === 'demo' || animMode === 'good'
              ? 'bg-paper-0 text-cinnabar shadow-xs scale-[1.02]'
              : 'bg-transparent text-ink-3 hover:text-ink-1'
          }`}
          onClick={onStartGoodAnim}
        >
          <span>🎬</span>
          <span>正着演示</span>
        </button>

        {(solved || stage === 'mirror') && (
          <button
            type="button"
            className={`h-7 px-3 rounded-xl text-xs font-bold transition-all duration-200 cursor-pointer border-0 flex items-center gap-1.5 ${
              stage === 'mirror'
                ? 'bg-purple-600 text-white shadow-xs scale-[1.02]'
                : 'text-purple-700 hover:bg-purple-500/10'
            }`}
            onClick={onMirrorDrill}
            title="左右对称镜像测试，检验是否真正掌握第一性原理"
          >
            <span>🔄</span>
            <span>镜像挑战</span>
          </button>
        )}
      </div>

      {/* 辅助开关条：Apple Glass 风格胶囊开关 */}
      <div className="flex items-center p-0.5 bg-paper-1/80 backdrop-blur-md rounded-2xl border border-hairline/70 shadow-3xs">
        <button
          type="button"
          className={`h-7 px-2.5 text-xs font-medium rounded-xl transition cursor-pointer border-0 flex items-center gap-1 ${
            choiceMode
              ? 'bg-paper-0 text-ink-0 font-bold shadow-xs'
              : 'bg-transparent text-ink-3 hover:text-ink-1'
          }`}
          onClick={onToggleChoiceMode}
          title="备选项推演模式：直观对比备选走法"
        >
          <span>🎯</span>
          <span>选项</span>
          <span
            className={`w-1.5 h-1.5 rounded-full ml-0.5 ${
              choiceMode ? 'bg-primary-500' : 'bg-transparent'
            }`}
          />
        </button>
        <button
          type="button"
          className={`h-7 px-2.5 text-xs font-medium rounded-xl transition cursor-pointer border-0 flex items-center gap-1 ${
            spotlightActive
              ? 'bg-paper-0 text-ink-0 font-bold shadow-xs'
              : 'bg-transparent text-ink-3 hover:text-ink-1'
          }`}
          onClick={onToggleSpotlight}
          title="聚焦核心攻防子力，暗化无关棋子"
        >
          <span>🔦</span>
          <span>聚光</span>
          <span
            className={`w-1.5 h-1.5 rounded-full ml-0.5 ${
              spotlightActive ? 'bg-amber-500' : 'bg-transparent'
            }`}
          />
        </button>
        <button
          type="button"
          className={`h-7 px-2.5 text-xs font-medium rounded-xl transition cursor-pointer border-0 flex items-center gap-1 ${
            xrayActive
              ? 'bg-paper-0 text-ink-0 font-bold shadow-xs'
              : 'bg-transparent text-ink-3 hover:text-ink-1'
          }`}
          onClick={onToggleXray}
          title="透视炮架、别马腿与无根大子暗线"
        >
          <span>👁️</span>
          <span>透视</span>
          <span
            className={`w-1.5 h-1.5 rounded-full ml-0.5 ${
              xrayActive ? 'bg-emerald-500' : 'bg-transparent'
            }`}
          />
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
  // 1. 如果处于动画推演模式：展示优雅的 Apple Timeline 控制坞
  if (animMode !== 'none') {
    return (
      <div
        className="flex items-center justify-between flex-wrap gap-2 px-4 py-2 bg-paper-1/90 backdrop-blur-xl border border-hairline/80 rounded-2xl mt-1.5 w-full select-none shadow-2xs"
        aria-label="动画推演控制"
      >
        <div className="flex items-center gap-2">
          <span
            className={`text-xs font-bold px-2.5 py-0.8 rounded-full border ${
              animMode === 'bad'
                ? 'bg-rose-500/15 text-rose-700 border-rose-400/40'
                : animMode === 'good'
                ? 'bg-emerald-500/15 text-emerald-800 border-emerald-400/40'
                : 'bg-amber-500/15 text-amber-800 border-amber-400/40'
            }`}
          >
            {animMode === 'bad' ? '❌ 走错后果' : animMode === 'good' ? '✅ 正解推演' : '👁️ 敌方企图'}
          </span>
          <span className="text-xs text-ink-2 font-num">
            第 <b className="text-ink-0">{animStep}</b> / {activeStepsCount} 步
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            className="w-7.5 h-7.5 flex items-center justify-center text-xs font-medium rounded-xl border border-hairline/80 bg-paper-0 hover:bg-paper-2 text-ink-2 hover:text-ink-0 transition cursor-pointer disabled:opacity-30 active:scale-95 shadow-3xs"
            onClick={onResetAnimStep}
            disabled={animStep === 0}
            title="回到初始起点"
          >
            ⏮
          </button>
          <button
            type="button"
            className="w-7.5 h-7.5 flex items-center justify-center text-xs font-medium rounded-xl border border-hairline/80 bg-paper-0 hover:bg-paper-2 text-ink-2 hover:text-ink-0 transition cursor-pointer disabled:opacity-30 active:scale-95 shadow-3xs"
            onClick={onPrevAnimStep}
            disabled={animStep <= 0}
            title="后退一动"
          >
            ◀
          </button>
          <button
            type="button"
            className="h-7.5 px-3.5 text-xs font-semibold rounded-xl bg-cinnabar hover:bg-cinnabar-bright text-white transition cursor-pointer shadow-xs active:scale-95 flex items-center gap-1"
            onClick={onTogglePlayAnim}
            title={animPlaying ? '暂停播放' : '自动播放'}
          >
            <span>{animPlaying ? '⏸' : '▶'}</span>
            <span>{animPlaying ? '暂停' : '连播'}</span>
          </button>
          <button
            type="button"
            className="w-7.5 h-7.5 flex items-center justify-center text-xs font-medium rounded-xl border border-hairline/80 bg-paper-0 hover:bg-paper-2 text-ink-2 hover:text-ink-0 transition cursor-pointer disabled:opacity-30 active:scale-95 shadow-3xs"
            onClick={onNextAnimStep}
            disabled={animStep >= activeStepsCount}
            title="前进一动"
          >
            ▶
          </button>
          <button
            type="button"
            className="h-7.5 px-3 text-xs font-medium text-ink-2 hover:text-ink-0 bg-paper-0 hover:bg-paper-2 rounded-xl border border-hairline/80 transition cursor-pointer ml-1 active:scale-95 shadow-3xs"
            onClick={onStopAnim}
            title="退出动画演示，回到动手试走"
          >
            换我走
          </button>
        </div>
      </div>
    )
  }

  // 2. 正常实战与动手试走模式
  return (
    <div
      className="flex items-center justify-between flex-wrap gap-2 px-3.5 py-2 bg-paper-1/85 backdrop-blur-xl border border-hairline/80 rounded-2xl mt-1.5 w-full select-none shadow-2xs"
      aria-label="实战动作坞"
    >
      {/* 左侧：法眼三阶提示与战术视听 */}
      <div className="flex items-center gap-2 flex-wrap">
        {onRequestHint && (
          <button
            type="button"
            className={`h-7.5 px-3 text-xs font-medium rounded-xl border transition-all duration-200 cursor-pointer flex items-center gap-2 active:scale-95 ${
              hintLevel > 0
                ? 'bg-amber-500/15 text-amber-900 border-amber-400/50 font-bold shadow-3xs'
                : 'bg-paper-0 border-hairline/80 text-ink-2 hover:text-ink-0 hover:bg-paper-2 shadow-3xs'
            }`}
            onClick={onRequestHint}
            title="三阶法眼提示：第1级看破绽，第2级看关键子，第3级看路线"
          >
            <span>💡 提示</span>
            <div className="flex items-center gap-1">
              <span
                className={`w-1.5 h-1.5 rounded-full transition-colors ${
                  hintLevel >= 1 ? 'bg-amber-500 shadow-xs' : 'bg-ink-0/15'
                }`}
              />
              <span
                className={`w-1.5 h-1.5 rounded-full transition-colors ${
                  hintLevel >= 2 ? 'bg-amber-500 shadow-xs' : 'bg-ink-0/15'
                }`}
              />
              <span
                className={`w-1.5 h-1.5 rounded-full transition-colors ${
                  hintLevel >= 3 ? 'bg-amber-500 shadow-xs' : 'bg-ink-0/15'
                }`}
              />
            </div>
          </button>
        )}

        {threatStepsCount > 0 && !inRebuttal && (
          <button
            type="button"
            className="h-7.5 px-2.5 text-xs font-medium rounded-xl text-ink-2 hover:text-ink-0 bg-paper-0 hover:bg-paper-2 border border-hairline/80 transition cursor-pointer active:scale-95 shadow-3xs"
            onClick={onStartThreatAnim}
            title="推演若我不设防，对手接下来的致命图谋"
          >
            👁️ 敌方企图
          </button>
        )}

        {/* 处于走错惩罚反击态时，高亮突出「为什么亏」和「退回重走」 */}
        {inRebuttal && (
          <>
            <button
              type="button"
              className="h-7.5 px-3 text-xs font-bold rounded-xl bg-cinnabar hover:bg-cinnabar-bright text-white border border-cinnabar transition cursor-pointer shadow-xs active:scale-95 animate-pulse flex items-center gap-1"
              onClick={onUndo}
              title="退回到走错之前重走"
            >
              <span>↩</span>
              <span>退回重走</span>
            </button>
            {badStepsCount > 0 && (
              <button
                type="button"
                className="h-7.5 px-2.5 text-xs font-semibold rounded-xl text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-300 transition cursor-pointer active:scale-95 shadow-3xs"
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
            className="h-7.5 px-2.5 text-xs font-medium text-ink-2 hover:text-ink-0 bg-paper-0 hover:bg-paper-2 rounded-xl border border-hairline/80 transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed active:scale-95 shadow-3xs"
            onClick={onUndo}
            disabled={!hasGame || !hasHistory || thinking}
            title="撤回上一步走子"
          >
            ↩ 撤回
          </button>
        )}

        <button
          type="button"
          className="h-7.5 px-2.5 text-xs font-medium text-ink-2 hover:text-ink-0 bg-paper-0 hover:bg-paper-2 rounded-xl border border-hairline/80 transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed active:scale-95 shadow-3xs"
          onClick={onReset}
          disabled={!hasGame || thinking}
          title="恢复到本题初始局面"
        >
          🔄 重置
        </button>

        <button
          type="button"
          className={`h-7.5 px-2.5 text-xs font-medium rounded-xl border transition cursor-pointer active:scale-95 ${
            sandbox
              ? 'bg-blue-600 text-white border-blue-600 shadow-xs font-semibold'
              : 'text-ink-3 hover:text-ink-1 bg-paper-0 hover:bg-paper-2 border-hairline/80 shadow-3xs'
          }`}
          onClick={onToggleSandbox}
          title="开启沙盒自由试走模式，不计入失误统计"
        >
          🧪 自由试走
        </button>

        <button
          type="button"
          className="h-7.5 px-3.5 text-xs font-semibold text-white bg-cinnabar hover:bg-cinnabar-bright rounded-xl border border-cinnabar transition cursor-pointer shadow-xs active:scale-95 flex items-center gap-1"
          onClick={onNextPuzzle}
          title="进入下一道精训题"
        >
          <span>下一题</span>
          <span>⏭</span>
        </button>
      </div>
    </div>
  )
}
