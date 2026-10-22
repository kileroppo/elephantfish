interface ZenHudProps {
  isPlaying: boolean
  turn: 'red' | 'black'
  thinking?: boolean
  onExit: () => void
}

export function ZenHud({ isPlaying, turn, thinking, onExit }: ZenHudProps) {
  return (
    <div className="fixed top-14 left-1/2 -translate-x-1/2 z-50 pointer-events-auto" role="status" aria-live="polite">
      <div className="flex items-center gap-2.5 px-3.5 py-1.5 rounded-full bg-paper-0/95 backdrop-blur border border-hairline-strong shadow-lg text-ink-1 text-xs select-none animate-in fade-in slide-in-from-top-2 duration-200">
        <span
          className="w-5 h-5 rounded-full bg-cinnabar/10 text-cinnabar text-[11px] font-kai flex items-center justify-center font-bold"
          aria-hidden="true"
        >
          禅
        </span>
        <span className="font-semibold text-ink-0 tracking-wide font-display">静虑深思</span>
        <span className="text-[11px] text-ink-3 pl-1.5 border-l border-hairline">
          {isPlaying ? (turn === 'red' ? '红先出招' : '黑方行棋') : '对局终了'}
        </span>
        {thinking && (
          <span className="text-cinnabar font-medium text-[11px] animate-pulse">
            · 引擎推演中…
          </span>
        )}
        <button
          type="button"
          className="ml-1 px-2 py-0.5 rounded-full text-[11px] text-ink-3 hover:text-cinnabar hover:bg-cinnabar/10 border border-transparent hover:border-cinnabar/20 transition-colors"
          onClick={onExit}
          title="退出禅意专注模式 (Esc / Z)"
        >
          退出禅境 ✕
        </button>
      </div>
    </div>
  )
}
