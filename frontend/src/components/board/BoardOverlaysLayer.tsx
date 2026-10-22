import type { Side, XiangqiXRay } from '../../types'
import { BOARD_H, BOARD_W, parseSquare, toPercent } from '../../lib/board'

interface BoardHudCaptionProps {
  caption: { badge: string; text: string; tone?: 'bad' | 'good' | 'threat' | 'info' }
}

/** 棋盘顶部战术灵动岛（Dynamic Tactical Island） */
export function BoardHudCaption({ caption }: BoardHudCaptionProps) {
  const tone = caption.tone || 'info'
  const toneClasses =
    tone === 'bad'
      ? 'is-bad bg-rose-50/92 border-rose-400/40 text-rose-900 shadow-rose-500/10'
      : tone === 'good'
        ? 'is-good bg-emerald-50/92 border-emerald-400/40 text-emerald-900 shadow-emerald-500/10'
        : tone === 'threat'
          ? 'is-threat bg-amber-50/92 border-amber-400/40 text-amber-950 shadow-amber-500/10'
          : 'bg-paper-0/92 border-hairline/80 text-ink-0 shadow-black/5'

  const badgeBg =
    tone === 'bad'
      ? 'bg-rose-600 text-white'
      : tone === 'good'
        ? 'bg-emerald-600 text-white'
        : tone === 'threat'
          ? 'bg-amber-500 text-white'
          : 'bg-primary-600 text-white'

  return (
    <div className="absolute top-2.5 left-0 right-0 z-40 pointer-events-none flex justify-center px-4">
      <div
        className={`pointer-events-auto max-w-[92%] backdrop-blur-2xl border px-3.5 py-1.5 rounded-full text-xs font-medium flex items-center gap-2 shadow-lg transition-all duration-300 animate-[islandDrop_320ms_cubic-bezier(0.16,1,0.3,1)_both] ${toneClasses}`}
        title={caption.text}
      >
        <span className={`text-[10.5px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap shrink-0 shadow-2xs ${badgeBg}`}>
          {caption.badge}
        </span>
        <span className="truncate leading-tight font-display tracking-wide">{caption.text}</span>
      </div>
    </div>
  )
}

interface BoardOverlaysLayerProps {
  flipped: boolean
  visualClues?: {
    weakness_squares?: string[]
    key_pieces?: string[]
    route?: string[]
  }
  moveBubble?: { square: string; text: string; tone?: 'bad' | 'good' | 'threat' | 'info' } | null
  xrayOverlay?: XiangqiXRay | null
  ghostMove?: { from: string; to: string; counterMove?: string; pieceGlyph?: string; pieceSide?: Side } | null
}

