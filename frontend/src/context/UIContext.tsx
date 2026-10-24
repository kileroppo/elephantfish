import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
  type ReactNode,
  type Dispatch,
  type SetStateAction,
} from 'react'
import type {
  AnimatedStep,
  GameSnapshot,
  OpponentThreatInfo,
  ProsConsAnalysis,
  ThinkingGuide,
  VisualClues,
} from '../types'
import { api } from '../api'
import { buildAnimatedFrames } from '../lib/replay'
import type { ReplaySeed } from '../components/ReplayDesk'
import { setSoundEnabled, unlockAudio } from '../lib/sound'
import { useGameContext } from './GameContext'

const LS_FLIP = 'ef.flipped'
const FLIP_TOTAL_MS = 340
const FLIP_MID_MS = 150
const LS_SOUND = 'ef.sound'
const LS_RAIL_L = 'ef.rail-left'
const LS_RAIL_R = 'ef.rail-right'
const LS_THEME = 'ef.theme'

export interface CoachLiveState {
  open: boolean
  loading: boolean
  mode: 'threat' | 'good' | 'bad' | 'guide'
  opponentThreat: OpponentThreatInfo | null
  thinkingGuide: ThinkingGuide | null
  threatSteps: AnimatedStep[]
  goodSteps: AnimatedStep[]
  badSteps: AnimatedStep[]
  prosCons: ProsConsAnalysis | null
  activeSteps: AnimatedStep[]
  animStep: number
  animPlaying: boolean
}

export interface UIContextType {
  theme: 'xuan' | 'wumu'
  cycleTheme: () => void
  zenMode: boolean
  toggleZen: () => void
  setZenMode: (v: boolean) => void
  soundOn: boolean
  toggleSound: () => void
  setSoundOn: Dispatch<SetStateAction<boolean>>
  flipped: boolean
  flipping: boolean
  turnBoard: () => void
  setFlipped: (v: boolean) => void
  setFlipOverride: (v: boolean) => void
  liveHelper: string | null
  setLiveHelper: (v: string | null) => void
  coachLive: CoachLiveState
  openCoachLive: (mode: 'threat' | 'good' | 'bad' | 'guide', candidateMove?: string) => Promise<void>
  closeCoachLive: () => void
  setCoachLiveAnimStep: (step: number) => void
  toggleCoachLivePlay: () => void
  nextCoachLiveStep: () => void
  prevCoachLiveStep: () => void
  railL: boolean
  toggleRailL: () => void
  setRailL: Dispatch<SetStateAction<boolean>>
  railR: boolean
  toggleRailR: () => void
  setRailR: Dispatch<SetStateAction<boolean>>
  playMode: 'sparring' | 'relay'
  togglePlayMode: () => void
  coachGuard: boolean
  toggleCoachGuard: () => void
  setCoachGuard: (v: boolean) => void
  shadowGuess: boolean
  toggleShadowGuess: () => void
  help: boolean
  setHelp: (v: boolean) => void
  replay: ReplaySeed | null
  openReplay: (gameId: string, ply?: number | null) => void
  openReplayAt: (gameId: string, ply: number | null) => void
  closeReplay: () => void
  drillOpen: boolean
  drillPuzzleId: string | null
  drillGameId: string | null
  openDrillAt: (puzzleId?: string, gameId?: string) => void
  closeDrill: () => void
  liveClues: VisualClues | null
  setLiveClues: (clues: VisualClues | null) => void
  previewGame: GameSnapshot | null
  previewPv: string[]
  handlePreviewBoard: (
    overrideGame: GameSnapshot | null,
    pv: string[],
    clues: VisualClues | null,
  ) => void
}

const UIContext = createContext<UIContextType | null>(null)

