import type { ValidationResult } from '../../lib/setup'
import type { GameSnapshot, PieceInfo, Side, XiangqiXRay } from '../../types'

/** 正在被拖拽的一颗子。bx/by 是棋盘坐标系里的像素位置，
 *  渲染时直接写进 --cx/--cy，所以不需要在渲染期读 getBoundingClientRect。 */
export interface DragState {
  from: string
  bx: number
  by: number
}

/** 落点上那颗「已被服务端摘掉、画面还没让它倒」的被吃子。 */
export interface Victim {
  square: string
  glyph: string
  side: Side
}

/** 同上，再加撞飞这一下需要的两个量：从哪来（决定方向），翻几个身。 */
export interface KnockSeed extends Victim {
  from: string
}

export interface KnockState extends KnockSeed {
  kr: number
}

export interface BoardProps {
  game: GameSnapshot
  flipped: boolean
  thinking: boolean
  /** 主变（ICCS）：在盘面上淡淡地铺一条「引擎打算这么走」的虚线 */
  pv?: string[]
  /** 落子唯一的出口。走哪一步算一步由 Board 自己认，上层只收 ICCS。
   *  要回一个「收没收」：false 表示这一步没被接受，Board 得立刻把本地预判撤回来。 */
  onMove: (iccs: string) => Promise<boolean>
  /** 补棋 / 自定义排局模式 */
  setupMode?: boolean
  setupPieces?: PieceInfo[]
  selectedTrayPiece?: string | null
  pickedBoardSquare?: string | null
  onSetupSquareTap?: (square: string) => void
  onSetupPieceMove?: (from: string, to: string) => void
  onSetupPieceRemove?: (square: string) => void
  onSetupPickBoardSquare?: (square: string | null) => void
  onSetupPieceDropFromTray?: (char: string, square: string) => void
  onPoofTriggered?: (clientX: number, clientY: number) => void
  setupValidation?: ValidationResult | null
  /** 正在翻转视角（「收窄 → 换 → 展开」这一段的头尾）。见 App 里的 turnBoard。 */
  flipping?: boolean
  /**
   * 只读：复盘台用它。盘上的子一颗都不许抓、一点都不许点 —— 回放那一局不是
   * 再走一局。这道闸门写在这里而不是靠「传一副没有合法着法的快照」间接实现：
   * 后者一旦有人给快照补上 `legal_moves`，回放盘就又能动棋了，而那正是这件事
   * 最不该发生的形式。
   */
  readOnly?: boolean
  /** 师门传功三阶视觉点拨：薄弱格高亮、核心主攻子、主变行棋轨迹 */
  visualClues?: {
    weakness_squares?: string[]
    key_pieces?: string[]
    route?: string[]
  }
  /** 棋盘顶部动态 HUD 战况字幕条（Phase 1） */
  boardCaption?: { badge: string; text: string; tone?: 'bad' | 'good' | 'threat' | 'info' } | null
  /** 战术关键落点漫画气泡 / 标语（Phase 1） */
  moveBubble?: { square: string; text: string; tone?: 'bad' | 'good' | 'threat' | 'info' } | null
  /** 中国象棋专属空间暗线透视（炮架/别马腿/无根子）（Phase 1） */
  xrayOverlay?: XiangqiXRay | null
  /** 核心战区战术聚光灯：仅高亮关键子力，其余子力降噪半透明（Phase 1） */
  spotlightSquares?: string[] | null
  /** What-If 走前试探残影与对手反击路线（Phase 2） */
  ghostMove?: { from: string; to: string; counterMove?: string; pieceGlyph?: string; pieceSide?: Side } | null
}
