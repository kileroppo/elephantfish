import type { GameSnapshot } from '../../types'
import { scoreText, seconds } from '../../lib/format'

export interface EngineHeroProps {
  thinking: boolean
  lastEngineMove: GameSnapshot['records'][number] | null
  playMode: 'sparring' | 'relay'
  shadowGuess: boolean
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
  // 移动端专用抽屉控制
  railL?: boolean
  railR?: boolean
  onToggleRailL?: () => void
  onToggleRailR?: () => void
}

export function EngineHero({
  thinking,
  lastEngineMove,
  playMode,
  shadowGuess,
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
  railL,
  railR,
  onToggleRailL,
  onToggleRailR,
}: EngineHeroProps) {
  return (
    <>
      {/* ================= 移动端：双行等宽对齐极简底栏 (!flex md:!hidden) ================= */}
      <div className="!flex md:!hidden flex-col gap-1.5 w-full max-w-[min(100vw-24px,460px)] mx-auto px-1 select-none">
        {/* 第 1 行：走法与对弈核心状态（去除枯燥技术数字，大字醒目展示当前步 + 快捷悔棋） */}
        <div
          className={`flex items-center justify-between h-10 px-3.5 rounded-xl border transition-all duration-150 ${
            thinking
              ? 'border-cinnabar bg-cinnabar/10 text-cinnabar shadow-xs'
              : 'border-hairline-strong bg-paper-0 shadow-xs'
          }`}
        >
          {thinking ? (
            <div className="flex items-center justify-between w-full">
              <div className="flex items-center gap-2 text-cinnabar font-medium text-xs">
                <span className="grid place-items-center w-4.5 h-4.5 rounded bg-cinnabar text-white font-kai text-[11px] font-semibold">
                  算
                </span>
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
                  className={`font-display text-[16px] font-bold tracking-wider transition-colors ${
                    copied ? 'text-jade' : 'text-cinnabar'
                  }`}
                >
                  {lastEngineMove.chinese}
                </span>
                <span className="text-[10px] text-ink-mute bg-paper-2 px-1.5 py-0.5 rounded-full border border-hairline whitespace-nowrap">
                  {copied ? '已复制' : '复制'}
                </span>
              </button>

              {onToggleCoachGuard && (
                <button
                  type="button"
                  className={`flex items-center gap-1 h-7.5 px-2 rounded-lg border text-[11px] font-medium transition active:scale-95 whitespace-nowrap ${
                    coachGuard
                      ? 'bg-paper-1 border-hairline-strong text-ink-1'
                      : 'bg-transparent border-dashed border-hairline text-ink-4'
                  }`}
                  onClick={onToggleCoachGuard}
                  title="走错失先弹窗提醒开关"
                >
                  {coachGuard ? '🛡️开' : '🛡️关'}
                </button>
              )}
              {playMode === 'sparring' && onUndo && (
                <button
                  type="button"
                  className="flex items-center gap-1 h-7.5 px-3 rounded-lg bg-paper-1 hover:bg-paper-2 border border-hairline-strong text-ink-1 text-xs font-medium transition active:scale-95 shadow-xs whitespace-nowrap"
                  onClick={onUndo}
                  title="撤回上一步 (Ctrl+Z)"
                >
                  ↩ 悔棋
                </button>
              )}
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

        {/* 第 2 行：4 个等宽对齐操作工具（💡提示、🛡️企图、⚙️设置、📜棋谱） */}
        <div className="grid grid-cols-4 gap-2 w-full">
          <button
            type="button"
            className={`flex items-center justify-center gap-1.5 h-9 rounded-xl border text-xs font-medium transition active:scale-95 ${
              helperOpen && helperMode === 'good'
                ? 'bg-jade/15 border-jade text-jade shadow-xs font-semibold'
                : 'bg-paper-0 border-hairline-strong text-ink-2 hover:bg-paper-1'
            }`}
            onClick={() => void onOpenHelper('good')}
            title="💡 提示一步"
          >
            <span className="text-sm">💡</span>
            <span>提示</span>
          </button>

          <button
            type="button"
            className={`flex items-center justify-center gap-1.5 h-9 rounded-xl border text-xs font-medium transition active:scale-95 ${
              helperOpen && helperMode === 'threat'
                ? 'bg-cinnabar/15 border-cinnabar text-cinnabar shadow-xs font-semibold'
                : 'bg-paper-0 border-hairline-strong text-ink-2 hover:bg-paper-1'
            }`}
            onClick={() => void onOpenHelper('threat')}
            title="🛡️ 威胁企图预警"
          >
            <span className="text-sm">🛡️</span>
            <span>企图</span>
          </button>

          <button
            type="button"
            className={`flex items-center justify-center gap-1.5 h-9 rounded-xl border text-xs font-medium transition active:scale-95 ${
              railL
                ? 'bg-ink-1 text-paper-0 border-ink-1 shadow-xs font-semibold'
                : 'bg-paper-0 border-hairline-strong text-ink-2 hover:bg-paper-1'
            }`}
            onClick={onToggleRailL}
            title={railL ? '收起对局设置' : '打开对局设置'}
          >
            <span className="text-sm">⚙️</span>
            <span>设置</span>
          </button>

          <button
            type="button"
            className={`flex items-center justify-center gap-1.5 h-9 rounded-xl border text-xs font-medium transition active:scale-95 ${
              railR
                ? 'bg-ink-1 text-paper-0 border-ink-1 shadow-xs font-semibold'
                : 'bg-paper-0 border-hairline-strong text-ink-2 hover:bg-paper-1'
            }`}
            onClick={onToggleRailR}
            title={railR ? '收起分析与棋谱' : '打开分析与棋谱'}
          >
            <span className="text-sm">📜</span>
            <span>棋谱</span>
          </button>
        </div>
      </div>

      {/* ================= 桌面端：单行超紧凑 Hero 胶囊 (!hidden md:!inline-flex) ================= */}
      <div
        className={`!hidden md:!inline-flex relative h-[38px] min-h-[38px] max-h-[38px] px-3.5 rounded-full border border-hairline-strong bg-paper-0 shadow-[0_1px_3px_rgba(0,0,0,0.05),inset_0_1px_0_rgba(255,255,255,0.6)] items-center justify-center gap-2.5 box-border mx-auto transition-all duration-150 ${
          thinking ? 'border-cinnabar bg-cinnabar/10 text-cinnabar' : ''
        }`}
      >
        {thinking ? (
          <div className="inline-flex items-center gap-2 h-full">
            <span
              className="grid place-items-center w-5 h-5 rounded bg-cinnabar text-[#fff8f2] font-kai text-[11.5px] font-semibold shadow-[0_1px_3px_rgba(180,50,42,0.3)]"
              aria-hidden="true"
            >
              算
            </span>
            <span className="text-[12.5px] font-medium text-cinnabar whitespace-nowrap">
              引擎推演中…
            </span>
            <button
              type="button"
              className="px-2 py-0.5 text-[11px] min-h-6 h-6 leading-none rounded-full border border-cinnabar/40 text-cinnabar bg-paper-0 inline-flex items-center gap-1 cursor-pointer whitespace-nowrap hover:bg-cinnabar hover:text-[#fff8f2] transition-colors duration-150"
              onClick={onStop}
              title="采用当前最优步 (Space)"
            >
              采用最优步
              <kbd className="font-num text-[10px] opacity-80 ml-0.5">Space</kbd>
            </button>
          </div>
        ) : lastEngineMove ? (
          <div className="inline-flex items-center gap-2 h-full w-auto">
            <div className="inline-flex items-center gap-1.5 shrink-0">
              <span className="text-[11px] font-medium text-ink-3 bg-paper-2 px-1.5 py-0.5 rounded border border-hairline tracking-wider whitespace-nowrap">
                {playMode === 'sparring' ? '对手' : '应手'}
              </span>
              <button
                key={lastEngineMove.ply}
                type="button"
                className={`inline-flex items-center gap-1.5 px-2 py-0.5 h-[26px] min-h-[26px] rounded-md border border-cinnabar/30 bg-paper-1 cursor-pointer box-border no-underline transition-all duration-150 hover:-translate-y-px hover:border-cinnabar hover:shadow-[0_2px_6px_rgba(180,50,42,0.18)] ${
                  copied ? '!border-jade !bg-jade/10' : ''
                }`}
                onClick={() => void onCopyMove(lastEngineMove.iccs, lastEngineMove.chinese)}
                title="点击复制走法给对手"
              >
                <span
                  className={`font-display text-[15px] font-bold text-cinnabar tracking-wider leading-none whitespace-nowrap ${
                    copied ? '!text-jade' : ''
                  }`}
                >
                  {lastEngineMove.chinese}
                </span>
                <span className="font-num text-[11px] text-ink-mute bg-paper-2 px-1 py-px rounded leading-none">
                  {lastEngineMove.iccs}
                </span>
                <span
                  className={`inline-flex items-center gap-0.5 text-[10px] text-ink-2 px-1.5 py-px rounded-full bg-paper-2 leading-none whitespace-nowrap ${
                    copied ? '!bg-jade !text-[#fff8f2]' : ''
                  }`}
                >
                  <svg
                    className="w-2.5 h-2.5"
                    viewBox="0 0 12 12"
                    width="10"
                    height="10"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    aria-hidden="true"
                  >
                    {copied ? (
                      <path d="M2.5 6.4 5 8.8 9.6 3.4" strokeLinecap="round" strokeLinejoin="round" />
                    ) : (
                      <>
                        <rect x="3.8" y="3.8" width="6" height="6" rx="1.2" />
                        <path d="M8.2 2.2H3.4c-.7 0-1.2.5-1.2 1.2v4.8" strokeLinecap="round" />
                      </>
                    )}
                  </svg>
                  {copied ? '已复制' : '复制'}
                </span>
              </button>
              {playMode === 'sparring' && onUndo && (
                <button
                  type="button"
                  className="px-2 py-0.5 h-6 min-h-6 text-[11px] rounded-full whitespace-nowrap leading-none bg-paper-1 border border-hairline-strong text-ink-2 cursor-pointer inline-flex items-center gap-1 hover:bg-paper-2 hover:text-ink-0 hover:border-hairline-strong transition-all duration-150"
                  onClick={onUndo}
                  title="撤回上一步 (Ctrl+Z)"
                >
                  ↩ 悔棋
                </button>
              )}
            </div>
            <div key={`m${lastEngineMove.ply}`} className="text-[11px] text-ink-mute whitespace-nowrap tracking-wide">
              深{lastEngineMove.depth} · {seconds(lastEngineMove.time)}
              {lastEngineMove.eval !== null &&
                ` · ${scoreText(lastEngineMove.eval, lastEngineMove.mate_in ?? null)}`}
              {shadowGuess && <span className="text-emerald-500 ml-1">· 盲猜</span>}
            </div>
            <div className="inline-flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                className={`px-3 py-1 h-7 min-h-7 text-xs rounded-full whitespace-nowrap leading-none font-medium bg-cinnabar text-paper-0 cursor-pointer inline-flex items-center gap-1 hover:brightness-105 active:scale-95 transition-all shadow-xs ${
                  helperOpen && helperMode === 'good' ? 'ring-2 ring-cinnabar/40' : ''
                }`}
                onClick={() => void onOpenHelper('good')}
                title="💡 提示一步：用动画演示最佳走法接下来怎么走"
              >
                💡 提示一步
              </button>
              <button
                type="button"
                className={`px-2.5 py-1 h-7 min-h-7 text-xs rounded-full whitespace-nowrap leading-none bg-paper-1 border border-hairline-strong text-ink-1 cursor-pointer inline-flex items-center gap-1 hover:bg-paper-2 hover:border-ink-2 active:scale-95 transition-all ${
                  helperOpen && helperMode === 'threat' ? '!border-cinnabar !text-cinnabar !bg-cinnabar/5' : ''
                }`}
                onClick={() => void onOpenHelper('threat')}
                title="🛡️ 威胁预警：用动画演示如果不设防，对手接下来怎么杀我"
              >
                🛡️ 威胁预警
              </button>
              {playMode === 'relay' && (
                <button
                  type="button"
                  className={`px-2.5 py-1 h-7 min-h-7 text-xs rounded-full whitespace-nowrap leading-none bg-paper-1 border border-hairline-strong text-ink-2 cursor-pointer inline-flex items-center gap-1 hover:bg-paper-2 hover:text-ink-0 transition-all ${
                    helperOpen && helperMode === 'guide' ? '!border-cinnabar !text-cinnabar !bg-cinnabar/5' : ''
                  }`}
                  onClick={() => void onOpenHelper('guide')}
                  title="🧠 算路三问：用第一性原理、逆向思维和对抗三问理清头绪"
                >
                  🧠 三问
                </button>
              )}
              {onToggleCoachGuard && (
                <button
                  type="button"
                  className={`px-2 py-1 h-7 min-h-7 text-xs rounded-full whitespace-nowrap leading-none border transition-all cursor-pointer inline-flex items-center gap-1 ${
                    coachGuard
                      ? 'bg-paper-1 border-hairline-strong text-ink-1 hover:border-ink-2'
                      : 'bg-transparent border-dashed border-hairline text-ink-4 hover:text-ink-2'
                  }`}
                  onClick={onToggleCoachGuard}
                  title={
                    coachGuard
                      ? `失误点拨：已开启（${playMode === 'sparring' ? '实战' : '转述'}模式点击可静默）`
                      : `失误点拨：已静默（点击开启当前模式点拨弹窗）`
                  }
                >
                  <span>{coachGuard ? '🛡️ 点拨:开' : '🛡️ 点拨:关'}</span>
                </button>
              )}
              <button
                type="button"
                className={`px-2 py-1 h-7 min-h-7 text-xs rounded-full whitespace-nowrap leading-none bg-transparent border border-hairline text-ink-3 cursor-pointer inline-flex items-center gap-1 hover:bg-paper-2 hover:text-ink-0 transition-all ${
                  showTypeInput ? '!bg-paper-2 !text-ink-0' : ''
                }`}
                onClick={onToggleTypeInput}
                title="键盘文本录入 (/)"
              >
                <span>⌨️ 键入</span>
                <kbd className="font-num text-[10px] opacity-60 ml-0.5">/</kbd>
              </button>
            </div>
          </div>
        ) : (
          <div className="inline-flex items-center gap-2 h-full">
            <div className="inline-flex items-center gap-1.5 shrink-0">
              <span className="text-[12px] text-ink-3 whitespace-nowrap">对局已就绪</span>
              {gameEngineToMove && playing && (
                <button
                  type="button"
                  className="min-h-6 h-6 px-2.5 py-0.5 text-[11px] leading-none rounded-lg bg-cinnabar text-white font-medium shadow-xs active:scale-95"
                  onClick={onEngineMove}
                >
                  让引擎先出招
                </button>
              )}
            </div>
            <div className="inline-flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                className={`px-3 py-1 h-7 min-h-7 text-xs rounded-full whitespace-nowrap leading-none font-medium bg-cinnabar text-paper-0 cursor-pointer inline-flex items-center gap-1 hover:brightness-105 active:scale-95 transition-all shadow-xs ${
                  helperOpen && helperMode === 'good' ? 'ring-2 ring-cinnabar/40' : ''
                }`}
                onClick={() => void onOpenHelper('good')}
                title="💡 提示一步"
              >
                💡 提示一步
              </button>
              <button
                type="button"
                className={`px-2.5 py-1 h-7 min-h-7 text-xs rounded-full whitespace-nowrap leading-none bg-paper-1 border border-hairline-strong text-ink-1 cursor-pointer inline-flex items-center gap-1 hover:bg-paper-2 hover:border-ink-2 active:scale-95 transition-all ${
                  helperOpen && helperMode === 'threat' ? '!border-cinnabar !text-cinnabar !bg-cinnabar/5' : ''
                }`}
                onClick={() => void onOpenHelper('threat')}
                title="🛡️ 威胁预警：用动画演示如果不设防，对手接下来怎么杀我"
              >
                🛡️ 威胁预警
              </button>
              {onToggleCoachGuard && (
                <button
                  type="button"
                  className={`px-2 py-1 h-7 min-h-7 text-xs rounded-full whitespace-nowrap leading-none border transition-all cursor-pointer inline-flex items-center gap-1 ${
                    coachGuard
                      ? 'bg-paper-1 border-hairline-strong text-ink-1 hover:border-ink-2'
                      : 'bg-transparent border-dashed border-hairline text-ink-4 hover:text-ink-2'
                  }`}
                  onClick={onToggleCoachGuard}
                  title={
                    coachGuard
                      ? `失误点拨：已开启（${playMode === 'sparring' ? '实战' : '转述'}模式点击可静默）`
                      : `失误点拨：已静默（点击开启当前模式点拨弹窗）`
                  }
                >
                  <span>{coachGuard ? '🛡️ 点拨:开' : '🛡️ 点拨:关'}</span>
                </button>
              )}
              <button
                type="button"
                className={`px-2 py-1 h-7 min-h-7 text-xs rounded-full whitespace-nowrap leading-none bg-transparent border border-hairline text-ink-3 cursor-pointer inline-flex items-center gap-1 hover:bg-paper-2 hover:text-ink-0 transition-all ${
                  showTypeInput ? '!bg-paper-2 !text-ink-0' : ''
                }`}
                onClick={onToggleTypeInput}
                title="键盘文本录入 (/)"
              >
                <span>⌨️ 键入</span>
                <kbd className="font-num text-[10px] opacity-60 ml-0.5">/</kbd>
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  )
}
