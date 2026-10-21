import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api'
import type {
  AnimatedStep,
  GameSnapshot,
  ProsConsAnalysis,
  ThinkingGuide,
  VisualClues,
} from '../types'
import { buildAnimatedFrames } from '../lib/replay'
import { scoreText, seconds } from '../lib/format'
import { play } from '../lib/sound'
import type { SubmitOutcome } from '../hooks/useGame'
import { useGameContext } from '../context/GameContext'
import { useUIContext } from '../context/UIContext'

export interface RelayConsoleProps {
  game?: GameSnapshot
  thinking?: boolean
  queued?: string | null
  onSubmit?: (text: string) => Promise<SubmitOutcome>
  onClearQueue?: () => void
  onStop?: () => void
  onEngineMove?: () => void
  playMode?: 'sparring' | 'relay'
  shadowGuess?: boolean
  coachGuard?: boolean
  cluesActive?: boolean
  onToggleClues?: (clues: VisualClues | null) => void
  onOpenDrill?: () => void
  onUndo?: () => void
  onPreviewBoard?: (
    overrideGame: GameSnapshot | null,
    pv: string[],
    clues: VisualClues | null,
  ) => void
}

export function RelayConsole(props: RelayConsoleProps) {
  const g = useGameContext()
  const ui = useUIContext()

  const game = props.game ?? g.state?.game
  if (!game) return null

  const thinking = props.thinking ?? g.thinking
  const queued = props.queued ?? g.queued
  const onSubmit = props.onSubmit ?? g.submitMove
  const onClearQueue = props.onClearQueue ?? g.clearQueue
  const onStop = props.onStop ?? (() => void g.stopThinking())
  const onEngineMove = props.onEngineMove ?? (() => void g.engineMove())
  const playMode = props.playMode ?? ui.playMode
  const shadowGuess = props.shadowGuess ?? ui.shadowGuess
  const coachGuard = props.coachGuard ?? (g.state?.settings.coach_guard !== false)
  const cluesActive = props.cluesActive ?? (ui.liveClues !== null)
  const onToggleClues = props.onToggleClues ?? ui.setLiveClues
  const onOpenDrill = props.onOpenDrill ?? (() => ui.openDrillAt())
  const onUndo = props.onUndo ?? (() => void g.undoRound())
  const onPreviewBoard = props.onPreviewBoard ?? ui.handlePreviewBoard
  const [text, setText] = useState('')
  const [showTypeInput, setShowTypeInput] = useState(false)
  const [copied, setCopied] = useState(false)
  const [rejected, setRejected] = useState(0)
  const [dismissedPly, setDismissedPly] = useState<number | null>(null)
  const copyTimer = useRef<number>()

  // 实战盘面「对手企图 / 优劣势分步动画 / 算路三问」助手状态
  const [helperOpen, setHelperOpen] = useState(false)
  const [helperLoading, setHelperLoading] = useState(false)
  const [helperMode, setHelperMode] = useState<'threat' | 'good' | 'bad' | 'guide'>('threat')
  const [threatSteps, setThreatSteps] = useState<AnimatedStep[]>([])
  const [goodSteps, setGoodSteps] = useState<AnimatedStep[]>([])
  const [badSteps, setBadSteps] = useState<AnimatedStep[]>([])
  const [prosCons, setProsCons] = useState<ProsConsAnalysis | null>(null)
  const [thinkingGuide, setThinkingGuide] = useState<ThinkingGuide | null>(null)
  const [baseSnap, setBaseSnap] = useState<GameSnapshot | null>(null)
  const [animStep, setAnimStep] = useState(0)
  const [animPlaying, setAnimPlaying] = useState(false)
  const animTimerRef = useRef<number | null>(null)

  const clearAnimTimer = useCallback(() => {
    if (animTimerRef.current !== null) {
      window.clearInterval(animTimerRef.current)
      animTimerRef.current = null
    }
  }, [])

  const closeHelper = useCallback(() => {
    clearAnimTimer()
    setAnimPlaying(false)
    setAnimStep(0)
    setHelperOpen(false)
    onPreviewBoard?.(null, [], null)
  }, [clearAnimTimer, onPreviewBoard])

  // 当实战盘面手数变化时，自动退出演示，回到真实对局
  useEffect(() => {
    closeHelper()
  }, [game.ply, closeHelper])

  const activeSteps: AnimatedStep[] = useMemo(() => {
    if (helperMode === 'threat') return threatSteps
    if (helperMode === 'good') return goodSteps
    if (helperMode === 'bad') return badSteps
    return []
  }, [helperMode, threatSteps, goodSteps, badSteps])

  const animFrames: GameSnapshot[] = useMemo(() => {
    const start = baseSnap || game
    if (!start || activeSteps.length === 0) return []
    return buildAnimatedFrames(start, activeSteps)
  }, [baseSnap, game, activeSteps])

  // 自动连播控制
  useEffect(() => {
    clearAnimTimer()
    if (!helperOpen || !animPlaying || helperMode === 'guide' || activeSteps.length === 0) return

    const maxStep = activeSteps.length
    animTimerRef.current = window.setInterval(() => {
      setAnimStep((prev) => {
        if (prev < maxStep) {
          const next = prev + 1
          const st = activeSteps[next - 1]
          if (st?.captured) play('capture')
          else play('move')
          return next
        } else {
          clearAnimTimer()
          setAnimPlaying(false)
          return prev
        }
      })
    }, 1300)

    return clearAnimTimer
  }, [helperOpen, animPlaying, helperMode, activeSteps, clearAnimTimer])

  // 同步当前动画帧到主棋盘
  useEffect(() => {
    if (!helperOpen || helperMode === 'guide' || animFrames.length === 0) {
      onPreviewBoard?.(null, [], null)
      return
    }
    const frame = animFrames[Math.min(animStep, animFrames.length - 1)]
    const curStep = animStep > 0 ? activeSteps[animStep - 1] : activeSteps[0]
    const pv = curStep ? [curStep.iccs || curStep.move] : []
    const clues: VisualClues | null =
      curStep?.threat_squares && curStep.threat_squares.length > 0
        ? { weakness_squares: curStep.threat_squares }
        : null
    onPreviewBoard?.(frame, pv, clues)
  }, [helperOpen, helperMode, animStep, animFrames, activeSteps, onPreviewBoard])

  // 触发实战预演与对手企图分析
  const openLiveHelper = async (
    targetMode: 'threat' | 'good' | 'bad' | 'guide',
    candidateMove?: string,
  ) => {
    clearAnimTimer()
    setHelperOpen(true)
    setHelperLoading(true)
    setHelperMode(targetMode)
    setAnimStep(0)
    setAnimPlaying(false)
    try {
      const res = await api.preview(game.fen, candidateMove)
      setBaseSnap(res.base_game || game)
      setThreatSteps(res.opponent_threat_steps || [])
      setGoodSteps(res.good_steps || [])
      setBadSteps(res.bad_steps || [])
      if (res.pros_cons) setProsCons(res.pros_cons)
      if (res.thinking_guide) setThinkingGuide(res.thinking_guide)

      if (targetMode !== 'guide') {
        setAnimStep(0)
        setAnimPlaying(true)
      }
    } catch {
      // 忽略网络异常
    } finally {
      setHelperLoading(false)
    }
  }

  const lastEngineMove = useMemo(() => {
    for (let i = game.records.length - 1; i >= 0; i -= 1) {
      if (game.records[i].by === 'engine') return game.records[i]
    }
    return null
  }, [game.records])

  const lastHumanMove = useMemo(() => {
    for (let i = game.records.length - 1; i >= 0; i -= 1) {
      if (game.records[i].by !== 'engine') return game.records[i]
    }
    return null
  }, [game.records])

  const humanTactics = lastHumanMove?.review?.tactics ?? null
  const showCoachInterrupt =
    coachGuard &&
    playMode === 'sparring' &&
    lastHumanMove &&
    dismissedPly !== lastHumanMove.ply &&
    humanTactics &&
    (humanTactics.severity === 'critical' || humanTactics.severity === 'warn') &&
    lastHumanMove.review?.rank !== 1

  const playing = game.status.state === 'playing'

  // '/'：在任何地方（输入框外）按下都展开录入栏并聚焦
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return
      e.preventDefault()
      setShowTypeInput(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => () => window.clearTimeout(copyTimer.current), [])

  // 换了一手，复制态归零 —— 「已复制」只属于那一手
  useEffect(() => {
    setCopied(false)
  }, [lastEngineMove?.ply])

  const submit = async () => {
    const payload = text.trim()
    if (!payload) return
    const outcome = await onSubmit(payload)
    if (outcome === 'ok' || outcome === 'queued') {
      setText('')
      setShowTypeInput(false)
    } else {
      // 走法不合法：输入框横向抖一下，比只弹一条 toast 更贴手
      setRejected((n) => n + 1)
    }
  }

  const copyMove = async (iccs: string, chinese: string) => {
    try {
      await navigator.clipboard.writeText(`${iccs} ${chinese}`)
      setCopied(true)
      window.clearTimeout(copyTimer.current)
      copyTimer.current = window.setTimeout(() => setCopied(false), 1600)
    } catch {
      setCopied(false)
    }
  }

  return (
    <section className="relay-compact" aria-label="应手与控制" data-relay="">
      {/* 核心应手展示区 */}
      <div className={`engine-hero ${thinking ? 'is-thinking' : ''}`}>
        {thinking ? (
          <div className="hero-thinking">
            {/* 静态的「算」字印：思考期间全站停摆，这里也不转圈 */}
            <span className="hero-think-seal" aria-hidden="true">
              算
            </span>
            <span className="thinking-title">引擎正在深度计算应手…</span>
            <button type="button" className="btn btn-ghost btn-sm" onClick={onStop}>
              采用当前最优步
              <kbd className="btn-kbd">Space</kbd>
            </button>
          </div>
        ) : lastEngineMove ? (
          <div className="hero-content">
            <div className="hero-label">
              {playMode === 'sparring' ? '对手最近走棋' : '引擎下一步应手'}
            </div>
            {playMode === 'sparring' ? (
              <div key={lastEngineMove.ply} className="hero-action-card is-sparring" style={{ cursor: 'default' }}>
                <span className="hero-move-cn">{lastEngineMove.chinese}</span>
                <span className="hero-move-iccs">{lastEngineMove.iccs}</span>
                {onUndo && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={onUndo}
                    style={{ fontSize: '12px', marginLeft: 'auto' }}
                    title="撤回上一步 (Ctrl+Z)"
                  >
                    悔棋 ↺
                  </button>
                )}
              </div>
            ) : (
              <button
                key={lastEngineMove.ply}
                type="button"
                className={`hero-action-card${copied ? ' is-copied' : ''}`}
                onClick={() => void copyMove(lastEngineMove.iccs, lastEngineMove.chinese)}
                title="点击复制走法给对手"
              >
                <span className="hero-move-cn">{lastEngineMove.chinese}</span>
                <span className="hero-move-iccs">{lastEngineMove.iccs}</span>
                <span className="hero-copy-pill">
                  <svg
                    className="hero-copy-icon"
                    viewBox="0 0 12 12"
                    width="10"
                    height="10"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    aria-hidden="true"
                  >
                    {copied ? (
                      <path d="M2.5 6.4 5 8.8 9.6 3.4" strokeLinecap="round" strokeLinejoin="round" />
                    ) : (
                      <>
                        <rect x="3.8" y="3.8" width="6" height="6" rx="1.2" />
                        <path d="M8.2 2.2H3.4c-.7 0-1.2.5-1.2 1.2v4.8" strokeLinecap="round" />
                      </>
                    )}
                  </svg>
                  {copied ? '已复制' : '复制'}
                </span>
              </button>
            )}
            <div key={`m${lastEngineMove.ply}`} className="hero-meta">
              深度 {lastEngineMove.depth} · 耗时 {seconds(lastEngineMove.time)}
              {lastEngineMove.eval !== null
                && ` · ${scoreText(lastEngineMove.eval, lastEngineMove.mate_in ?? null)}`}
              {playMode === 'relay' && shadowGuess && (
                <span style={{ color: '#10b981', marginLeft: '6px' }}>· 盲猜已就绪</span>
              )}
              {humanTactics?.severity === 'good' && (
                <span className="coach-good-pill" title={humanTactics.coach_summary}>
                  · ✓ 上手「{lastHumanMove?.chinese}」好棋控盘
                </span>
              )}
            </div>
          </div>
        ) : (
          <div className="hero-idle">
            <span>对局已就绪，请直接在棋盘上走子</span>
            {game.engine_to_move && playing && (
              <button type="button" className="btn btn-primary btn-sm" onClick={onEngineMove}>
                让引擎先出招
              </button>
            )}
          </div>
        )}
      </div>

      {/* 实战算路与意图透视工具栏：解决“看不懂对手这步想干嘛”与“自己脑子想不明白接下来走向” */}
      {playing && !thinking && (
        <div className="live-helper-strip" aria-label="实战算路与意图透视">
          <button
            type="button"
            className={`btn btn-xs drill-anim-tab is-threat${helperOpen && helperMode === 'threat' ? ' is-active' : ''}`}
            onClick={() => void openLiveHelper('threat')}
            title="看不懂对手刚才那步棋？用动画演示如果我不设防，对手接下来 2~3 步怎么杀我"
          >
            👁️ 看不懂对手这步？(动画看他企图)
          </button>
          <button
            type="button"
            className={`btn btn-xs drill-anim-tab is-good${helperOpen && helperMode === 'good' ? ' is-active' : ''}`}
            onClick={() => void openLiveHelper('good')}
            title="不知道现在走哪步最好？用动画演示最佳走法接下来 3 步怎么占优"
          >
            ✅ 看最佳走法动画
          </button>
          <button
            type="button"
            className={`btn btn-xs btn-ghost${helperOpen && helperMode === 'guide' ? ' is-active' : ''}`}
            onClick={() => void openLiveHelper('guide')}
            title="用第一性原理、逆向思维和对抗三问帮你理清头绪"
          >
            🧠 脑子想不明白？(逆向三问)
          </button>
          {helperOpen && (
            <button
              type="button"
              className="btn btn-xs btn-ghost"
              onClick={closeHelper}
            >
              ✕ 收起演示继续下棋
            </button>
          )}
        </div>
      )}

      {/* 实战分步动画与逆向算路抽屉 */}
      {helperOpen && (
        <div className="live-helper-drawer" role="region" aria-label="实战分步动画推演">
          {helperLoading ? (
            <div className="live-helper-loading">正在为你推演接下来 3~4 步的棋局走向…</div>
          ) : helperMode === 'guide' && thinkingGuide ? (
            <div className="drill-thinking-card is-compact">
              <div className="thinking-card-head">
                <h4>🧠 当前局面算路助手（第一性原理 · 逆向思维 · 对抗三问）</h4>
                <button type="button" className="btn btn-ghost btn-xs" onClick={closeHelper}>
                  收起
                </button>
              </div>
              <div className="thinking-section">
                <div className="thinking-badge is-fp">① 第一性原理（只看这 3 件事）</div>
                <ul className="thinking-fp-list">
                  {thinkingGuide.first_principles.map((fp, idx) => (
                    <li key={idx}>{fp}</li>
                  ))}
                </ul>
              </div>
              <div className="thinking-section">
                <div className="thinking-badge is-inv">② 逆向思维（从 3 步后倒推现在）</div>
                <p className="thinking-inv-text">{thinkingGuide.inversion_tip}</p>
              </div>
              <div className="thinking-section">
                <div className="thinking-badge is-adv">③ 落子前对抗三问</div>
                <div className="thinking-qa-list">
                  {thinkingGuide.adversarial_qa.map((item, idx) => (
                    <div key={idx} className="thinking-qa-item">
                      <div className="qa-question">{item.q}</div>
                      <div className="qa-answer">👉 {item.a}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : activeSteps.length > 0 ? (
            <div className={`drill-theater-card mode-${helperMode}`}>
              <div className="drill-theater-head">
                <div className="drill-theater-title">
                  {helperMode === 'threat'
                    ? '👁️ 对手企图动画：如果不设防，他接下来会这样进攻你'
                    : helperMode === 'good'
                      ? '✅ 最佳走法动画：接下来 3~4 步怎么走最占优'
                      : '❌ 走错后果动画：为什么那步棋几步后会吃亏'}
                </div>
                <div className="drill-theater-controls">
                  <button
                    type="button"
                    className="btn btn-ghost btn-xs"
                    onClick={() => {
                      clearAnimTimer()
                      setAnimPlaying(false)
                      setAnimStep((s) => Math.max(0, s - 1))
                    }}
                    disabled={animStep <= 0}
                  >
                    ◀ 上一步
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary btn-xs"
                    onClick={() => {
                      if (animPlaying) {
                        clearAnimTimer()
                        setAnimPlaying(false)
                      } else {
                        if (animStep >= activeSteps.length) setAnimStep(0)
                        setAnimPlaying(true)
                      }
                    }}
                  >
                    {animPlaying ? '⏸ 暂停' : '▶ 自动连播'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-xs"
                    onClick={() => {
                      clearAnimTimer()
                      setAnimPlaying(false)
                      setAnimStep((s) => Math.min(activeSteps.length, s + 1))
                    }}
                    disabled={animStep >= activeSteps.length}
                  >
                    下一步 ▶
                  </button>
                  <button type="button" className="btn btn-ghost btn-xs" onClick={closeHelper}>
                    返回实战
                  </button>
                </div>
              </div>
              <div className="drill-theater-steps">
                {activeSteps.map((st, idx) => {
                  const stepIdx = idx + 1
                  const isCurrent = animStep === stepIdx
                  return (
                    <button
                      key={st.step}
                      type="button"
                      className={`drill-step-item${isCurrent ? ' is-current' : ''}`}
                      onClick={() => {
                        clearAnimTimer()
                        setAnimPlaying(false)
                        setAnimStep(stepIdx)
                      }}
                    >
                      <div className="drill-step-top">
                        <span className="drill-step-badge">{st.tag || `第 ${st.step} 步`}</span>
                        <span className="drill-step-move">{st.chinese}</span>
                      </div>
                      <div className="drill-step-plain">{st.plain || st.comment}</div>
                    </button>
                  )
                })}
              </div>
              {prosCons && helperMode === 'bad' && (
                <div className="live-pros-cons-mini">
                  <strong>📊 优劣对比：</strong>
                  <span>{prosCons.verdict_headline}</span>
                </div>
              )}
            </div>
          ) : (
            <div className="live-helper-loading">当前局面平稳，暂无明显强制杀招。</div>
          )}
        </div>
      )}

      {/* 走错失误提醒 · 大白话解释 + 一键看为什么亏动画 */}
      {showCoachInterrupt && humanTactics && lastHumanMove && (
        <div
          className={`coach-interrupt-card is-${humanTactics.severity}`}
          role="region"
          aria-label="师傅扶手关键手点拨"
          data-coach-interrupt=""
        >
          <div className="coach-interrupt-head">
            <span className="coach-interrupt-badge">
              ⚠️ 走错失先 · #{humanTactics.motif_label}
            </span>
            <span className="coach-interrupt-ply">
              第 {lastHumanMove.ply} 手「{lastHumanMove.chinese}」
              {lastHumanMove.review?.loss ? `（约亏 ${(lastHumanMove.review.loss / 100).toFixed(1)} 个兵）` : ''}
            </span>
          </div>
          <p className="coach-interrupt-summary">{humanTactics.coach_summary}</p>
          <div className="coach-interrupt-actions">
            {onUndo && (
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => {
                  onToggleClues?.(null)
                  closeHelper()
                  onUndo()
                }}
              >
                ↺ 悔棋重走这步
              </button>
            )}
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => void openLiveHelper('threat')}
            >
              🎬 动画看接下来怎么吃亏
            </button>
            {onToggleClues && humanTactics.visual_clues && (
              <button
                type="button"
                className={`btn btn-ghost btn-sm${cluesActive ? ' is-on' : ''}`}
                onClick={() =>
                  onToggleClues(cluesActive ? null : (humanTactics.visual_clues ?? null))
                }
              >
                {cluesActive ? '👁️ 收起标记' : '👁️ 标出破绽位置'}
              </button>
            )}
            {onOpenDrill && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={onOpenDrill}
              >
                🎯 去训练营练同类题
              </button>
            )}
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setDismissedPly(lastHumanMove.ply)}
            >
              忽略继续下
            </button>
          </div>
        </div>
      )}

      {/* 排队步提醒 */}
      {queued && (
        <div className="queued-strip" data-relay-queued={queued}>
          <span>已排队录入对方走法：<strong>{queued}</strong>（等待计算结束）</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClearQueue}>
            撤销
          </button>
        </div>
      )}

      {/* 极轻量录入栏（默认折叠，支持快捷键 / 触发） */}
      <div className="type-toggle-bar">
        {!showTypeInput ? (
          <button
            type="button"
            className="type-toggle-btn"
            data-relay-toggle=""
            onClick={() => setShowTypeInput(true)}
          >
            <span>键盘文本录入</span>
            <kbd>/</kbd>
          </button>
        ) : (
          <div key={`box${rejected}`} className={`type-inline-box${rejected ? ' is-rejected' : ''}`}>
            <input
              autoFocus
              value={text}
              placeholder="输入记谱 (如 炮二平五 或 h2e2)"
              data-relay-input=""
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submit()
                if (e.key === 'Escape') setShowTypeInput(false)
              }}
            />
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={!text.trim()}
              onClick={() => void submit()}
            >
              提交
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowTypeInput(false)}>
              收起
            </button>
          </div>
        )}
      </div>
    </section>
  )
}
