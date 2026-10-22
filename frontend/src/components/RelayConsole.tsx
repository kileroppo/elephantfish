import { useEffect, useMemo, useRef, useState } from 'react'
import type { GameSnapshot, VisualClues } from '../types'
import type { SubmitOutcome } from '../hooks/useGame'
import { useGameContext } from '../context/GameContext'
import { useUIContext } from '../context/UIContext'
import {
  CoachInterruptCard,
  EngineHero,
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
    !ui.drillOpen &&
    !ui.replay &&
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

  // 换了一手，复制态归零
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
      className="relay-compact relative shrink-0 flex flex-col md:flex-row items-center justify-center mt-2 mx-auto w-full md:w-fit md:h-10 md:min-h-10 md:max-h-10 max-w-[min(100%,720px)] box-border"
      aria-label="应手与控制"
      data-relay=""
    >
      {/* 核心应手展示区 / 对弈Dock（桌面端单行超紧凑胶囊，移动端精致双行） */}
      <EngineHero
        thinking={thinking}
        lastEngineMove={lastEngineMove}
        playMode={playMode}
        shadowGuess={shadowGuess}
        copied={copied}
        playing={playing}
        gameEngineToMove={!!game.engine_to_move}
        helperOpen={ui.coachLive.open}
        helperMode={ui.coachLive.mode}
        showTypeInput={showTypeInput}
        onStop={onStop}
        onUndo={playMode === 'sparring' ? onUndo : undefined}
        onEngineMove={onEngineMove}
        onCopyMove={copyMove}
        onOpenHelper={(mode) => void ui.openCoachLive(mode)}
        onToggleTypeInput={() => setShowTypeInput((v) => !v)}
        coachGuard={coachGuard}
        onToggleCoachGuard={onToggleCoachGuard}
        railL={ui.railL}
        railR={ui.railR}
        onToggleRailL={ui.toggleRailL}
        onToggleRailR={ui.toggleRailR}
      />

      {/* 走错失误提醒 · 大白话解释 + 一键看为什么亏动画（固定于左下角，远离棋盘） */}
      <CoachInterruptCard
        show={!!showCoachInterrupt}
        lastHumanMove={lastHumanMove}
        tactics={humanTactics}
        cluesActive={cluesActive}
        onUndo={() => {
          ui.closeCoachLive()
          onUndo()
        }}
        onToggleClues={onToggleClues}
        onOpenDrill={() => {
          if (lastHumanMove) setDismissedPly(lastHumanMove.ply)
          if (props.onOpenDrill) {
            props.onOpenDrill()
          } else {
            const motif = humanTactics?.primary_motif || humanTactics?.motif
            ui.openDrillAt(motif)
          }
        }}
        onOpenThreatHelper={() => void ui.openCoachLive('threat')}
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

      {/* 极轻量键盘录入浮层 */}
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