/** 棋盘覆盖层：包含命门薄弱格、漫画气泡、空间暗线透视（炮架/别马腿/无根子）、What-If 残影与坐标尺 */
export function BoardOverlaysLayer({
  flipped,
  visualClues: _visualClues,
  moveBubble,
  xrayOverlay,
  ghostMove,
}: BoardOverlaysLayerProps) {
  return (
    <>

      {/* 战术关键落点漫画气泡 / 标语 */}
      {moveBubble && (() => {
        const { file, rank } = parseSquare(moveBubble.square)
        const { x, y } = toPercent(file, rank, flipped)
        const tone = moveBubble.tone || 'info'
        const toneBg =
          tone === 'bad'
            ? 'bg-red-600'
            : tone === 'good'
              ? 'bg-emerald-600'
              : tone === 'threat'
                ? 'bg-amber-600'
                : 'bg-blue-600'
        const tailBorder =
          tone === 'bad'
            ? 'border-t-red-600'
            : tone === 'good'
              ? 'border-t-emerald-600'
              : tone === 'threat'
                ? 'border-t-amber-600'
                : 'border-t-blue-600'

        return (
          <div
            className={`board-move-bubble is-${tone} absolute -translate-x-1/2 -translate-y-[128%] z-[38] pointer-events-none animate-[bubblePop_220ms_cubic-bezier(0.175,0.885,0.32,1.275)_both]`}
            style={{ left: `${x}%`, top: `${y}%` }}
          >
            <div className={`bubble-body px-2.5 py-1 rounded-lg text-[11.5px] font-bold whitespace-nowrap shadow-[0_4px_14px_rgba(0,0,0,0.22)] text-white ${toneBg}`}>
              {moveBubble.text}
            </div>
            <div className={`bubble-tail absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-0 h-0 border-l-[6px] border-l-transparent border-r-[6px] border-r-transparent border-t-[6px] ${tailBorder}`} />
          </div>
        )
      })()}

      {/* 空间暗线透视：炮架金环 */}
      {xrayOverlay?.cannon_mounts?.map((m, idx) => {
        const { file: mf, rank: mr } = parseSquare(m.mount_square)
        const mPos = toPercent(mf, mr, flipped)
        return (
          <span
            key={`mount-${m.mount_square}-${idx}`}
            className={[
              'xray-cannon-mount',
              m.is_check ? 'is-check-mount' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            style={{ left: `${mPos.x}%`, top: `${mPos.y}%` }}
            title={`炮架：借【${m.mount_piece}】发炮瞄准【${m.target_piece}】`}
          >
            <span className="mount-ring" />
          </span>
        )
      })}

      {/* 空间暗线透视：别马腿/塞象眼受阻锁 */}
      {xrayOverlay?.blocked_legs?.map((b, idx) => {
        const { file, rank } = parseSquare(b.leg_square)
        const pos = toPercent(file, rank, flipped)
        return (
          <span
            key={`blocked-${b.leg_square}-${idx}`}
            className="xray-blocked-leg"
            style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
            title={`${b.label}：阻挡【${b.piece_square}】攻防路线`}
          >
            <span className="blocked-lock-badge inline-flex items-center justify-center w-5 h-5 rounded-full bg-red-500 text-white text-[11px] shadow-[0_2px_6px_rgba(0,0,0,0.3)] animate-[lockShake_1200ms_infinite_ease-in-out]">
              🔒
            </span>
          </span>
        )
      })}

      {/* 空间暗线透视：无根受攻大子警示 */}
      {xrayOverlay?.hanging_badges?.map((h, idx) => {
        const { file, rank } = parseSquare(h.square)
        const pos = toPercent(file, rank, flipped)
        return (
          <span
            key={`hanging-${h.square}-${idx}`}
            className="xray-hanging-badge"
            style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
            title={`无根大子【${h.piece}】：${h.label}`}
          >
            <span className="hanging-badge-icon inline-flex items-center justify-center w-[22px] h-[22px] rounded-full bg-orange-500 text-white text-[11px] shadow-[0_2px_8px_rgba(249,115,22,0.45)] animate-[badgeBlink_1400ms_infinite]">
              ⚠️
            </span>
          </span>
        )
      })}

      {/* What-If 试探残影与对手反扑路线 */}
      {ghostMove && (() => {
        const fromSq = parseSquare(ghostMove.from)
        const toSq = parseSquare(ghostMove.to)
        const a = toPercent(fromSq.file, fromSq.rank, flipped)
        const b = toPercent(toSq.file, toSq.rank, flipped)
        const dist = Math.hypot(((b.x - a.x) / 100) * BOARD_W, ((b.y - a.y) / 100) * BOARD_H)
        const angle = Math.atan2(((b.y - a.y) / 100) * BOARD_H, ((b.x - a.x) / 100) * BOARD_W)

        let counterElem = null
        if (ghostMove.counterMove && ghostMove.counterMove.length === 4) {
          const cFrom = parseSquare(ghostMove.counterMove.slice(0, 2))
          const cTo = parseSquare(ghostMove.counterMove.slice(2, 4))
          const ca = toPercent(cFrom.file, cFrom.rank, flipped)
          const cb = toPercent(cTo.file, cTo.rank, flipped)
          const cDist = Math.hypot(((cb.x - ca.x) / 100) * BOARD_W, ((cb.y - ca.y) / 100) * BOARD_H)
          const cAngle = Math.atan2(((cb.y - ca.y) / 100) * BOARD_H, ((cb.x - ca.x) / 100) * BOARD_W)
          counterElem = (
            <div
              className="ghost-counter-trace absolute h-[calc(var(--u)*3.5px)] rounded-[2px] origin-[0_50%] bg-gradient-to-r from-red-600/95 to-red-500/15 pointer-events-none z-[13] animate-[counterPulse_800ms_infinite_alternate]"
              style={{
                left: `${ca.x}%`,
                top: `${ca.y}%`,
                width: `${cDist}px`,
                transform: `rotate(${cAngle}rad)`,
              }}
              title="对手当场反击路线"
            />
          )
        }

        return (
          <>
            <div
              className="ghost-move-trace absolute h-[calc(var(--u)*3.2px)] rounded-[2px] origin-[0_50%] bg-gradient-to-r from-blue-600/90 to-blue-500/10 pointer-events-none z-[12]"
              style={{
                left: `${a.x}%`,
                top: `${a.y}%`,
                width: `${dist}px`,
                transform: `rotate(${angle}rad)`,
              }}
            />
            {counterElem}
            <div
              className={`piece piece-ghost absolute pointer-events-none z-[28] opacity-65 drop-shadow-[0_0_8px_rgba(59,130,246,0.6)] animate-[ghostHover_1400ms_infinite_alternate_ease-in-out] ${ghostMove.pieceSide || 'red'}`}
              style={{ left: `${b.x}%`, top: `${b.y}%` }}
            >
              <span className="piece-face relative grid place-items-center w-full h-full rounded-full">
                <span className="piece-glyph relative font-kai font-semibold text-[calc(var(--u)*42px)] leading-none -translate-y-[1%]">
                  {ghostMove.pieceGlyph || '试'}
                </span>
              </span>
            </div>
          </>
        )
      })()}

      {/* 棋盘坐标：只在悬停时显形，平时不打扰 */}
      <div className="coord-layer absolute inset-0 pointer-events-none opacity-0 transition-opacity duration-200 ease-out">
        {Array.from({ length: 9 }).map((_, i) => {
          const f = flipped ? 8 - i : i
          const { x } = toPercent(f, 0, flipped)
          return (
            <span
              key={`f${f}`}
              className="coord coord-file absolute font-num text-[calc(var(--u)*13px)] text-board-line opacity-50 bottom-[calc(var(--u)*7px)] -translate-x-1/2"
              style={{ left: `${x}%` }}
            >
              {String.fromCharCode(97 + f)}
            </span>
          )
        })}
        {Array.from({ length: 10 }).map((_, i) => {
          const r = flipped ? 9 - i : i
          const { y } = toPercent(0, r, flipped)
          return (
            <span
              key={`r${r}`}
              className="coord coord-rank absolute font-num text-[calc(var(--u)*13px)] text-board-line opacity-50 left-[calc(var(--u)*6px)] -translate-y-1/2"
              style={{ top: `${y}%` }}
            >
              {r}
            </span>
          )
        })}
      </div>
    </>
  )
}
