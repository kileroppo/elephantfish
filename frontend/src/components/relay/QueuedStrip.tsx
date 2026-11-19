export interface QueuedStripProps {
  queued: string | null
  onClearQueue: () => void
}

export function QueuedStrip({ queued, onClearQueue }: QueuedStripProps) {
  if (!queued) return null

  return (
    <div
      className="queued-strip"
      data-relay-queued={queued}
    >
      <span className="text-ink-2">
        已排队走法：<strong className="font-semibold text-ink-0">{queued}</strong>（等待计算结束）
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
