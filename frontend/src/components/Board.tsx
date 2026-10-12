import {
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { GameSnapshot, Side } from '../types'
import {
  BOARD_H,
  BOARD_W,
  CELL,
  COLS,
  MARGIN,
  MARK_POINTS,
  RIVER_LABELS,
  ROWS,
  squareAt,
  toPixel,
  toPercent,
  palaceDiagonals,
  parseSquare,
} from '../lib/board'

/** 正在被拖拽的一颗子。bx/by 是棋盘坐标系里的像素位置，
 *  渲染时换算成百分比，所以不需要在渲染期读 getBoundingClientRect。 */
interface DragState {
  from: string
  bx: number
  by: number
}

interface BoardProps {
  game: GameSnapshot
  flipped: boolean
  selected: string | null
  targets: string[]
  /** 单击（不拖）：由上层决定这是「选中」还是「落子」 */
  onSquareClick: (square: string) => void
  /** 拖拽开始时选中起点，好让可走点提前显形 */
  onSelect: (square: string) => void
  /** 拖拽结束落在 to 上：由上层校验合法性并提交 */
  onDragDrop: (from: string, to: string) => void
  thinking: boolean
  /** 主变占位（ICCS），在盘面上淡淡地铺一条「引擎打算这么走」的虚线 */
  pv?: string[]
}

export function Board({
  game,
  flipped,
  selected,
  targets,
  onSquareClick,
  onSelect,
  onDragDrop,
  thinking,
  pv = [],
}: BoardProps) {
  const surfaceRef = useRef<HTMLDivElement>(null)

  // 拖拽：从「按下一颗子」到「松手」之间的全部状态都在这里。
  const [drag, setDrag] = useState<DragState | null>(null)
  const dragRef = useRef<{
    from: string | null
    sx: number
    sy: number
    id: number
    moved: boolean
  } | null>(null)

  // 本地预判位移：落子瞬间立即启动位移，不等网络往返，杜绝子回弹与闪烁
  const [pendingMove, setPendingMove] = useState<{ from: string; to: string } | null>(null)

  useEffect(() => {
    setPendingMove(null)
  }, [game.ply, game.pieces, game.turn])

  useEffect(() => {
    if (!pendingMove) return
    const timer = window.setTimeout(() => setPendingMove(null), 800)
    return () => window.clearTimeout(timer)
  }, [pendingMove])

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

  // 胜方的王：终局时亮起一圈朱砂余光
  const victorKing = useMemo(() => {
    if (game.status.state === 'playing' || !game.status.winner) return null
    const king = game.pieces.find(
      (p) => p.char.toLowerCase() === 'k' && p.side === game.status.winner,
    )
    return king ? king.square : null
  }, [game.status.state, game.status.winner, game.pieces])

  // 吃子物理动量反应：记录被吃掉的棋子残影
  const [capturedGhost, setCapturedGhost] = useState<{
    id: string
    square: string
    glyph: string
    side: Side
    kx: number
    ky: number
    kr: number
  } | null>(null)

  useEffect(() => {
    if (!game.last_move || !game.last_move.captured) {
      return
    }
    const { from, to } = game.last_move
    const fromP = parseSquare(from)
    const toP = parseSquare(to)
    const df = toP.file - fromP.file
    const dr = toP.rank - fromP.rank
    const dist = Math.hypot(df, dr) || 1
    // 屏幕坐标系：df 向右为正，dr 在非翻转下 rank 增加（向上）即 Y 变小（向上）
    const screenKx = df / dist
    const screenKy = (flipped ? dr : -dr) / dist
    const kr = (Math.random() > 0.5 ? 1 : -1) * (3 + Math.random() * 4)

    // 找到被吃掉的棋子 glyph 和 side
    const lastRec = game.records[game.ply - 1]
    const glyph = lastRec?.captured_glyph || game.last_move.captured || '子'
    const moverPiece = game.pieces.find((p) => p.square === to)
    const moverSide = moverPiece ? moverPiece.side : (game.turn === 'red' ? 'black' : 'red')
    const victimSide: Side = moverSide === 'red' ? 'black' : 'red'

    const ghostId = `ghost-${game.ply}-${to}`
    setCapturedGhost({
      id: ghostId,
      square: to,
      glyph,
      side: victimSide,
      kx: screenKx,
      ky: screenKy,
      kr,
    })

    const timer = window.setTimeout(() => {
      setCapturedGhost((curr) => (curr?.id === ghostId ? null : curr))
    }, 240)
    return () => window.clearTimeout(timer)
  }, [game.ply, game.last_move, flipped, game.pieces, game.records, game.turn])

  const pvSquares = useMemo(() => {
    const out: { from: string; to: string }[] = []
    pv.slice(0, 3).forEach((iccs) => {
      if (iccs.length === 4) out.push({ from: iccs.slice(0, 2), to: iccs.slice(2, 4) })
    })
    return out
  }, [pv])

  /** 棋盘像素坐标 -> 格子名；落在盘外返回 null。翻转只在这一步发生。 */
  const squareFromBoard = (x: number, y: number): string | null => {
    let file = Math.round((x - MARGIN) / CELL)
    let rank = 9 - Math.round((y - MARGIN) / CELL)
    if (file < 0 || file > 8 || rank < 0 || rank > 9) return null
    if (flipped) {
      file = 8 - file
      rank = 9 - rank
    }
    return String.fromCharCode(97 + file) + rank
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

  /** 这颗子现在能不能被拿走。轮到的、还没结束、引擎没在算 —— 三者缺一不可。 */
  const grabbable = (square: string | null): boolean => {
    if (!square || thinking || game.status.state !== 'playing') return false
    const piece = game.pieces.find((p) => p.square === square)
    return !!piece && piece.side === game.turn
  }

  // ---- 指针：按下 / 移动 / 松开 -------------------------------------- //
  //
  // 落子有两条路，共用同一套坐标反查：
  //   拖   —— 按住子、挪过 5px 就进入拖拽，松手落在合法点就落子；
  //   点   —— 没挪动，当单击处理，交给上层决定是选中还是落子。
  // 之所以把点击也画进指针事件里，是因为一个 <div> 上同时挂 onClick 和
  // pointerdown，拖拽结束时浏览器补的那次 click 会把同一步走两遍。

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    setKbdOn(false) // 回到鼠标操作，键盘光标退场
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
      // 把后续的 pointermove/up 都收进棋盘，指针滑到盘外也不会丢事件
      e.currentTarget.setPointerCapture(e.pointerId)
    }
  }

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current
    if (!d || !d.from) return
    if (!d.moved) {
      if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 5) return
      d.moved = true
      // 一旦真的拖动起来就先把起点选中，可走点提前显形
      onSelect(d.from)
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
      if (sq && sq !== fromSq && targets.includes(sq)) {
        setPendingMove({ from: fromSq, to: sq })
        onDragDrop(fromSq, sq)
      }
      return
    }
    if (sq) {
      if (selected && selected !== sq && targets.includes(sq)) {
        setPendingMove({ from: selected, to: sq })
      }
      onSquareClick(sq)
    }
  }

  const cancelPointer = (e: React.PointerEvent<HTMLDivElement>) => {
    dragRef.current = null
    setDrag(null)
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
  }

  /** 拖拽时指针底下的那一格，用来把落点标记点亮 */
  const dragSquare = drag ? squareFromBoard(drag.bx, drag.by) : null

  // ---- 键盘：方向键移光标、回车选中/落子、Esc 取消 ---------------------- //
  //
  // 光标只在「棋盘拿到焦点且按过键盘」时显形，鼠标用户永远看不到它。
  // 上下左右说的是「视觉上」的方向，所以翻转视角后要跟着倒过来。

  const [cursor, setCursor] = useState<string | null>(null)
  const [kbdOn, setKbdOn] = useState(false)

  const initialCursor = (): string => {
    if (selected) return selected
    if (game.last_move) return game.last_move.to
    return flipped ? 'e9' : 'e0' // 执棋一方的将/帅门口
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
        if (selected && selected !== sq && targets.includes(sq)) {
          setPendingMove({ from: selected, to: sq })
        }
        onSquareClick(sq) // 上层自己判断这是选中还是落子
        break
      }
      case 'Escape':
        if (selected) onSquareClick(selected) // 再点一次已选中的子 = 取消选中
        break
    }
  }

  return (
    <div className={`board ${thinking ? 'is-thinking' : ''}`}>
      <div
        className={`board-surface ${drag ? 'is-dragging' : ''}`}
        ref={surfaceRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerCancel={cancelPointer}
        onKeyDown={onKeyDown}
        onFocus={() => setKbdOn(false)}
        tabIndex={0}
        role="application"
        aria-label="棋盘。方向键移动光标，回车选中或落子，Esc 取消选中。"
      >
        <BoardArtwork />

        {/* 主变预览：引擎盘算的下一步，淡淡的，不抢戏 */}
        {pvSquares.map((step, i) => {
          const a = toPercent(parseSquare(step.from).file, parseSquare(step.from).rank, flipped)
          const b = toPercent(parseSquare(step.to).file, parseSquare(step.to).rank, flipped)
          return (
            <div
              key={`${step.from}${step.to}${i}`}
              className="pv-trace"
              style={{
                left: `${a.x}%`,
                top: `${a.y}%`,
                width: `${Math.hypot(((b.x - a.x) / 100) * BOARD_W, ((b.y - a.y) / 100) * BOARD_H)}px`,
                transform: `rotate(${Math.atan2(
                  ((b.y - a.y) / 100) * BOARD_H,
                  ((b.x - a.x) / 100) * BOARD_W,
                )}rad)`,
                opacity: 0.5 - i * 0.16,
              }}
            />
          )
        })}

        {/* 可走点位 */}
        {targets.map((sq) => {
          const { file, rank } = parseSquare(sq)
          const { x, y } = toPercent(file, rank, flipped)
          const occupied = game.pieces.some((p) => p.square === sq)
          return (
            <div
              key={`t${sq}`}
              className={[
                'target',
                occupied ? 'target-capture' : '',
                dragSquare === sq ? 'is-over' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              style={{ left: `${x}%`, top: `${y}%` }}
            />
          )
        })}

        {/* 键盘光标：只有按过方向键才出现，鼠标用户无感 */}
        {kbdOn && cursor && (
          <span
            className="kbd-cursor"
            style={{
              left: `${toPercent(parseSquare(cursor).file, parseSquare(cursor).rank, flipped).x}%`,
              top: `${toPercent(parseSquare(cursor).file, parseSquare(cursor).rank, flipped).y}%`,
            }}
          />
        )}

        {/* 移动轨迹（墨痕）：棋子走过后的渐隐笔锋，700ms 淡没 */}
        {game.last_move && (() => {
          const fromP = parseSquare(game.last_move.from)
          const toP = parseSquare(game.last_move.to)
          const a = toPercent(fromP.file, fromP.rank, flipped)
          const b = toPercent(toP.file, toP.rank, flipped)
          const dx = ((b.x - a.x) / 100) * BOARD_W
          const dy = ((b.y - a.y) / 100) * BOARD_H
          const len = Math.hypot(dx, dy)
          const angle = Math.atan2(dy, dx)
          // 刚走完那步的棋子颜色（turn 已经翻过了，所以反过来取）
          const moverSide = game.turn === 'red' ? 'black' : 'red'
          return (
            <div
              key={`trail-${game.ply}`}
              className={`move-trail move-trail-${moverSide}`}
              style={{
                left: `${a.x}%`,
                top: `${a.y}%`,
                width: `${len}px`,
                transform: `rotate(${angle}rad)`,
              }}
              aria-hidden="true"
            />
          )
        })()}

        {/* 选中棋子周围的清透月牙高光圆环（精准对齐图一） */}
        {selected && (() => {
          const { file, rank } = parseSquare(selected)
          const { x, y } = toPercent(file, rank, flipped)
          return (
            <span
              key={`selected-crescent-${selected}`}
              className="selected-crescent-ring"
              style={{
                left: `${x}%`,
                top: `${y}%`,
              }}
              aria-hidden="true"
            >
              <svg viewBox="0 0 100 100" className="crescent-svg" aria-hidden="true">
                <defs>
                  <linearGradient id="crescentGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#ffffff" stopOpacity="1" />
                    <stop offset="35%" stopColor="#ffffff" stopOpacity="0.85" />
                    <stop offset="70%" stopColor="#ffffff" stopOpacity="0.25" />
                    <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
                  </linearGradient>
                  <filter id="crescentGlow" x="-30%" y="-30%" width="160%" height="160%">
                    <feGaussianBlur stdDeviation="2.2" result="blur" />
                    <feMerge>
                      <feMergeNode in="blur" />
                      <feMergeNode in="SourceGraphic" />
                    </feMerge>
                  </filter>
                </defs>
                {/* 底部细圆环：定出中空轮廓，晶莹通透 */}
                <circle
                  cx="50"
                  cy="50"
                  r="43"
                  fill="none"
                  stroke="rgba(255, 255, 255, 0.35)"
                  strokeWidth="1.6"
                />
                {/* 顶部高亮月牙弧光：形成图一鲜明的顶光高光弧 */}
                <path
                  d="M 10 50 A 43 43 0 0 1 90 50"
                  fill="none"
                  stroke="url(#crescentGrad)"
                  strokeWidth="5"
                  strokeLinecap="round"
                  filter="url(#crescentGlow)"
                />
              </svg>
            </span>
          )
        })()}

        {/* 上一步的起终点：
            起点：柔光白圈点（指示从何处起步）
            终点：典雅微光取景落点框 */}
        {game.last_move && (
          <>
            <span
              key={`from-${game.ply}-${game.last_move.from}`}
              className="last-marker last-from"
              style={{
                left: `${toPercent(parseSquare(game.last_move.from).file, parseSquare(game.last_move.from).rank, flipped).x}%`,
                top: `${toPercent(parseSquare(game.last_move.from).file, parseSquare(game.last_move.from).rank, flipped).y}%`,
              }}
            />
            <span
              key={`to-${game.ply}-${game.last_move.to}`}
              className={`last-marker last-to last-to-${game.last_move.by}${
                game.last_move.captured ? ' last-to-capture' : ''
              }`}
              style={{
                left: `${toPercent(parseSquare(game.last_move.to).file, parseSquare(game.last_move.to).rank, flipped).x}%`,
                top: `${toPercent(parseSquare(game.last_move.to).file, parseSquare(game.last_move.to).rank, flipped).y}%`,
              }}
            />
          </>
        )}

        {/* 被吃棋子的物理受力击退滑移 */}
        {capturedGhost && (() => {
          const { file, rank } = parseSquare(capturedGhost.square)
          const { x, y } = toPercent(file, rank, flipped)
          return (
            <div
              key={capturedGhost.id}
              className={`piece ${capturedGhost.side} piece-ghost-knockback`}
              style={{
                left: `${x}%`,
                top: `${y}%`,
                ['--kx' as any]: capturedGhost.kx,
                ['--ky' as any]: capturedGhost.ky,
                ['--kr' as any]: `${capturedGhost.kr}deg`,
              }}
              aria-hidden="true"
            >
              <span className="piece-face">
                <span className="piece-glyph">{capturedGhost.glyph}</span>
              </span>
            </div>
          )
        })()}
        {/* 棋子：纯净位移，其它棋子保持绝对静止 */}
        {game.pieces.map((p) => {
          // 被吃掉的子立即隐藏（被预判吃掉或被服务端吃掉）
          if (pendingMove && p.square === pendingMove.to && p.side !== game.turn) {
            return null
          }

          const isDragging = drag?.from === p.square
          const effectiveSquare = pendingMove && p.square === pendingMove.from ? pendingMove.to : p.square
          const { file, rank } = parseSquare(effectiveSquare)
          const { x, y } = toPercent(file, rank, flipped)

          const posX = isDragging && drag ? (drag.bx / BOARD_W) * 100 : x
          const posY = isDragging && drag ? (drag.by / BOARD_H) * 100 : y

          const canGrab = !thinking && game.status.state === 'playing' && p.side === game.turn
          const isLanding = game.last_move && game.last_move.to === effectiveSquare && !isDragging

          return (
            <div
              key={p.id}
              className={[
                'piece',
                p.side,
                selected === p.square ? 'is-selected' : '',
                kingInCheck === p.square ? 'is-check' : '',
                victorKing === p.square ? 'is-victor' : '',
                isDragging ? 'dragging' : '',
                canGrab ? 'is-grabbable' : '',
                isLanding ? 'is-landing' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              style={{
                left: `${posX}%`,
                top: `${posY}%`,
              }}
              aria-label={`${p.side === 'red' ? '红' : '黑'}${p.glyph}于 ${effectiveSquare}`}
            >
              <span className="piece-face" key={`face-${p.id}-${effectiveSquare}`}>
                <span className="piece-glyph">{p.glyph}</span>
              </span>
            </div>
          )
        })}

        {/* 棋盘坐标：只在悬停时显形，平时不打扰 */}
        <div className="coord-layer">
          {Array.from({ length: 9 }).map((_, i) => {
            const f = flipped ? 8 - i : i
            const { x } = toPercent(f, 0, flipped)
            return (
              <span key={`f${f}`} className="coord coord-file" style={{ left: `${x}%` }}>
                {String.fromCharCode(97 + f)}
              </span>
            )
          })}
          {Array.from({ length: 10 }).map((_, i) => {
            const r = flipped ? 9 - i : i
            const { y } = toPercent(0, r, flipped)
            return (
              <span key={`r${r}`} className="coord coord-rank" style={{ top: `${y}%` }}>
                {r}
              </span>
            )
          })}
        </div>
      </div>
    </div>
  )
}

/** 棋盘线稿。纯 SVG，缩放到任何尺寸都不糊。 */
const BoardArtwork = memo(function BoardArtwork() {
  const verticals = Array.from({ length: 9 }, (_, i) => i)
  const horizontals = Array.from({ length: 10 }, (_, i) => i)
  const top = toPixel(0, 9, false).y
  const bottom = toPixel(0, 0, false).y
  const riverTop = toPixel(0, 5, false).y
  const riverBottom = toPixel(0, 4, false).y

  return (
    <svg
      className="board-svg"
      viewBox={`0 0 ${BOARD_W} ${BOARD_H}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="boardFace" x1="0" y1="0" x2="0.7" y2="1">
          <stop offset="0%" stopColor="var(--board-face-1)" />
          <stop offset="52%" stopColor="var(--board-face-2)" />
          <stop offset="100%" stopColor="var(--board-face-3)" />
        </linearGradient>
        <radialGradient id="boardVignette" cx="50%" cy="42%" r="78%">
          <stop offset="60%" stopColor="rgba(255,255,255,0)" />
          <stop offset="100%" stopColor="var(--board-vignette)" />
        </radialGradient>
        {/* 上缘受光、下缘落影：让这块板看起来有厚度，不是一张贴纸 */}
        <linearGradient id="boardSheen" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(255,252,244,0.6)" />
          <stop offset="13%" stopColor="rgba(255,252,244,0)" />
          <stop offset="84%" stopColor="rgba(74,52,22,0)" />
          <stop offset="100%" stopColor="rgba(74,52,22,0.18)" />
        </linearGradient>

        {/* 木纹两层：一层宽年轮带，一层细纤维。
            两条噪声都只在首帧算一次，之后浏览器缓存滤波结果；
            BoardArtwork 又用 memo 包住，轮询时的重渲染根本不会碰它。 */}
        <filter id="efWoodBand" x="0%" y="0%" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.0016 0.055" numOctaves="2" seed="7" />
          <feColorMatrix
            type="matrix"
            values="0 0 0 0 0.40
                    0 0 0 0 0.27
                    0 0 0 0 0.12
                    0 0 0 0.55 0"
          />
        </filter>
        <filter id="efWoodFibre" x="0%" y="0%" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.004 0.62" numOctaves="4" seed="23" />
          <feColorMatrix
            type="matrix"
            values="0 0 0 0 0.44
                    0 0 0 0 0.31
                    0 0 0 0 0.15
                    0 0 0 0.9 0"
          />
        </filter>
        {/* 木纹第三层：节疤 / 轮纹同心弧。type=turbulence 的团块被
            alpha 通道阈值化（0.9*(r+g+b)-0.9），只留下稀疏的暗弧，
            打破前两层的均匀噪声感。浓度压得很轻，只是「有方向」。 */}
        <filter id="efWoodKnot" x="0%" y="0%" width="100%" height="100%">
          <feTurbulence type="turbulence" baseFrequency="0.011 0.042" numOctaves="3" seed="41" />
          <feColorMatrix
            type="matrix"
            values="0 0 0 0 0.36
                    0 0 0 0 0.24
                    0 0 0 0 0.10
                    0.9 0.9 0.9 0 -0.95"
          />
        </filter>
      </defs>

      <rect x="0" y="0" width={BOARD_W} height={BOARD_H} rx="16" fill="url(#boardFace)" />
      <rect
        x="0"
        y="0"
        width={BOARD_W}
        height={BOARD_H}
        rx="16"
        filter="url(#efWoodBand)"
        style={{ mixBlendMode: 'multiply' }}
        opacity="0.5"
      />
      <rect
        x="0"
        y="0"
        width={BOARD_W}
        height={BOARD_H}
        rx="16"
        filter="url(#efWoodFibre)"
        style={{ mixBlendMode: 'multiply' }}
        opacity="0.34"
      />
      <rect
        x="0"
        y="0"
        width={BOARD_W}
        height={BOARD_H}
        rx="16"
        filter="url(#efWoodKnot)"
        style={{ mixBlendMode: 'multiply' }}
        opacity="0.2"
      />
      <rect x="0" y="0" width={BOARD_W} height={BOARD_H} rx="16" fill="url(#boardVignette)" />
      <rect x="0" y="0" width={BOARD_W} height={BOARD_H} rx="16" fill="url(#boardSheen)" />
      {/* 板边那道倒角 */}
      <rect
        x="1.25"
        y="1.25"
        width={BOARD_W - 2.5}
        height={BOARD_H - 2.5}
        rx="15"
        fill="none"
        stroke="rgba(109,80,40,0.45)"
        strokeWidth="1.5"
      />

      {/* 外框 */}
      <rect
        x={MARGIN - 22}
        y={MARGIN - 22}
        width={BOARD_W - (MARGIN - 22) * 2}
        height={BOARD_H - (MARGIN - 22) * 2}
        rx="6"
        fill="none"
        stroke="var(--board-line)"
        strokeWidth="3.5"
        opacity="0.85"
      />
      <rect
        x={MARGIN - 14}
        y={MARGIN - 14}
        width={BOARD_W - (MARGIN - 14) * 2}
        height={BOARD_H - (MARGIN - 14) * 2}
        rx="3"
        fill="none"
        stroke="var(--board-line)"
        strokeWidth="1"
        opacity="0.5"
      />

      <g stroke="var(--board-line)" strokeWidth="1.4" strokeLinecap="round">
        {horizontals.map((r) => (
          <line key={`h${r}`} x1={MARGIN} y1={toPixel(0, r, false).y} x2={BOARD_W - MARGIN} y2={toPixel(0, r, false).y} />
        ))}
        {verticals.map((f) => {
          const x = toPixel(f, 0, false).x
          if (f === 0 || f === 8) {
            return <line key={`v${f}`} x1={x} y1={top} x2={x} y2={bottom} />
          }
          return (
            <g key={`v${f}`}>
              <line x1={x} y1={top} x2={x} y2={riverTop} />
              <line x1={x} y1={riverBottom} x2={x} y2={bottom} />
            </g>
          )
        })}
      </g>

      {/* 九宫斜线 */}
      <g stroke="var(--board-line)" strokeWidth="1.2" opacity="0.75">
        {palaceDiagonals().map(([a, b], i) => (
          <line key={`d${i}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
        ))}
      </g>

      {/* 炮兵位角括号 */}
      <g stroke="var(--board-line)" strokeWidth="1.6" strokeLinecap="round" opacity="0.75" fill="none">
        {MARK_POINTS.map(({ file, rank }) => (
          <Marker key={`m${file}-${rank}`} file={file} rank={rank} />
        ))}
      </g>

      {/* 楚河汉界 */}
      <g className="river-text">
        {RIVER_LABELS.map((label, i) => {
          const step = (BOARD_W - MARGIN * 2) / (RIVER_LABELS.length + 1)
          const x = MARGIN + step * (i + 1)
          const y = (riverTop + riverBottom) / 2
          return (
            <text key={label} x={x} y={y} textAnchor="middle" dominantBaseline="central">
              {label}
            </text>
          )
        })}
      </g>
    </svg>
  )
})

function Marker({ file, rank }: { file: number; rank: number }) {
  const { x, y } = toPixel(file, rank, false)
  const gap = 7
  const len = 14
  const left = file > 0
  const right = file < 8
  const paths: string[] = []

  if (left) {
    paths.push(`M${x - gap} ${y - gap - len} L${x - gap} ${y - gap} L${x - gap - len} ${y - gap}`)
    paths.push(`M${x - gap} ${y + gap + len} L${x - gap} ${y + gap} L${x - gap - len} ${y + gap}`)
  }
  if (right) {
    paths.push(`M${x + gap} ${y - gap - len} L${x + gap} ${y - gap} L${x + gap + len} ${y - gap}`)
    paths.push(`M${x + gap} ${y + gap + len} L${x + gap} ${y + gap} L${x + gap + len} ${y + gap}`)
  }

  return (
    <>
      {paths.map((d, i) => (
        <path key={i} d={d} />
      ))}
    </>
  )
}
