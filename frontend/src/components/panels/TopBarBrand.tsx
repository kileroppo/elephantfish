import type { EngineInfo } from '../../types'
import { useGameContext } from '../../context/GameContext'

export interface TopBarBrandProps {
  engineInfo?: EngineInfo
  onToggleEngine?: () => void
}

export function TopBarBrand({ engineInfo, onToggleEngine }: TopBarBrandProps) {
  const g = useGameContext()
  const connected = g.connected
  const thinking = g.thinking

  // 真实引擎名随 engine_info.active 走，内置引擎不得谎报 Pikafish（与 ControlRail 徽标同语言）
  const active = engineInfo?.active ?? 'pikafish'
  const engineName = active === 'builtin' ? '内置引擎' : 'Pikafish'
  const target: 'pikafish' | 'builtin' = active === 'builtin' ? 'pikafish' : 'builtin'
  const targetName = target === 'pikafish' ? '皮卡鱼' : '内置引擎'
  const targetAvailable = target === 'builtin' || (engineInfo?.pikafish_available ?? false)

  const handleToggleEngine = () => {
    if (!targetAvailable) {
      g.pushToast('皮卡鱼不可用：未找到可执行文件，已保持当前引擎', 'warn')
      return
    }
    if (onToggleEngine) onToggleEngine()
    else void g.updateSettings({ engine_type: target })
    g.pushToast(`引擎已切换为${targetName}`, 'ok')
  }

  const title = !connected
    ? `引擎服务未连接 · 当前引擎：${engineName}`
    : !targetAvailable
      ? `当前引擎：${engineName} · 皮卡鱼不可用，暂无法切换`
      : `当前引擎：${engineName} · 点击切换为${targetName}`

  return (
    <div className="brand flex items-center gap-2.5 md:gap-3 select-none shrink-0">
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

      {/* 引擎状态胶囊：真实引擎名 + 思忖中/未连接警示，点击在 builtin ↔ pikafish 间切换 */}
      <button
        type="button"
        onClick={handleToggleEngine}
        title={title}
        aria-label={`引擎状态：${engineName}，点击切换引擎`}
        className={`engine-pill h-7 rounded-lg text-xs tracking-wide font-medium transition-all cursor-pointer flex items-center gap-1.5 border leading-none px-2 md:px-2.5 ${
          !connected
            ? 'bg-amber-500/10 text-amber-700 border-amber-500/40 hover:bg-amber-500/20'
            : thinking
              ? 'bg-cinnabar/10 text-cinnabar border-cinnabar/30 animate-pulse hover:bg-cinnabar/15'
              : 'bg-paper-2/60 text-ink-3 border-hairline hover:bg-paper-1 hover:text-ink-1'
        }`}
      >
        <span
          aria-hidden="true"
          className={`w-1.5 h-1.5 rounded-full shrink-0 ${
            !connected
              ? 'bg-amber-500 animate-pulse'
              : thinking
                ? 'bg-cinnabar animate-pulse'
                : 'bg-cinnabar/60'
          }`}
        />
        <span className="hidden md:inline whitespace-nowrap">
          {thinking ? '思忖中…' : engineName}
        </span>
      </button>
    </div>
  )
}
