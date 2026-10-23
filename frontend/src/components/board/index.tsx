import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react'
import type { Side } from '../../types'
import type { KnockSeed, KnockState, Victim, DragState, BoardProps } from './types'
import {
  BOARD_H,
  BOARD_W,
  COLS,
  ROWS,
  glideMs,
  landMs,
  squareAt,
  toPixel,
  parseSquare,
  pixelToSquare,
  calculateMoveLine,
  type CurveTrajectory,
} from '../../lib/board'
import { useExitPhase } from '../../hooks/useExitPhase'
import { play } from '../../lib/sound'
import { BoardArtwork } from './BoardArtwork'
import { BoardSvgLayer } from './BoardSvgLayer'
import { BoardPiecesLayer } from './BoardPiecesLayer'
import { BoardOverlaysLayer } from './BoardOverlaysLayer'

/** 落子反馈自身的时长。涟漪（520ms）比压实（320ms）长，两者错开收尾 */
const IMPACT_MS = 520

/** 被吃残影从挂载到卸载。CSS 里 pieceKnockback 走 220ms，这里给到 240ms 收干净 */
const KNOCK_MS = 240

/** 可走点与选中月牙环还多活多久（见 hooks/useExitPhase） */
const MARK_OUT_MS = 170

/** 将军那一响在 DOM 上多留多久。CSS 里 checkAlarm 走 640ms，这里给到 700ms */
const CHECK_ALARM_MS = 700

/** 本地预判最多活这么久。到点服务端还没认，就判这一手落空、就地回位 */
const PENDING_MS = 800

