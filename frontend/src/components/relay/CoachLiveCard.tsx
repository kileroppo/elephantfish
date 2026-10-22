import React from 'react'
import type { AnimatedStep, OpponentThreatInfo, ProsConsAnalysis, ThinkingGuide } from '../../types'

export interface CoachLiveCardProps {
  mode: 'threat' | 'good' | 'bad' | 'guide'
  loading: boolean
  opponentThreat: OpponentThreatInfo | null
  thinkingGuide: ThinkingGuide | null
  activeSteps: AnimatedStep[]
  animStep: number
  animPlaying: boolean
  prosCons: ProsConsAnalysis | null
  onStepClick: (stepIdx: number) => void
  onPrevStep: () => void
  onNextStep: () => void
  onTogglePlay: () => void
  onClose: () => void
  onSwitchMode: (mode: 'threat' | 'good' | 'bad' | 'guide') => void
}

export const CoachLiveCard: React.FC<CoachLiveCardProps> = ({
  mode,
  loading,
  opponentThreat,
  thinkingGuide,
  activeSteps,
  animStep,
  animPlaying,
  prosCons,
  onStepClick,
  onPrevStep,
  onNextStep,
  onTogglePlay,
  onClose,
  onSwitchMode,
}) => {
  return (
    <div
      className="coach-live-card w-full rounded-2xl border border-hairline/90 bg-paper-0/95 backdrop-blur-xl p-3 shadow-sm flex flex-col gap-2.5 select-none animate-fadeIn transition-all duration-200"
      role="region"
      aria-label="实时教练推演卡片"
    >
      {/* 顶部标题与模式切换 (iOS Segmented Control) */}
      <div className="flex items-center justify-between pb-2 border-b border-hairline/80 gap-2">
        <div className="flex items-center p-0.5 bg-paper-1/90 rounded-xl border border-hairline/80 shadow-2xs">
          <button
            type="button"
            className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all duration-200 cursor-pointer border-0 ${
              mode === 'good'
                ? 'bg-paper-0 text-cinnabar font-bold shadow-xs'
                : 'bg-transparent text-ink-3 hover:text-ink-1'
            }`}
            onClick={() => onSwitchMode('good')}
          >
            💡 招法提示
          </button>
          <button
            type="button"
            className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all duration-200 cursor-pointer border-0 ${
              mode === 'threat'
                ? 'bg-paper-0 text-cinnabar font-bold shadow-xs'
                : 'bg-transparent text-ink-3 hover:text-ink-1'
            }`}
            onClick={() => onSwitchMode('threat')}
          >
            🛡️ 识破企图
          </button>
          <button
            type="button"
            className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all duration-200 cursor-pointer border-0 ${
              mode === 'guide'
                ? 'bg-paper-0 text-cinnabar font-bold shadow-xs'
                : 'bg-transparent text-ink-3 hover:text-ink-1'
            }`}
            onClick={() => onSwitchMode('guide')}
          >
            🧭 算路指南
          </button>
        </div>

        <button
          type="button"
          className="w-7 h-7 flex items-center justify-center text-ink-3 hover:text-ink-0 hover:bg-paper-2 rounded-full text-xs transition cursor-pointer shrink-0 active:scale-95"
          onClick={onClose}
          title="收起教练推演"
          aria-label="关闭"
        >
          ✕
        </button>
      </div>

      {/* 主体推演内容 */}
      {loading ? (
        <div className="text-center py-6 text-xs text-ink-3 flex flex-col items-center gap-2">
          <div className="w-5 h-5 border-2 border-cinnabar/30 border-t-cinnabar rounded-full animate-spin" />
          <span className="font-medium">大师正在精算盘面后续走向…</span>
        </div>
      ) : mode === 'guide' && thinkingGuide ? (
        /* 算路三问模式 */
        <div className="flex flex-col gap-2 text-xs">
          <div className="p-2 rounded-xl bg-paper-1/80 border border-hairline/80">
            <span className="text-[11px] font-bold text-amber-900 block mb-1">
              ① 核心抓手（第一性原理）
            </span>
            <ul className="list-disc pl-4 text-ink-2 space-y-1 m-0">
              {thinkingGuide.first_principles.map((fp, idx) => (
                <li key={idx} className="leading-relaxed">
                  {fp}
                </li>
              ))}
            </ul>
          </div>

          <div className="p-2 rounded-xl bg-paper-1/80 border border-hairline/80">
            <span className="text-[11px] font-bold text-blue-900 block mb-1">
              ② 逆向倒推
            </span>
            <p className="text-ink-2 leading-relaxed m-0">
              {thinkingGuide.inversion_tip}
            </p>
          </div>

          <div className="p-2 rounded-xl bg-paper-1/80 border border-hairline/80">
            <span className="text-[11px] font-bold text-cinnabar block mb-1">
              ③ 对抗自查三问
            </span>
            <div className="space-y-1 mt-1">
              {thinkingGuide.adversarial_qa.map((item, idx) => (
                <div key={idx} className="p-1.5 rounded-lg bg-paper-0 border border-hairline/60">
                  <div className="font-bold text-ink-0 text-[11.5px]">{item.q}</div>
                  <div className="text-ink-2 text-[11px] mt-0.5">👉 {item.a}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : mode === 'threat' && opponentThreat && !opponentThreat.is_substantial ? (
        /* 企图平稳态 */
        <div className="p-3 rounded-xl bg-paper-1/80 border border-hairline/80 flex flex-col gap-1 text-xs">
          <div className="font-bold text-ink-0 flex items-center gap-1">
            <span>🛡️</span>
            <span>敌方企图扫描：局势平稳</span>
          </div>
          <div className="text-ink-2 leading-relaxed">{opponentThreat.intent_desc}</div>
          <div className="text-ink-3 text-[11px]">（暂无立即致命杀招，可按既定战术稳步推进）</div>
        </div>
      ) : activeSteps.length > 0 ? (
        /* 分步演示时间轴模式 */
        <div className="flex flex-col gap-2">
          {/* 媒体播放控制条 */}
          <div className="flex items-center justify-between gap-1 flex-wrap bg-paper-1/80 p-1.5 rounded-xl border border-hairline/80 text-xs">
            <span className="text-[11px] font-bold text-ink-2 px-1">
              {animStep > 0 ? `第 ${animStep}/${activeSteps.length} 动` : '推演起点'}
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                className="h-6.5 px-2 rounded-lg border border-hairline/80 bg-paper-0 text-ink-2 hover:text-ink-0 text-xs transition cursor-pointer disabled:opacity-40"
                onClick={onPrevStep}
                disabled={animStep <= 0}
              >
                ◀ 上一步
              </button>
              <button
                type="button"
                className="h-6.5 px-2.5 rounded-lg bg-cinnabar hover:bg-cinnabar-bright text-white font-semibold text-xs transition shadow-xs cursor-pointer active:scale-95"
                onClick={onTogglePlay}
              >
                {animPlaying ? '⏸ 暂停' : '▶ 连播'}
              </button>
              <button
                type="button"
                className="h-6.5 px-2 rounded-lg border border-hairline/80 bg-paper-0 text-ink-2 hover:text-ink-0 text-xs transition cursor-pointer disabled:opacity-40"
                onClick={onNextStep}
                disabled={animStep >= activeSteps.length}
              >
                下一步 ▶
              </button>
            </div>
          </div>

          {/* 分步卡片列表：无内层双滚动条困扰，自然呈现 */}
          <div className="flex flex-col gap-1.5">
            {activeSteps.map((st, idx) => {
              const stepIdx = idx + 1
              const isCurrent = animStep === stepIdx
              return (
                <button
                  key={st.step}
                  type="button"
                  className={`w-full text-left p-2.5 rounded-xl border transition-all duration-200 cursor-pointer ${
                    isCurrent
                      ? 'border-cinnabar bg-cinnabar/10 shadow-xs ring-1 ring-cinnabar/30'
                      : 'border-hairline/70 bg-paper-0/70 hover:bg-paper-0'
                  }`}
                  onClick={() => onStepClick(stepIdx)}
                >
                  <div className="flex items-center justify-between gap-1 mb-1">
                    <span className="text-[11px] font-bold text-ink-2">
                      {st.tag || `第 ${st.step} 步`}
                    </span>
                    <span className="font-display text-xs font-bold text-cinnabar">
                      {st.chinese}
                    </span>
                  </div>
                  <div className="text-xs text-ink-1 leading-relaxed">
                    {st.plain || st.comment}
                  </div>
                </button>
              )
            })}
          </div>

          {prosCons && mode === 'bad' && (
            <div className="text-xs p-2.5 rounded-xl bg-paper-1/80 border border-hairline/80 text-ink-2">
              <strong className="text-ink-0">📊 走势评判：</strong>
              <span>{prosCons.verdict_headline}</span>
            </div>
          )}
        </div>
      ) : (
        <div className="text-center py-4 text-xs text-ink-3">
          <span>当前局面均势，点击盘面落子继续对弈。</span>
        </div>
      )}
    </div>
  )
}
