import { memo } from 'react'
import {
  BOARD_H,
  BOARD_W,
  MARGIN,
  MARK_POINTS,
  RIVER_LABELS,
  palaceDiagonals,
  toPixel,
} from '../../lib/board'

interface BoardArtworkProps {
  flipped?: boolean
}

/** 棋盘线稿。纯 SVG，缩放到任何尺寸都不糊。 */
export const BoardArtwork = memo(function BoardArtwork({ flipped = false }: BoardArtworkProps) {
  const verticals = Array.from({ length: 9 }, (_, i) => i)
  const horizontals = Array.from({ length: 10 }, (_, i) => i)
  const top = toPixel(0, 9, false).y
  const bottom = toPixel(0, 0, false).y
  const riverTop = toPixel(0, 5, false).y
  const riverBottom = toPixel(0, 4, false).y

  // 路数文字：未翻转时下红上黑；翻转时下黑上红
  const redDigits = ['九', '八', '七', '六', '五', '四', '三', '二', '一']
  const blackDigits = ['1', '2', '3', '4', '5', '6', '7', '8', '9']

  const bottomLabels = flipped ? [...blackDigits].reverse() : redDigits
  const topLabels = flipped ? [...redDigits].reverse() : blackDigits

  return (
    <svg
      className="board-svg absolute inset-0 block w-full h-full pointer-events-none"
      viewBox={`0 0 ${BOARD_W} ${BOARD_H}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {/* 宣纸：纯色一张，不再有木纹、渐变、晕影和倒角 */}
      <rect x="0" y="0" width={BOARD_W} height={BOARD_H} rx="4" fill="var(--board-face-1)" />

      {/* 外框：一道细线，棋盘的全部「装饰」 */}
      <rect
        x={MARGIN - 18}
        y={MARGIN - 18}
        width={BOARD_W - (MARGIN - 18) * 2}
        height={BOARD_H - (MARGIN - 18) * 2}
        fill="none"
        stroke="var(--board-line)"
        strokeWidth="2.2"
      />

      {/* 顶部与底部专业路数刻度标记 (1~9 / 九~一) */}
      <g className="rank-numbers font-kai fill-[var(--board-line)] select-none opacity-40 text-[11px]">
        {verticals.map((f, i) => {
          const x = toPixel(f, 0, false).x
          return (
            <g key={`num-${f}`}>
              <text x={x} y={MARGIN - 7} textAnchor="middle" dominantBaseline="central">
                {topLabels[i]}
              </text>
              <text x={x} y={BOARD_H - MARGIN + 7} textAnchor="middle" dominantBaseline="central">
                {bottomLabels[i]}
              </text>
            </g>
          )
        })}
      </g>

      <g stroke="var(--board-line)" strokeWidth="1.4" strokeLinecap="round">
        {horizontals.map((r) => (
          <line
            key={`h${r}`}
            x1={MARGIN}
            y1={toPixel(0, r, false).y}
            x2={BOARD_W - MARGIN}
            y2={toPixel(0, r, false).y}
          />
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
      <g className="river-text font-kai fill-[var(--board-line)] opacity-60">
        {RIVER_LABELS.map((label, i) => {
          const step = (BOARD_W - MARGIN * 2) / (RIVER_LABELS.length + 1)
          const x = MARGIN + step * (i + 1)
          const y = (riverTop + riverBottom) / 2
          return (
            <text
              key={label}
              x={x}
              y={y}
              textAnchor="middle"
              dominantBaseline="central"
              className="text-[36px] tracking-[12px]"
            >
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
