import { useState, useRef, useEffect } from 'react'
import type { GameSnapshot } from '../../types'

export interface EngineHeroProps {
  thinking: boolean
  lastEngineMove: GameSnapshot['records'][number] | null
  playMode: 'sparring' | 'relay'
  shadowGuess?: boolean
  copied: boolean
  playing: boolean
  gameEngineToMove: boolean
  helperOpen: boolean
  helperMode: 'threat' | 'good' | 'bad' | 'guide'
  showTypeInput: boolean
  onStop: () => void
  onUndo?: () => void
  onEngineMove: () => void
  onCopyMove: (iccs: string, chinese: string) => void
  onOpenHelper: (mode: 'threat' | 'good' | 'bad' | 'guide') => void
  onToggleTypeInput: () => void
  coachGuard?: boolean
  onToggleCoachGuard?: () => void
  railL?: boolean
  railR?: boolean
  onToggleRailL?: () => void
  onToggleRailR?: () => void
}

export function EngineHero({
  thinking,
  lastEngineMove,
  playMode,
  copied,
  playing,
  gameEngineToMove,
  helperOpen,
  helperMode,
  showTypeInput,
  onStop,
  onUndo,
  onEngineMove,
  onCopyMove,
  onOpenHelper,
  onToggleTypeInput,
  coachGuard,
  onToggleCoachGuard,
}: EngineHeroProps) {
  const [moreMenuOpen, setMoreMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!moreMenuOpen) return
    const onClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMoreMenuOpen(false)
      }
    }
    window.addEventListener('pointerdown', onClickOutside)
    return () => window.removeEventListener('pointerdown', onClickOutside)
  }, [moreMenuOpen])

  return (
    <>
      {/* ================= 移动端：双行精致对齐底栏 (!flex md:!hidden) ================= */}
      <div className="!flex md:!hidden flex-col gap-1.5 w-full max-w-[min(100vw-24px,460px)] mx-auto px-1 select-none">
        {/* 第 1 行：走法与对弈核心状态 */}
        <div
          className={`flex items-center justify-between h-10 px-3.5 rounded-xl border transition-all duration-150 ${
            thinking
              ? 'border-cinnabar bg-cinnabar/10 text-cinnabar shadow-xs'
              : 'border-hairline bg-paper-0 shadow-xs'
          }`}
        >
          {thinking ? (
            <div className="flex items-center justify-between w-full">
              <div className="flex items-center gap-2 text-cinnabar font-medium text-xs">
                <span className="w-2 h-2 rounded-full bg-cinnabar animate-pulse" />
                <span className="font-display tracking-wide">引擎深度推演中…</span>
              </div>
              <button
                type="button"
                className="px-3 py-1 rounded-full bg-cinnabar text-white text-xs font-medium shadow-xs active:scale-95 transition-transform"
                onClick={onStop}
              >
                采用最优步
              </button>
            </div>
          ) : lastEngineMove ? (
            <div className="flex items-center justify-between w-full">
              <button
                type="button"
                className="flex items-center gap-2 group cursor-pointer border-0 bg-transparent p-0 text-left"
                onClick={() => void onCopyMove(lastEngineMove.iccs, lastEngineMove.chinese)}
                title="点击复制着法"
              >
                <span className="text-[11px] font-medium text-ink-3 bg-paper-2 px-1.5 py-0.5 rounded border border-hairline whitespace-nowrap">
                  {playMode === 'sparring' ? '对手' : '应手'}
                </span>
                <span
                  className={`font-kai text-[17px] font-bold tracking-wider transition-colors ${
                    copied ? 'text-jade' : 'text-cinnabar'
                  }`}
                >
                  {lastEngineMove.chinese}
                </span>
                {copied && (
                  <span className="text-[10px] text-jade font-medium animate-fadeIn">✓ 已复制</span>
                )}
              </button>

              <div className="flex items-center gap-1.5">
                {onToggleCoachGuard && (
                  <button
                    type="button"
                    className={`flex items-center h-7 px-2 rounded-lg border text-[11px] font-medium transition active:scale-95 whitespace-nowrap ${
                      coachGuard
                        ? 'bg-paper-1 border-hairline text-ink-1'
                        : 'bg-transparent border-dashed border-hairline text-ink-4'
                    }`}
                    onClick={onToggleCoachGuard}
                    title="走错失先防错提醒开关"
                  >
                    {coachGuard ? '🛡️防错:开' : '🛡️防错:关'}
                  </button>
                )}
                {playMode === 'sparring' && onUndo && (
                  <button
                    type="button"
                    className="flex items-center h-7 px-2.5 rounded-lg bg-paper-1 hover:bg-paper-2 border border-hairline text-ink-1 text-xs font-medium transition active:scale-95 shadow-xs whitespace-nowrap"
                    onClick={onUndo}
                    title="撤回上一步 (Ctrl+Z)"
                  >
                    ↩ 悔棋
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between w-full">
              <span className="text-xs text-ink-3 font-medium">对局已就绪</span>
              {gameEngineToMove && playing && (
                <button
                  type="button"
                  className="px-3 py-1 rounded-lg bg-cinnabar text-white text-xs font-medium shadow-xs active:scale-95"
                  onClick={onEngineMove}
                >
                  让引擎先出招
                </button>
              )}
            </div>
          )}
        </div>

        {/* 第 2 行：两大核心教练工具（💡 招法提示、🛡️ 识破企图）与轻量更多项 */}
        <div className="flex items-center gap-1.5 w-full">
          <button
            type="button"
            className={`flex-1 flex items-center justify-center gap-1.5 h-9 rounded-xl border text-xs font-medium transition active:scale-95 ${
              helperOpen && helperMode === 'good'
                ? 'bg-cinnabar text-paper-0 border-cinnabar shadow-xs font-semibold'
                : 'bg-paper-0 border-hairline text-ink-1 hover:bg-paper-1'
            }`}
            onClick={() => void onOpenHelper('good')}
            title="💡 招法提示：演示当前局面最佳走法"
          >
            <span>💡</span>
            <span>招法提示</span>
          </button>

          <button
            type="button"
            className={`flex-1 flex items-center justify-center gap-1.5 h-9 rounded-xl border text-xs font-medium transition active:scale-95 ${
              helperOpen && helperMode === 'threat'
                ? 'bg-amber-500/15 border-amber-500 text-amber-900 shadow-xs font-semibold'
                : 'bg-paper-0 border-hairline text-ink-1 hover:bg-paper-1'
            }`}
            onClick={() => void onOpenHelper('threat')}
            title="🛡️ 识破企图：演示若不设防对手接下来的威胁招法"
          >
            <span>🛡️</span>
            <span>识破企图</span>
          </button>

          <div className="relative" ref={menuRef}>
            <button
              type="button"
              className={`w-9 h-9 flex items-center justify-center rounded-xl border text-xs font-medium transition active:scale-95 ${
                moreMenuOpen || showTypeInput || (helperOpen && helperMode === 'guide')
                  ? 'bg-paper-2 border-hairline text-ink-0'
                  : 'bg-paper-0 border-hairline text-ink-2 hover:bg-paper-1'
              }`}
              onClick={() => setMoreMenuOpen((v) => !v)}
              title="更多功能 (算路拆解、键入)"
            >
              ···
            </button>
            {moreMenuOpen && (
              <div className="absolute right-0 top-full mt-2 w-36 py-1 bg-paper-0 rounded-xl border border-hairline shadow-xl flex flex-col z-50 text-xs animate-in zoom-in-95 duration-150">
                <button
                  type="button"
                  className="flex items-center gap-2 px-3 py-2 text-left hover:bg-paper-1 text-ink-1 transition"
                  onClick={() => {
                    setMoreMenuOpen(false)
                    void onOpenHelper('guide')
                  }}
                >
                  <span>🧭</span>
                  <span>算路拆解</span>
                </button>
                <button
                  type="button"
                  className="flex items-center gap-2 px-3 py-2 text-left hover:bg-paper-1 text-ink-1 transition"
                  onClick={() => {
                    setMoreMenuOpen(false)
                    onToggleTypeInput()
                  }}
                >
                  <span>⌨️</span>
                  <span>键入走法 (/)</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ================= 桌面端：单行极简教练胶囊 (!hidden md:!inline-flex) ================= */}
      <div
        className={`!hidden md:!inline-flex relative h-[38px] px-3.5 rounded-full border border-hairline bg-paper-0/95 backdrop-blur-md shadow-xs items-center justify-center gap-2.5 box-border mx-auto transition-all duration-150 select-none ${
          thinking ? 'border-cinnabar bg-cinnabar/10 text-cinnabar' : ''
        }`}
      >
        {thinking ? (
          <div className="inline-flex items-center gap-2 h-full">
            <span className="w-2 h-2 rounded-full bg-cinnabar animate-pulse" aria-hidden="true" />
            <span className="text-[12.5px] font-medium text-cinnabar whitespace-nowrap">
              引擎推演中…
            </span>
            <button
              type="button"
              className="px-2.5 py-0.5 text-[11px] h-6 rounded-full border border-cinnabar/40 text-cinnabar bg-paper-0 inline-flex items-center gap-1 cursor-pointer whitespace-nowrap hover:bg-cinnabar hover:text-white transition-colors duration-150 active:scale-95"
              onClick={onStop}
              title="采用当前最优步 (Space)"
            >
              采用最优步
              <kbd className="font-num text-[10px] opacity-75 ml-0.5">Space</kbd>
            </button>
          </div>
        ) : lastEngineMove ? (
          <div className="inline-flex items-center gap-2.5 h-full w-auto">
            {/* 左侧：应手展示与悔棋 */}
            <div className="inline-flex items-center gap-2 shrink-0">
              <button
                key={lastEngineMove.ply}
                type="button"
                className="inline-flex items-center gap-1.5 px-2.5 py-0.5 h-[26px] rounded-lg border border-hairline bg-paper-1 cursor-pointer transition-all duration-150 hover:border-cinnabar/60 hover:shadow-xs active:scale-95"
                onClick={() => void onCopyMove(lastEngineMove.iccs, lastEngineMove.chinese)}
                title="点击复制走法"
              >
                <span className="text-[10.5px] font-medium text-ink-3">
                  {playMode === 'sparring' ? '对手' : '应手'}
                </span>
                <span
                  className={`font-kai text-[15px] font-bold tracking-wider leading-none whitespace-nowrap transition-colors ${
                    copied ? 'text-jade' : 'text-cinnabar'
                  }`}
                >
                  {lastEngineMove.chinese}
                </span>
                {copied && (
                  <span className="text-[10px] text-jade font-medium animate-fadeIn">✓</span>
                )}
              </button>

              {playMode === 'sparring' && onUndo && (
                <button
                  type="button"
                  className="px-2 py-0.5 h-[24px] text-[11px] rounded-full whitespace-nowrap leading-none bg-paper-1 hover:bg-paper-2 border border-hairline text-ink-2 hover:text-ink-0 cursor-pointer inline-flex items-center transition-all duration-150 active:scale-95"
                  onClick={onUndo}
                  title="撤回上一步 (Ctrl+Z)"
                >
                  ↩ 悔棋
                </button>
              )}
            </div>

            {/* 优雅分隔线 */}
            <div className="h-4 w-px bg-hairline" />

            {/* 右侧：两大高频心法与微型更多胶囊 */}
            <div className="inline-flex items-center gap-1.5 shrink-0" ref={menuRef}>
              <button
                type="button"
                className={`px-3 py-1 h-[26px] text-xs rounded-full whitespace-nowrap leading-none font-medium cursor-pointer inline-flex items-center gap-1 active:scale-95 transition-all shadow-xs ${
                  helperOpen && helperMode === 'good'
                    ? 'bg-cinnabar text-paper-0 ring-2 ring-cinnabar/30'
                    : 'bg-paper-1 hover:bg-paper-2 border border-hairline text-ink-0'
                }`}
                onClick={() => void onOpenHelper('good')}
                title="💡 招法提示：演示当前局面的最佳走法"
              >
                <span>💡</span>
                <span>招法提示</span>
              </button>

              <button
                type="button"
                className={`px-3 py-1 h-[26px] text-xs rounded-full whitespace-nowrap leading-none font-medium cursor-pointer inline-flex items-center gap-1 active:scale-95 transition-all ${
                  helperOpen && helperMode === 'threat'
                    ? 'bg-amber-500/15 border border-amber-500 text-amber-900 font-semibold'
                    : 'bg-paper-1 hover:bg-paper-2 border border-hairline text-ink-1'
                }`}
                onClick={() => void onOpenHelper('threat')}
                title="🛡️ 识破企图：演示若不设防对手接下来的威胁招法"
              >
                <span>🛡️</span>
                <span>识破企图</span>
              </button>

              <div className="relative">
                <button
                  type="button"
                  className={`w-[26px] h-[26px] flex items-center justify-center rounded-full border text-xs font-semibold cursor-pointer transition active:scale-95 ${
                    moreMenuOpen || showTypeInput || (helperOpen && helperMode === 'guide')
                      ? 'bg-paper-2 border-hairline text-ink-0'
                      : 'bg-paper-1 border-hairline text-ink-3 hover:text-ink-0 hover:bg-paper-2'
                  }`}
                  onClick={() => setMoreMenuOpen((v) => !v)}
                  title="更多工具 (算路拆解、键盘键入)"
                >
                  ···
                </button>
                {moreMenuOpen && (
                  <div className="absolute right-0 top-full mt-2 w-34 py-1 bg-paper-0 rounded-xl border border-hairline shadow-xl flex flex-col z-50 text-xs animate-in zoom-in-95 duration-150">
                    <button
                      type="button"
                      className="flex items-center gap-2 px-3 py-2 text-left hover:bg-paper-1 text-ink-1 transition"
                      onClick={() => {
                        setMoreMenuOpen(false)
                        void onOpenHelper('guide')
                      }}
                    >
                      <span>🧭</span>
                      <span>算路拆解</span>
                    </button>
                    <button
                      type="button"
                      className="flex items-center gap-2 px-3 py-2 text-left hover:bg-paper-1 text-ink-1 transition"
                      onClick={() => {
                        setMoreMenuOpen(false)
                        onToggleTypeInput()
                      }}
                    >
                      <span>⌨️</span>
                      <span>键入走法 (/)</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="inline-flex items-center gap-3 h-full">
            <span className="text-[12px] text-ink-3 whitespace-nowrap">对局已就绪</span>
            {gameEngineToMove && playing && (
              <button
                type="button"
                className="h-[24px] px-2.5 text-[11px] leading-none rounded-lg bg-cinnabar text-white font-medium shadow-xs active:scale-95"
                onClick={onEngineMove}
              >
                让引擎先出招
              </button>
            )}
            <div className="h-4 w-px bg-hairline" />
            <button
              type="button"
              className={`px-3 py-1 h-[26px] text-xs rounded-full whitespace-nowrap leading-none font-medium cursor-pointer inline-flex items-center gap-1 active:scale-95 transition-all shadow-xs ${
                helperOpen && helperMode === 'good'
                  ? 'bg-cinnabar text-paper-0 ring-2 ring-cinnabar/30'
                  : 'bg-paper-1 hover:bg-paper-2 border border-hairline text-ink-0'
              }`}
              onClick={() => void onOpenHelper('good')}
              title="💡 招法提示"
            >
              <span>💡</span>
              <span>招法提示</span>
            </button>
            <button
              type="button"
              className={`px-3 py-1 h-[26px] text-xs rounded-full whitespace-nowrap leading-none font-medium cursor-pointer inline-flex items-center gap-1 active:scale-95 transition-all ${
                helperOpen && helperMode === 'threat'
                  ? 'bg-amber-500/15 border border-amber-500 text-amber-900 font-semibold'
                  : 'bg-paper-1 hover:bg-paper-2 border border-hairline text-ink-1'
              }`}
              onClick={() => void onOpenHelper('threat')}
              title="🛡️ 识破企图"
            >
              <span>🛡️</span>
              <span>识破企图</span>
            </button>
          </div>
        )}
      </div>
    </>
  )
}