export function UIProvider({ children }: { children: ReactNode }) {
  const g = useGameContext()
  const game = g.state?.game

  const [flipped, setFlipped] = useState(() => localStorage.getItem(LS_FLIP) === '1')
  const [soundOn, setSoundOn] = useState(() => localStorage.getItem(LS_SOUND) !== '0')
  const [help, setHelp] = useState(false)
  const [theme, setTheme] = useState<'xuan' | 'wumu'>(() => {
    const saved = typeof window !== 'undefined' ? localStorage.getItem(LS_THEME) : null
    if (saved === 'wumu') return saved
    return 'xuan'
  })
  const [zenMode, setZenMode] = useState(false)
  const [playMode, setPlayMode] = useState<'sparring' | 'relay'>(() => {
    return (localStorage.getItem('ef.play_mode') as 'sparring' | 'relay') || 'sparring'
  })
  const [shadowGuess, setShadowGuess] = useState(() => localStorage.getItem('ef.shadow_guess') === '1')
  const [liveHelper, setLiveHelper] = useState<string | null>(null)

  // 师傅扶手走错失误点拨：按模式独立记忆（实战默认开启，转述默认静默关闭）
  const [coachGuardSparring, setCoachGuardSparring] = useState(() => {
    return localStorage.getItem('ef.coach_guard.sparring') !== '0'
  })
  const [coachGuardRelay, setCoachGuardRelay] = useState(() => {
    return localStorage.getItem('ef.coach_guard.relay') === '1'
  })

  const coachGuard = playMode === 'sparring' ? coachGuardSparring : coachGuardRelay

  const toggleCoachGuard = useCallback(() => {
    if (playMode === 'sparring') {
      setCoachGuardSparring((prev) => {
        const next = !prev
        localStorage.setItem('ef.coach_guard.sparring', next ? '1' : '0')
        void g.updateSettings({ coach_guard: next } as any)
        g.pushToast(next ? '实战失误点拨已开启' : '实战失误点拨已静默', 'info')
        return next
      })
    } else {
      setCoachGuardRelay((prev) => {
        const next = !prev
        localStorage.setItem('ef.coach_guard.relay', next ? '1' : '0')
        g.pushToast(next ? '转述失误点拨已开启' : '转述失误点拨已静默（沉浸记录）', 'info')
        return next
      })
    }
  }, [playMode, g])

  const setCoachGuard = useCallback(
    (v: boolean) => {
      if (playMode === 'sparring') {
        setCoachGuardSparring(v)
        localStorage.setItem('ef.coach_guard.sparring', v ? '1' : '0')
        void g.updateSettings({ coach_guard: v } as any)
      } else {
        setCoachGuardRelay(v)
        localStorage.setItem('ef.coach_guard.relay', v ? '1' : '0')
      }
    },
    [playMode, g],
  )

  const togglePlayMode = useCallback(() => {
    setPlayMode((curr) => {
      const next = curr === 'sparring' ? 'relay' : 'sparring'
      localStorage.setItem('ef.play_mode', next)
      void g.updateSettings({ play_mode: next } as any)
      g.pushToast(
        `已切换为：${next === 'sparring' ? '实战陪练模式（我执朝我）' : '信使代下模式（引擎朝下）'}`,
        'info',
      )
      return next
    })
  }, [g])

  const toggleShadowGuess = useCallback(() => {
    setShadowGuess((v) => {
      const next = !v
      localStorage.setItem('ef.shadow_guess', next ? '1' : '0')
      g.pushToast(next ? '跟师盲猜已开启：大师出招前可先盲猜一步' : '已关闭跟师盲猜', 'info')
      return next
    })
  }, [g])

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem(LS_THEME, theme)
  }, [theme])

  const cycleTheme = useCallback(() => {
    const list: Array<'xuan' | 'wumu'> = ['xuan', 'wumu']
    setTheme((curr) => {
      const nextIdx = (list.indexOf(curr) + 1) % list.length
      const next = list[nextIdx]
      const label = next === 'wumu' ? '乌墨' : '宣纸'
      g.pushToast(`美学材质已切换为：${label}`, 'info')
      return next
    })
  }, [g])

  const toggleZen = useCallback(() => {
    setZenMode((v) => {
      const next = !v
      g.pushToast(next ? '已进入禅意极简专注对弈模式 (按 Z 或 Esc 退出)' : '已退出禅意模式', 'info')
      return next
    })
  }, [g])

  const [replay, setReplay] = useState<ReplaySeed | null>(null)
  const openReplay = useCallback(
    (gameId: string, ply?: number | null) => setReplay({ gameId, focusPly: ply ?? null }),
    [],
  )
  const openReplayAt = useCallback(
    (gameId: string, ply: number | null) => setReplay({ gameId, focusPly: ply }),
    [],
  )
  const closeReplay = useCallback(() => setReplay(null), [])

  const [drillOpen, setDrillOpen] = useState(false)
  const [drillPuzzleId, setDrillPuzzleId] = useState<string | null>(null)
  const [drillGameId, setDrillGameId] = useState<string | null>(null)
  const openDrillAt = useCallback((puzzleId?: string, gameId?: string) => {
    setDrillPuzzleId(puzzleId ?? null)
    setDrillGameId(gameId ?? null)
    setDrillOpen(true)
  }, [])
  const closeDrill = useCallback(() => {
    setDrillOpen(false)
    setDrillPuzzleId(null)
    setDrillGameId(null)
  }, [])

  const [liveClues, setLiveClues] = useState<VisualClues | null>(null)
  const [previewGame, setPreviewGame] = useState<GameSnapshot | null>(null)
  const [previewPv, setPreviewPv] = useState<string[]>([])
  useEffect(() => {
    setLiveClues(null)
    setPreviewGame(null)
    setPreviewPv([])
  }, [game?.ply])

  const handlePreviewBoard = useCallback(
    (overrideGame: GameSnapshot | null, pv: string[], clues: VisualClues | null) => {
      setPreviewGame(overrideGame)
      setPreviewPv(pv)
      if (clues !== null) {
        setLiveClues(clues)
      }
    },
    [],
  )

  const [railL, setRailL] = useState(() => localStorage.getItem(LS_RAIL_L) === '1')
  const [railR, setRailR] = useState(() => {
    if (typeof window !== 'undefined' && window.innerWidth < 1140) {
      return false
    }
    return localStorage.getItem(LS_RAIL_R) !== '0'
  })

  const toggleRailL = useCallback(() => setRailL((v) => !v), [])
  const toggleRailR = useCallback(() => setRailR((v) => !v), [])
  const toggleSound = useCallback(() => setSoundOn((v) => !v), [])

  // 实时教练推演状态（💡 招法提示 / 🛡️ 识破企图 / 🧭 算路拆解）
  const [coachLiveOpen, setCoachLiveOpen] = useState(false)
  const [coachLiveLoading, setCoachLiveLoading] = useState(false)
  const [coachLiveMode, setCoachLiveMode] = useState<'threat' | 'good' | 'bad' | 'guide'>('good')
  const [opponentThreat, setOpponentThreat] = useState<OpponentThreatInfo | null>(null)
  const [thinkingGuide, setThinkingGuide] = useState<ThinkingGuide | null>(null)
  const [threatSteps, setThreatSteps] = useState<AnimatedStep[]>([])
  const [goodSteps, setGoodSteps] = useState<AnimatedStep[]>([])
  const [badSteps, setBadSteps] = useState<AnimatedStep[]>([])
  const [prosCons, setProsCons] = useState<ProsConsAnalysis | null>(null)
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

  const activeSteps = useMemo(() => {
    if (coachLiveMode === 'threat') return threatSteps
    if (coachLiveMode === 'good') return goodSteps
    if (coachLiveMode === 'bad') return badSteps
    return []
  }, [coachLiveMode, threatSteps, goodSteps, badSteps])

  const animFrames = useMemo(() => {
    const startSnap = baseSnap || game
    if (!startSnap || activeSteps.length === 0) return []
    return buildAnimatedFrames(startSnap, activeSteps)
  }, [baseSnap, game, activeSteps])

  const closeCoachLive = useCallback(() => {
    clearAnimTimer()
    setAnimPlaying(false)
    setAnimStep(0)
    setCoachLiveOpen(false)
    setPreviewGame(null)
    setPreviewPv([])
    setLiveClues(null)
  }, [clearAnimTimer])

  // 当盘面回合变化时，自动收起已完成的推演
  useEffect(() => {
    closeCoachLive()
  }, [game?.ply, closeCoachLive])

  // 连播定时器驱动
  useEffect(() => {
    if (!coachLiveOpen || !animPlaying || coachLiveMode === 'guide' || activeSteps.length === 0) {
      clearAnimTimer()
      return
    }
    clearAnimTimer()
    animTimerRef.current = window.setInterval(() => {
      setAnimStep((prev) => {
        if (prev < activeSteps.length) {
          return prev + 1
        } else {
          setAnimPlaying(false)
          return prev
        }
      })
    }, 1300)
    return clearAnimTimer
  }, [coachLiveOpen, animPlaying, coachLiveMode, activeSteps, clearAnimTimer])

  // 同步动画帧到主棋盘
  useEffect(() => {
    if (!coachLiveOpen || coachLiveMode === 'guide') {
      return
    }
    if (coachLiveMode === 'threat' && opponentThreat && !opponentThreat.is_substantial) {
      return
    }
    if (animFrames.length === 0) {
      return
    }
    const frame = animFrames[Math.min(animStep, animFrames.length - 1)]
    const curStep = animStep > 0 ? activeSteps[animStep - 1] : activeSteps[0]
    const pv = curStep ? [curStep.iccs || curStep.move] : []
    const clues: VisualClues | null =
      curStep?.threat_squares && curStep.threat_squares.length > 0
        ? { weakness_squares: curStep.threat_squares }
        : null
    handlePreviewBoard(frame, pv, clues)
  }, [coachLiveOpen, coachLiveMode, opponentThreat, animStep, animFrames, activeSteps, handlePreviewBoard])

  const openCoachLive = useCallback(
    async (targetMode: 'threat' | 'good' | 'bad' | 'guide', candidateMove?: string) => {
      if (coachLiveOpen && coachLiveMode === targetMode) {
        closeCoachLive()
        setRailR(false)
        return
      }
      clearAnimTimer()
      setCoachLiveOpen(true)
      setCoachLiveLoading(true)
      setCoachLiveMode(targetMode)
      setAnimStep(0)
      setAnimPlaying(false)
      // 智能展开右侧栏，确保视线平移到右侧指点卡片，绝不遮挡棋盘
      setRailR(true)

      if (!game) {
        setCoachLiveLoading(false)
        return
      }

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
              handlePreviewBoard(res.base_game || game, [res.opponent_threat.target_move], {
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
        // 静默异常
      } finally {
        setCoachLiveLoading(false)
      }
    },
    [coachLiveOpen, coachLiveMode, closeCoachLive, clearAnimTimer, game, handlePreviewBoard],
  )

  const setCoachLiveAnimStep = useCallback(
    (step: number) => {
      clearAnimTimer()
      setAnimPlaying(false)
      setAnimStep(step)
    },
    [clearAnimTimer],
  )

  const toggleCoachLivePlay = useCallback(() => {
    if (animPlaying) {
      clearAnimTimer()
      setAnimPlaying(false)
    } else {
      if (animStep >= activeSteps.length) setAnimStep(0)
      setAnimPlaying(true)
    }
  }, [animPlaying, animStep, activeSteps.length, clearAnimTimer])

  const nextCoachLiveStep = useCallback(() => {
    clearAnimTimer()
    setAnimPlaying(false)
    setAnimStep((s) => Math.min(activeSteps.length, s + 1))
  }, [activeSteps.length, clearAnimTimer])

  const prevCoachLiveStep = useCallback(() => {
    clearAnimTimer()
    setAnimPlaying(false)
    setAnimStep((s) => Math.max(0, s - 1))
  }, [clearAnimTimer])

  const coachLive: CoachLiveState = useMemo(
    () => ({
      open: coachLiveOpen,
      loading: coachLiveLoading,
      mode: coachLiveMode,
      opponentThreat,
      thinkingGuide,
      threatSteps,
      goodSteps,
      badSteps,
      prosCons,
      activeSteps,
      animStep,
      animPlaying,
    }),
    [
      coachLiveOpen,
      coachLiveLoading,
      coachLiveMode,
      opponentThreat,
      thinkingGuide,
      threatSteps,
      goodSteps,
      badSteps,
      prosCons,
      activeSteps,
      animStep,
      animPlaying,
    ],
  )

  // 视角朝向规则：
  // 1. 信使代下模式 (relay): 我是转述人，引擎朝下
  //    - 引擎执红 (game.engine_side === 'red') -> 红方朝下 (flipped = false)
  //    - 引擎执黑 (game.engine_side === 'black') -> 黑方朝下 (flipped = true)
  // 2. 实战陪练模式 (sparring): 我亲自下棋，我执朝我
  //    - 我执红 (引擎执黑, game.engine_side === 'black') -> 红方朝下 (flipped = false)
  //    - 我执黑 (引擎执红, game.engine_side === 'red') -> 黑方朝下 (flipped = true)
  useEffect(() => {
    if (!game) return
    const shouldFlip =
      playMode === 'relay'
        ? game.engine_side === 'black'
        : game.engine_side === 'red'
    setFlipped(shouldFlip)
  }, [game?.engine_side, playMode])

  useEffect(() => {
    setSoundEnabled(soundOn)
    localStorage.setItem(LS_SOUND, soundOn ? '1' : '0')
  }, [soundOn])

  useEffect(() => {
    localStorage.setItem(LS_FLIP, flipped ? '1' : '0')
  }, [flipped])

  const [flipping, setFlipping] = useState(false)
  const flipMid = useRef<number | null>(null)
  const flipEnd = useRef<number | null>(null)
  const flippedRef = useRef(flipped)
  flippedRef.current = flipped

  useEffect(
    () => () => {
      if (flipMid.current !== null) window.clearTimeout(flipMid.current)
      if (flipEnd.current !== null) window.clearTimeout(flipEnd.current)
    },
    [],
  )

  const turnBoard = useCallback(() => {
    if (flipMid.current !== null) return
    setFlipping(true)
    flipMid.current = window.setTimeout(() => {
      flipMid.current = null
      setFlipped(!flippedRef.current)
    }, FLIP_MID_MS)
    flipEnd.current = window.setTimeout(() => {
      flipEnd.current = null
      setFlipping(false)
    }, FLIP_TOTAL_MS)
  }, [])

  useEffect(() => {
    localStorage.setItem(LS_RAIL_L, railL ? '1' : '0')
  }, [railL])

  useEffect(() => {
    localStorage.setItem(LS_RAIL_R, railR ? '1' : '0')
  }, [railR])

  // 浏览器音频手势解锁
  useEffect(() => {
    const unlock = () => unlockAudio()
    window.addEventListener('pointerdown', unlock, { once: true })
    window.addEventListener('keydown', unlock, { once: true })
    return () => {
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('keydown', unlock)
    }
  }, [])

  return (
    <UIContext.Provider
      value={{
        theme,
        cycleTheme,
        zenMode,
        toggleZen,
        setZenMode,
        soundOn,
        toggleSound,
        setSoundOn,
        flipped,
        flipping,
        turnBoard,
        setFlipped,
        setFlipOverride: setFlipped,
        liveHelper,
        setLiveHelper,
        coachLive,
        openCoachLive,
        closeCoachLive,
        setCoachLiveAnimStep,
        toggleCoachLivePlay,
        nextCoachLiveStep,
        prevCoachLiveStep,
        railL,
        toggleRailL,
        setRailL,
        railR,
        toggleRailR,
        setRailR,
        playMode,
        togglePlayMode,
        coachGuard,
        toggleCoachGuard,
        setCoachGuard,
        shadowGuess,
        toggleShadowGuess,
        help,
        setHelp,
        replay,
        openReplay,
        openReplayAt,
        closeReplay,
        drillOpen,
        drillPuzzleId,
        drillGameId,
        openDrillAt,
        closeDrill,
        liveClues,
        setLiveClues,
        previewGame,
        previewPv,
        handlePreviewBoard,
      }}
    >
      {children}
    </UIContext.Provider>
  )
}

export function useUIContext(): UIContextType {
  const ctx = useContext(UIContext)
  if (!ctx) {
    throw new Error('useUIContext must be used within a UIProvider')
  }
  return ctx
}
