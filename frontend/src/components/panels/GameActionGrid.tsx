import { useState } from 'react'
import type { GameSnapshot, Side } from '../../types'

export interface GameActionGridProps {
  game: GameSnapshot
  over: boolean
  setupMode: boolean
  playMode: 'sparring' | 'relay'
  onNewGame: (side: Side) => void
  onUndo: () => void
  onResign: () => void
  onToggleSetup?: () => void
  onSetFlipOverride: (flip: boolean) => void
}

export function GameActionGrid({
  game,
  over,
  setupMode,
  playMode,
  onNewGame,
  onUndo,
  onResign,
  onToggleSetup,
  onSetFlipOverride,
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
    <section className="panel bg-paper-0/80 rounded-md border border-hairline p-3 shadow-xs">
      <header className="panel-head pb-2 mb-2.5 border-b border-hairline/60">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-3">对局操作</h2>
      </header>

      <div className="action-grid grid grid-cols-2 gap-2">
        <button
          type="button"
          className="btn btn-primary h-9 px-3 rounded text-xs font-semibold bg-cinnabar text-white hover:bg-cinnabar-bright transition-colors shadow-xs flex items-center justify-center cursor-pointer border-0"
          onClick={handleNewGame}
        >
          新对局
        </button>
        <button
          type="button"
          className="btn btn-ghost h-9 px-3 rounded text-xs font-medium bg-paper-2 hover:bg-paper-3 text-ink-1 border border-hairline transition-colors flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
          onClick={onUndo}
          disabled={!game.ply}
        >
          悔一步
        </button>
      </div>

      <div className="flex flex-col gap-2 mt-2">
        <button
          type="button"
          className="btn btn-ghost wide w-full h-8 px-2 rounded text-xs font-medium bg-paper-2/70 hover:bg-paper-2 text-ink-1 border border-hairline transition-colors flex items-center justify-center cursor-pointer"
          onClick={handleToggleSide}
          title="切换执子方与先手"
        >
          执子与先手：{isEngineRed ? '我执黑 · 引擎红' : '我执红 · 引擎黑'}
        </button>

        <button
          type="button"
          className={`btn wide w-full h-8 px-2 rounded text-xs font-medium transition-colors flex items-center justify-center cursor-pointer border ${
            confirmResign
              ? 'btn-danger bg-rose-600 text-white border-rose-700 font-semibold shadow-xs animate-pulse'
              : 'btn-ghost bg-paper-2/70 hover:bg-paper-2 text-ink-2 border-hairline'
          }`}
          disabled={over}
          onClick={handleResignClick}
        >
          {confirmResign ? '再点一次确认认输' : '认输'}
        </button>

        <button
          type="button"
          className={`btn wide w-full h-8 px-2 rounded text-xs font-medium transition-colors flex items-center justify-center cursor-pointer border ${
            setupMode
              ? 'btn-warn bg-amber-600 text-white border-amber-700 font-semibold shadow-xs'
              : 'btn-ghost bg-paper-2/70 hover:bg-paper-2 text-ink-1 border-hairline'
          }`}
          onClick={onToggleSetup}
        >
          {setupMode ? '退出补棋' : '补棋 / 自定义排局'}
        </button>
      </div>
    </section>
  )
}
