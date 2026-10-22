export interface TypeInlineFloatingProps {
  show: boolean
  text: string
  rejected: number
  onChange: (value: string) => void
  onSubmit: () => void
  onClose: () => void
}

export function TypeInlineFloating({
  show,
  text,
  rejected,
  onChange,
  onSubmit,
  onClose,
}: TypeInlineFloatingProps) {
  if (!show) return null

  return (
    <div className="type-inline-floating absolute bottom-[calc(100%+8px)] left-1/2 -translate-x-1/2 z-45 bg-paper-0 border border-hairline-strong rounded-md shadow-md p-2 sm:px-2.5 sm:py-1.5 w-[min(92vw,420px)] animate-[floatIn_180ms_var(--ease-out)_both]">
      <div key={`box${rejected}`} className={`type-inline-box flex items-center gap-1.5 ${rejected ? 'is-rejected' : ''}`}>
        <input
          autoFocus
          value={text}
          placeholder="输入记谱 (如 炮二平五 或 h2e2)"
          data-relay-input=""
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void onSubmit()
            if (e.key === 'Escape') onClose()
          }}
          className="flex-1 min-w-0 px-2.5 py-1 text-xs bg-paper-1 border border-hairline rounded text-ink-0 placeholder:text-ink-mute focus:outline-none focus:border-cinnabar focus:ring-1 focus:ring-cinnabar"
        />
        <button
          type="button"
          className="btn btn-primary btn-sm min-h-[30px] h-[30px] px-3 text-xs leading-none rounded cursor-pointer disabled:opacity-40"
          disabled={!text.trim()}
          onClick={onSubmit}
        >
          提交
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm min-h-[30px] h-[30px] px-2.5 text-xs leading-none rounded cursor-pointer"
          onClick={onClose}
        >
          收起
        </button>
      </div>
    </div>
  )
}
