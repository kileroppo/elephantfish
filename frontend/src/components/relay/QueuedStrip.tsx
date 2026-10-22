export interface QueuedStripProps {
  queued: string | null
  onClearQueue: () => void
}

export function QueuedStrip({ queued, onClearQueue }: QueuedStripProps) {
  if (!queued) return null

  return (
    <div
      className="queued-strip absolute bottom-[calc(100%+8px)] left-1/2 -translate-x-1/2 z-45 whitespace-nowrap shadow-md border border-hairline-strong bg-paper-0 px-3 py-1.5 rounded-full flex items-center gap-2 text-xs animate-[floatIn_180ms_var(--ease-out)_both]"
      data-relay-queued={queued}
    >
      <span className="text-ink-2">
        已排队录入对方走法：<strong className="font-semibold text-ink-0">{queued}</strong>（等待计算结束）
      </span>
      <button
        type="button"
        className="btn btn-ghost btn-sm text-xs px-2 py-0.5 rounded cursor-pointer text-cinnabar hover:bg-[var(--cinnabar-wash)]"
        onClick={onClearQueue}
      >
        撤销
      </button>
    </div>
  )
}
