import type { PieceInfo, Side } from '../types'
import { COLS, ROWS, parseSquare, squareAt } from './board'

export interface SetupPieceSpec {
  char: string
  name: string
  glyph: string
  side: Side
  maxCount: number
}

export const PIECE_SPECS: Record<string, SetupPieceSpec> = {
  // 红方 (大写)
  K: { char: 'K', name: '帅', glyph: '帅', side: 'red', maxCount: 1 },
  A: { char: 'A', name: '仕', glyph: '仕', side: 'red', maxCount: 2 },
  B: { char: 'B', name: '相', glyph: '相', side: 'red', maxCount: 2 },
  N: { char: 'N', name: '傌', glyph: '傌', side: 'red', maxCount: 2 },
  R: { char: 'R', name: '俥', glyph: '俥', side: 'red', maxCount: 2 },
  C: { char: 'C', name: '砲', glyph: '砲', side: 'red', maxCount: 2 },
  P: { char: 'P', name: '兵', glyph: '兵', side: 'red', maxCount: 5 },

  // 黑方 (小写)
  k: { char: 'k', name: '将', glyph: '将', side: 'black', maxCount: 1 },
  a: { char: 'a', name: '士', glyph: '士', side: 'black', maxCount: 2 },
  b: { char: 'b', name: '象', glyph: '象', side: 'black', maxCount: 2 },
  n: { char: 'n', name: '馬', glyph: '馬', side: 'black', maxCount: 2 },
  r: { char: 'r', name: '車', glyph: '車', side: 'black', maxCount: 2 },
  c: { char: 'c', name: '砲', glyph: '砲', side: 'black', maxCount: 2 },
  p: { char: 'p', name: '卒', glyph: '卒', side: 'black', maxCount: 5 },
}

export const RED_PIECES = ['K', 'A', 'B', 'N', 'R', 'C', 'P'] as const
export const BLACK_PIECES = ['k', 'a', 'b', 'n', 'r', 'c', 'p'] as const

export const INITIAL_FEN = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1'

/**
 * 盘面 Map: 逻辑坐标 square (如 'a0') -> piece char ('R', 'k', etc.)
 */
export type BoardMap = Record<string, string>

export function piecesToBoardMap(pieces: PieceInfo[]): BoardMap {
  const map: BoardMap = {}
  for (const p of pieces) {
    if (p.square && p.char) {
      map[p.square] = p.char
    }
  }
  return map
}

let setupIdCounter = 1000

export function boardMapToPieces(map: BoardMap): PieceInfo[] {
  const pieces: PieceInfo[] = []
  for (let r = 0; r < ROWS; r++) {
    for (let f = 0; f < COLS; f++) {
      const sq = squareAt(f, r)
      const ch = map[sq]
      if (ch && PIECE_SPECS[ch]) {
        const spec = PIECE_SPECS[ch]
        pieces.push({
          id: ++setupIdCounter,
          square: sq,
          index: r * 16 + f,
          char: ch,
          side: spec.side,
          piece: spec.name,
          glyph: spec.glyph,
          file: f,
          rank: r,
        })
      }
    }
  }
  return pieces
}

/** 计算当前盘面上未摆放的剩余棋子数量 */
export function getRemainingCounts(map: BoardMap): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const ch of Object.keys(PIECE_SPECS)) {
    counts[ch] = PIECE_SPECS[ch].maxCount
  }
  for (const ch of Object.values(map)) {
    if (ch && counts[ch] !== undefined) {
      counts[ch] = Math.max(0, counts[ch] - 1)
    }
  }
  return counts
}

/** 盘面转标准 FEN 字符串 */
export function boardMapToFen(
  map: BoardMap,
  turn: 'red' | 'black',
  halfmove = 0,
  fullmove = 1,
): string {
  const rows: string[] = []
  for (let r = ROWS - 1; r >= 0; r--) {
    let row = ''
    let empty = 0
    for (let f = 0; f < COLS; f++) {
      const sq = squareAt(f, r)
      const ch = map[sq]
      if (!ch) {
        empty++
      } else {
        if (empty > 0) {
          row += String(empty)
          empty = 0
        }
        row += ch
      }
    }
    if (empty > 0) {
      row += String(empty)
    }
    rows.push(row)
  }
  const sideChar = turn === 'red' ? 'w' : 'b'
  return `${rows.join('/')} ${sideChar} - - ${halfmove} ${fullmove}`
}

