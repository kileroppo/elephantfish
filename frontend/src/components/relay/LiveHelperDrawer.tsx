import { useEffect } from 'react'
import type { AnimatedStep, OpponentThreatInfo, ProsConsAnalysis, ThinkingGuide } from '../../types'
import { useExitPhase } from '../../hooks/useExitPhase'

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

/** 退场时长：与 useExitPhase 的卸载定时器共用这一个常量，动画播完才卸载 */
const EXIT_MS = 180

/**
 * 实战分步推演浮层：应手台上方的轻弹层（面纱 + 纸面浮层 + 右上 ✕ + Esc）。
 *
 * chrome 与其它面板对齐（ia F13）：
 *   · 关闭 = 右上 ✕ / Esc / 点击面纱空白处，三路等价；
 *   · 进出对等 —— 进 floatIn、退 helperOut（relay-compact.css），退场相位
 *     由 useExitPhase 驱动，与 CoachInterruptCard / 各 Desk 同款；
 *   · 「返回实战」文字钮是显式返回 affordance，与 ✕ 同义。
 *
 * 2026-11-18：内容词汇从 drill- 系与 thinking- 系类（reasoning.css 持有，带
 * amber/blue/#1d4ed8 体系外色）迁到 relay-helper- 系与 relay-guide-badge
 * （relay-desk.css，全令牌）—— 组件与它的样式终于同户。
 */
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
  // 挂载/退场相位：关掉后多活 180ms 播 helperOut，播完才卸载
  const [mounted, leaving] = useExitPhase(helperOpen, EXIT_MS)

  // Esc 收浮层：✕ 的 title 向用户承诺了 (Esc)（ia F13：不承诺没有的行为），
  // 这里兑现它。捕获阶段 + stopImmediatePropagation —— 不透传给 App.tsx 的
  // 全局 Esc（那会顺带退出禅意/关帮助层），与 HelpOverlay 的 Esc 契约同款。
  useEffect(() => {
    if (!mounted || leaving) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopImmediatePropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [mounted, leaving, onClose])

  if (!mounted) return null

  return (
    <>
      {/* 全屏轻量点击遮罩：点击浮层外任意空白处即刻收起关闭，手机端交互友好 */}
      <div
        className={`relay-helper-veil z-[var(--z-veil,100)] ${
          leaving ? 'pointer-events-none [animation:fadeOut_180ms_var(--ease-out)_both]' : 'animate-fadeIn'
        }`}
        onClick={onClose}
        aria-hidden="true"
      />

      <div
        className={`live-helper-drawer${leaving ? ' is-leaving' : ''}`}
        role="region"
        aria-label="实战分步动画推演"
      >
        {/* 常驻右上角关闭按钮：转述台统一 idiom（.relay-close-btn） */}
        <button
          type="button"
          className="relay-close-btn absolute top-2.5 right-2.5 z-10"
          onClick={onClose}
          title="返回对局 (Esc)"
          aria-label="关闭推演面板"
        >
          ✕
        </button>

        {helperLoading ? (
          <div className="bg-paper-1 border border-hairline rounded text-center py-8 text-xs text-ink-2 flex flex-col items-center gap-3">
            <div className="w-5 h-5 border-2 border-cinnabar/30 border-t-cinnabar rounded-full animate-spin" />
            <span>正在为你推演接下来 3~4 步的棋局走向…</span>
          </div>
        ) : helperMode === 'guide' && thinkingGuide ? (
          <div className="bg-paper-1 border border-hairline-strong rounded p-3 flex flex-col gap-3 pr-6">
            <div className="flex items-center justify-between pb-2 border-b border-hairline gap-2">
              <h4 className="text-[13px] font-bold text-ink-0 m-0">
                🧠 当前局面算路助手（第一性原理 · 逆向思维 · 对抗三问）
              </h4>
            </div>
            <div>
              <span className="relay-guide-badge">① 第一性原理（只看这 3 件事）</span>
              <ul className="list-disc pl-5 text-xs text-ink-2 space-y-1 my-1">
                {thinkingGuide.first_principles.map((fp, idx) => (
                  <li key={idx}>{fp}</li>
                ))}
              </ul>
            </div>
            <div>
              <span className="relay-guide-badge">② 逆向思维（从 3 步后倒推现在）</span>
              <p className="text-xs text-ink-2 leading-relaxed m-0 p-1">
                {thinkingGuide.inversion_tip}
              </p>
            </div>
            <div>
              <span className="relay-guide-badge is-accent">③ 落子前对抗三问</span>
              <div className="space-y-1.5 mt-1">
                {thinkingGuide.adversarial_qa.map((item, idx) => (
                  <div key={idx} className="p-2 rounded bg-paper-1 border border-hairline text-xs">
                    <div className="font-semibold text-ink-1 mb-0.5">{item.q}</div>
                    <div className="text-ink-3">👉 {item.a}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : helperMode === 'threat' && opponentThreat && !opponentThreat.is_substantial ? (
          <div className="bg-paper-1 border border-hairline-strong rounded p-3 pr-8 flex flex-col gap-2">
            <div className="flex items-center gap-2 flex-wrap text-xs">
              <span className="relay-guide-badge">🛡️ 对手企图</span>
              <span className="text-ink-1 font-medium">{opponentThreat.intent_desc}</span>
              <span className="text-ink-3">（已在盘面标出行动路线）</span>
            </div>
            <button
              type="button"
              className="btn btn-ghost btn-sm self-end mt-1 cursor-pointer"
              onClick={onClose}
            >
              知道了，返回实战
            </button>
          </div>
        ) : (helperMode === 'threat' && (opponentThreat?.is_substantial || activeSteps.length > 0)) ||
          activeSteps.length > 0 ? (
          <div className={`relay-helper-theater mode-${helperMode}`}>
            <div className="flex items-center justify-between gap-2 flex-wrap pb-1 border-b border-hairline">
              <div className="text-[13px] font-bold text-ink-0">
                {helperMode === 'threat'
                  ? '👁️ 对手企图：对手具有进攻威胁（演示走法）'
                  : helperMode === 'good'
                    ? '✅ 最佳走法动画：接下来 3~4 步怎么走最占优'
                    : '❌ 走错后果动画：为什么那步棋几步后会吃亏'}
              </div>
              <div className="flex items-center gap-1.5 flex-wrap">
                <button
                  type="button"
                  className="btn btn-ghost btn-sm cursor-pointer disabled:opacity-40"
                  onClick={onPrevStep}
                  disabled={animStep <= 0}
                >
                  ◀ 上一步
                </button>
                <button
                  type="button"
                  className="btn btn-primary btn-sm cursor-pointer"
                  onClick={onTogglePlay}
                >
                  {animPlaying ? '⏸ 暂停' : '▶ 自动连播'}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm cursor-pointer disabled:opacity-40"
                  onClick={onNextStep}
                  disabled={animStep >= activeSteps.length}
                >
                  下一步 ▶
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm cursor-pointer border border-hairline"
                  onClick={onClose}
                >
                  返回实战
                </button>
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
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
                    className={`relay-helper-step${isCurrent ? ' is-current' : ''}`}
                    onClick={() => onStepClick(stepIdx)}
                  >
                    <div className="flex items-center justify-between gap-2 mb-0.5">
                      <span className={`relay-helper-step-badge${st.tag ? ' has-tag' : ''}${tagClass}`}>
                        {st.tag || `第 ${st.step} 步`}
                      </span>
                      <span className="font-display text-[13px] font-bold text-cinnabar">
                        {st.chinese}
                      </span>
                    </div>
                    <div className="text-[12px] leading-relaxed text-ink-1">
                      {st.plain || st.comment}
                    </div>
                  </button>
                )
              })}
            </div>
            {prosCons && helperMode === 'bad' && (
              <div className="text-xs p-2 rounded bg-paper-0 border border-hairline mt-1 text-ink-2">
                <strong className="font-semibold text-ink-0">📊 优劣对比：</strong>
                <span>{prosCons.verdict_headline}</span>
              </div>
            )}
          </div>
        ) : (
          <div className="text-center py-6 text-xs text-ink-3 flex flex-col items-center gap-2">
            <span>当前局面平稳，暂无明显强制杀招。</span>
            <button
              type="button"
              className="btn btn-ghost btn-sm cursor-pointer border border-hairline mt-1"
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