/** 主棋盘组件：统一状态协调、落子逻辑、右键/点击事件处理与各子图层组装 */
export function Board({
  game,
  flipped,
  thinking,
  pv = [],
  onMove,
  flipping = false,
  readOnly = false,
  setupMode = false,
  visualClues,
  setupPieces,
  selectedTrayPiece = null,
  pickedBoardSquare = null,
  onSetupSquareTap,
  onSetupPieceMove,
  onSetupPieceRemove,
  onSetupPickBoardSquare,
  onSetupPieceDropFromTray,
  onPoofTriggered,
  setupValidation,
  boardCaption: _boardCaption = null,
  moveBubble = null,
  xrayOverlay = null,
  spotlightSquares = null,
  ghostMove = null,
}: BoardProps) {
  const surfaceRef = useRef<HTMLDivElement>(null)

  // 拖拽：从「按下一颗子」到「松手」之间的全部状态都在这里
  const [drag, setDrag] = useState<DragState | null>(null)
  const dragRef = useRef<{
    from: string | null
    sx: number
    sy: number
    id: number
    moved: boolean
  } | null>(null)

  // 本地预判位移：落子瞬间立即启动位移，不等网络往返，杜绝子回弹与闪烁
  const [pendingMove, setPendingMove] = useState<{
    id: number
    from: string
    to: string
  } | null>(null)

  // 每颗子「上一帧渲染在哪个格子」，键是服务端给的棋子身份号
  const prevVisual = useRef(new Map<number, string>())

  // 落子的序号。用来认出「这条提交回执已经过期了」
  const moveSeq = useRef(0)

  // 上一次结算过的 ply
  const plyRef = useRef(game.ply)

  // 滑行收尾时用它强制重渲一次
  const [, forceSettle] = useReducer((n: number) => n + 1, 0)

  /** 正在滑的棋子 -> 这一段位移该走多久。锁住，滑完才收 */
  const glideRef = useRef(new Map<number, number>())

  // 开场落盘只播一次
  const bootedRef = useRef(false)
  useEffect(() => {
    bootedRef.current = true
  }, [])

  // 正在播落子反馈的那颗子（一次性）
  const [impactId, setImpactId] = useState<number | null>(null)
  const landTimer = useRef<{ id: number; handle: number } | null>(null)
  const settleTimer = useRef<{ id: number; handle: number } | null>(null)
  const hideImpact = useRef<number | null>(null)
  const hideKnock = useRef<number | null>(null)
  const knockRef = useRef<KnockSeed | null>(null)
  const [knock, setKnock] = useState<KnockState | null>(null)
  const [landedPly, setLandedPly] = useState(-1)
  const [alarmSquare, setAlarmSquare] = useState<string | null>(null)
  const hideAlarm = useRef<number | null>(null)
  const recordsRef = useRef(game.records)
  recordsRef.current = game.records

  // 选中格子与激活棋子
  const [picked, setPicked] = useState<string | null>(null)
  const activePieces = setupMode && setupPieces ? setupPieces : game.pieces
  const effectivePicked = setupMode ? pickedBoardSquare : picked

  // 可走点：从合法着法里现算
  const targets = useMemo(() => {
    if (setupMode || !effectivePicked) return []
    return game.legal_moves.filter((m) => m.from === effectivePicked).map((m) => m.to)
  }, [setupMode, effectivePicked, game.legal_moves])

  // 可走点与月牙环优雅退场时序
  const [dotsShown, dotsLeaving] = useExitPhase(!setupMode && targets.length > 0, MARK_OUT_MS)
  const lastDots = useRef<{ sq: string; capture: boolean }[]>([])
  const dots = targets.map((sq) => ({ sq, capture: game.pieces.some((p) => p.square === sq) }))
  if (dots.length) lastDots.current = dots

  const [crescentShown, crescentLeaving] = useExitPhase(!!effectivePicked, MARK_OUT_MS)
  const lastPicked = useRef<string | null>(null)
  if (effectivePicked) lastPicked.current = effectivePicked
  const crescentSq = effectivePicked ?? (crescentShown ? lastPicked.current : null)

  // 服务端确认了这一手就清空预判
  useEffect(() => {
    setPendingMove(null)
  }, [game.ply, game.turn])

  // 局面换了就把选中清掉
  useEffect(() => {
    setPicked(null)
  }, [game.ply, game.engine_side, game.status.state])

  // 兜底：PENDING_MS 还没等到服务端认同，瞬回原位
  useEffect(() => {
    if (!pendingMove) return
    const { id, from } = pendingMove
    const timer = window.setTimeout(() => {
      prevVisual.current.set(id, from)
      setPendingMove(null)
      cancelArrival(id)
    }, PENDING_MS)
    return () => window.clearTimeout(timer)
  }, [pendingMove])

  // 计算这一帧真正换了格子的子
  const moved = useMemo(() => {
    const prev = prevVisual.current
    const out: { id: number; from: string; to: string }[] = []
    for (const p of game.pieces) {
      const sq = p.id === pendingMove?.id ? pendingMove.to : p.square
      const was = prev.get(p.id)
      if (was !== undefined && was !== sq) out.push({ id: p.id, from: was, to: sq })
    }
    return out
  }, [game.pieces, pendingMove])

  const plyDelta = game.ply - plyRef.current
  const canGlide = plyDelta > 0 || (plyDelta === 0 && pendingMove !== null)

  // 锁定当前手滑行时长
  const solo = moved.length === 1 ? moved[0] : null
  if (solo && canGlide) glideRef.current.set(solo.id, glideMs(solo.from, solo.to))

  const victimAt = (from: string, to: string, moverId: number): KnockSeed | null => {
    const standing = game.pieces.find((p) => p.square === to && p.id !== moverId)
    if (standing) {
      return { square: to, glyph: standing.glyph, side: standing.side, from }
    }
    const rec = game.records[game.ply - 1]
    if (rec?.captured && rec.to === to) {
      return {
        square: to,
        glyph: rec.captured_glyph || rec.captured,
        side: rec.side === 'red' ? 'black' : 'red',
        from,
      }
    }
    return null
  }

  // 排定落子反馈、撞飞残影与将军震荡波
  useEffect(() => {
    const next = new Map<number, string>()
    for (const p of game.pieces) {
      next.set(p.id, p.id === pendingMove?.id ? pendingMove.to : p.square)
    }
    prevVisual.current = next

    const landed = moved.length === 1 ? moved[0] : null
    if (!landed) {
      plyRef.current = game.ply
      return
    }

    const { id, from, to } = landed
    const wait = glideRef.current.get(id) ?? 0
    const isPrediction = pendingMove?.id === id
    const advanced = game.ply === plyRef.current + 1
    plyRef.current = game.ply
    const targetPly = isPrediction ? game.ply + 1 : game.ply
    knockRef.current = victimAt(from, to, id)

    if (landTimer.current) window.clearTimeout(landTimer.current.handle)
    if (settleTimer.current) window.clearTimeout(settleTimer.current.handle)
    if (hideImpact.current) window.clearTimeout(hideImpact.current)
    if (hideKnock.current) window.clearTimeout(hideKnock.current)

    landTimer.current = {
      id,
      handle: window.setTimeout(() => {
        landTimer.current = null
        if (!(isPrediction || advanced)) return
        setLandedPly(targetPly)
        setImpactId(id)
        hideImpact.current = window.setTimeout(
          () => setImpactId((curr) => (curr === id ? null : curr)),
          IMPACT_MS,
        )
        const seed = knockRef.current
        if (seed) {
          setKnock({ ...seed, kr: (Math.random() > 0.5 ? 1 : -1) * (3 + Math.random() * 4) })
          hideKnock.current = window.setTimeout(() => setKnock(null), KNOCK_MS)
        }
        const rec = recordsRef.current.find((r) => r.ply === targetPly)
        const alarmSq = checkSquareRef.current
        if (rec?.check && alarmSq) {
          if (hideAlarm.current) window.clearTimeout(hideAlarm.current)
          setAlarmSquare(alarmSq)
          hideAlarm.current = window.setTimeout(
            () => setAlarmSquare((curr) => (curr === alarmSq ? null : curr)),
            CHECK_ALARM_MS,
          )
        }
      }, landMs(from, to)),
    }
    settleTimer.current = {
      id,
      handle: window.setTimeout(() => {
        settleTimer.current = null
        glideRef.current.delete(id)
        forceSettle()
      }, wait),
    }
  }, [moved, game.pieces, pendingMove])

  useEffect(
    () => () => {
      if (landTimer.current) window.clearTimeout(landTimer.current.handle)
      if (settleTimer.current) window.clearTimeout(settleTimer.current.handle)
      if (hideImpact.current) window.clearTimeout(hideImpact.current)
      if (hideKnock.current) window.clearTimeout(hideKnock.current)
      if (hideAlarm.current) window.clearTimeout(hideAlarm.current)
    },
    [],
  )

  // 棋盘比例锚定
  useLayoutEffect(() => {
    const el = surfaceRef.current
    if (!el) return
    const apply = () => {
      const w = el.clientWidth
      if (w > 0) el.style.setProperty('--u', String(w / BOARD_W))
    }
    apply()
    const ro = new ResizeObserver(apply)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const kingInCheck = useMemo(() => {
    if (!game.in_check) return null
    const king = game.pieces.find((p) => p.char.toLowerCase() === 'k' && p.side === game.turn)
    return king ? king.square : null
  }, [game.in_check, game.pieces, game.turn])
  const checkSquareRef = useRef<string | null>(null)
  checkSquareRef.current = kingInCheck

  // 胜方的王：终局时亮起一圈朱砂余光
  const victorKing = useMemo(() => {
    if (game.status.state === 'playing' || !game.status.winner) return null
    const king = game.pieces.find(
      (p) => p.char.toLowerCase() === 'k' && p.side === game.status.winner,
    )
    return king ? king.square : null
  }, [game.status.state, game.status.winner, game.pieces])

  // 空中滑行中判定
  const airborne = (() => {
    if (setupMode || !game.last_move) return false
    if (landedPly === game.ply) return false
    const sq = game.last_move.to
    for (const p of game.pieces) {
      const at = p.id === pendingMove?.id ? pendingMove.to : p.square
      if (at === sq) return glideRef.current.has(p.id)
    }
    return false
  })()

  // 落点替身
  const standIn = (() => {
    if (!airborne) return null
    const rec = game.records[game.ply - 1]
    if (!rec?.captured || rec.ply !== game.ply) return null
    if (!game.last_move || rec.to !== game.last_move.to) return null
    return {
      square: rec.to,
      glyph: rec.captured_glyph || rec.captured,
      side: (rec.side === 'red' ? 'black' : 'red') as any,
      from: rec.from,
    } satisfies Victim & { from: string }
  })()

  const pvSquares = useMemo(() => {
    const out: { from: string; to: string }[] = []
    pv.slice(0, 3).forEach((iccs) => {
      if (iccs.length === 4) out.push({ from: iccs.slice(0, 2), to: iccs.slice(2, 4) })
    })
    return out
  }, [pv])

  // 最近一步行棋的直线轨迹
  const lastMoveArc = useMemo<(CurveTrajectory & { moverSide: Side }) | null>(() => {
    if (setupMode || !game.last_move) return null
    const fromP = parseSquare(game.last_move.from)
    const toP = parseSquare(game.last_move.to)
    const p1 = toPixel(fromP.file, fromP.rank, flipped)
    const p2 = toPixel(toP.file, toP.rank, flipped)
    const moverSide: Side = game.turn === 'red' ? 'black' : 'red'
    const arc = calculateMoveLine(p1, p2)
    if (!arc) return null
    return { ...arc, moverSide }
  }, [game.last_move, game.turn, flipped, setupMode])

  // 引擎主变预测走法的直线虚线分支
  const pvArcs = useMemo(() => {
    if (setupMode || pvSquares.length === 0) return []
    return pvSquares
      .map((step) => {
        const fromP = parseSquare(step.from)
        const toP = parseSquare(step.to)
        const p1 = toPixel(fromP.file, fromP.rank, flipped)
        const p2 = toPixel(toP.file, toP.rank, flipped)
        return calculateMoveLine(p1, p2)
      })
      .filter((a): a is CurveTrajectory => a !== null)
  }, [pvSquares, flipped, setupMode])

  const squareFromBoard = (x: number, y: number): string | null => {
    const p = pixelToSquare(x, y, flipped)
    return p ? squareAt(p.file, p.rank) : null
  }

  const squareAtPoint = (clientX: number, clientY: number): string | null => {
    const el = surfaceRef.current
    if (!el) return null
    const rect = el.getBoundingClientRect()
    return squareFromBoard(
      ((clientX - rect.left) / rect.width) * BOARD_W,
      ((clientY - rect.top) / rect.height) * BOARD_H,
    )
  }

  const toBoardPixel = (clientX: number, clientY: number) => {
    const el = surfaceRef.current
    if (!el) return { bx: 0, by: 0 }
    const rect = el.getBoundingClientRect()
    return {
      bx: ((clientX - rect.left) / rect.width) * BOARD_W,
      by: ((clientY - rect.top) / rect.height) * BOARD_H,
    }
  }

  const grabbable = (square: string | null): boolean => {
    if (!square) return false
    if (readOnly) return false
    if (setupMode) {
      return activePieces.some((p) => p.square === square)
    }
    if (thinking || game.status.state !== 'playing') return false
    const piece = game.pieces.find((p) => p.square === square)
    return !!piece && piece.side === game.turn
  }

  const canPlay = (): boolean => setupMode || (!thinking && game.status.state === 'playing')

  const cancelArrival = (id: number) => {
    if (landTimer.current?.id === id) {
      window.clearTimeout(landTimer.current.handle)
      landTimer.current = null
      knockRef.current = null
    }
  }

  const commitMove = (from: string, to: string): boolean => {
    if (!canPlay()) return false
    const mv = game.legal_moves.find((m) => m.from === from && m.to === to)
    if (!mv || mv.from === mv.to) return false
    const mover = game.pieces.find((p) => p.square === from)
    if (!mover) return false
    setPendingMove({ id: mover.id, from, to })
    setPicked(null)

    const seq = (moveSeq.current += 1)
    const rollBack = () => {
      if (seq !== moveSeq.current) return
      prevVisual.current.set(mover.id, from)
      setPendingMove(null)
      cancelArrival(mover.id)
    }
    void onMove(mv.iccs).then((ok) => {
      if (!ok) rollBack()
    }, rollBack)
    return true
  }

  const tapSquare = (sq: string) => {
    if (setupMode) {
      if (selectedTrayPiece) {
        onSetupSquareTap?.(sq)
        play('snap')
        return
      }
      const pieceOnSq = activePieces.find((p) => p.square === sq)
      if (pickedBoardSquare) {
        if (pickedBoardSquare === sq) {
          onSetupPickBoardSquare?.(null)
        } else {
          onSetupPieceMove?.(pickedBoardSquare, sq)
          play('snap')
          onSetupPickBoardSquare?.(null)
        }
      } else if (pieceOnSq) {
        onSetupPickBoardSquare?.(sq)
      }
      return
    }
    if (!canPlay()) return
    if (picked && picked !== sq && commitMove(picked, sq)) return
    if (grabbable(sq)) setPicked((prev) => (prev === sq ? null : sq))
    else setPicked(null)
  }

  // 指针事件处理
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (setupMode && e.button === 2) {
      const sq = squareAtPoint(e.clientX, e.clientY)
      if (sq) {
        onSetupPieceRemove?.(sq)
        onPoofTriggered?.(e.clientX, e.clientY)
        play('poof')
      }
      return
    }
    if (e.button !== 0) return
    setKbdOn(false)
    const sq = squareAtPoint(e.clientX, e.clientY)
    const canGrab = grabbable(sq)
    dragRef.current = {
      from: canGrab ? sq : null,
      sx: e.clientX,
      sy: e.clientY,
      id: e.pointerId,
      moved: false,
    }
    if (canGrab) {
      e.currentTarget.setPointerCapture(e.pointerId)
    }
  }

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (surfaceRef.current) {
      const rect = surfaceRef.current.getBoundingClientRect()
      if (rect.width > 0 && rect.height > 0) {
        const px = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100))
        const py = Math.max(0, Math.min(100, ((e.clientY - rect.top) / rect.height) * 100))
        surfaceRef.current.style.setProperty('--mouse-x', `${px.toFixed(1)}%`)
        surfaceRef.current.style.setProperty('--mouse-y', `${py.toFixed(1)}%`)
      }
    }
    const d = dragRef.current
    if (!d || !d.from) return
    if (!d.moved) {
      if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 5) return
      d.moved = true
      setPicked(d.from)
    }
    const { bx, by } = toBoardPixel(e.clientX, e.clientY)
    setDrag({ from: d.from, bx, by })
  }

  const endPointer = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current
    dragRef.current = null
    const wasDrag = d?.moved && d?.from
    const fromSq = d?.from
    setDrag(null)
    if (!d) return
    if (e.currentTarget.hasPointerCapture(d.id)) e.currentTarget.releasePointerCapture(d.id)
    const sq = squareAtPoint(e.clientX, e.clientY)
    if (wasDrag && fromSq) {
      if (setupMode) {
        if (sq && sq !== fromSq) {
          onSetupPieceMove?.(fromSq, sq)
          play('snap')
        } else if (!sq) {
          onSetupPieceRemove?.(fromSq)
          onPoofTriggered?.(e.clientX, e.clientY)
          play('poof')
        }
        return
      }
      if (sq && sq !== fromSq) commitMove(fromSq, sq)
      return
    }
    if (sq) tapSquare(sq)
  }

  const cancelPointer = (e: React.PointerEvent<HTMLDivElement>) => {
    dragRef.current = null
    setDrag(null)
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
  }

  const dragSquare = drag ? squareFromBoard(drag.bx, drag.by) : null

  // 键盘操作
  const [cursor, setCursor] = useState<string | null>(null)
  const [kbdOn, setKbdOn] = useState(false)

  const initialCursor = (): string => {
    if (picked) return picked
    if (game.last_move) return game.last_move.to
    return flipped ? 'e9' : 'e0'
  }

  const moveCursor = (dFile: number, dRank: number) => {
    const { file, rank } = parseSquare(cursor ?? initialCursor())
    const f = Math.min(COLS - 1, Math.max(0, file + (flipped ? -dFile : dFile)))
    const r = Math.min(ROWS - 1, Math.max(0, rank + (flipped ? -dRank : dRank)))
    setCursor(squareAt(f, r))
    setKbdOn(true)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    switch (e.key) {
      case 'ArrowUp':
        e.preventDefault()
        moveCursor(0, 1)
        break
      case 'ArrowDown':
        e.preventDefault()
        moveCursor(0, -1)
        break
      case 'ArrowLeft':
        e.preventDefault()
        moveCursor(-1, 0)
        break
      case 'ArrowRight':
        e.preventDefault()
        moveCursor(1, 0)
        break
      case 'Enter':
      case ' ': {
        e.preventDefault()
        const sq = cursor ?? initialCursor()
        setCursor(sq)
        setKbdOn(true)
        tapSquare(sq)
        break
      }
      case 'Escape':
        setPicked(null)
        break
    }
  }

  // 棋子按稳固身份号排序
  const piecesInOrder = useMemo(
    () => [...activePieces].sort((a, b) => a.id - b.id),
    [activePieces],
  )

  return (
    <div className={`board relative aspect-[720/800] max-w-full rounded-[var(--r-lg)] ${thinking ? 'is-thinking' : ''} ${setupMode ? 'is-setup' : ''}`}>
      {/* 棋盘物理比例占位体（常规文档流）：确保 WebKit / Safari 下即便子层全为 absolute 也绝不塌陷高度 */}
      <div className="w-full aspect-[720/800] pointer-events-none opacity-0 select-none" aria-hidden="true" />

      <div
        className={[
          'board-surface',
          'absolute inset-0 rounded-[var(--r-lg)] overflow-hidden cursor-pointer select-none [isolation:isolate] [contain:layout_style_paint] outline-none',
          drag ? 'is-dragging cursor-grabbing' : '',
          flipping ? 'is-flipping' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        ref={surfaceRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerCancel={cancelPointer}
        onDragOver={(e) => {
          if (setupMode) {
            e.preventDefault()
            e.dataTransfer.dropEffect = 'copy'
          }
        }}
        onDrop={(e) => {
          if (setupMode) {
            e.preventDefault()
            const char = e.dataTransfer.getData('text/plain')
            const sq = squareAtPoint(e.clientX, e.clientY)
            if (sq && char) {
              onSetupPieceDropFromTray?.(char, sq)
              play('snap')
            }
          }
        }}
        onContextMenu={(e) => {
          if (setupMode) e.preventDefault()
        }}
        onKeyDown={onKeyDown}
        onFocus={() => setKbdOn(false)}
        tabIndex={0}
        role="application"
        aria-label="棋盘。方向键移动光标，回车选中或落子，Esc 取消选中。"
        data-board=""
        data-flipped={flipped ? 'true' : 'false'}
        data-thinking={thinking ? 'true' : 'false'}
        data-ply={game.ply}
        {...(drag ? { 'data-dragging': drag.from } : {})}
      >
        {/* 1. 纯 SVG 底图与楚河汉界网格线 */}
        <BoardArtwork flipped={flipped} />

        {/* 2. 走棋直线/曲线轨迹线与主变分支及排局就地诊断 */}
        <BoardSvgLayer
          setupMode={setupMode}
          pvArcs={pvArcs}
          lastMoveArc={lastMoveArc}
          ply={game.ply}
          setupValidation={setupValidation}
          flipped={flipped}
        />

        {/* 3. 核心棋子渲染、拖拽交互与落地动效 */}
        <BoardPiecesLayer
          piecesInOrder={piecesInOrder}
          pendingMove={pendingMove}
          drag={drag}
          dragSquare={dragSquare}
          flipped={flipped}
          glideMap={glideRef.current}
          booted={bootedRef.current}
          effectivePicked={effectivePicked}
          kingInCheck={kingInCheck}
          alarmSquare={alarmSquare}
          visualClues={visualClues}
          spotlightSquares={spotlightSquares}
          victorKing={victorKing}
          thinking={thinking}
          gameState={game.status.state}
          turn={game.turn}
          setupMode={setupMode}
          impactId={impactId}
          knock={knock}
          standIn={standIn}
          ply={game.ply}
          airborne={airborne}
          lastMove={game.last_move}
          activeDots={dotsShown ? lastDots.current : []}
          dotsLeaving={dotsLeaving}
          kbdOn={kbdOn}
          cursor={cursor}
          crescentSq={crescentSq}
          crescentLeaving={crescentLeaving}
        />

        {/* 4. 浮层：气泡、空间暗线透视、坐标尺 */}
        <BoardOverlaysLayer
          flipped={flipped}
          visualClues={visualClues}
          moveBubble={moveBubble}
          xrayOverlay={xrayOverlay}
          ghostMove={ghostMove}
        />


      </div>
    </div>
  )
}

export { BoardArtwork } from './BoardArtwork'
export { BoardPiece, VictimGhostPiece } from './BoardPiece'
export { BoardPiecesLayer } from './BoardPiecesLayer'
export { BoardSvgLayer } from './BoardSvgLayer'
export { BoardHudCaption, BoardOverlaysLayer } from './BoardOverlaysLayer'
export type { BoardProps, DragState, Victim, KnockSeed, KnockState } from './types'