/** 解析 FEN 字符串到 BoardMap 和先手方 */
export function fenToBoardMap(
  fen: string,
): { map: BoardMap; turn: 'red' | 'black'; error?: string } | null {
  const parts = fen.trim().split(/\s+/)
  if (!parts[0]) return null
  const rows = parts[0].split('/')
  if (rows.length !== ROWS) {
    return { map: {}, turn: 'red', error: `FEN 格式错误：行数应为 ${ROWS}，实际为 ${rows.length}` }
  }

  const map: BoardMap = {}
  for (let r = 0; r < ROWS; r++) {
    const rank = ROWS - 1 - r // 第 0 行是 rank 9 (黑方底线)
    let f = 0
    const rowStr = rows[r]
    for (const ch of rowStr) {
      if (ch >= '1' && ch <= '9') {
        f += parseInt(ch, 10)
      } else if (PIECE_SPECS[ch]) {
        if (f < COLS) {
          map[squareAt(f, rank)] = ch
          f++
        } else {
          return { map: {}, turn: 'red', error: `FEN 第 ${r + 1} 行超出 9 列` }
        }
      } else {
        return { map: {}, turn: 'red', error: `无法识别的棋子字符：${ch}` }
      }
    }
    if (f !== COLS) {
      return { map: {}, turn: 'red', error: `FEN 第 ${r + 1} 行列数不匹配（应为 9 列）` }
    }
  }

  const turn: 'red' | 'black' = parts[1]?.toLowerCase() === 'b' ? 'black' : 'red'
  return { map, turn }
}

/**
 * 九宫格区域与特殊棋子合法点定义
 */
const RED_ADVISOR_SQUARES = new Set(['d0', 'f0', 'e1', 'd2', 'f2'])
const BLACK_ADVISOR_SQUARES = new Set(['d9', 'f9', 'e8', 'd7', 'f7'])

const RED_BISHOP_SQUARES = new Set(['c0', 'g0', 'a2', 'e2', 'i2', 'c4', 'g4'])
const BLACK_BISHOP_SQUARES = new Set(['c9', 'g9', 'a7', 'e7', 'i7', 'c5', 'g5'])

