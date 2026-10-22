import { memo, useRef, useState, useEffect } from 'react'

interface SetupStudioBottomDockProps {
  turn: 'red' | 'black'
  engineSide: 'red' | 'black'
  valid: boolean
  errors: string[]
  onTurnChange: (turn: 'red' | 'black') => void
  onEngineSideChange: (side: 'red' | 'black') => void
  onStartGame: () => void
  onToast: (text: string, tone?: 'info' | 'warn' | 'error') => void
}

/**
 * 排局工作室底部一体化高定控制坞（Apple HIG 悬浮胶囊设计）
 * - 先手方与引擎执子轻量分段切换
 * - 规则合法性无打扰微标（悬浮卡片展示异常清单，绝不推挤界面布局）
 * - 醒目对决主按钮，支持一键开局
 */
export const SetupStudioBottomDock = memo(function SetupStudioBottomDock({
  turn,
  engineSide,
  valid,
  errors,
  onTurnChange,
  onEngineSideChange,
  onStartGame,
  onToast,
}: SetupStudioBottomDockProps) {
  const [errorPopover, setErrorPopover] = useState(false)
  const popoverRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleDown = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setErrorPopover(false)
      }
    }
    if (errorPopover) document.addEventListener('mousedown', handleDown)
    return () => document.removeEventListener('mousedown', handleDown)
  }, [errorPopover])

  return (
    <footer className="setup-studio-bottom-dock relative flex items-center justify-between gap-3 w-full max-w-[820px] px-4 py-2.5 mx-auto rounded-full bg-paper-1/90 backdrop-blur-md border border-hairline-strong shadow-xl select-none z-30 transition-all">
      {/* 1. 先手分段选择器 */}
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold text-ink-mute hidden sm:inline">先手方:</span>
        <div className="segmented-control inline-flex p-0.5 rounded-full bg-paper-2 border border-hairline">
          <button
            type="button"
            onClick={() => onTurnChange('red')}
            className={`px-3 py-1 rounded-full text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
              turn === 'red'
                ? 'bg-cinnabar text-white shadow-xs'
                : 'text-ink-2 hover:text-ink-1'
            }`}
          >
            <span className="w-2 h-2 rounded-full bg-piece-red inline-block" />
            <span>红先</span>
          </button>
          <button
            type="button"
            onClick={() => onTurnChange('black')}
            className={`px-3 py-1 rounded-full text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
              turn === 'black'
                ? 'bg-[#2b231a] text-white shadow-xs'
                : 'text-ink-2 hover:text-ink-1'
            }`}
          >
            <span className="w-2 h-2 rounded-full bg-piece-black inline-block" />
            <span>黑先</span>
          </button>
        </div>
      </div>

      {/* 2. 引擎执子分段选择器 */}
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold text-ink-mute hidden md:inline">引擎执子:</span>
        <div className="segmented-control inline-flex p-0.5 rounded-full bg-paper-2 border border-hairline">
          <button
            type="button"
            onClick={() => onEngineSideChange('black')}
            className={`px-2.5 py-1 rounded-full text-xs font-bold transition-all cursor-pointer flex items-center gap-1 ${
              engineSide === 'black'
                ? 'bg-paper-0 text-ink-1 shadow-2xs border border-hairline-strong'
                : 'text-ink-mute hover:text-ink-1'
            }`}
          >
            <span>🤖 执黑</span>
          </button>
          <button
            type="button"
            onClick={() => onEngineSideChange('red')}
            className={`px-2.5 py-1 rounded-full text-xs font-bold transition-all cursor-pointer flex items-center gap-1 ${
              engineSide === 'red'
                ? 'bg-paper-0 text-ink-1 shadow-2xs border border-hairline-strong'
                : 'text-ink-mute hover:text-ink-1'
            }`}
          >
            <span>🤖 执红</span>
          </button>
        </div>
      </div>

      {/* 3. 局面合法性指示与开始对弈主按钮 */}
      <div className="flex items-center gap-2 relative" ref={popoverRef}>
        {/* 合法性指示胶囊 */}
        {valid ? (
          <div className="valid-pill flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-500/15 text-emerald-700 text-xs font-semibold border border-emerald-500/30">
            <span>✓</span>
            <span className="hidden sm:inline">局面合法</span>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setErrorPopover((v) => !v)}
            className="invalid-pill flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-500/15 text-amber-800 text-xs font-semibold border border-amber-500/35 hover:bg-amber-500/25 transition-colors cursor-pointer"
            title="点击查看不合规原因"
          >
            <span>⚠</span>
            <span>{errors.length} 处异常</span>
          </button>
        )}

        {/* 异常清单气泡卡片 */}
        {errorPopover && !valid && (
          <div className="absolute right-0 bottom-full mb-3 w-80 p-3.5 rounded-[var(--r-lg)] bg-paper-1/95 backdrop-blur-lg border border-amber-500/40 shadow-2xl flex flex-col gap-2 z-50 animate-in fade-in zoom-in-95 duration-150">
            <div className="text-xs font-bold text-amber-800 flex items-center gap-1.5 border-b border-hairline pb-1.5">
              <span>⚠</span>
              <span>排局需满足象棋规则（共 {errors.length} 项）：</span>
            </div>
            <ul className="flex flex-col gap-1.5 text-xs text-ink-2 max-h-48 overflow-y-auto pl-4 list-disc">
              {errors.map((err, idx) => (
                <li key={idx} className="leading-snug">
                  {err}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* 开始对弈主按钮 */}
        <button
          type="button"
          onClick={() => {
            if (!valid) {
              onToast(errors[0] || '盘面存在不合规项，无法开始对弈', 'warn')
              setErrorPopover(true)
              return
            }
            onStartGame()
          }}
          disabled={!valid}
          className={`btn-start-game flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-bold transition-all shadow-md cursor-pointer ${
            valid
              ? 'bg-gradient-to-r from-cinnabar to-cinnabar-bright text-white hover:scale-105 active:scale-95 shadow-[0_4px_12px_rgba(200,56,46,0.35)]'
              : 'bg-paper-3 text-ink-mute/60 cursor-not-allowed border border-hairline'
          }`}
        >
          <span>开始对战</span>
          <span className="text-sm">➜</span>
        </button>
      </div>
    </footer>
  )
})
