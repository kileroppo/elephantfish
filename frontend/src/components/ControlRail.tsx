import { useState } from 'react'
import type { AppState, Side } from '../types'
import { useGameContext } from '../context/GameContext'
import { useUIContext } from '../context/UIContext'
import { SPARRING_TIERS, type SparringTier } from './panels/SparringTierSelect'
import { THINK_PRESETS } from './panels/AdvancedSettingsDrawer'

export interface ControlRailProps {
  open?: boolean
  state?: AppState
  setupMode?: boolean
  onToggleSetup?: () => void
  onNewGame?: (side: Side) => void
  onUndo?: () => void
  onResign?: () => void
  onSettings?: (patch: Partial<AppState['settings']>) => void
  playMode?: 'sparring' | 'relay'
  shadowGuess?: boolean
  onTogglePlayMode?: () => void
  onToggleShadowGuess?: () => void
}

export function ControlRail(props: ControlRailProps) {
  const g = useGameContext()
  const ui = useUIContext()

  const open = props.open ?? ui.railL
  const state = props.state ?? g.state
  if (!state) return null

  const setupMode = props.setupMode ?? false
  const onToggleSetup = props.onToggleSetup
  const onNewGame = props.onNewGame ?? ((side: Side) => void g.newGame(side))
  const onUndo = props.onUndo ?? (() => void g.undoRound())
  const onResign = props.onResign ?? (() => void g.resign())
  const onSettings = props.onSettings ?? ((patch) => void g.updateSettings(patch))

  const { game, settings } = state
  const over = game.status.state !== 'playing'
  const coachGuardOn = settings.coach_guard !== false
  const activeTier = settings.sparring_level ?? 'master'
  const isEngineRed = game.engine_side === 'red'

  const [moreOpen, setMoreOpen] = useState(false)
  const [confirmResign, setConfirmResign] = useState(false)

  const handleSelectTier = (t: SparringTier) => {
    onSettings({
      sparring_level: t.id,
      max_depth: t.depth,
      think_ms: t.ms,
      engine_type: t.engine,
    })
  }

  const handleToggleSide = () => {
    const nextSide = isEngineRed ? 'black' : 'red'
    // nextSide 为新对局引擎执子：引擎执红 -> 玩家执黑 (flipped = true)；引擎执黑 -> 玩家执红 (flipped = false)
    ui.setFlipOverride(nextSide === 'red')
    onNewGame(nextSide)
  }

  const handleNewGame = () => {
    ui.setFlipOverride(isEngineRed)
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

  return (
    <aside
      className={`rail rail-left w-full max-w-[var(--rail-l,262px)] flex flex-col p-1.5 transition-all select-none ${
        open ? 'is-open' : ''
      }`}
      aria-label="对局控制"
      aria-hidden={!open}
      {...(open ? {} : { inert: '' })}
    >
      {/* 极简 iOS 控制岛容器：高度 ~170px，优雅无遮挡 */}
      <div className="w-full flex flex-col bg-paper-0/95 backdrop-blur-md rounded-2xl border border-hairline shadow-[0_2px_12px_rgba(0,0,0,0.04)] overflow-hidden transition-all duration-300">
        {/* 顶部标题栏 */}
        <div className="flex items-center justify-between px-3.5 pt-3 pb-2 select-none">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-cinnabar" />
            <h2 className="text-xs font-semibold tracking-wider text-ink-0 m-0">
              对局控制
            </h2>
          </div>
          <span
            className={`text-[10.5px] font-num px-2 py-0.5 rounded-full border transition-colors ${
              coachGuardOn
                ? 'bg-jade/10 text-jade border-jade/30 font-medium'
                : 'bg-paper-2 text-ink-mute border-hairline'
            }`}
          >
            {coachGuardOn ? '指导中' : '静音'}
          </span>
        </div>

        {/* 核心控件区 */}
        <div className="px-3 pb-3 flex flex-col gap-2.5">
          {/* 1. iOS 原生风格分段控制器 (Segmented Control) */}
          <div
            className="w-full inline-flex p-0.5 bg-paper-2/90 rounded-xl border border-hairline text-xs font-medium"
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
              return (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={isOn}
                  className={`flex-1 py-1.5 px-1 rounded-[9px] text-[11px] font-medium transition-all duration-200 cursor-pointer border-0 flex items-center justify-center gap-0.5 whitespace-nowrap ${
                    isOn
                      ? 'bg-paper-0 text-cinnabar shadow-xs font-semibold'
                      : 'bg-transparent text-ink-3 hover:text-ink-1'
                  }`}
                  onClick={() => handleSelectTier(t)}
                  title={`${t.label}（${t.engine === 'pikafish' ? '皮卡鱼' : '纯Python'} · ${t.ms}ms）`}
                >
                  <span className="text-[10px]">{emoji}</span>
                  <span>{shortName}</span>
                </button>
              )
            })}
          </div>

          {/* 2. iOS 风格列表项与平滑 Toggle Switch */}
          <div className="flex items-center justify-between px-1 py-0.5">
            <span className="text-xs font-medium text-ink-1">实时防走错提醒</span>
            <button
              type="button"
              role="switch"
              aria-checked={coachGuardOn}
              className={`w-9 h-5 rounded-full transition-colors duration-200 cursor-pointer p-0.5 relative border ${
                coachGuardOn
                  ? 'bg-emerald-500 border-emerald-500'
                  : 'bg-paper-2 border-hairline-strong'
              }`}
              onClick={() => onSettings({ coach_guard: !coachGuardOn })}
              title="走错或漏着时，教练立即弹出提示与归因"
            >
              <div
                className={`w-3.5 h-3.5 rounded-full bg-white shadow-xs transition-transform duration-200 ${
                  coachGuardOn ? 'translate-x-4' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          {/* 3. 核心高频双核操作：新开一局 (重点) + 悔一步 */}
          <div className="grid grid-cols-2 gap-2 pt-0.5">
            <button
              type="button"
              className="h-8.5 px-3 rounded-xl text-xs font-semibold bg-cinnabar text-white hover:bg-cinnabar-bright transition-all shadow-xs flex items-center justify-center cursor-pointer border-0 active:scale-95"
              onClick={handleNewGame}
            >
              新开一局
            </button>
            <button
              type="button"
              className="h-8.5 px-3 rounded-xl text-xs font-medium bg-paper-2 hover:bg-paper-3 text-ink-1 border border-hairline transition-all flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer active:scale-95"
              onClick={onUndo}
              disabled={!game.ply}
            >
              悔一步
            </button>
          </div>

          {/* 4. 情境化内嵌抽屉：低频设置与动作展开 */}
          <div className="pt-1 border-t border-hairline/60">
            <button
              type="button"
              className="w-full flex items-center justify-between py-1 px-1 rounded-md text-[11px] font-medium text-ink-4 hover:text-ink-1 hover:bg-paper-2/60 transition-colors cursor-pointer border-0 bg-transparent"
              onClick={() => setMoreOpen(!moreOpen)}
            >
              <span>··· 更多对局设置</span>
              <span
                className={`text-[9px] transition-transform duration-200 ${
                  moreOpen ? 'rotate-180' : ''
                }`}
              >
                ▼
              </span>
            </button>

            {/* 展开区：执子、翻转、补棋、认输、高级参数 */}
            {moreOpen && (
              <div className="flex flex-col gap-2 mt-2 pt-1 border-t border-hairline/40 animate-fadeIn">
                <button
                  type="button"
                  className="w-full h-7.5 px-2 rounded-lg text-xs font-medium bg-paper-2/70 hover:bg-paper-2 text-ink-1 border border-hairline transition-colors flex items-center justify-center cursor-pointer whitespace-nowrap"
                  onClick={handleToggleSide}
                >
                  执子先手：{isEngineRed ? '我执黑 · 引擎红' : '我执红 · 引擎黑'}
                </button>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    className="h-7.5 px-2 rounded-lg text-xs font-medium bg-paper-2/70 hover:bg-paper-2 text-ink-1 border border-hairline transition-colors flex items-center justify-center cursor-pointer"
                    onClick={() => ui.setFlipOverride(!ui.flipped)}
                    title="翻转棋盘视角 (快捷键 F)"
                  >
                    ⇅ 翻转视角
                  </button>

                  <button
                    type="button"
                    className={`h-7.5 px-2 rounded-lg text-xs font-medium transition-colors flex items-center justify-center cursor-pointer border ${
                      setupMode
                        ? 'bg-amber-600 text-white border-amber-700 font-semibold'
                        : 'bg-paper-2/70 hover:bg-paper-2 text-ink-1 border-hairline'
                    }`}
                    onClick={onToggleSetup}
                  >
                    {setupMode ? '退出补棋' : '自由排局'}
                  </button>
                </div>

                {/* 思考时限 */}
                <div className="flex flex-col gap-1.5 pt-1.5 border-t border-hairline/40">
                  <span className="text-[10.5px] font-medium text-ink-3">单步思考时间</span>
                  <div className="grid grid-cols-2 gap-1">
                    {THINK_PRESETS.map((p) => {
                      const isOn = Math.abs(settings.think_ms - p.ms) < 150
                      return (
                        <button
                          key={p.ms}
                          type="button"
                          className={`h-6.5 rounded-md text-[10.5px] border flex items-center justify-center font-medium cursor-pointer transition-colors ${
                            isOn
                              ? 'bg-cinnabar text-white border-cinnabar font-semibold shadow-xs'
                              : 'bg-paper-1/60 hover:bg-paper-2 text-ink-2 border-hairline'
                          }`}
                          onClick={() => onSettings({ think_ms: p.ms })}
                        >
                          {p.label}
                        </button>
                      )
                    })}
                  </div>
                </div>

                {/* 认输按钮（置底防误触） */}
                <div className="pt-1.5 border-t border-hairline/40">
                  <button
                    type="button"
                    className={`w-full h-7 px-2 rounded-lg text-xs font-medium transition-colors flex items-center justify-center cursor-pointer border ${
                      confirmResign
                        ? 'bg-rose-600 text-white border-rose-700 font-semibold shadow-xs animate-pulse'
                        : 'bg-transparent hover:bg-paper-2 text-ink-4 hover:text-rose-600 border-hairline/60'
                    }`}
                    disabled={over}
                    onClick={handleResignClick}
                  >
                    {confirmResign ? '再点一次确认认输' : '认输'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </aside>
  )
}