/** 判断某一方的将/帅是否正在被攻击 (将死/将军判定辅助) */
function isKingCheckedBy(
  kingSq: string,
  attackerSide: Side,
  map: BoardMap,
): boolean {
  const { file: kf, rank: kr } = parseSquare(kingSq)

  // 1. 直线检查：车 (R/r) 和 炮 (C/c)
  const straightDirs = [
    [0, 1],
    [0, -1],
    [1, 0],
    [-1, 0],
  ]

  for (const [df, dr] of straightDirs) {
    let f = kf + df
    let r = kr + dr
    let screenCount = 0

    while (f >= 0 && f < COLS && r >= 0 && r < ROWS) {
      const sq = squareAt(f, r)
      const ch = map[sq]
      if (ch) {
        const spec = PIECE_SPECS[ch]
        if (screenCount === 0) {
          // 无遮挡：车直接将军，或敌方老将直接照面
          if (spec.side === attackerSide) {
            if (ch.toUpperCase() === 'R') return true
            if (ch.toUpperCase() === 'K') return true // 对将视同攻击
          }
          screenCount++
        } else if (screenCount === 1) {
          // 有一个炮架：炮将军
          if (spec.side === attackerSide && ch.toUpperCase() === 'C') {
            return true
          }
          break // 超过 1 个遮挡物，直线后续不可能再将军
        }
      }
      f += df
      r += dr
    }
  }

  // 2. 马 (N/n) 检查（注意马腿）
  const knightMoves = [
    { df: 1, dr: 2, legF: 0, legR: 1 },
    { df: -1, dr: 2, legF: 0, legR: 1 },
    { df: 1, dr: -2, legF: 0, legR: -1 },
    { df: -1, dr: -2, legF: 0, legR: -1 },
    { df: 2, dr: 1, legF: 1, legR: 0 },
    { df: 2, dr: -1, legF: 1, legR: 0 },
    { df: -2, dr: 1, legF: -1, legR: 0 },
    { df: -2, dr: -1, legF: -1, legR: 0 },
  ]

  for (const km of knightMoves) {
    const nf = kf + km.df
    const nr = kr + km.dr
    if (nf >= 0 && nf < COLS && nr >= 0 && nr < ROWS) {
      const legF = kf + km.legF
      const legR = kr + km.legR
      // 马腿处不能有棋子
      if (!map[squareAt(legF, legR)]) {
        const ch = map[squareAt(nf, nr)]
        if (ch && PIECE_SPECS[ch].side === attackerSide && ch.toUpperCase() === 'N') {
          return true
        }
      }
    }
  }

  // 3. 兵/卒 (P/p) 检查
  // 红兵只能由下往上攻击，黑卒只能由上往下攻击
  if (attackerSide === 'red') {
    // 红兵向北进攻（kr - 1 位直冲，或 kr 位的左右横击）
    // 从红兵位置看：红兵在 (kf, kr - 1)，或 (kf - 1, kr), (kf + 1, kr)
    const pawnChecks = [
      { f: kf, r: kr - 1 },
      { f: kf - 1, r: kr },
      { f: kf + 1, r: kr },
    ]
    for (const pos of pawnChecks) {
      if (pos.f >= 0 && pos.f < COLS && pos.r >= 0 && pos.r < ROWS) {
        const ch = map[squareAt(pos.f, pos.r)]
        if (ch === 'P') {
          // 只有过了河（r >= 5）才能横击，但若它在 (kf, kr-1) 则任何过不过河直冲都算
          if (pos.r === kr - 1 || pos.r >= 5) {
            return true
          }
        }
      }
    }
  } else {
    // 黑卒向南进攻（kr + 1 位直冲，或 kr 位的左右横击）
    const pawnChecks = [
      { f: kf, r: kr + 1 },
      { f: kf - 1, r: kr },
      { f: kf + 1, r: kr },
    ]
    for (const pos of pawnChecks) {
      if (pos.f >= 0 && pos.f < COLS && pos.r >= 0 && pos.r < ROWS) {
        const ch = map[squareAt(pos.f, pos.r)]
        if (ch === 'p') {
          if (pos.r === kr + 1 || pos.r <= 4) {
            return true
          }
        }
      }
    }
  }

  return false
}

export interface ValidationResult {
  valid: boolean
  errors: string[]
}

/**
 * 全面校验排局盘面是否合规
 */
