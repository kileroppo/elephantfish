import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, ApiError } from '../api'
import type { GameSnapshot, ReplayReply, SandboxReply } from '../types'
import { buildReplay, snapshotAt } from '../lib/replay'
import {
  causalBreakdown,
  gradeLabel,
  whySentence,
} from '../lib/format'
import { useExitPhase } from '../hooks/useExitPhase'
import { useUIContext } from '../context/UIContext'
import { useGameContext } from '../context/GameContext'
import {
  ReplayBoardSection,
  ReplayCausalCard,
  ReplayCoachBar,
  ReplayEvalChart,
  ReplayFooter,
  ReplayHeader,
  ReplayMoveHeader,
  ReplayMoveList,
  ReplayTacticsCard,
} from './replay'

/**
 * 复盘台：把**存档里那一局**一手手摆回盘上。
 *
 * 它是错题本答不了的那一半。错题本问的是「这个局面你错过几次」，这里问的是
 * 「那一局究竟是怎么走到那个局面的」—— 人要重下一手漏着的棋，需要的不是那道题的
 * 答案，是从第一手起的那段来路。所以这里的每一手都带着它自己的判分与「为什么」，
 * 措辞仍然只从 `lib/format.ts` 出来。
 *
 * 只读，而且**只读存档**：数据全部来自 `GET /api/game`，一眼都不看会话的实况。
 * 眼下这一局在底下照旧进行，关掉这层就回到原位 —— 回放一局不该改变任何一局。
 * 这条纪律不是装饰：`tools/smoke_http.py` 12 段就是拿「读历史前后 /api/state
 * 逐字段相同、三张表行数一根手指没动」把它钉住的。
 */

export interface ReplaySeed {
  gameId: string
  /** 从错题本跳过来时要点开的那一手（1 起）；null = 从开局看起 */
  focusPly: number | null
}

