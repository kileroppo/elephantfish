interface StageHeadProps {
  turn: 'red' | 'black'
  turnText: string
  isPlaying: boolean
  isEngineTurn: boolean
  inCheck: boolean
  setupActive: boolean
  ply?: number
}

export function StageHead({
  turn,
  turnText,
  isPlaying,
  isEngineTurn,
  inCheck,
  setupActive,
  ply,
}: StageHeadProps) {
  const isRed = turn === 'red'
  const roundNo = ply !== undefined ? Math.floor(ply / 2) + 1 : 1

  return (
    <div className="stage-head flex items-center justify-center gap-2 h-8 mb-1 select-none shrink-0">
      <span
        className={`inline-flex items-center gap-2 px-3.5 py-1 rounded-full text-xs font-medium border transition-all duration-200 shadow-xs ${
          !isPlaying
            ? 'bg-paper-2 text-ink-3 border-hairline'
            : isEngineTurn
              ? 'bg-paper-0 border-cinnabar/40 text-cinnabar shadow-cinnabar/5'
              : 'bg-paper-0 border-hairline-strong text-ink-1'
        }`}
      >
        <span
          className={`w-2.5 h-2.5 rounded-full transition-transform duration-200 ${
            isRed ? 'bg-piece-red' : 'bg-piece-black'
          } ${isEngineTurn ? 'animate-pulse' : ''}`}
        />

        {!setupActive && isPlaying && (
          <span className="font-num text-[11px] text-ink-mute border-r border-hairline pr-2 leading-none">
            第 {roundNo} 回合
          </span>
        )}

        <span className="font-display tracking-wide">{turnText}</span>
      </span>

      {inCheck && isPlaying && !setupActive && (
        <span
          key={`chk-${ply}`}
          className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold tracking-widest bg-cinnabar text-white shadow-sm animate-bounce"
        >
          将军！
        </span>
      )}
    </div>
  )
}
