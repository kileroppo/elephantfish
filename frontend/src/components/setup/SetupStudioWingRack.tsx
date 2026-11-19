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
 * - 木纹面用 --disc-face-* 令牌（setup-studio.css）：宣纸是暖白木、乌墨是夜褐木，
 *   主题切换跟着翻面，不是一块贴上去的亮色
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
      className={`setup-wing-rack setup-wing-${side} flex flex-col items-center gap-2 py-3 px-2 rounded-[var(--r-xl)] bg-paper-1/90 backdrop-blur-md border border-hairline-strong shadow-lg select-none z-20`}
      aria-label={`${isRed ? '红方' : '黑方'}备用棋架`}
    >
      {/* 棋架顶标 */}
      <div className="rack-header flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-paper-2/80 text-[11px] font-semibold text-ink-2 shadow-2xs">
        <span
          className={`w-2 h-2 rounded-full ${isRed ? 'bg-piece-red' : 'bg-piece-black'}`}
          aria-hidden="true"
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
              className={`rack-slot relative group flex items-center justify-center p-1 rounded-[var(--r-md)] transition-transform duration-[var(--dur-fast)] ease-spring-sm ${
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
                  'rack-piece-btn relative flex items-center justify-center w-11 h-11 rounded-full outline-none',
                  isSelected ? 'is-selected' : '',
                  isEmpty ? 'is-empty' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                title={
                  isEmpty
                    ? `${spec.name} 已全部上盘`
                    : isSelected
                      ? '连盖模式：点盘面落子，再点一次收起'
                      : `拖来落子，或点我连盖（余 ${rem} 枚）`
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
                  className={`rack-count-badge absolute -bottom-1 -right-1 font-num text-[10px] font-bold px-1.5 py-0.2 rounded-full border shadow-xs transition-colors duration-[var(--dur-fast)] ${
                    isSelected
                      ? 'bg-cinnabar text-[var(--ink-on-accent)] border-paper-0 ring-1 ring-cinnabar'
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
      <div className="rack-footer text-[9.5px] text-ink-mute text-center leading-tight px-1">
        拖拽落子 · 点选连盖
      </div>
    </aside>
  )
})
