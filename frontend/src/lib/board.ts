/**
 * 棋盘几何。
 *
 * 一套坐标到底：外部永远用「文件 a-i + 行 0-9」说话（row 0 = 红方底线），
 * 只在渲染前一刻才换算成像素。视角翻转也只在换算这一步发生，
 * 这样上层逻辑完全不需要关心棋盘有没有倒过来。
 */

export const MARGIN = 40
export const CELL = 80
export const COLS = 9
export const ROWS = 10
export const BOARD_W = MARGIN * 2 + CELL * (COLS - 1) // 720
export const BOARD_H = MARGIN * 2 + CELL * (ROWS - 1) // 800

export interface Pt {
  x: number
  y: number
}

/** 逻辑坐标（file, rank）-> 棋盘像素坐标，已考虑视角翻转。 */
export function toPixel(file: number, rank: number, flipped: boolean): Pt {
  const f = flipped ? COLS - 1 - file : file
  const r = flipped ? ROWS - 1 - rank : rank
  return {
    x: MARGIN + f * CELL,
    y: MARGIN + (ROWS - 1 - r) * CELL,
  }
}

/** 同上，但返回百分比，方便用 CSS 绝对定位。 */
export function toPercent(file: number, rank: number, flipped: boolean): Pt {
  const p = toPixel(file, rank, flipped)
  return { x: (p.x / BOARD_W) * 100, y: (p.y / BOARD_H) * 100 }
}

export function parseSquare(square: string): { file: number; rank: number } {
  return {
    file: square.charCodeAt(0) - 97,
    rank: Number(square.slice(1)),
  }
}

export function squareAt(file: number, rank: number): string {
  return String.fromCharCode(97 + file) + rank
}

/** 像素坐标反查格子；落在棋盘外返回 null。 */
export function pixelToSquare(
  x: number,
  y: number,
  flipped: boolean,
): { file: number; rank: number } | null {
  let f = Math.round((x - MARGIN) / CELL)
  let r = ROWS - 1 - Math.round((y - MARGIN) / CELL)
  if (f < 0 || f >= COLS || r < 0 || r >= ROWS) return null
  if (flipped) {
    f = COLS - 1 - f
    r = ROWS - 1 - r
  }
  return { file: f, rank: r }
}

/** 红线（河界）在像素上的上下沿。 */
export const RIVER_TOP = toPixel(0, 5, false).y
export const RIVER_BOTTOM = toPixel(0, 4, false).y

/** 九宫斜线的四个端点（红方在下、黑方在上）。 */
export function palaceDiagonals(): [Pt, Pt][] {
  const a = toPixel(3, 0, false)
  const b = toPixel(5, 2, false)
  const c = toPixel(5, 0, false)
  const d = toPixel(3, 2, false)
  const e = toPixel(3, 7, false)
  const f = toPixel(5, 9, false)
  const g = toPixel(5, 7, false)
  const h = toPixel(3, 9, false)
  return [
    [a, b],
    [c, d],
    [e, f],
    [g, h],
  ]
}

/** 炮位与兵位上的传统「角括号」标记。 */
export const MARK_POINTS: { file: number; rank: number }[] = [
  // 炮位
  { file: 1, rank: 2 },
  { file: 7, rank: 2 },
  { file: 1, rank: 7 },
  { file: 7, rank: 7 },
  // 兵位
  { file: 0, rank: 3 },
  { file: 2, rank: 3 },
  { file: 4, rank: 3 },
  { file: 6, rank: 3 },
  { file: 8, rank: 3 },
  { file: 0, rank: 6 },
  { file: 2, rank: 6 },
  { file: 4, rank: 6 },
  { file: 6, rank: 6 },
  { file: 8, rank: 6 },
]

/** 楚河汉界的四个字，横向均分在河界带里。 */
export const RIVER_LABELS = ['楚', '河', '汉', '界']
