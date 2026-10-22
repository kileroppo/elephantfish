interface BootScreenProps {
  booting?: boolean
  onRetry?: () => void
}

export function BootScreen({ booting, onRetry }: BootScreenProps) {
  if (booting) {
    return (
      <div className="h-full flex flex-col items-center justify-center bg-paper-1 text-ink-2 select-none animate-in fade-in duration-300">
        <div className="w-[86px] h-[86px] rounded-full border border-cinnabar/30 flex items-center justify-center font-kai text-4xl text-cinnabar shadow-sm animate-pulse mb-4">
          象
        </div>
        <p className="text-sm font-medium tracking-wide text-ink-3">正在连接引擎…</p>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col items-center justify-center p-6 text-center bg-paper-1 text-ink-2">
      <div className="w-[86px] h-[86px] rounded-full border border-ink-mute/30 flex items-center justify-center font-kai text-4xl text-ink-mute mb-4">
        象
      </div>
      <h2 className="text-xl font-bold font-display text-ink-1 mb-2">连不上引擎服务</h2>
      <p className="text-xs text-ink-3 max-w-sm mb-6 leading-relaxed">
        先在项目根目录运行：<code className="px-2 py-0.5 rounded bg-paper-2 text-ink-1 font-num text-[11px] border border-hairline">python server/app.py</code>，然后刷新本页。
      </p>
      {onRetry && (
        <button
          type="button"
          className="px-5 py-2 rounded-lg bg-cinnabar hover:bg-cinnabar-bright text-paper-0 font-medium text-xs tracking-wider transition-all shadow-sm active:scale-95"
          onClick={onRetry}
        >
          重试
        </button>
      )}
    </div>
  )
}