export interface ReplayDeskProps {
  /** null = 没开。关掉时不能一帧摘掉，退场交给 useExitPhase。 */
  seed?: ReplaySeed | null
  onClose?: () => void
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

/** 下一手 / 上一手「带着判分」的那些手。找不到就原地不动 —— 不许偷偷跳到别的手。 */
function nextGraded(plies: ReplayReply['plies'], from: number, dir: 1 | -1): number {
  const step = dir
  for (let i = from + step; i >= 1 && i <= plies.length; i += step) {
    if (plies[i - 1]?.review) return i
  }
  return from
}

/** 识别本局中的「胜负手 / 关键失误手」（Critical Turning Points） */
function isTurningPly(p: ReplayReply['plies'][number] | undefined): boolean {
  if (!p || p.by === 'engine' || !p.review) return false
  const rv = p.review
  if (rv.rank === 1 && (rv.loss === 0 || rv.loss_kind === 'mate')) return false
  if (rv.tactics?.severity === 'critical' || rv.tactics?.severity === 'warn') return true
  if (rv.status === 'outside' || rv.loss_kind === 'mate') return true
  if (typeof rv.loss === 'number' && rv.loss >= 90) return true
  return false
}

export function ReplayDesk(props?: ReplayDeskProps) {
  const ui = useUIContext()
  const g = useGameContext()
  const seed = props?.seed !== undefined ? props.seed : ui.replay
  const onClose = props?.onClose ?? ui.closeReplay
  const open = seed !== null
  const [mounted, leaving] = useExitPhase(open)
  const [reply, setReply] = useState<ReplayReply | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [index, setIndex] = useState(0)
  const [flipped, setFlipped] = useState(false)
  const [autoPlay, setAutoPlay] = useState(false)
  const stripRef = useRef<HTMLDivElement>(null)

  const gameId = seed?.gameId ?? null
  const focusPly = seed?.focusPly ?? null

  useEffect(() => {
    if (!gameId) return
    let dead = false
    setLoading(true)
    setError(null)
    api
      .game(gameId)
      .then((r) => {
        if (dead) return
        setReply(r)
        // 进来站在**走过第 1 手之后**那一格，而不是第 0 手那个空开局：从棋谱第 1 手
        // 起看才是「重看那一局」，停在 0 会让人以为这一局第一步没走 —— 尤其引擎
        // 执红时，存档里第 1 手就是它走的，第 0 手看上去像「还没开始」。
        // 错题本跳过来时仍要落在那一手上；那一手不在这一局里（存档被改过、或题号
        // 本来就错）就退回第 1 手 —— 摆一副对不上的盘比回到第一步更坏。
        const want = focusPly ?? 1
        setIndex(want >= 1 && want <= r.plies.length ? want : r.plies.length ? 1 : 0)
        // 视角朝向规则：
        // 代下模式：引擎朝下（引擎执黑 -> flipped = true；引擎执红 -> flipped = false）
        // 实战陪练：我执朝下（我执黑/引擎红 -> flipped = true；我执红/引擎黑 -> flipped = false）
        const shouldFlip =
          ui.playMode === 'relay'
            ? r.game.engine_side === 'black'
            : r.game.engine_side === 'red'
        setFlipped(shouldFlip)
      })
      .catch((err: unknown) => {
        if (dead) return
        setError(err instanceof ApiError ? err.message : '这一局没读回来')
      })
      .finally(() => {
        if (!dead) setLoading(false)
      })
  }, [gameId, focusPly])

  const replay = useMemo(
    () => (reply ? buildReplay(reply.game, reply.plies) : null),
    [reply],
  )
  const game = useMemo(() => (replay ? snapshotAt(replay, index) : null), [replay, index])
  const plies = reply?.plies ?? []
  const current = index > 0 ? plies[index - 1] : null
  const grade = current && current.by !== 'engine' ? gradeLabel(current.review) : null
  const why = current && current.by !== 'engine' ? whySentence(current.review) : null
  const [pvMode, setPvMode] = useState<'none' | 'best' | 'refute'>('none')
  const [showClues, setShowClues] = useState(false)
  const [sandboxSnap, setSandboxSnap] = useState<GameSnapshot | null>(null)
  const [sandboxBaseFen, setSandboxBaseFen] = useState<string | null>(null)
  const [sandboxInfo, setSandboxInfo] = useState<SandboxReply | null>(null)
  const [sandboxBusy, setSandboxBusy] = useState(false)
  const causal = useMemo(() => (current ? causalBreakdown(current.review) : null), [current])
  const turningPlies = useMemo(
    () => plies.filter((p) => isTurningPly(p)).map((p) => p.ply),
    [plies],
  )

  // 当进入沙盒或者到最后一手时，自动取消连播
  useEffect(() => {
    if (autoPlay && (sandboxSnap || index >= plies.length)) {
      setAutoPlay(false)
    }
  }, [autoPlay, sandboxSnap, index, plies.length])

  // 自动连播定时器 (1100ms 间隔)
  useEffect(() => {
    if (!autoPlay) return
    const timer = window.setInterval(() => {
      setIndex((curr) => {
        if (curr >= plies.length) {
          setAutoPlay(false)
          return curr
        }
        return curr + 1
      })
    }, 1100)
    return () => window.clearInterval(timer)
  }, [autoPlay, plies.length])

  const handleContinueGame = useCallback(async () => {
    const targetFen = sandboxSnap
      ? sandboxSnap.fen
      : (index < plies.length
          ? plies[index]?.fen_before
          : reply?.game?.fen_now) ?? reply?.game?.start_fen
    if (!targetFen) return
    const engineSide = reply?.game?.engine_side ?? 'black'
    try {
      await g.loadPosition(targetFen, engineSide)
      g.pushToast('已从此局面开始实战对弈', 'info')
      onClose()
    } catch {
      g.pushToast('加载局面失败', 'error')
    }
  }, [sandboxSnap, index, plies, reply, g, onClose])

  useEffect(() => {
    setPvMode('none')
    setShowClues(false)
    setSandboxSnap(null)
    setSandboxBaseFen(null)
    setSandboxInfo(null)
  }, [index, gameId])

  const enterSandbox = useCallback(async () => {
    if (!replay) return
    // 若当前停在人走的失误手，从走这手之前的盘面（fen_before）开始试走新分支
    const targetFen =
      current && current.by !== 'engine' && current.fen_before
        ? current.fen_before
        : (game?.fen ?? replay.head.start_fen)
    setSandboxBusy(true)
    try {
      const res = await api.sandbox(targetFen)
      setSandboxBaseFen(targetFen)
      setSandboxSnap(res.game)
      setSandboxInfo(null)
    } catch {
      // ignore
    } finally {
      setSandboxBusy(false)
    }
  }, [replay, current, game])

  const onSandboxMove = useCallback(
    async (iccs: string): Promise<boolean> => {
      if (!sandboxSnap) return false
      setSandboxBusy(true)
      try {
        const res = await api.sandbox(sandboxSnap.fen, iccs)
        setSandboxSnap(res.game)
        setSandboxInfo(res)
        return true
      } catch {
        return false
      } finally {
        setSandboxBusy(false)
      }
    },
    [sandboxSnap],
  )

  const pvTrace = useMemo(() => {
    if (pvMode === 'best' && causal?.bestPv) {
      return causal.bestPv.map((st) => st.iccs)
    }
    if (pvMode === 'refute' && causal?.refutePv) {
      return causal.refutePv.map((st) => st.iccs)
    }
    return []
  }, [pvMode, causal])

  useEffect(() => {
    const container = stripRef.current
    if (!container) return
    if (index === 0) {
      container.scrollTop = 0
      return
    }
    const el = container.querySelector<HTMLElement>(`[data-ply="${index}"]`)
    if (!el) return

    const cRect = container.getBoundingClientRect()
    const eRect = el.getBoundingClientRect()
    // 仅当当前手超出可见区域（上下保留 6px 余量）时精准滚动棋谱容器，避免全局 scrollIntoView 导致整个弹窗跳动
    if (eRect.top < cRect.top + 6) {
      container.scrollTop -= Math.ceil(cRect.top + 6 - eRect.top)
    } else if (eRect.bottom > cRect.bottom - 6) {
      container.scrollTop += Math.ceil(eRect.bottom - (cRect.bottom - 6))
    }
  }, [index])

  const go = useCallback((to: number) => setIndex(clamp(to, 0, plies.length)), [plies.length])

  useEffect(() => {
    if (!mounted || leaving) return
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return

      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        go(index - 1)
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        go(index + 1)
      } else if (e.key === 'Home') {
        e.preventDefault()
        go(0)
      } else if (e.key === 'End') {
        e.preventDefault()
        go(plies.length)
      } else if (!sandboxSnap) {
        if (e.key === ' ' || e.code === 'Space') {
          e.preventDefault()
          setAutoPlay((v) => !v)
        } else if (e.key === 'ArrowUp') {
          e.preventDefault()
          go(nextGraded(plies, index, -1))
        } else if (e.key === 'ArrowDown') {
          e.preventDefault()
          go(nextGraded(plies, index, 1))
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mounted, leaving, index, plies, sandboxSnap, go, onClose])

  if (!mounted) return null

  const summary = reply?.summary
  const head = reply?.game

  return (
    <div
      className={`overlay replay-veil fixed inset-0 z-40 bg-ink-0/40 backdrop-blur-sm flex items-center justify-center p-3 sm:p-5 select-none transition-opacity duration-200 ${
        leaving ? 'opacity-0 pointer-events-none' : 'opacity-100'
      }`}
      onClick={onClose}
    >
      <div
        className={`sheet replay-desk w-[min(1060px,100%)] h-[min(88vh,880px)] flex flex-col overflow-hidden p-4 sm:p-6 bg-paper-0/98 rounded-2xl shadow-2xl border border-hairline transition-all duration-200 ${
          leaving ? 'scale-95 opacity-0' : 'scale-100 opacity-100'
        }`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="逐手回放"
        data-replay=""
        data-replay-game={head?.game_id ?? seed?.gameId ?? ''}
        data-replay-ply={index}
        data-replay-flipped={flipped ? 'true' : 'false'}
        data-replay-loading={loading ? 'true' : 'false'}
        data-replay-error={error ? '1' : '0'}
      >
        <ReplayHeader
          head={head}
          seedGameId={seed?.gameId}
          onClose={onClose}
        />

        {error && (
          <p className="hint replay-hint text-xs text-red-600 my-1" data-replay-error-text="">
            {error}
          </p>
        )}

        {replay?.error && <p className="hint replay-hint text-xs text-red-600 my-1">{replay.error}</p>}

        {game && replay && !replay.error && (
          <div
            className={`replay-body flex-1 min-h-0 grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(272px,336px)] gap-4 transition-opacity duration-150 ${
              loading ? 'is-loading opacity-50 pointer-events-none' : ''
            }`}
          >
            <ReplayBoardSection
              game={game}
              sandboxSnap={sandboxSnap}
              flipped={flipped}
              sandboxBusy={sandboxBusy}
              pvTrace={pvTrace}
              visualClues={
                sandboxInfo?.tactics?.visual_clues ??
                (showClues ? current?.review?.tactics?.visual_clues : undefined)
              }
              onMove={sandboxSnap ? onSandboxMove : async () => false}
              index={index}
              totalPlies={plies.length}
              autoPlay={autoPlay}
              prevGradedIndex={nextGraded(plies, index, -1)}
              nextGradedIndex={nextGraded(plies, index, 1)}
              onGo={go}
              onToggleAutoPlay={() => setAutoPlay((v) => !v)}
              onToggleFlip={() => setFlipped((v) => !v)}
            />

            <div className="replay-side flex flex-col min-h-0 gap-2">
              <ReplayMoveHeader current={current} grade={grade} />

              <ReplayCoachBar
                turningCount={turningPlies.length}
                hasVisualClues={!!current?.review?.tactics?.visual_clues}
                showClues={showClues}
                sandboxSnap={!!sandboxSnap}
                sandboxBusy={sandboxBusy}
                canRetrySandbox={!!sandboxBaseFen}
                onContinueGame={() => void handleContinueGame()}
                onDrillSpecificGame={
                  head?.game_id
                    ? () => {
                        onClose()
                        ui.openDrillAt(undefined, head.game_id)
                      }
                    : undefined
                }
                onNextTurningPly={() => {
                  const next = turningPlies.find((p) => p > index) ?? turningPlies[0]
                  go(next)
                }}
                onToggleClues={() => setShowClues((v) => !v)}
                onEnterSandbox={() => void enterSandbox()}
                onRetrySandbox={() => {
                  if (sandboxBaseFen) {
                    void api.sandbox(sandboxBaseFen).then((r) => {
                      setSandboxSnap(r.game)
                      setSandboxInfo(null)
                    })
                  }
                }}
                onExitSandbox={() => {
                  setSandboxSnap(null)
                  setSandboxInfo(null)
                }}
              />

              <ReplayEvalChart
                plies={plies}
                currentIndex={index}
                onSelectPly={go}
                isTurningPly={isTurningPly}
              />

              <ReplayMoveList
                plies={plies}
                currentIndex={index}
                stripRef={stripRef}
                onSelectPly={go}
              />

              {/* 当手深度解析与反馈：置于棋谱下方，定高可滚，绝不挤压或顶动上方棋谱列表 */}
              <div className="replay-feedback-section flex-1 min-h-[110px] flex flex-col gap-1.5 overflow-y-auto scrollbar-thin">
                <ReplayTacticsCard
                  sandboxSnap={sandboxSnap}
                  sandboxInfo={sandboxInfo}
                  tactics={current?.review?.tactics}
                />

                <ReplayCausalCard
                  causal={causal}
                  pvMode={pvMode}
                  onTogglePvMode={(mode) => setPvMode((v) => (v === mode ? 'none' : mode))}
                />

                {why && (
                  <p className="learn-why replay-why text-xs text-ink-2 bg-paper-1 p-2.5 rounded-md border border-hairline m-0 shadow-2xs leading-relaxed" data-replay-why="">
                    {why}
                  </p>
                )}

                {!sandboxSnap && !current?.review?.tactics && !causal && !why && (
                  <div className="replay-feedback-empty flex-1 min-h-[64px] flex items-center justify-center p-2.5 rounded bg-paper-1/40 border border-dashed border-hairline/60 text-ink-3 text-xs text-center select-none">
                    <span>{current?.by === 'engine' ? '引擎执子走步 · 局势平稳推进' : '本手走法平稳，无关键失误或战术提示'}</span>
                  </div>
                )}
              </div>

              <ReplayFooter
                summary={summary}
                head={head}
                emptyPlies={plies.length === 0}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
export default ReplayDesk
