import type { CSSProperties } from 'react'
import type { LastMove, PieceInfo, Side } from '../../types'
import { parseSquare, toPercent, toPixel } from '../../lib/board'
import { BoardPiece, VictimGhostPiece } from './BoardPiece'
import type { DragState, KnockState, Victim } from './types'

interface BoardPiecesLayerProps {
  piecesInOrder: PieceInfo[]
  pendingMove: { id: number; from: string; to: string } | null
  drag: DragState | null
  dragSquare: string | null
  flipped: boolean
  glideMap: Map<number, number>
  booted: boolean
  effectivePicked: string | null
  kingInCheck: string | null
  alarmSquare: string | null
  visualClues?: {
    weakness_squares?: string[]
    key_pieces?: string[]
    route?: string[]
  }
  spotlightSquares?: string[] | null
  victorKing: string | null
  thinking: boolean
  gameState: string
  turn: Side
  setupMode: boolean
  impactId: number | null
  knock: KnockState | null
  standIn: (Victim & { from: string }) | null
  ply: number
  airborne: boolean
  lastMove?: LastMove | null
  activeDots: { sq: string; capture: boolean }[]
  dotsLeaving: boolean
  kbdOn: boolean
  cursor: string | null
  crescentSq: string | null
  crescentLeaving: boolean
}

