import { useCallback, useMemo, useState } from 'react'
import type { PieceInfo, Side } from '../types'
import {
  type BoardMap,
  INITIAL_FEN,
  PIECE_SPECS,
  type ValidationResult,
  boardMapToPieces,
  boardMapToFen,
  fenToBoardMap,
  getRemainingCounts,
  piecesToBoardMap,
  validateSetupBoard,
} from '../lib/setup'

/* -------------------------------------------------------------------------- */
/*  Hook：补棋 / 自定义排局模式                                                 */
/*  从 App.tsx 抽出的 10 个 useState + 12 个 useCallback，                      */
/*  收拢成一个自洽的状态机，外部只需 `const setup = useSetupMode(deps)`。        */
/* -------------------------------------------------------------------------- */

export interface SetupAPI {
  /** 是否处于补棋模式 */
  active: boolean
  /** 当前排布 */
  boardMap: BoardMap
  /** 先手方 */
  turn: 'red' | 'black'
  /** 引擎执子 */
  engineSide: 'red' | 'black'
  /** 当前选中的托盘棋子（正在准备放子/连盖印章） */
  selectedTrayPiece: string | null
  /** 当前选中的盘上棋子格（正在准备挪位/移除） */
  pickedBoardSquare: string | null
  /** boardMap 对应的 PieceInfo[] 用于渲染 */
  pieces: PieceInfo[]
  /** 剩余棋子数统计 */
  remaining: Record<string, number>
  /** 盘面合法性校验结果 */
  validation: ValidationResult
  /** 当前盘面的 FEN 串 */
  currentFen: string

  enter: () => void
  exit: () => void
  toggle: () => void
  selectTrayPiece: (char: string | null) => void
  pickSquare: (sq: string | null) => void
  clearSelection: () => void
  tapSquare: (sq: string) => void
  dropPieceToSquare: (char: string, sq: string) => boolean
  movePiece: (from: string, to: string) => void
  removePiece: (sq: string) => void
  clearBoard: () => void
  resetStandard: () => void
  revertOriginal: () => void
  importFen: (fen: string) => boolean
  setTurn: (turn: 'red' | 'black') => void
  setEngineSide: (side: 'red' | 'black') => void
  startGame: () => Promise<void>
}

interface SetupDeps {
  game: { pieces: PieceInfo[]; turn: Side; engine_side: Side } | undefined
  pushToast: (text: string, tone?: 'info' | 'warn' | 'error') => void
  loadPosition: (fen: string, engineSide: Side) => Promise<void>
}

