export interface SetupHeaderProps {
  fenOpen: boolean
  onClearBoard: () => void
  onResetStandard: () => void
  onRevertOriginal: () => void
  onToggleFen: () => void
}

export function SetupHeader({
  fenOpen,
  onClearBoard,
  onResetStandard,
  onRevertOriginal,
  onToggleFen,
}: SetupHeaderProps) {
  return (
    <div className="setup-panel-header flex items-center justify-between flex-wrap gap-2.5 pb-1 border-b border-hairline/60">
      <div className="setup-title-box flex items-center gap-2.5">
        <span className="setup-badge inline-flex items-center px-2.5 py-0.5 rounded-full bg-gradient-to-br from-cinnabar-bright to-cinnabar text-paper-0 text-xs font-semibold tracking-wider shadow-xs">
          排局模式
        </span>
        <span className="setup-subtitle text-xs text-ink-mute hidden sm:inline">
          自由增减与调动棋子，排布专属残局或杀局
        </span>
      </div>

      <div className="setup-quick-actions flex items-center gap-1.5 flex-wrap">
        <button
          type="button"
          className="btn btn-ghost btn-sm h-7 px-2.5 rounded text-xs font-medium bg-paper-2/70 hover:bg-paper-2 text-ink-1 border border-hairline transition-colors flex items-center justify-center cursor-pointer"
          onClick={onClearBoard}
          title="清空棋盘所有棋子"
        >
          清空棋盘
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm h-7 px-2.5 rounded text-xs font-medium bg-paper-2/70 hover:bg-paper-2 text-ink-1 border border-hairline transition-colors flex items-center justify-center cursor-pointer"
          onClick={onResetStandard}
          title="恢复为正规标准开局 32 颗棋子"
        >
          标准开局
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm h-7 px-2.5 rounded text-xs font-medium bg-paper-2/70 hover:bg-paper-2 text-ink-1 border border-hairline transition-colors flex items-center justify-center cursor-pointer"
          onClick={onRevertOriginal}
          title="还原为进入补棋模式前的局面"
        >
          恢复原局
        </button>
        <button
          type="button"
          className={`btn btn-ghost btn-sm h-7 px-2.5 rounded text-xs font-medium transition-colors flex items-center justify-center cursor-pointer border ${
            fenOpen
              ? 'is-active bg-cinnabar text-white border-cinnabar font-semibold shadow-xs'
              : 'bg-paper-2/70 hover:bg-paper-2 text-ink-1 border-hairline'
          }`}
          onClick={onToggleFen}
          title="导入或导出 FEN 局面代码"
        >
          FEN 工具 {fenOpen ? '▲' : '▼'}
        </button>
      </div>
    </div>
  )
}
