import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
  type Dispatch,
  type SetStateAction,
} from 'react'
import type { GameSnapshot, VisualClues } from '../types'
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
  railL: boolean
  toggleRailL: () => void
  setRailL: Dispatch<SetStateAction<boolean>>
  railR: boolean
  toggleRailR: () => void
  setRailR: Dispatch<SetStateAction<boolean>>
  playMode: 'sparring' | 'relay'
  togglePlayMode: () => void
  shadowGuess: boolean
  toggleShadowGuess: () => void
  help: boolean
  setHelp: (v: boolean) => void
  replay: ReplaySeed | null
  openReplay: (gameId: string) => void
  openReplayAt: (gameId: string, ply: number | null) => void
  closeReplay: () => void
  drillOpen: boolean
  drillPuzzleId: string | null
  openDrillAt: (puzzleId?: string) => void
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

  const togglePlayMode = useCallback(() => {
    setPlayMode((curr) => {
      const next = curr === 'sparring' ? 'relay' : 'sparring'
      localStorage.setItem('ef.play_mode', next)
      void g.updateSettings({ play_mode: next } as any)
      g.pushToast(`已切换为：${next === 'sparring' ? '实战陪练模式' : '信使代打模式'}`, 'info')
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
  const openReplay = useCallback((gameId: string) => setReplay({ gameId, focusPly: null }), [])
  const openReplayAt = useCallback(
    (gameId: string, ply: number | null) => setReplay({ gameId, focusPly: ply }),
    [],
  )
  const closeReplay = useCallback(() => setReplay(null), [])

  const [drillOpen, setDrillOpen] = useState(false)
  const [drillPuzzleId, setDrillPuzzleId] = useState<string | null>(null)
  const openDrillAt = useCallback((puzzleId?: string) => {
    setDrillPuzzleId(puzzleId ?? null)
    setDrillOpen(true)
  }, [])
  const closeDrill = useCallback(() => {
    setDrillOpen(false)
    setDrillPuzzleId(null)
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
  const [railR, setRailR] = useState(() => localStorage.getItem(LS_RAIL_R) !== '0')

  const toggleRailL = useCallback(() => setRailL((v) => !v), [])
  const toggleRailR = useCallback(() => setRailR((v) => !v), [])
  const toggleSound = useCallback(() => setSoundOn((v) => !v), [])

  // 引擎执哪一边，这边的棋就朝下
  const prevEngineSide = useRef<string | null>(null)
  useEffect(() => {
    if (!game) return
    if (prevEngineSide.current !== game.engine_side) {
      prevEngineSide.current = game.engine_side
      setFlipped(game.engine_side === 'black')
    }
  }, [game?.engine_side])

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
        railL,
        toggleRailL,
        setRailL,
        railR,
        toggleRailR,
        setRailR,
        playMode,
        togglePlayMode,
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
