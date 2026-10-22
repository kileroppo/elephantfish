import { PIECE_SPECS, type SetupPieceSpec as PieceSpec } from '../../lib/setup'

export interface SetupStatusStripProps {
  selectedTrayPiece: string | null
  pickedBoardSquare: string | null
  pickedSpec: PieceSpec | null
  remainingCount: number
  onCancelTrayPiece: () => void
  onRemovePickedPiece: () => void
  onCancelPick: () => void
}

export function SetupStatusStrip({
  selectedTrayPiece,
  pickedBoardSquare,
  pickedSpec,
  remainingCount,
  onCancelTrayPiece,
  onRemovePickedPiece,
  onCancelPick,
}: SetupStatusStripProps) {
  return (
    <div className="setup-status-strip rounded overflow-hidden">
      {selectedTrayPiece ? (
        <div className="status-tip active-tray-tip flex items-center justify-between gap-2 p-2 rounded text-xs bg-cinnabar/10 border border-cinnabar/30 text-cinnabar leading-normal">
          <span>
            已选中备用子
            <strong className="font-semibold mx-1">
              【{PIECE_SPECS[selectedTrayPiece].side === 'red' ? '红' : '黑'}
              {PIECE_SPECS[selectedTrayPiece].name}】
            </strong>
            ，点击棋盘任意空格即可放置（剩余可用 {remainingCount} 枚）。
          </span>
          <button
            type="button"
            className="btn btn-ghost btn-xs h-6 px-2 rounded text-[11px] font-medium bg-paper-0 hover:bg-paper-1 text-ink-1 border border-cinnabar/40 transition-colors shrink-0 cursor-pointer shadow-2xs"
            onClick={onCancelTrayPiece}
          >
            取消放子
          </button>
        </div>
      ) : pickedBoardSquare && pickedSpec ? (
        <div className="status-tip active-picked-tip flex items-center justify-between gap-2 p-2 rounded text-xs bg-jade/10 border border-jade/30 text-jade leading-normal flex-wrap">
          <span>
            已选中盘上
            <strong className="font-semibold mx-1">
              【{pickedSpec.side === 'red' ? '红' : '黑'}
              {pickedSpec.name} 于 {pickedBoardSquare}】
            </strong>
            。点击另一空格可移位，或右键/点击右侧按钮移除：
          </span>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              className="btn btn-warn btn-xs h-6 px-2 rounded text-[11px] font-medium bg-amber-600 hover:bg-amber-700 text-white transition-colors cursor-pointer border-0 shadow-2xs"
              onClick={onRemovePickedPiece}
            >
              从盘上移除
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-xs h-6 px-2 rounded text-[11px] font-medium bg-paper-0 hover:bg-paper-1 text-ink-1 border border-jade/40 transition-colors cursor-pointer shadow-2xs"
              onClick={onCancelPick}
            >
              取消选择
            </button>
          </div>
        </div>
      ) : (
        <div className="status-tip normal-tip flex items-center gap-2 p-2 rounded text-xs bg-paper-2/70 text-ink-2 border border-hairline/60 leading-normal">
          <span>
            <strong className="font-semibold text-ink-1">操作指南：</strong>
            从上方点击备用子，再点棋盘空格落盘；盘上已有子可自由拖动或点击挪位；右键或拖出棋盘可将棋子移除。
          </span>
        </div>
      )}
    </div>
  )
}
