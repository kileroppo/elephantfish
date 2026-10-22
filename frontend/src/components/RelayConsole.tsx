import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api'
import type {
  AnimatedStep,
  GameSnapshot,
  OpponentThreatInfo,
  ProsConsAnalysis,
  ThinkingGuide,
  VisualClues,
} from '../types'
import { buildAnimatedFrames } from '../lib/replay'
import { play } from '../lib/sound'
import type { SubmitOutcome } from '../hooks/useGame'
import { useGameContext } from '../context/GameContext'
import { useUIContext } from '../context/UIContext'
import {
  CoachInterruptCard,
  EngineHero,
  LiveHelperDrawer,
  QueuedStrip,
  TypeInlineFloating,
} from './relay'

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
  const coachGuard = props.coachGuard ?? ui.coachGuard
  const onToggleCoachGuard = ui.toggleCoachGuard
  const cluesActive = props.cluesActive ?? (ui.liveClues !== null)
  const onToggleClues = props.onToggleClues ?? ui.setLiveClues
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
  const [opponentThreat, setOpponentThreat] = useState<OpponentThreatInfo | null>(null)
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
    setOpponentThreat(null)
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
    if (!helperOpen || helperMode === 'guide') {
      onPreviewBoard?.(null, [], null)
      return
    }
    if (helperMode === 'threat' && opponentThreat && !opponentThreat.is_substantial) {
      return
    }
    if (animFrames.length === 0) {
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
  }, [helperOpen, helperMode, opponentThreat, animStep, animFrames, activeSteps, onPreviewBoard])

  // 触发实战预演与对手企图分析（支持再次点击相同模式按钮切换关闭）
  const openLiveHelper = async (
    targetMode: 'threat' | 'good' | 'bad' | 'guide',
    candidateMove?: string,
  ) => {
    if (helperOpen && helperMode === targetMode) {
      closeHelper()
      return
    }
    clearAnimTimer()
    setHelperOpen(true)
    setHelperLoading(true)
    setHelperMode(targetMode)
    setAnimStep(0)
    setAnimPlaying(false)
    try {
      const res = await api.preview(game.fen, candidateMove)
      setBaseSnap(res.base_game || game)
      setOpponentThreat(res.opponent_threat || null)
      setThreatSteps(res.opponent_threat?.steps || res.opponent_threat_steps || [])
      setGoodSteps(res.good_steps || [])
      setBadSteps(res.bad_steps || [])
      if (res.pros_cons) setProsCons(res.pros_cons)
      if (res.thinking_guide) setThinkingGuide(res.thinking_guide)

      if (targetMode === 'threat') {
        if (res.opponent_threat && !res.opponent_threat.is_substantial) {
          setAnimPlaying(false)
          setAnimStep(0)
          if (res.opponent_threat.target_move) {
            onPreviewBoard?.(res.base_game || game, [res.opponent_threat.target_move], {
              weakness_squares: res.opponent_threat.threat_squares || [],
              route: res.opponent_threat.route || [],
            })
          }
        } else {
          setAnimStep(0)
          setAnimPlaying(true)
        }
      } else if (targetMode !== 'guide') {
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
    lastHumanMove &&
    dismissedPly !== lastHumanMove.ply &&
    humanTactics &&
    (humanTactics.severity === 'critical' || humanTactics.severity === 'warn') &&
    lastHumanMove.review?.rank !== 1

  // 自动化破绽显影：当实战触发严重失误点拨时，自动显影盘面破绽弱点，无需手动再点一次
  useEffect(() => {
    if (showCoachInterrupt && humanTactics?.visual_clues) {
      onToggleClues?.(humanTactics.visual_clues)
    }
  }, [showCoachInterrupt, humanTactics?.visual_clues, onToggleClues])

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
    <section
      className="relay-compact relative shrink-0 flex flex-col md:flex-row items-center justify-center mt-2.5 mx-auto w-full md:w-fit md:h-10 md:min-h-10 md:max-h-10 max-w-[min(100%,720px)] box-border"
      aria-label="应手与控制"
      data-relay=""
    >
      {/* 核心应手展示区 / 对弈Dock（移动端双行等宽对齐，桌面端单行超紧凑胶囊） */}
      <EngineHero
        thinking={thinking}
        lastEngineMove={lastEngineMove}
        playMode={playMode}
        shadowGuess={shadowGuess}
        copied={copied}
        playing={playing}
        gameEngineToMove={!!game.engine_to_move}
        helperOpen={helperOpen}
        helperMode={helperMode}
        showTypeInput={showTypeInput}
        onStop={onStop}
        onUndo={playMode === 'sparring' ? onUndo : undefined}
        onEngineMove={onEngineMove}
        onCopyMove={copyMove}
        onOpenHelper={(mode) => void openLiveHelper(mode)}
        onToggleTypeInput={() => setShowTypeInput((v) => !v)}
        coachGuard={coachGuard}
        onToggleCoachGuard={onToggleCoachGuard}
        railL={ui.railL}
        railR={ui.railR}
        onToggleRailL={ui.toggleRailL}
        onToggleRailR={ui.toggleRailR}
      />

      {/* 实战分步动画与逆向算路抽屉 */}
      <LiveHelperDrawer
        helperOpen={helperOpen}
        helperLoading={helperLoading}
        helperMode={helperMode}
        opponentThreat={opponentThreat}
        thinkingGuide={thinkingGuide}
        activeSteps={activeSteps}
        animStep={animStep}
        animPlaying={animPlaying}
        prosCons={prosCons}
        onStepClick={(stepIdx) => {
          clearAnimTimer()
          setAnimPlaying(false)
          setAnimStep(stepIdx)
        }}
        onPrevStep={() => {
          clearAnimTimer()
          setAnimPlaying(false)
          setAnimStep((s) => Math.max(0, s - 1))
        }}
        onNextStep={() => {
          clearAnimTimer()
          setAnimPlaying(false)
          setAnimStep((s) => Math.min(activeSteps.length, s + 1))
        }}
        onTogglePlay={() => {
          if (animPlaying) {
            clearAnimTimer()
            setAnimPlaying(false)
          } else {
            if (animStep >= activeSteps.length) setAnimStep(0)
            setAnimPlaying(true)
          }
        }}
        onClose={closeHelper}
      />

      {/* 走错失误提醒 · 大白话解释 + 一键看为什么亏动画 */}
      <CoachInterruptCard
        show={!!showCoachInterrupt}
        lastHumanMove={lastHumanMove}
        tactics={humanTactics}
        cluesActive={cluesActive}
        onUndo={() => {
          closeHelper()
          onUndo()
        }}
        onToggleClues={onToggleClues}
        onOpenDrill={() => {
          if (props.onOpenDrill) {
            props.onOpenDrill()
          } else {
            const motif = humanTactics?.primary_motif || humanTactics?.motif
            ui.openDrillAt(motif)
          }
        }}
        onOpenThreatHelper={() => void openLiveHelper('threat')}
        onDismiss={() => {
          if (lastHumanMove) setDismissedPly(lastHumanMove.ply)
        }}
        onMuteThisGame={() => {
          ui.setCoachGuard(false)
          if (lastHumanMove) setDismissedPly(lastHumanMove.ply)
        }}
        onPreviewBoard={onPreviewBoard}
      />

      {/* 排队步提醒 */}
      <QueuedStrip queued={queued} onClearQueue={onClearQueue} />

      {/* 极轻量键盘录入浮层（展开时浮动展示，不挤占棋盘高度） */}
      <TypeInlineFloating
        show={showTypeInput}
        text={text}
        rejected={rejected}
        onChange={setText}
        onSubmit={() => void submit()}
        onClose={() => setShowTypeInput(false)}
      />
    </section>
  )
}
export default RelayConsole
