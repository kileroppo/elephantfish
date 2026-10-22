/**
 * XQ-Coach 象棋棋盘模块统一导出
 * 内部实现已解耦拆分至 `./board/` 目录：
 *  - BoardArtwork: 棋盘底图、网格线、九宫斜线、炮星标记、楚河汉界
 *  - BoardPiece / BoardPiecesLayer: 棋子渲染、拖拽交互、动效与残影
 *  - BoardSvgLayer: 走子直线/曲线轨迹与主变分支
 *  - BoardOverlaysLayer: HUD战况、气泡、空间暗线透视与坐标尺
 *  - index: 统一状态机与落子协调
 */
export {
  Board,
  BoardArtwork,
  BoardPiece,
  VictimGhostPiece,
  BoardPiecesLayer,
  BoardSvgLayer,
  BoardHudCaption,
  BoardOverlaysLayer,
} from './board/index'

export type { BoardProps, DragState, Victim, KnockSeed, KnockState } from './board/types'