/** 棋盘核心棋子层：负责棋子、可走点、选中月牙光环、键盘焦点、走步高亮与击飞动效 */
export function BoardPiecesLayer({
  piecesInOrder,
  pendingMove,
  drag,
  dragSquare,
  flipped,
  glideMap,
  booted,
  effectivePicked,
  kingInCheck,
  alarmSquare,
  visualClues,
  spotlightSquares,
  victorKing,
  thinking,
  gameState,
  turn,
  setupMode,
  impactId,
  knock,
  standIn,
  ply,
  airborne,
  lastMove,
  activeDots,
  dotsLeaving,
  kbdOn,
  cursor,
  crescentSq,
  crescentLeaving,
}: BoardPiecesLayerProps) {
  const shownVictim = knock ?? standIn

  return (
    <>
      {/* 可走点位 */}
      {activeDots.map((d, i) => {
        const { file, rank } = parseSquare(d.sq)
        const { x, y } = toPercent(file, rank, flipped)
        return (
          <div
            key={`t${d.sq}`}
            className={[
              'target',
              d.capture ? 'target-capture' : '',
              dragSquare === d.sq ? 'is-over' : '',
              dotsLeaving ? 'is-leaving' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            /* --i：可走点出场的序号，CSS 拿它排 18ms 一档的波次 */
            style={{ left: `${x}%`, top: `${y}%`, '--i': i } as CSSProperties}
            data-target=""
            data-square={d.sq}
            data-over={dragSquare === d.sq ? 'true' : 'false'}
          />
        )
      })}

      {/* 键盘光标：只有按过方向键才出现，鼠标用户无感 */}
      {kbdOn && cursor && (() => {
        const p = parseSquare(cursor)
        const { x, y } = toPixel(p.file, p.rank, flipped)
        return (
          <span
            className="kbd-cursor"
            data-kbd-cursor=""
            data-cursor={cursor}
            style={{ '--cx': `${x}px`, '--cy': `${y}px` } as CSSProperties}
          />
        )
      })()}

      {/* 选中棋子周围的清透月牙高光圆环 */}
      {crescentSq && (() => {
        const { file, rank } = parseSquare(crescentSq)
        const { x, y } = toPercent(file, rank, flipped)
        return (
          <span
            key={`selected-crescent-${crescentSq}`}
            className={`selected-crescent-ring${crescentLeaving ? ' is-leaving' : ''}`}
            style={{
              left: `${x}%`,
              top: `${y}%`,
            }}
            data-crescent=""
            aria-hidden="true"
          >
            <svg viewBox="0 0 100 100" className="crescent-svg" aria-hidden="true">
              <defs>
                <linearGradient id="crescentGrad" x1="0%" y1="0%" x2="0%" y2="1">
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
              {/* 顶部高亮月牙弧光：鲜明的顶光高光弧 */}
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

      {/* 上一步的起点：一走就标，不必等落定 */}
      {!setupMode && lastMove && (
        <span
          key={`from-${ply}-${lastMove.from}`}
          className="last-marker last-from"
          style={{
            left: `${toPercent(parseSquare(lastMove.from).file, parseSquare(lastMove.from).rank, flipped).x}%`,
            top: `${toPercent(parseSquare(lastMove.from).file, parseSquare(lastMove.from).rank, flipped).y}%`,
          }}
        />
      )}

      {/* 落点框：排在落点那一拍显形（airborne 期间压住） */}
      {!setupMode && lastMove && !airborne && (
        <span
          key={`to-${ply}-${lastMove.to}`}
          className={`last-marker last-to last-to-${lastMove.by}${
            lastMove.captured ? ' last-to-capture' : ''
          }`}
          style={{
            left: `${toPercent(parseSquare(lastMove.to).file, parseSquare(lastMove.to).rank, flipped).x}%`,
            top: `${toPercent(parseSquare(lastMove.to).file, parseSquare(lastMove.to).rank, flipped).y}%`,
          }}
        >
          <span className="last-to-rotator" aria-hidden="true">
            <svg className="last-to-spinner" viewBox="0 0 100 100" aria-hidden="true">
              <circle className="spinner-halo" cx="50" cy="50" r="43" />
              <circle className="spinner-arcs" cx="50" cy="50" r="43" />
            </svg>
          </span>
        </span>
      )}

      {/* 落点上那颗被吃子：替身（standIn）与被撞飞残影（knock） */}
      {!setupMode && shownVictim && (
        <VictimGhostPiece
          shown={shownVictim}
          knock={knock}
          ply={ply}
          flipped={flipped}
        />
      )}

      {/* 棋子群：纯净位移，按稳固 id 排序 */}
      {piecesInOrder.map((p) => {
        const doomed =
          !!pendingMove && p.id !== pendingMove.id && p.square === pendingMove.to
        const isDragging = drag?.from === p.square
        const effectiveSquare =
          pendingMove && p.id === pendingMove.id ? pendingMove.to : p.square
        const { file, rank } = parseSquare(effectiveSquare)
        const center = toPixel(file, rank, flipped)
        const cx = isDragging && drag ? drag.bx : center.x
        const cy = isDragging && drag ? drag.by : center.y
        const wait = glideMap.get(p.id) ?? 0

        const displayRow = flipped ? rank : 9 - rank
        const enterDelay = booted ? 0 : displayRow * 44 + file * 4

        const canGrab =
          setupMode || (!thinking && gameState === 'playing' && p.side === turn)

        const isSpotlighted =
          !spotlightSquares || spotlightSquares.length === 0 || spotlightSquares.includes(effectiveSquare)

        return (
          <BoardPiece
            key={p.id}
            piece={p}
            effectiveSquare={effectiveSquare}
            cx={cx}
            cy={cy}
            wait={wait}
            enterDelay={enterDelay}
            booted={booted}
            isSelected={effectivePicked === p.square}
            isKingInCheck={kingInCheck === p.square}
            isAlarm={alarmSquare === p.square}
            isMasterKey={!!visualClues?.key_pieces?.includes(effectiveSquare)}
            isMasterWeakness={!!visualClues?.weakness_squares?.includes(effectiveSquare)}
            isSpotlighted={isSpotlighted}
            isVictor={victorKing === p.square}
            isDragging={isDragging}
            canGrab={canGrab}
            isDoomed={doomed}
            isImpact={impactId === p.id}
            isCaptureImpact={!!knock}
          />
        )
      })}
    </>
  )
}
