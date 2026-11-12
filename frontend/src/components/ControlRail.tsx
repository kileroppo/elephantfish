import { useState } from 'react'
import type { AppState, Side } from '../types'
import { useGameContext } from '../context/GameContext'
import { useUIContext } from '../context/UIContext'
import { SPARRING_TIERS, type SparringTier } from './panels/SparringTierSelect'

export interface ControlRailProps {
  open?: boolean
  state?: AppState
  setupMode?: boolean
  onToggleSetup?: () => void
  onNewGame?: (side: Side) => void
  onResign?: () => void
  onSettings?: (patch: Partial<AppState['settings']>) => void
  playMode?: 'sparring' | 'relay'
  onTogglePlayMode?: () => void
}

export function ControlRail(props: ControlRailProps) {
  const g = useGameContext()
  const ui = useUIContext()

  // 常驻控制岛：桌面端恒在（禅意模式收起），无需任何把手
  const open = (props.open ?? true) && !ui.zenMode
  const state = props.state ?? g.state
  if (!state) return null

  const setupMode = props.setupMode ?? false
  const onToggleSetup = props.onToggleSetup
  const onNewGame = props.onNewGame ?? ((side: Side) => void g.newGame(side))
  const onResign = props.onResign ?? (() => void g.resign())
  const onSettings = props.onSettings ?? ((patch) => void g.updateSettings(patch))

  const playMode = props.playMode ?? ui.playMode
  const togglePlayMode = props.onTogglePlayMode ?? ui.togglePlayMode

  const { game, settings } = state
  const over = game.status.state !== 'playing'
  const activeTier = settings.sparring_level ?? 'master'
  const isEngineRed = game.engine_side === 'red'

  const [confirmResign, setConfirmResign] = useState(false)

  const handleSelectTier = (t: SparringTier) => {
    onSettings({
      sparring_level: t.id,
      max_depth: t.depth,
      think_ms: t.ms,
      engine_type: 'pikafish',
    })
  }

  const handleSelectSide = (sideChoice: 'red' | 'black') => {
    if (playMode === 'relay') {
      // 信使代下模式：sideChoice 是引擎执子方
      if (sideChoice === game.engine_side && !over) return
      ui.setFlipOverride(sideChoice === 'black')
      onNewGame(sideChoice)
    } else {
      // 实战陪练模式：sideChoice 是我执子方
      const nextEngineSide: Side = sideChoice === 'red' ? 'black' : 'red'
      if (nextEngineSide === game.engine_side && !over) return
      ui.setFlipOverride(sideChoice === 'black')
      onNewGame(nextEngineSide)
    }
  }

  const handleNewGame = () => {
    const shouldFlip =
      playMode === 'relay'
        ? game.engine_side === 'black'
        : game.engine_side === 'red'
    ui.setFlipOverride(shouldFlip)
    onNewGame(game.engine_side)
  }

  const handleResignClick = () => {
    if (confirmResign) {
      onResign()
      setConfirmResign(false)
    } else {
      setConfirmResign(true)
      window.setTimeout(() => setConfirmResign(false), 3000)
    }
  }

  const isPlayerRed = playMode === 'relay' ? isEngineRed : !isEngineRed
  const canUndo = !over && game.ply > 0 && !g.thinking

  return (
    <aside
      className={`rail rail-left w-full max-w-[var(--rail-l,262px)] flex flex-col p-1.5 transition-all select-none ${
        open ? 'is-open' : ''
      }`}
      aria-label="对局控制"
      aria-hidden={!open}
      {...(open ? {} : { inert: '' })}
    >
      {/* 宣纸匣面控制卡：轻浮起、柔和内衬、精致边距与呼吸感。
          shadow-panel 不是 Tailwind 类（tokens.css 的 :root 变量，且乌墨主题会覆盖为 none），
          必须用任意值类在使用处解析 var(--shadow-panel)，主题切换才跟随 */}
      <div className="w-full bg-paper-0/85 backdrop-blur-md rounded-2xl border border-hairline/90 shadow-[var(--shadow-panel)] p-3 flex flex-col gap-3">
        {/* 头部：标题与引擎微状态指示 */}
        <div className="flex items-center justify-between px-0.5 pb-0.5 border-b border-hairline/60">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-ink-2 font-display tracking-wide">
            <span className="w-1.5 h-1.5 rounded-full bg-cinnabar" aria-hidden="true" />
            <span>对局控制</span>
          </div>
          <div className="flex items-center gap-1">
            <span
              className={`text-[10px] font-num px-1.5 py-0.5 rounded-md border leading-none transition-colors ${
                g.thinking
                  ? 'bg-cinnabar/10 text-cinnabar border-cinnabar/30 animate-pulse'
                  : 'bg-paper-2/60 text-ink-3 border-hairline'
              }`}
              title="当前引擎"
            >
              {/* 真实引擎名随 engine_info.active 走，内置引擎不得谎报 Pikafish */}
              {g.thinking
                ? '思忖中…'
                : state.engine_info?.active === 'builtin'
                  ? '内置引擎'
                  : 'Pikafish'}
            </span>
          </div>
        </div>

        {/* 0. 窄屏下的模式切换分段器 */}
        <div
          className="w-full flex sm:hidden items-center p-0.5 bg-paper-2/70 rounded-lg border border-hairline text-xs font-medium"
          role="tablist"
          aria-label="对战模式选择"
        >
          <button
            type="button"
            role="tab"
            aria-selected={playMode === 'relay'}
            className={`flex-1 py-1 px-1.5 text-[11px] rounded-md transition-all duration-200 cursor-pointer border-0 flex items-center justify-center gap-1 ${
              playMode === 'relay'
                ? 'bg-paper-0 text-cinnabar shadow-2xs font-semibold'
                : 'bg-transparent text-ink-3 hover:text-ink-1'
            }`}
            onClick={() => {
              if (playMode !== 'relay') togglePlayMode()
            }}
            title="信使代下模式：我是转述人，引擎朝下"
          >
            <span>⚡ 信使代下</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={playMode === 'sparring'}
            className={`flex-1 py-1 px-1.5 text-[11px] rounded-md transition-all duration-200 cursor-pointer border-0 flex items-center justify-center gap-1 ${
              playMode === 'sparring'
                ? 'bg-paper-0 text-cinnabar shadow-2xs font-semibold'
                : 'bg-transparent text-ink-3 hover:text-ink-1'
            }`}
            onClick={() => {
              if (playMode !== 'sparring') togglePlayMode()
            }}
            title="实战陪练模式：我亲自下棋，我执朝我"
          >
            <span>🎯 实战陪练</span>
          </button>
        </div>

        {/* 1. 对弈段位选择：2×2 雅致对弈段位小卡片矩阵 */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between px-0.5">
            <span className="text-[11px] font-medium text-ink-3">段位棋力</span>
            <span className="text-[10px] text-ink-mute font-num">
              {activeTier === 'apprentice'
                ? '4层 · 拟人快'
                : activeTier === 'club'
                ? '8层 · 攻防敏'
                : activeTier === 'master'
                ? '14层 · 严密'
                : '22层 · 极深'}
            </span>
          </div>
          <div
            className="grid grid-cols-2 gap-1.5"
            role="tablist"
            aria-label="对弈段位选择"
          >
            {SPARRING_TIERS.map((t) => {
              const isOn = activeTier === t.id
              const shortName =
                t.id === 'apprentice'
                  ? '学徒'
                  : t.id === 'club'
                  ? '棋摊'
                  : t.id === 'master'
                  ? '名手'
                  : '宗师'
              const emoji =
                t.id === 'apprentice' ? '🌱' : t.id === 'club' ? '🍵' : t.id === 'master' ? '⚔️' : '👑'
              const subText =
                t.id === 'apprentice' ? '初学' : t.id === 'club' ? '民间' : t.id === 'master' ? '省冠' : '绝顶'

              return (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={isOn}
                  className={`h-9 px-2 rounded-xl text-xs transition-all duration-200 active:scale-[0.98] cursor-pointer border flex items-center justify-between text-left ${
                    isOn
                      ? 'bg-cinnabar/8 text-cinnabar border-cinnabar/50 font-semibold shadow-2xs'
                      : 'bg-paper-1/60 hover:bg-paper-2 text-ink-2 border-hairline/80 hover:border-ink-4/40'
                  }`}
                  onClick={() => handleSelectTier(t)}
                  title={`${t.label}（深度 ${t.depth}，拟人节奏约 ${t.ms}ms）`}
                >
                  <span className="flex items-center gap-1.5">
                    <span className="text-[11px]">{emoji}</span>
                    <span className="text-[11.5px] leading-tight">{shortName}</span>
                  </span>
                  <span
                    className={`text-[9.5px] font-num px-1 py-0.25 rounded ${
                      isOn ? 'bg-cinnabar/15 text-cinnabar' : 'text-ink-mute'
                    }`}
                  >
                    {subText}
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        {/* 2. 执子方选择器（阴阳双子对分） */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between px-0.5">
            <span className="text-[11px] font-medium text-ink-3">执子与先手</span>
            <span className="text-[10px] text-ink-mute font-num">
              {isPlayerRed ? '红先行' : '黑后至'}
            </span>
          </div>
          <div
            className="grid grid-cols-2 gap-1.5"
            role="radiogroup"
            aria-label="执子选择"
          >
            <button
              type="button"
              role="radio"
              aria-checked={isPlayerRed}
              className={`h-8.5 px-2 rounded-xl text-xs transition-all duration-200 active:scale-95 cursor-pointer border flex items-center justify-center gap-1.5 ${
                isPlayerRed
                  ? 'bg-cinnabar/10 text-cinnabar border-cinnabar/50 font-semibold shadow-2xs'
                  : 'bg-paper-1/60 hover:bg-paper-2 text-ink-2 border-hairline/80'
              }`}
              onClick={() => handleSelectSide('red')}
              title={
                playMode === 'relay'
                  ? '切换为引擎执红（红方朝下 · 引擎先手）'
                  : '切换为我执红方（红方朝我 · 我方先手）'
              }
            >
              <span className="w-2 h-2 rounded-full bg-piece-red" aria-hidden="true" />
              <span className="text-[11.5px] whitespace-nowrap">
                {playMode === 'relay' ? '引擎执红' : '我执红 (先)'}
              </span>
            </button>

            <button
              type="button"
              role="radio"
              aria-checked={!isPlayerRed}
              className={`h-8.5 px-2 rounded-xl text-xs transition-all duration-200 active:scale-95 cursor-pointer border flex items-center justify-center gap-1.5 ${
                !isPlayerRed
                  ? 'bg-ink-0/10 text-ink-0 border-ink-1/40 font-semibold shadow-2xs'
                  : 'bg-paper-1/60 hover:bg-paper-2 text-ink-2 border-hairline/80'
              }`}
              onClick={() => handleSelectSide('black')}
              title={
                playMode === 'relay'
                  ? '切换为引擎执黑（黑方朝下 · 对手先手）'
                  : '切换为我执黑方（黑方朝我 · 对方先手）'
              }
            >
              <span className="w-2 h-2 rounded-full bg-piece-black" aria-hidden="true" />
              <span className="text-[11.5px] whitespace-nowrap">
                {playMode === 'relay' ? '引擎执黑' : '我执黑 (后)'}
              </span>
            </button>
          </div>
        </div>

        {/* 3. 核心主操作：新局（金石印章质感全宽按钮） */}
        <button
          type="button"
          className="h-9 w-full rounded-xl font-display text-[13px] font-semibold tracking-[0.28em] indent-[0.28em] bg-gradient-to-b from-cinnabar-bright to-cinnabar text-white hover:brightness-105 active:scale-[0.98] transition-all shadow-xs flex items-center justify-center cursor-pointer border-0"
          onClick={handleNewGame}
        >
          新局
        </button>

        {/* 4. 对局快捷辅助 Dock (悔棋 / 视角翻转 / 防走错提醒) */}
        <div className="grid grid-cols-3 gap-1.5 pt-0.5">
          <button
            type="button"
            className="h-8 px-1.5 rounded-lg text-[11px] font-medium bg-paper-2/60 hover:bg-paper-2 text-ink-1 border border-hairline transition-all flex items-center justify-center gap-1 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed active:scale-95"
            onClick={() => void g.undoRound()}
            disabled={!canUndo}
            title="悔棋一回合 (快捷键 Ctrl+Z)"
          >
            <span>↶</span>
            <span>悔棋</span>
          </button>

          <button
            type="button"
            className="h-8 px-1.5 rounded-lg text-[11px] font-medium bg-paper-2/60 hover:bg-paper-2 text-ink-1 border border-hairline transition-all flex items-center justify-center gap-1 cursor-pointer active:scale-95"
            onClick={ui.turnBoard}
            title="翻转棋盘视角 (快捷键 F)"
          >
            <span>↺</span>
            <span>翻盘</span>
          </button>

          <button
            type="button"
            className={`h-8 px-1.5 rounded-lg text-[11px] font-medium transition-all flex items-center justify-center gap-1 cursor-pointer active:scale-95 border ${
              ui.coachGuard
                ? 'bg-jade/10 text-jade border-jade/40 font-semibold'
                : 'bg-paper-2/60 hover:bg-paper-2 text-ink-3 border-hairline'
            }`}
            onClick={ui.toggleCoachGuard}
            title={ui.coachGuard ? '防走错提醒：已开启（遇大漏招自动点拨）' : '防走错提醒：已关闭'}
          >
            <span>🛡️</span>
            <span>{ui.coachGuard ? '防错开' : '防错关'}</span>
          </button>
        </div>

        {/* 5. 底部次要操作文字链：自由排局 · 认输 */}
        <div className="flex items-center justify-between pt-1 px-1 text-[11px] text-ink-3 border-t border-hairline/60">
          <button
            type="button"
            className={`bg-transparent border-0 cursor-pointer p-0.5 rounded transition-colors flex items-center gap-1 ${
              setupMode
                ? 'text-amber-600 font-semibold'
                : 'hover:text-ink-1'
            }`}
            onClick={onToggleSetup}
            title={setupMode ? '点击退出自由排局' : '进入自由补棋与排局'}
          >
            <span>♟</span>
            <span>{setupMode ? '退出排局' : '自由排局'}</span>
          </button>

          <span className="text-hairline-strong select-none">·</span>

          <button
            type="button"
            className={`bg-transparent border-0 cursor-pointer p-0.5 rounded transition-colors ${
              confirmResign
                ? 'text-rose-600 font-semibold animate-pulse'
                : 'hover:text-rose-600 disabled:opacity-30 disabled:cursor-not-allowed'
            }`}
            disabled={over}
            onClick={handleResignClick}
            title={over ? '对局已结束' : '认输本局'}
          >
            {confirmResign ? '确认认输?' : '认输'}
          </button>
        </div>

        {/* 6. 最底部微型键盘快捷键贴士（Space 语义与 EngineHero「采用最优步」一致） */}
        <div className="text-[10px] text-ink-mute text-center pt-0.5 flex items-center justify-center gap-1.5 opacity-80">
          <span>Space 采用</span>
          <span>·</span>
          <span>Z 禅意</span>
          <span>·</span>
          <span>? 帮助</span>
        </div>
      </div>
    </aside>
  )
}