export function useSetupMode({ game, pushToast, loadPosition }: SetupDeps): SetupAPI {
  const [active, setActive] = useState(false)
  const [boardMap, setBoardMap] = useState<BoardMap>({})
  const [turn, setTurn] = useState<'red' | 'black'>('red')
  const [engineSide, setEngineSide] = useState<'red' | 'black'>('black')
  const [selectedTrayPiece, setSelectedTrayPiece] = useState<string | null>(null)
  const [pickedBoardSquare, setPickedBoardSquare] = useState<string | null>(null)
  const [originalBoardMap, setOriginalBoardMap] = useState<BoardMap>({})
  const [originalTurn, setOriginalTurn] = useState<'red' | 'black'>('red')
  const [originalEngineSide, setOriginalEngineSide] = useState<'red' | 'black'>('black')

  const pieces = useMemo(() => boardMapToPieces(boardMap), [boardMap])
  const remaining = useMemo(() => getRemainingCounts(boardMap), [boardMap])
  const validation = useMemo(() => validateSetupBoard(boardMap, turn), [boardMap, turn])
  const currentFen = useMemo(() => boardMapToFen(boardMap, turn), [boardMap, turn])

  const enter = useCallback(() => {
    if (!game) return
    const map = piecesToBoardMap(game.pieces)
    setBoardMap(map)
    setOriginalBoardMap(map)
    setTurn(game.turn)
    setOriginalTurn(game.turn)
    setEngineSide(game.engine_side)
    setOriginalEngineSide(game.engine_side)
    setSelectedTrayPiece(null)
    setPickedBoardSquare(null)
    setActive(true)
    pushToast('已进入补棋模式，可自由摆放与调整棋子', 'info')
  }, [game, pushToast])

  const exit = useCallback(() => {
    setActive(false)
    setSelectedTrayPiece(null)
    setPickedBoardSquare(null)
    pushToast('已退出补棋模式，盘面未更改', 'info')
  }, [pushToast])

  const toggle = useCallback(() => {
    if (active) exit()
    else enter()
  }, [active, exit, enter])

  const selectTrayPiece = useCallback((char: string | null) => {
    setSelectedTrayPiece(char)
    if (char) setPickedBoardSquare(null)
  }, [])

  const pickSquare = useCallback((sq: string | null) => {
    setPickedBoardSquare(sq)
    if (sq) setSelectedTrayPiece(null)
  }, [])

  const clearSelection = useCallback(() => {
    setSelectedTrayPiece(null)
    setPickedBoardSquare(null)
  }, [])

  /* ❻ 修复：选中托盘棋子后点击盘上已有棋子的行为
   *
   *  旧行为：静默覆盖，无反馈，用户容易莫名其妙丢子。
   *  新行为：
   *    · 点到同侧棋子 → 取消放子，改为选中该盘上棋子（直觉：我想操作这颗子）
   *    · 点到异侧棋子 → 允许替换，但弹 toast 反馈（直觉：我想在敌子位置放子）
   *    · 点空格 → 正常放子（不变）
   */
  const tapSquare = useCallback(
    (sq: string) => {
      if (!selectedTrayPiece) return
      const rem = getRemainingCounts(boardMap)[selectedTrayPiece] ?? 0
      const currentOnSq = boardMap[sq]

      // 点到的格子已经是同一种棋子，不需要重复放
      if (currentOnSq === selectedTrayPiece) return

      // 格子上有棋子
      if (currentOnSq) {
        const traySpec = PIECE_SPECS[selectedTrayPiece]
        const currentSpec = PIECE_SPECS[currentOnSq]

        // 同侧：切换为选中盘上棋子，不覆盖
        if (traySpec && currentSpec && traySpec.side === currentSpec.side) {
          setSelectedTrayPiece(null)
          setPickedBoardSquare(sq)
          return
        }

        // 异侧：替换，但给反馈
        if (rem <= 0) {
          pushToast('该棋子数量已达上限', 'warn')
          return
        }
        setBoardMap((prev) => ({ ...prev, [sq]: selectedTrayPiece }))
        pushToast(
          `已将${currentSpec?.side === 'red' ? '红' : '黑'}${currentSpec?.name ?? '子'}替换为${traySpec?.side === 'red' ? '红' : '黑'}${traySpec?.name ?? '子'}`,
          'info',
        )
        if (rem <= 1) setSelectedTrayPiece(null)
        return
      }

      // 空格：正常放子
      if (rem <= 0) {
        pushToast('该棋子数量已达上限', 'warn')
        return
      }
      setBoardMap((prev) => ({ ...prev, [sq]: selectedTrayPiece }))
      if (rem <= 1) {
        setSelectedTrayPiece(null)
      }
    },
    [selectedTrayPiece, boardMap, pushToast],
  )

  const movePiece = useCallback((from: string, to: string) => {
    setBoardMap((prev) => {
      const piece = prev[from]
      if (!piece) return prev
      const next = { ...prev }
      delete next[from]
      next[to] = piece
      return next
    })
    setPickedBoardSquare(null)
  }, [])

  const removePiece = useCallback(
    (sq: string) => {
      setBoardMap((prev) => {
        if (!prev[sq]) return prev
        const next = { ...prev }
        delete next[sq]
        return next
      })
      if (pickedBoardSquare === sq) setPickedBoardSquare(null)
    },
    [pickedBoardSquare],
  )

  const clearBoard = useCallback(() => {
    setBoardMap({})
    setPickedBoardSquare(null)
    setSelectedTrayPiece(null)
    pushToast('已清空棋盘', 'info')
  }, [pushToast])

  const resetStandard = useCallback(() => {
    const res = fenToBoardMap(INITIAL_FEN)
    if (res) {
      setBoardMap(res.map)
      setTurn('red')
      setPickedBoardSquare(null)
      setSelectedTrayPiece(null)
      pushToast('已恢复为标准开局 32 颗棋子', 'info')
    }
  }, [pushToast])

  const revertOriginal = useCallback(() => {
    setBoardMap(originalBoardMap)
    setTurn(originalTurn)
    setEngineSide(originalEngineSide)
    setPickedBoardSquare(null)
    setSelectedTrayPiece(null)
    pushToast('已恢复进入前盘面', 'info')
  }, [originalBoardMap, originalTurn, originalEngineSide, pushToast])

  const dropPieceToSquare = useCallback(
    (char: string, sq: string): boolean => {
      if (!PIECE_SPECS[char]) return false
      const rem = getRemainingCounts(boardMap)[char] ?? 0
      const currentOnSq = boardMap[sq]
      if (currentOnSq === char) return true
      if (rem <= 0 && currentOnSq !== char) {
        pushToast(`${PIECE_SPECS[char].name} 数量已达上限`, 'warn')
        return false
      }
      setBoardMap((prev) => ({ ...prev, [sq]: char }))
      return true
    },
    [boardMap, pushToast],
  )

  const importFen = useCallback((fen: string): boolean => {
    const res = fenToBoardMap(fen)
    if (res && !res.error) {
      setBoardMap(res.map)
      setTurn(res.turn)
      setPickedBoardSquare(null)
      setSelectedTrayPiece(null)
      return true
    }
    return false
  }, [])

  const startGame = useCallback(async () => {
    const val = validateSetupBoard(boardMap, turn)
    if (!val.valid) {
      pushToast('当前盘面存在不合规项，无法开始对局', 'error')
      return
    }
    const fen = boardMapToFen(boardMap, turn)
    setActive(false)
    setSelectedTrayPiece(null)
    setPickedBoardSquare(null)
    await loadPosition(fen, engineSide)
    pushToast('已载入自定义排局，开始对局', 'info')
  }, [boardMap, turn, engineSide, pushToast, loadPosition])

  return {
    active,
    boardMap,
    turn,
    engineSide,
    selectedTrayPiece,
    pickedBoardSquare,
    pieces,
    remaining,
    validation,
    currentFen,
    enter,
    exit,
    toggle,
    selectTrayPiece,
    pickSquare,
    clearSelection,
    tapSquare,
    dropPieceToSquare,
    movePiece,
    removePiece,
    clearBoard,
    resetStandard,
    revertOriginal,
    importFen,
    setTurn,
    setEngineSide,
    startGame,
  }
}
