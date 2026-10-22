export function TopBarBrand() {
  return (
    <div className="brand flex items-center gap-3">
      <span
        className="brand-mark w-[26px] h-[26px] rounded-xs bg-cinnabar text-paper-0 font-display text-[15px] font-semibold flex items-center justify-center select-none shadow-xs"
        aria-hidden="true"
      >
        象
      </span>
      <div className="brand-text flex items-baseline gap-3">
        <h1 className="text-[17px] font-medium tracking-wide text-ink-0 whitespace-nowrap m-0 leading-none">
          XQ-Coach
        </h1>
        <p className="text-[11px] tracking-[0.2em] text-ink-4 whitespace-nowrap hidden sm:block m-0 leading-none">
          象棋教练实训台
        </p>
      </div>
    </div>
  )
}
