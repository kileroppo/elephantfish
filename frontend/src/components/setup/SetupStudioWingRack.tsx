import { memo } from 'react'
import {
  BLACK_PIECES,
  PIECE_SPECS,
  RED_PIECES,
  type SetupPieceSpec,
} from '../../lib/setup'

interface SetupStudioWingRackProps {
  side: 'red' | 'black'
  remaining: Record<string, number>
  selectedTrayPiece: string | null
  onSelectTrayPiece: (char: string | null) => void
}

/**
 * 排局工作室左右双翼实木棋槽（Apple HIG 悬浮微拟物设计）
 * - 桌面端分别立于棋盘左右两侧，纵向排列，完全不压缩棋盘纵向高度
 * - 支持原生 HTML5 拖拽（拖入棋盘任意交叉点落子）
 * - 支持单击进入「连续印章喷涂模式」（Stamp Brush Mode）
 */
export const SetupStudioWingRack = memo(function SetupStudioWingRack({
  side,
  remaining,
  selectedTrayPiece,
  onSelectTrayPiece,
}: SetupStudioWingRackProps) {
  const pieces = side === 'red' ? RED_PIECES : BLACK_PIECES
  const isRed = side === 'red'

  return (
    <aside
      className={`setup-wing-rack setup-wing-${side} flex flex-col items-center gap-2 py-3 px-2 rounded-[var(--r-xl)] bg-paper-1/90 backdrop-blur-md border border-hairline-strong shadow-lg select-none transition-all duration-300 z-20`}
      aria-label={`${isRed ? '红方' : '黑方'}备用棋架`}
    >
      {/* 棋架顶标 */}
      <div className="rack-header flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-paper-2/80 text-[11px] font-semibold text-ink-2 shadow-2xs">
        <span
          className={`w-2 h-2 rounded-full ${
            isRed ? 'bg-piece-red shadow-[0_0_6px_rgba(200,56,46,0.6)]' : 'bg-piece-black'
          }`}
        />
        <span>{isRed ? '红方棋盒' : '黑方棋盒'}</span>
      </div>

      {/* 棋子曹列表 */}
      <div className="rack-slots flex flex-col gap-1.5 w-full items-center">
        {pieces.map((char) => {
          const spec: SetupPieceSpec = PIECE_SPECS[char]
          const rem = remaining[char] ?? 0
          const isSelected = selectedTrayPiece === char
          const isEmpty = rem <= 0

          return (
            <div
              key={char}
              className={`rack-slot relative group flex items-center justify-center p-1 rounded-[var(--r-md)] transition-transform duration-150 ${
                isEmpty ? 'is-empty opacity-30 cursor-not-allowed' : 'cursor-grab active:cursor-grabbing hover:scale-105'
              }`}
            >
              <button
                type="button"
                draggable={!isEmpty}
                onDragStart={(e) => {
                  if (isEmpty) return
                  e.dataTransfer.setData('text/plain', char)
                  e.dataTransfer.effectAllowed = 'copy'
                }}
                onClick={() => {
                  if (isEmpty && !isSelected) return
                  onSelectTrayPiece(isSelected ? null : char)
                }}
                disabled={isEmpty && !isSelected}
                className={[
                  'rack-piece-btn relative flex items-center justify-center w-11 h-11 rounded-full transition-all duration-200 outline-none',
                  'bg-gradient-to-b from-[#fefaf4] via-[#f7ebd9] to-[#ecd3b2]',
                  'border-[1.8px] border-[#d8b88a] shadow-sm',
                  isSelected
                    ? 'ring-3 ring-cinnabar scale-110 shadow-md animate-[pulse_2s_infinite]'
                    : 'hover:shadow-md hover:border-[#b89564]',
                  isEmpty ? 'grayscale brightness-90 shadow-inner' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                title={
                  isEmpty
                    ? `${spec.name} 已全部上盘`
                    : isSelected
                      ? `【连盖印章模式已激活】点击盘面任意空格快速落子，再次点击取消`
                      : `拖拽放置 或 单击进入连盖印章模式（剩余 ${rem} 枚）`
                }
              >
                {/* 棋子凹槽内阴影 */}
                <span className="absolute inset-0 rounded-full shadow-[inset_0_2px_4px_rgba(0,0,0,0.12)] pointer-events-none" />

                {/* 棋子红黑字样 */}
                <span
                  className={`font-kai text-[22px] font-bold leading-none select-none ${
                    isRed ? 'text-piece-red' : 'text-piece-black'
                  }`}
                >
                  {spec.glyph}
                </span>

                {/* 剩余数量小角标 */}
                <span
                  className={`rack-count-badge absolute -bottom-1 -right-1 font-num text-[10px] font-bold px-1.5 py-0.2 rounded-full border shadow-xs transition-colors ${
                    isSelected
                      ? 'bg-cinnabar text-white border-white ring-1 ring-cinnabar'
                      : rem === 0
                        ? 'bg-paper-3 text-ink-mute border-hairline'
                        : 'bg-paper-0 text-ink-1 border-hairline-strong'
                  }`}
                >
                  {rem}
                </span>
              </button>
            </div>
          )
        })}
      </div>

      {/* 底部操作轻提示 */}
      <div className="rack-footer text-[9.5px] text-ink-mute/80 text-center leading-tight px-1">
        可拖可点
      </div>
    </aside>
  )
})
