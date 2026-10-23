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

/**
 * 棋盘顶置微型态势与透视开关条 (Precision Light Top HUD)
 */
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
    <div className="w-full max-w-[min(100%,520px)] mx-auto px-2 py-1 bg-white/95 backdrop-blur-md rounded-lg border border-slate-200/90 shadow-sm flex items-center justify-between gap-1 select-none font-mono text-xs mb-2 text-slate-700">
      {/* 阶段选择：实训 / 实战 / 演示 */}
      <div className="flex items-center gap-1 font-sans">
        <button
          type="button"
          className={`h-6.5 px-2 rounded text-[11px] font-semibold transition-all cursor-pointer border flex items-center gap-1.5 ${
            stage === 'drill' && animMode === 'none'
              ? 'bg-sky-50 text-sky-700 border-sky-300 shadow-3xs'
              : 'bg-transparent text-slate-500 border-transparent hover:text-slate-800 hover:bg-slate-100'
          }`}
          onClick={onSwitchToDrill}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-sky-500" />
          <span>动手实训</span>
        </button>

        <button
          type="button"
          className={`h-6.5 px-2 rounded text-[11px] font-semibold transition-all cursor-pointer border flex items-center gap-1.5 ${
            stage === 'exam'
              ? 'bg-amber-50 text-amber-700 border-amber-300 shadow-3xs'
              : 'bg-transparent text-slate-500 border-transparent hover:text-slate-800 hover:bg-slate-100'
          }`}
          onClick={() => onReset('exam')}
        >
          <span>🎯</span>
          <span>盲测检验</span>
        </button>

        <button
          type="button"
          className={`h-6.5 px-2 rounded text-[11px] font-semibold transition-all cursor-pointer border flex items-center gap-1.5 ${
            stage === 'demo' || animMode === 'good'
              ? 'bg-emerald-50 text-emerald-700 border-emerald-300 shadow-3xs'
              : 'bg-transparent text-slate-500 border-transparent hover:text-slate-800 hover:bg-slate-100'
          }`}
          onClick={onStartGoodAnim}
        >
          <span>🎬</span>
          <span>正手演示</span>
        </button>

        {(solved || stage === 'mirror') && (
          <button
            type="button"
            className={`h-6.5 px-2 rounded text-[11px] font-bold transition-all cursor-pointer border flex items-center gap-1 ${
              stage === 'mirror'
                ? 'bg-purple-50 text-purple-700 border-purple-300 shadow-3xs'
                : 'text-purple-600 border-transparent hover:bg-purple-50'
            }`}
            onClick={onMirrorDrill}
            title="左右镜像对抗"
          >
            <span>🔄</span>
            <span>镜像</span>
          </button>
        )}
      </div>

      <div className="h-3 w-px bg-slate-200" aria-hidden="true" />

      {/* 辅助透视开关：透视 / 聚光 / 选项 */}
      <div className="flex items-center gap-1 font-mono">
        <button
          type="button"
          className={`h-6.5 px-2 text-[11px] rounded transition cursor-pointer border flex items-center gap-1 ${
            xrayActive
              ? 'bg-sky-50 text-sky-700 border-sky-300 font-semibold'
              : 'bg-transparent text-slate-400 border-transparent hover:text-slate-700'
          }`}
          onClick={onToggleXray}
          title="X-Ray 战术暗线透视"
        >
          <span>👁️ 透视</span>
          <span className={`w-1 h-1 rounded-full ${xrayActive ? 'bg-sky-500' : 'bg-slate-300'}`} />
        </button>

        <button
          type="button"
          className={`h-6.5 px-2 text-[11px] rounded transition cursor-pointer border flex items-center gap-1 ${
            spotlightActive
              ? 'bg-amber-50 text-amber-700 border-amber-300 font-semibold'
              : 'bg-transparent text-slate-400 border-transparent hover:text-slate-700'
          }`}
          onClick={onToggleSpotlight}
          title="聚光核心子力"
        >
          <span>🔦 聚光</span>
          <span className={`w-1 h-1 rounded-full ${spotlightActive ? 'bg-amber-500' : 'bg-slate-300'}`} />
        </button>

        <button
          type="button"
          className={`h-6.5 px-2 text-[11px] rounded transition cursor-pointer border flex items-center gap-1 ${
            choiceMode
              ? 'bg-indigo-50 text-indigo-700 border-indigo-300 font-semibold'
              : 'bg-transparent text-slate-400 border-transparent hover:text-slate-700'
          }`}
          onClick={onToggleChoiceMode}
          title="着法矩阵面板切换"
        >
          <span>❖ 矩阵</span>
          <span className={`w-1 h-1 rounded-full ${choiceMode ? 'bg-indigo-500' : 'bg-slate-300'}`} />
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

