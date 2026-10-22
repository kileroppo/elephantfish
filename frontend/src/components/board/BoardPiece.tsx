import type { CSSProperties } from 'react'
import type { PieceInfo } from '../../types'
import { parseSquare, toPixel } from '../../lib/board'
import type { KnockState, Victim } from './types'

export interface BoardPieceProps {
  piece: PieceInfo
  effectiveSquare: string
  cx: number
  cy: number
  wait: number
  enterDelay: number
  booted: boolean
  isSelected: boolean
  isKingInCheck: boolean
  isAlarm: boolean
  isMasterKey: boolean
  isMasterWeakness: boolean
  isSpotlighted: boolean
  isVictor: boolean
  isDragging: boolean
  canGrab: boolean
  isDoomed: boolean
  isImpact: boolean
  isCaptureImpact: boolean
}

/** 单个象棋棋子渲染：支持位移滑行、抬起选中、受光环、将军光晕等动效 */
export function BoardPiece({
  piece: p,
  effectiveSquare,
  cx,
  cy,
  wait,
  enterDelay,
  booted,
  isSelected,
  isKingInCheck,
  isAlarm,
  isMasterKey,
  isMasterWeakness,
  isSpotlighted,
  isVictor,
  isDragging,
  canGrab,
  isDoomed,
  isImpact,
  isCaptureImpact,
}: BoardPieceProps) {
  return (
    <div
      className={[
        'piece',
        'absolute left-0 top-0 w-[calc(var(--u)*66px)] h-[calc(var(--u)*66px)] z-20 will-change-transform',
        p.side === 'red' ? 'red text-piece-red' : 'black text-piece-black',
        isSelected ? 'is-selected z-[45]' : '',
        isKingInCheck ? 'is-check' : '',
        isAlarm ? 'is-check-alarm' : '',
        isMasterKey ? 'is-master-key' : '',
        isMasterWeakness ? 'is-master-weakness' : '',
        !isSpotlighted ? 'is-spotlight-dimmed opacity-25 grayscale-[0.7]' : '',
        isVictor ? 'is-victor' : '',
        isDragging ? 'dragging z-[60] cursor-grabbing' : '',
        canGrab ? 'is-grabbable cursor-grab touch-none' : '',
        isDoomed ? 'is-doomed z-[19] pointer-events-none opacity-[0.88]' : '',
        wait > 0 ? 'is-gliding z-[25]' : '',
        isImpact ? (isCaptureImpact ? 'is-impact is-capture-impact' : 'is-impact') : '',
        enterDelay > 0 || !booted ? 'is-entering' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={
        {
          '--cx': `${cx}px`,
          '--cy': `${cy}px`,
          '--glide-dur': `${wait}ms`,
          '--enter-delay': `${enterDelay}ms`,
        } as CSSProperties
      }
      aria-label={`${p.side === 'red' ? '红' : '黑'}${p.glyph}于 ${effectiveSquare}`}
      data-piece={p.piece}
      data-side={p.side}
      data-square={effectiveSquare}
      data-selected={isSelected ? 'true' : 'false'}
      data-dragging={isDragging ? 'true' : 'false'}
    >
      <span className="piece-face relative grid place-items-center w-full h-full rounded-full transition-transform duration-140">
        <span className="piece-glyph relative font-kai font-semibold text-[calc(var(--u)*42px)] leading-none -translate-y-[1%]">
          {p.glyph}
        </span>
      </span>
    </div>
  )
}

export interface VictimGhostPieceProps {
  shown: (Victim & { from: string }) | KnockState
  knock: KnockState | null
  ply: number
  flipped: boolean
}

/** 落点上被吃子的替身（standIn）与被撞飞残影（knockback） */
export function VictimGhostPiece({ shown, knock, ply, flipped }: VictimGhostPieceProps) {
  const { file, rank } = parseSquare(shown.square)
  const from = parseSquare(shown.from)
  const { x, y } = toPixel(file, rank, flipped)
  const df = file - from.file
  const dr = rank - from.rank
  const dist = Math.hypot(df, dr) || 1

  return (
    <div
      key={`${knock ? 'knock' : 'stand'}-${shown.square}-${ply}`}
      className={[
        'piece',
        'absolute left-0 top-0 w-[calc(var(--u)*66px)] h-[calc(var(--u)*66px)]',
        shown.side === 'red' ? 'red text-piece-red' : 'black text-piece-black',
        knock
          ? 'piece-ghost-knockback z-[18] pointer-events-none'
          : 'is-doomed z-[19] pointer-events-none opacity-[0.88]',
      ].join(' ')}
      style={
        {
          '--cx': `${x}px`,
          '--cy': `${y}px`,
          '--kx': df / dist,
          '--ky': (flipped ? dr : -dr) / dist,
          '--kr': `${'kr' in shown ? shown.kr : 0}deg`,
        } as CSSProperties
      }
      aria-hidden="true"
    >
      <span className="piece-face relative grid place-items-center w-full h-full rounded-full">
        <span className="piece-glyph relative font-kai font-semibold text-[calc(var(--u)*42px)] leading-none -translate-y-[1%]">
          {shown.glyph}
        </span>
      </span>
      {knock && (
        <>
          <span className="capture-burst-ring absolute -inset-[12%] rounded-full pointer-events-none z-10" aria-hidden="true" />
          <span className="capture-spark-burst absolute inset-[10%] rounded-full pointer-events-none z-[9]" aria-hidden="true" />
        </>
      )}
    </div>
  )
}