export function validateSetupBoard(
  map: BoardMap,
  turn: 'red' | 'black',
): ValidationResult {
  const errors: string[] = []

  // 1. 棋子数量与统计
  const counts: Record<string, number> = {}
  for (const ch of Object.keys(PIECE_SPECS)) {
    counts[ch] = 0
  }

  let redKingSq: string | null = null
  let blackKingSq: string | null = null

  for (let r = 0; r < ROWS; r++) {
    for (let f = 0; f < COLS; f++) {
      const sq = squareAt(f, r)
      const ch = map[sq]
      if (!ch) continue
      if (!PIECE_SPECS[ch]) {
        errors.push(`位置 ${sq} 存在未知棋子：${ch}`)
        continue
      }
      counts[ch] = (counts[ch] || 0) + 1

      if (ch === 'K') redKingSq = sq
      if (ch === 'k') blackKingSq = sq

      // 仕/士九宫检查
      if (ch === 'A' && !RED_ADVISOR_SQUARES.has(sq)) {
        errors.push(`红仕 (${sq}) 必须在九宫指定斜线位（d0, f0, e1, d2, f2）`)
      }
      if (ch === 'a' && !BLACK_ADVISOR_SQUARES.has(sq)) {
        errors.push(`黑士 (${sq}) 必须在九宫指定斜线位（d9, f9, e8, d7, f7）`)
      }

      // 相/象区域与田字格检查
      if (ch === 'B' && !RED_BISHOP_SQUARES.has(sq)) {
        errors.push(`红相 (${sq}) 不可过河且必须在合法的田字格位`)
      }
      if (ch === 'b' && !BLACK_BISHOP_SQUARES.has(sq)) {
        errors.push(`黑象 (${sq}) 不可过河且必须在合法的田字格位`)
      }

      // 兵/卒未过河前横移与后退检查
      if (ch === 'P') {
        if (r < 3) {
          errors.push(`红兵 (${sq}) 不可出现在己方兵线后方（0-2 行）`)
        } else if (r === 3 && f % 2 !== 0) {
          errors.push(`红兵 (${sq}) 未过河前不可横移`)
        } else if (r === 4 && f % 2 !== 0) {
          errors.push(`红兵 (${sq}) 未过河前不可横移`)
        }
      }
      if (ch === 'p') {
        if (r > 6) {
          errors.push(`黑卒 (${sq}) 不可出现在己方卒线后方（7-9 行）`)
        } else if (r === 6 && f % 2 !== 0) {
          errors.push(`黑卒 (${sq}) 未过河前不可横移`)
        } else if (r === 5 && f % 2 !== 0) {
          errors.push(`黑卒 (${sq}) 未过河前不可横移`)
        }
      }
    }
  }

  // 数量超限检查
  for (const [ch, spec] of Object.entries(PIECE_SPECS)) {
    const cur = counts[ch] || 0
    if (cur > spec.maxCount) {
      errors.push(`${spec.name} 数量超出上限（当前 ${cur} 枚，最多 ${spec.maxCount} 枚）`)
    }
  }

  // 帅/将存在性检查
  if (counts['K'] === 0) {
    errors.push('缺少红帅（双方必须各有且仅有 1 个帅/将）')
  }
  if (counts['k'] === 0) {
    errors.push('缺少黑将（双方必须各有且仅有 1 个帅/将）')
  }

  // 帅/将九宫检查
  if (redKingSq) {
    const { file, rank } = parseSquare(redKingSq)
    if (file < 3 || file > 5 || rank < 0 || rank > 2) {
      errors.push(`红帅 (${redKingSq}) 必须在九宫之内（d0-f2）`)
    }
  }
  if (blackKingSq) {
    const { file, rank } = parseSquare(blackKingSq)
    if (file < 3 || file > 5 || rank < 7 || rank > 9) {
      errors.push(`黑将 (${blackKingSq}) 必须在九宫之内（d7-f9）`)
    }
  }

  // 双帅照面（王不见王）检查
  if (redKingSq && blackKingSq) {
    const pRed = parseSquare(redKingSq)
    const pBlack = parseSquare(blackKingSq)
    if (pRed.file === pBlack.file) {
      let blocked = false
      for (let r = pRed.rank + 1; r < pBlack.rank; r++) {
        if (map[squareAt(pRed.file, r)]) {
          blocked = true
          break
        }
      }
      if (!blocked) {
        errors.push('帅将不可直接对射照面（王不见王）')
      }
    }
  }

  // 检查非走棋方是否处于受将状态
  // 若红方走棋 (turn === 'red')，黑将绝不能正被红方将军（否则上一手黑方没应将是非法走法）
  if (redKingSq && blackKingSq) {
    if (turn === 'red' && isKingCheckedBy(blackKingSq, 'red', map)) {
      errors.push('黑将正处于被将军状态，轮次不合法（不能由红方接着走）')
    } else if (turn === 'black' && isKingCheckedBy(redKingSq, 'black', map)) {
      errors.push('红帅正处于被将军状态，轮次不合法（不能由黑方接着走）')
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}
