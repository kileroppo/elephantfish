import type { AnimatedStep, OpponentThreatInfo, ProsConsAnalysis, ThinkingGuide } from '../../types'

export interface LiveHelperDrawerProps {
  helperOpen: boolean
  helperLoading: boolean
  helperMode: 'threat' | 'good' | 'bad' | 'guide'
  opponentThreat?: OpponentThreatInfo | null
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
}

export function LiveHelperDrawer({
  helperOpen,
  helperLoading,
  helperMode,
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
}: LiveHelperDrawerProps) {
  if (!helperOpen) return null

  return (
    <>
      {/* 全屏轻量点击遮罩：点击浮层外任意空白处即刻收起关闭，手机端交互友好 */}
      <div
        className="fixed inset-0 z-40 bg-black/20 backdrop-blur-[1px] transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />

      <div
        className="live-helper-drawer absolute bottom-[calc(100%+8px)] left-1/2 -translate-x-1/2 w-[min(94vw,680px)] max-h-[min(70vh,480px)] overflow-y-auto z-50 bg-paper-0 border border-hairline-strong rounded-xl shadow-2xl p-3 sm:p-4 m-0 animate-[floatIn_180ms_var(--ease-out)_both]"
        role="region"
        aria-label="实战分步动画推演"
      >
        {/* 常驻右上角关闭按钮 */}
        <button
          type="button"
          className="absolute top-2.5 right-2.5 z-10 w-7 h-7 rounded-full flex items-center justify-center text-ink-3 hover:text-ink-0 hover:bg-paper-2 text-sm transition-colors cursor-pointer"
          onClick={onClose}
          title="关闭提示 (Esc)"
          aria-label="关闭"
        >
          ✕
        </button>

        {helperLoading ? (
          <div className="live-helper-loading text-center py-8 text-xs text-ink-3 flex flex-col items-center gap-3">
            <div className="w-5 h-5 border-2 border-cinnabar/30 border-t-cinnabar rounded-full animate-spin" />
            <span>正在为你推演接下来 3~4 步的棋局走向…</span>
          </div>
        ) : helperMode === 'guide' && thinkingGuide ? (
          <div className="drill-thinking-card is-compact flex flex-col gap-3 pr-6">
            <div className="thinking-card-head flex items-center justify-between pb-2 border-b border-hairline gap-2">
              <h4 className="text-[13px] font-bold text-ink-0 m-0">
                🧠 当前局面算路助手（第一性原理 · 逆向思维 · 对抗三问）
              </h4>
            </div>
            <div className="thinking-section">
              <div className="thinking-badge is-fp inline-block px-2 py-0.5 text-xs font-semibold rounded bg-amber-100/70 text-amber-900 border border-amber-300/60 mb-1.5">
                ① 第一性原理（只看这 3 件事）
              </div>
              <ul className="thinking-fp-list list-disc pl-5 text-xs text-ink-2 space-y-1 my-1">
                {thinkingGuide.first_principles.map((fp, idx) => (
                  <li key={idx}>{fp}</li>
                ))}
              </ul>
            </div>
            <div className="thinking-section">
              <div className="thinking-badge is-inv inline-block px-2 py-0.5 text-xs font-semibold rounded bg-blue-100/70 text-blue-900 border border-blue-300/60 mb-1.5">
                ② 逆向思维（从 3 步后倒推现在）
              </div>
              <p className="thinking-inv-text text-xs text-ink-2 leading-relaxed m-0 p-1">
                {thinkingGuide.inversion_tip}
              </p>
            </div>
            <div className="thinking-section">
              <div className="thinking-badge is-adv inline-block px-2 py-0.5 text-xs font-semibold rounded bg-rose-100/70 text-rose-900 border border-rose-300/60 mb-1.5">
                ③ 落子前对抗三问
              </div>
              <div className="thinking-qa-list space-y-1.5 mt-1">
                {thinkingGuide.adversarial_qa.map((item, idx) => (
                  <div key={idx} className="thinking-qa-item p-2 rounded bg-paper-1 border border-hairline text-xs">
                    <div className="qa-question font-semibold text-ink-1 mb-0.5">{item.q}</div>
                    <div className="qa-answer text-ink-3">👉 {item.a}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : helperMode === 'threat' && opponentThreat && !opponentThreat.is_substantial ? (
          <div className="drill-theater-card mode-threat is-calm p-3 pr-8 flex flex-col gap-2">
            <div className="drill-calm-row flex items-center gap-2 flex-wrap text-xs">
              <span className="drill-calm-badge px-2 py-0.5 rounded font-medium bg-amber-100 text-amber-900">
                🛡️ 对手企图
              </span>
              <span className="drill-calm-text text-ink-1 font-medium">{opponentThreat.intent_desc}</span>
              <span className="drill-calm-route-hint text-ink-3">（已在盘面标出行动路线）</span>
            </div>
            <button
              type="button"
              className="btn btn-ghost btn-xs text-xs px-3 py-1 rounded border border-hairline self-end mt-1 cursor-pointer"
              onClick={onClose}
            >
              知道了，返回实战
            </button>
          </div>
        ) : (helperMode === 'threat' && (opponentThreat?.is_substantial || activeSteps.length > 0)) || activeSteps.length > 0 ? (
          <div
            className={`drill-theater-card mode-${helperMode} p-3 pr-8 rounded-md bg-paper-1 border-[1.5px] border-hairline-strong flex flex-col gap-2.5 ${
              helperMode === 'threat'
                ? 'border-[rgba(180,83,9,0.35)] bg-gradient-to-b from-amber-500/[0.06] to-paper-1'
                : helperMode === 'good'
                  ? 'border-[rgba(16,124,92,0.35)] bg-gradient-to-b from-emerald-500/[0.05] to-paper-1'
                  : 'border-[var(--cinnabar-edge)] bg-gradient-to-b from-red-600/[0.05] to-paper-1'
            }`}
          >
            <div className="drill-theater-head flex items-center justify-between gap-2 flex-wrap pb-1 border-b border-hairline">
              <div className="drill-theater-title text-[13px] font-bold text-ink-0">
                {helperMode === 'threat'
                  ? '👁️ 对手企图：对手具有进攻威胁（演示走法）'
                  : helperMode === 'good'
                    ? '✅ 最佳走法动画：接下来 3~4 步怎么走最占优'
                    : '❌ 走错后果动画：为什么那步棋几步后会吃亏'}
              </div>
              <div className="drill-theater-controls flex items-center gap-1.5 flex-wrap">
                <button
                  type="button"
                  className="btn btn-ghost btn-xs text-xs px-2 py-0.5 rounded cursor-pointer disabled:opacity-40"
                  onClick={onPrevStep}
                  disabled={animStep <= 0}
                >
                  ◀ 上一步
                </button>
                <button
                  type="button"
                  className="btn btn-primary btn-xs text-xs px-2.5 py-0.5 rounded cursor-pointer"
                  onClick={onTogglePlay}
                >
                  {animPlaying ? '⏸ 暂停' : '▶ 自动连播'}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-xs text-xs px-2 py-0.5 rounded cursor-pointer disabled:opacity-40"
                  onClick={onNextStep}
                  disabled={animStep >= activeSteps.length}
                >
                  下一步 ▶
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-xs text-xs px-2 py-0.5 rounded cursor-pointer border border-hairline"
                  onClick={onClose}
                >
                  返回实战
                </button>
              </div>
            </div>
            <div className="drill-theater-steps flex flex-col gap-1.5">
              {activeSteps.map((st, idx) => {
                const stepIdx = idx + 1
                const isCurrent = animStep === stepIdx
                const tagClass = st.tag
                  ? st.tag.includes('对手')
                    ? ' tag-opp'
                    : st.tag.includes('我方')
                      ? ' tag-our'
                      : ' tag-follow'
                  : ''
                return (
                  <button
                    key={st.step}
                    type="button"
                    className={`drill-step-item w-full text-left p-2 rounded bg-paper-0 border border-hairline cursor-pointer transition-all duration-150 hover:border-hairline-strong ${
                      isCurrent ? 'is-current !border-[1.5px] !border-cinnabar !bg-[var(--cinnabar-wash)] shadow-sm' : ''
                    }`}
                    onClick={() => onStepClick(stepIdx)}
                  >
                    <div className="drill-step-top flex items-center justify-between gap-2 mb-0.5">
                      <span className={`drill-step-badge${st.tag ? ' has-tag' : ''}${tagClass}`}>
                        {st.tag || `第 ${st.step} 步`}
                      </span>
                      <span className="drill-step-move font-display text-[13px] font-bold text-cinnabar">
                        {st.chinese}
                      </span>
                    </div>
                    <div className="drill-step-plain text-[12px] leading-relaxed text-ink-1">
                      {st.plain || st.comment}
                    </div>
                  </button>
                )
              })}
            </div>
            {prosCons && helperMode === 'bad' && (
              <div className="live-pros-cons-mini text-xs p-2 rounded bg-paper-0 border border-hairline mt-1 text-ink-2">
                <strong className="font-semibold text-ink-0">📊 优劣对比：</strong>
                <span>{prosCons.verdict_headline}</span>
              </div>
            )}
          </div>
        ) : (
          <div className="live-helper-loading text-center py-6 text-xs text-ink-3 flex flex-col items-center gap-2">
            <span>当前局面平稳，暂无明显强制杀招。</span>
            <button
              type="button"
              className="btn btn-ghost btn-xs text-xs px-3 py-1 rounded border border-hairline cursor-pointer mt-1"
              onClick={onClose}
            >
              返回实战
            </button>
          </div>
        )}
      </div>
    </>
  )
}
