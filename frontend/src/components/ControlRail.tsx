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
  const isEngineRed = game.engine_side === 'red' // 引擎执红 = 玩家执黑

  const [confirmResign, setConfirmResign] = useState(false)

  const handleSelectTier = (t: SparringTier) => {
    onSettings({
      sparring_level: t.id,
      max_depth: t.depth,
      think_ms: t.ms,
      engine_type: 'pikafish',
    })
  }

  const handleSelectSide = (playerSide: 'red' | 'black') => {
    const nextEngineSide: Side = playerSide === 'red' ? 'black' : 'red'
    if (nextEngineSide === game.engine_side && !over) {
      return
    }
    // 玩家执黑 -> 翻转棋盘让黑方在底；玩家执红 -> 正向红在底
    ui.setFlipOverride(playerSide === 'black')
    onNewGame(nextEngineSide)
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
      {/* 极简 iOS 控制岛容器：极致轻薄，无折叠跳动 */}
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
          {/* 1. 对弈段位选择器 */}
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
                  title={`${t.label}（拟人节奏约 ${t.ms}ms）`}
                >
                  <span className="text-[10px]">{emoji}</span>
                  <span>{shortName}</span>
                </button>
              )
            })}
          </div>

          {/* 2. 执子方选择器（直接在主屏，无需展开） */}
          <div
            className="w-full inline-flex p-0.5 bg-paper-2/70 rounded-lg border border-hairline text-xs font-medium"
            role="radiogroup"
            aria-label="执子选择"
          >
            <button
              type="button"
              role="radio"
              aria-checked={!isEngineRed}
              className={`flex-1 py-1 px-1.5 rounded-md text-[11px] font-medium transition-all duration-200 cursor-pointer border-0 flex items-center justify-center gap-1 ${
                !isEngineRed
                  ? 'bg-paper-0 text-cinnabar shadow-xs font-semibold'
                  : 'bg-transparent text-ink-3 hover:text-ink-1'
              }`}
              onClick={() => handleSelectSide('red')}
              title="切换为我执红方（红方先手开局）"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-cinnabar" />
              <span>我执红 · 先手</span>
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={isEngineRed}
              className={`flex-1 py-1 px-1.5 rounded-md text-[11px] font-medium transition-all duration-200 cursor-pointer border-0 flex items-center justify-center gap-1 ${
                isEngineRed
                  ? 'bg-paper-0 text-ink-0 shadow-xs font-semibold'
                  : 'bg-transparent text-ink-3 hover:text-ink-1'
              }`}
              onClick={() => handleSelectSide('black')}
              title="切换为我执黑方（对方先出招）"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-ink-0" />
              <span>我执黑 · 后手</span>
            </button>
          </div>

          {/* 3. 实时防走错提醒 Toggle Switch */}
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

          {/* 4. 核心高频双核操作：新开一局 (重点) + 悔一步 */}
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

          {/* 5. 底部极简次要操作文字链：自由排局 · 认输 */}
          <div className="flex items-center justify-between pt-1.5 border-t border-hairline/60 px-1 text-[11px] text-ink-3">
            <button
              type="button"
              className={`bg-transparent border-0 cursor-pointer p-1 rounded transition-colors ${
                setupMode
                  ? 'text-amber-600 font-semibold'
                  : 'hover:text-ink-1'
              }`}
              onClick={onToggleSetup}
              title={setupMode ? '点击退出自由排局' : '进入自由补棋与排局'}
            >
              {setupMode ? '● 退出排局' : '自由排局'}
            </button>

            <span className="text-hairline-strong select-none">·</span>

            <button
              type="button"
              className={`bg-transparent border-0 cursor-pointer p-1 rounded transition-colors ${
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
        </div>
      </div>
    </aside>
  )
}
