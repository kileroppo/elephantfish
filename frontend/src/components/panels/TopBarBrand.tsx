import type { EngineInfo } from '../../types'

export interface TopBarBrandProps {
  engineInfo?: EngineInfo
  onToggleEngine?: () => void
}

export function TopBarBrand({ engineInfo, onToggleEngine }: TopBarBrandProps) {
  const isPikafish = engineInfo?.active === 'pikafish'

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

      {engineInfo && (
        <button
          type="button"
          onClick={onToggleEngine}
          className="hidden sm:inline-flex items-center gap-1.5 ml-1 py-1 px-2.5 rounded-full bg-paper-1/80 hover:bg-paper-2 border border-hairline text-ink-2 hover:text-cinnabar text-[11px] font-medium transition-all cursor-pointer shadow-2xs"
          title={
            isPikafish
              ? '当前对弈引擎：皮卡鱼 Pikafish (NNUE)，点击切换为内置纯 Python 引擎'
              : '当前对弈引擎：内置纯 Python 引擎，点击切换为皮卡鱼 (NNUE)'
          }
        >
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              isPikafish ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'
            }`}
          />
          <span>{isPikafish ? '皮卡鱼' : '内置引擎'}</span>
        </button>
      )}
    </div>
  )
}