/**
 * 棋盘底部极简悬浮控制坞 (Precision Light Stealth HUD 40px)
 */
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
  // 1. 动画演练状态下的 HUD
  if (animMode !== 'none') {
    return (
      <div
        className="flex items-center justify-between flex-wrap gap-2 px-3 py-1.5 bg-white/95 backdrop-blur-md border border-slate-200/90 rounded-lg mt-1 w-full max-w-[min(100%,520px)] mx-auto select-none font-mono text-xs shadow-sm text-slate-700"
        aria-label="动画推演控制"
      >
        <div className="flex items-center gap-2">
          <span
            className={`text-[11px] font-bold px-2 py-0.5 rounded border ${
              animMode === 'bad'
                ? 'bg-rose-50 text-rose-700 border-rose-300'
                : animMode === 'good'
                ? 'bg-emerald-50 text-emerald-700 border-emerald-300'
                : 'bg-amber-50 text-amber-700 border-amber-300'
            }`}
          >
            {animMode === 'bad' ? 'FLAW REPLAY' : animMode === 'good' ? 'OPTIMAL' : 'THREAT'}
          </span>
          <span className="text-slate-500 text-xs">
            PLY <b className="text-slate-800">{animStep}</b> / {activeStepsCount}
          </span>
        </div>

        <div className="flex items-center gap-1 whitespace-nowrap">
          <button
            type="button"
            className="w-7 h-7 flex items-center justify-center text-xs rounded border border-slate-200 bg-slate-50 text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition cursor-pointer disabled:opacity-30 active:scale-95"
            onClick={onResetAnimStep}
            disabled={animStep === 0}
            title="回到起点"
          >
            ⏮
          </button>
          <button
            type="button"
            className="w-7 h-7 flex items-center justify-center text-xs rounded border border-slate-200 bg-slate-50 text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition cursor-pointer disabled:opacity-30 active:scale-95"
            onClick={onPrevAnimStep}
            disabled={animStep <= 0}
            title="后退一动"
          >
            ◀
          </button>
          <button
            type="button"
            className="h-7 px-2.5 text-xs font-semibold rounded bg-sky-600 hover:bg-sky-700 text-white transition cursor-pointer shadow-xs active:scale-95 flex items-center gap-1"
            onClick={onTogglePlayAnim}
          >
            <span>{animPlaying ? '⏸ 暂停' : '▶ 播放'}</span>
          </button>
          <button
            type="button"
            className="w-7 h-7 flex items-center justify-center text-xs rounded border border-slate-200 bg-slate-50 text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition cursor-pointer disabled:opacity-30 active:scale-95"
            onClick={onNextAnimStep}
            disabled={animStep >= activeStepsCount}
            title="前进一动"
          >
            ▶
          </button>
          <button
            type="button"
            className="h-7 px-2.5 text-xs text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded border border-slate-200 transition cursor-pointer ml-1 active:scale-95"
            onClick={onStopAnim}
          >
            退出演示
          </button>
        </div>
      </div>
    )
  }

  // 2. 正常实战 HUD (40px)
  return (
    <div
      className="flex items-center justify-between flex-wrap gap-2 px-3 py-1.5 bg-white/95 backdrop-blur-md border border-slate-200/90 rounded-lg mt-1 w-full max-w-[min(100%,520px)] mx-auto select-none font-mono text-xs shadow-sm text-slate-700"
      aria-label="实战控制坞"
    >
      {/* 左侧：提示 / 敌方企图 */}
      <div className="flex items-center gap-1.5 font-sans">
        {onRequestHint && (
          <button
            type="button"
            className={`h-7 px-2.5 rounded border transition cursor-pointer flex items-center gap-1.5 active:scale-95 ${
              hintLevel > 0
                ? 'bg-amber-50 text-amber-800 border-amber-300 font-bold'
                : 'bg-slate-50 border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
            onClick={onRequestHint}
            title="启发点拨提示"
          >
            <span>💡 提示</span>
            <div className="flex items-center gap-0.5">
              <span className={`w-1 h-1 rounded-full ${hintLevel >= 1 ? 'bg-amber-500' : 'bg-slate-300'}`} />
              <span className={`w-1 h-1 rounded-full ${hintLevel >= 2 ? 'bg-amber-500' : 'bg-slate-300'}`} />
              <span className={`w-1 h-1 rounded-full ${hintLevel >= 3 ? 'bg-amber-500' : 'bg-slate-300'}`} />
            </div>
          </button>
        )}

        {threatStepsCount > 0 && !inRebuttal && (
          <button
            type="button"
            className="h-7 px-2 rounded text-slate-600 hover:text-slate-900 bg-slate-50 hover:bg-slate-100 border border-slate-200 transition cursor-pointer active:scale-95"
            onClick={onStartThreatAnim}
            title="推演对手致命图谋"
          >
            <span>👁️ 敌方企图</span>
          </button>
        )}

        {inRebuttal && (
          <>
            <button
              type="button"
              className="h-7 px-2.5 font-bold rounded bg-rose-600 hover:bg-rose-700 text-white border border-rose-600 transition cursor-pointer shadow-xs active:scale-95 animate-pulse flex items-center gap-1"
              onClick={onUndo}
            >
              <span>↩ 退回重走</span>
            </button>
            {badStepsCount > 0 && (
              <button
                type="button"
                className="h-7 px-2 font-semibold rounded text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-300 transition cursor-pointer active:scale-95"
                onClick={onStartBadAnim}
              >
                🎬 反制回放 ({badStepsCount}手)
              </button>
            )}
          </>
        )}
      </div>

      {/* 右侧：撤回 / 重置 / 自由试走 / 下一题 */}
      <div className="flex items-center gap-1.5 whitespace-nowrap font-mono">
        {!inRebuttal && (
          <button
            type="button"
            className="h-7 px-2 text-slate-600 hover:text-slate-900 bg-slate-50 hover:bg-slate-100 rounded border border-slate-200 transition cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed active:scale-95"
            onClick={onUndo}
            disabled={!hasGame || !hasHistory || thinking}
            title="撤回上一着 (Z)"
          >
            ↩ 撤回
          </button>
        )}

        <button
          type="button"
          className="h-7 px-2 text-slate-600 hover:text-slate-900 bg-slate-50 hover:bg-slate-100 rounded border border-slate-200 transition cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed active:scale-95"
          onClick={onReset}
          disabled={!hasGame || thinking}
          title="重置棋盘 (R)"
        >
          🔄 重置
        </button>

        <button
          type="button"
          className={`h-7 px-2 rounded border transition cursor-pointer active:scale-95 ${
            sandbox
              ? 'bg-sky-50 text-sky-700 border-sky-300 font-semibold'
              : 'text-slate-500 hover:text-slate-700 bg-slate-50 border-slate-200'
          }`}
          onClick={onToggleSandbox}
          title="沙盒自由试走"
        >
          🧪 自由
        </button>

        <button
          type="button"
          className="h-7 px-3 font-bold text-white bg-red-600 hover:bg-red-700 rounded border border-red-600 transition cursor-pointer shadow-sm active:scale-95 flex items-center gap-1 font-sans"
          onClick={onNextPuzzle}
          title="攻坚下一道精训题"
        >
          <span>下一题</span>
          <span>➔</span>
        </button>
      </div>
    </div>
  )
}
