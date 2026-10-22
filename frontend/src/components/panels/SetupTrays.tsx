import { BLACK_PIECES, PIECE_SPECS, RED_PIECES } from '../../lib/setup'

export interface SetupTraysProps {
  remaining: Record<string, number>
  selectedTrayPiece: string | null
  onSelectTrayPiece: (char: string | null) => void
}

export function SetupTrays({
  remaining,
  selectedTrayPiece,
  onSelectTrayPiece,
}: SetupTraysProps) {
  return (
    <div className="setup-trays grid grid-cols-1 md:grid-cols-2 gap-3">
      {/* 红方备用盒 */}
      <div className="piece-tray red-tray flex flex-col gap-2 p-2.5 rounded-md bg-paper-0/80 border border-hairline shadow-xs">
        <div className="tray-label flex items-center gap-1.5 text-xs font-semibold text-ink-2">
          <span className="tray-dot red-dot w-2 h-2 rounded-full bg-piece-red" />
          <span>红方备用子</span>
        </div>
        <div className="tray-pieces flex items-center gap-2 flex-wrap">
          {RED_PIECES.map((ch) => {
            const spec = PIECE_SPECS[ch]
            const rem = remaining[ch] ?? 0
            const isSelected = selectedTrayPiece === ch
            const isDisabled = rem <= 0

            return (
              <button
                key={ch}
                type="button"
                className={`tray-piece-btn red group relative flex flex-col items-center gap-1 p-1 rounded-md transition-all cursor-pointer ${
                  isSelected
                    ? 'is-selected bg-cinnabar/10 ring-2 ring-cinnabar'
                    : 'hover:bg-paper-2/60'
                } ${isDisabled && !isSelected ? 'is-empty opacity-30 cursor-not-allowed pointer-events-none' : ''}`}
                disabled={isDisabled && !isSelected}
                onClick={() => onSelectTrayPiece(isSelected ? null : ch)}
                title={
                  isDisabled
                    ? `${spec.name} 已全部上盘`
                    : `点击选择【红方 ${spec.name}】，剩余 ${rem} 枚可用`
                }
              >
                <span
                  className={`tray-piece-circle w-9 h-9 rounded-full flex items-center justify-center bg-gradient-to-b from-[#fdf6ec] to-[#f4e2ca] border-[1.5px] border-[#deb887] shadow-xs transition-transform group-hover:scale-105 ${
                    isSelected ? 'ring-2 ring-cinnabar shadow-md' : ''
                  }`}
                >
                  <span className="tray-piece-glyph font-kai text-xl font-bold text-piece-red leading-none select-none">
                    {spec.glyph}
                  </span>
                </span>
                <span
                  className={`tray-count-tag font-num text-[10px] font-semibold px-1.5 py-0.2 rounded-full leading-tight border transition-colors ${
                    isSelected
                      ? 'bg-cinnabar text-white border-cinnabar'
                      : 'bg-paper-2 text-ink-mute border-hairline'
                  }`}
                >
                  ×{rem}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {/* 黑方备用盒 */}
      <div className="piece-tray black-tray flex flex-col gap-2 p-2.5 rounded-md bg-paper-0/80 border border-hairline shadow-xs">
        <div className="tray-label flex items-center gap-1.5 text-xs font-semibold text-ink-2">
          <span className="tray-dot black-dot w-2 h-2 rounded-full bg-piece-black" />
          <span>黑方备用子</span>
        </div>
        <div className="tray-pieces flex items-center gap-2 flex-wrap">
          {BLACK_PIECES.map((ch) => {
            const spec = PIECE_SPECS[ch]
            const rem = remaining[ch] ?? 0
            const isSelected = selectedTrayPiece === ch
            const isDisabled = rem <= 0

            return (
              <button
                key={ch}
                type="button"
                className={`tray-piece-btn black group relative flex flex-col items-center gap-1 p-1 rounded-md transition-all cursor-pointer ${
                  isSelected
                    ? 'is-selected bg-cinnabar/10 ring-2 ring-cinnabar'
                    : 'hover:bg-paper-2/60'
                } ${isDisabled && !isSelected ? 'is-empty opacity-30 cursor-not-allowed pointer-events-none' : ''}`}
                disabled={isDisabled && !isSelected}
                onClick={() => onSelectTrayPiece(isSelected ? null : ch)}
                title={
                  isDisabled
                    ? `${spec.name} 已全部上盘`
                    : `点击选择【黑方 ${spec.name}】，剩余 ${rem} 枚可用`
                }
              >
                <span
                  className={`tray-piece-circle w-9 h-9 rounded-full flex items-center justify-center bg-gradient-to-b from-[#fdf6ec] to-[#f4e2ca] border-[1.5px] border-[#deb887] shadow-xs transition-transform group-hover:scale-105 ${
                    isSelected ? 'ring-2 ring-cinnabar shadow-md' : ''
                  }`}
                >
                  <span className="tray-piece-glyph font-kai text-xl font-bold text-piece-black leading-none select-none">
                    {spec.glyph}
                  </span>
                </span>
                <span
                  className={`tray-count-tag font-num text-[10px] font-semibold px-1.5 py-0.2 rounded-full leading-tight border transition-colors ${
                    isSelected
                      ? 'bg-cinnabar text-white border-cinnabar'
                      : 'bg-paper-2 text-ink-mute border-hairline'
                  }`}
                >
                  ×{rem}
                </span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
