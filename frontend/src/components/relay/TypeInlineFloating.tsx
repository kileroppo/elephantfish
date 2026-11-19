export interface TypeInlineFloatingProps {
  show: boolean
  text: string
  rejected: number
  onChange: (value: string) => void
  onSubmit: () => void
  onClose: () => void
}

/** 键盘记谱录入栏：应手台下方的一枚流内胶囊。
 *
 * 2026-11-18：从「绝对定位浮层」改为流内一行。旧写法 bottom:calc(100%+8px)
 * 浮在应手栏上方，实测会压住棋盘底边与整排路数标签（九八七六五四三二），
 * 且白盒红钮与应手栏的胶囊语言打架。现在跟在应手台下方成流，借 stage 的
 * flex 列自然让位，棋盘不再被盖；样式与应手栏同语言（等高全圆角纸色胶囊）。 */
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
    <div className="type-inline-floating w-full h-[38px] px-3.5 rounded-full border border-hairline bg-paper-0 shadow-xs flex items-center box-border animate-[rise_180ms_var(--ease-out)_both]">
      <div key={`box${rejected}`} className={`type-inline-box flex items-center gap-1.5 w-full ${rejected ? 'is-rejected' : ''}`}>
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
          className="flex-1 min-w-0 bg-transparent border-0 p-0 text-xs text-ink-0"
        />
        <button
          type="button"
          className="shrink-0 h-[26px] px-3 rounded-full bg-cinnabar text-[var(--ink-on-accent)] text-xs font-medium leading-none cursor-pointer inline-flex items-center gap-1 relay-press active:scale-95 shadow-xs disabled:opacity-40"
          disabled={!text.trim()}
          onClick={onSubmit}
        >
          提交
        </button>
        <button
          type="button"
          className="shrink-0 h-[26px] px-2.5 rounded-full text-xs leading-none text-ink-3 hover:text-ink-0 hover:bg-paper-2 cursor-pointer inline-flex items-center relay-press active:scale-95"
          onClick={onClose}
        >
          收起
        </button>
      </div>
    </div>
  )
}
