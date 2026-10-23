export interface TopBarBrandProps {
  engineInfo?: unknown
  onToggleEngine?: () => void
}

export function TopBarBrand(_props: TopBarBrandProps) {
  return (
    <div className="brand flex items-center gap-3 select-none shrink-0">
      <span
        className="brand-mark w-7 h-7 rounded-lg bg-cinnabar text-paper-0 font-display text-[15px] font-semibold flex items-center justify-center select-none shadow-xs"
        aria-hidden="true"
      >
        象
      </span>
      <div className="brand-text flex items-baseline gap-2">
        <h1 className="text-[16px] font-semibold tracking-wide text-ink-0 whitespace-nowrap m-0 leading-none">
          XQ-Coach
        </h1>
        <span className="text-[11px] tracking-wider text-ink-4 whitespace-nowrap hidden lg:inline m-0 leading-none">
          象棋教练实训台
        </span>
      </div>
    </div>
  )
}
