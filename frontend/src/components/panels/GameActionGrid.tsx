import { useState } from 'react'
import type { GameSnapshot, Side } from '../../types'

export interface GameActionGridProps {
  game: GameSnapshot
  over: boolean
  setupMode: boolean
  playMode: 'sparring' | 'relay'
  flipped?: boolean
  onNewGame: (side: Side) => void
  onUndo: () => void
  onResign: () => void
  onToggleSetup?: () => void
  onSetFlipOverride: (flip: boolean) => void
  onToggleFlip?: () => void
}

export function GameActionGrid({
  game,
  over,
  setupMode,
  playMode,
  flipped,
  onNewGame,
  onUndo,
  onResign,
  onToggleSetup,
  onSetFlipOverride,
  onToggleFlip,
}: GameActionGridProps) {
  const [confirmResign, setConfirmResign] = useState(false)
  const isEngineRed = game.engine_side === 'red'

  const handleNewGame = () => {
    if (playMode === 'sparring') {
      onSetFlipOverride(isEngineRed)
    }
    onNewGame(game.engine_side)
  }

  const handleToggleSide = () => {
    const nextSide = isEngineRed ? 'black' : 'red'
    if (playMode === 'sparring') {
      onSetFlipOverride(nextSide === 'red')
    }
    onNewGame(nextSide)
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
    <section className="flex flex-col gap-2 pt-3 border-t border-hairline/80">
      <header className="flex items-center justify-between pb-1 border-b border-hairline/60">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-3">对局操作</h3>
      </header>

      {/* 第 1 行：新对局 + 悔一步 */}
      <div className="action-grid grid grid-cols-2 gap-2">
        <button
          type="button"
          className="btn btn-primary h-8.5 px-3 rounded text-xs font-semibold bg-cinnabar text-white hover:bg-cinnabar-bright transition-colors shadow-xs flex items-center justify-center cursor-pointer border-0"
          onClick={handleNewGame}
        >
          新开一局
        </button>
        <button
          type="button"
          className="btn btn-ghost h-8.5 px-3 rounded text-xs font-medium bg-paper-2 hover:bg-paper-3 text-ink-1 border border-hairline transition-colors flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
          onClick={onUndo}
          disabled={!game.ply}
        >
          悔一步
        </button>
      </div>

      <div className="flex flex-col gap-2 mt-2">
        {/* 第 2 行：执子与先手通栏展示，绝不折行挤压 */}
        <button
          type="button"
          className="btn btn-ghost w-full h-8 px-2 rounded text-xs font-medium bg-paper-2/70 hover:bg-paper-2 text-ink-1 border border-hairline transition-colors flex items-center justify-center cursor-pointer whitespace-nowrap"
          onClick={handleToggleSide}
          title="切换我方执红/执黑"
        >
          执子先手：{isEngineRed ? '我执黑 · 引擎红' : '我执红 · 引擎黑'}
        </button>

        {/* 第 3 行：视角翻转 + 自由排局 */}
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            className="btn btn-ghost h-8 px-2 rounded text-xs font-medium bg-paper-2/70 hover:bg-paper-2 text-ink-1 border border-hairline transition-colors flex items-center justify-center cursor-pointer"
            onClick={() => {
              if (onToggleFlip) onToggleFlip()
              else onSetFlipOverride(!flipped)
            }}
            title="翻转棋盘视角 (快捷键 F)"
          >
            ⇅ 翻转视角
          </button>

          <button
            type="button"
            className={`btn h-8 px-2 rounded text-xs font-medium transition-colors flex items-center justify-center cursor-pointer border ${
              setupMode
                ? 'btn-warn bg-amber-600 text-white border-amber-700 font-semibold shadow-xs'
                : 'btn-ghost bg-paper-2/70 hover:bg-paper-2 text-ink-1 border-hairline'
            }`}
            onClick={onToggleSetup}
            title="自由摆子设定残局或特殊局面"
          >
            {setupMode ? '退出补棋' : '自由补棋'}
          </button>
        </div>

        {/* 第 4 行：认输（置底防误触） */}
        <button
          type="button"
          className={`btn w-full h-7.5 px-2 rounded text-xs font-medium transition-colors flex items-center justify-center cursor-pointer border ${
            confirmResign
              ? 'btn-danger bg-rose-600 text-white border-rose-700 font-semibold shadow-xs animate-pulse'
              : 'btn-ghost bg-transparent hover:bg-paper-2 text-ink-3 hover:text-ink-1 border-hairline/60'
          }`}
          disabled={over}
          onClick={handleResignClick}
        >
          {confirmResign ? '再点一次确认认输' : '认输'}
        </button>
      </div>
    </section>
  )
}
