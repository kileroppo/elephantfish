import type { GameSnapshot, VisualClues } from '../../types'
import { Board } from '../Board'

export interface ReplayBoardSectionProps {
  game: GameSnapshot
  sandboxSnap: GameSnapshot | null
  flipped: boolean
  sandboxBusy: boolean
  pvTrace: string[]
  visualClues?: VisualClues | null
  onMove: (iccs: string) => Promise<boolean>
  index: number
  totalPlies: number
  autoPlay: boolean
  prevGradedIndex: number
  nextGradedIndex: number
  onGo: (to: number) => void
  onToggleAutoPlay: () => void
  onToggleFlip: () => void
}

export function ReplayBoardSection({
  game,
  sandboxSnap,
  flipped,
  sandboxBusy,
  pvTrace,
  visualClues,
  onMove,
  index,
  totalPlies,
  autoPlay,
  prevGradedIndex,
  nextGradedIndex,
  onGo,
  onToggleAutoPlay,
  onToggleFlip,
}: ReplayBoardSectionProps) {
  return (
    <div className="replay-board flex flex-col items-center justify-between min-h-0 w-full h-full">
      {/* 棋盘包围盒：自适应最大化延展，严格保持 720/800 比例 */}
      <div className="board-wrap replay-board-wrap min-w-0 flex-1 w-full max-h-[calc(100%-46px)] aspect-[720/800] flex items-center justify-center relative">
        <Board
          game={sandboxSnap ?? game}
          flipped={flipped}
          flipping={false}
          thinking={sandboxBusy}
          pv={pvTrace}
          visualClues={visualClues ?? undefined}
          readOnly={!sandboxSnap}
          onMove={sandboxSnap ? onMove : async () => false}
        />
      </div>

      {/* 一体化横向中控台：单行整合步数、自动连播、漏着判分跳转与视角翻转，释放垂直空间放大棋盘 */}
      <div
        className="replay-control-bar w-full max-w-[580px] flex items-center justify-between px-2.5 py-1.5 mt-2 bg-paper-1/90 border border-hairline/80 rounded-xl shadow-3xs text-xs select-none backdrop-blur-sm shrink-0"
        data-replay-ctrl=""
      >
        {/* 1. 步数控制组：回到开局 / 后退 / 步数计数 / 前进 / 跳到终局 */}
        <div className="flex items-center gap-0.5 sm:gap-1">
          <button
            type="button"
            className="w-7 h-7 flex items-center justify-center rounded-lg text-ink-2 hover:text-ink-0 hover:bg-paper-2 transition cursor-pointer border border-transparent disabled:opacity-25 disabled:cursor-not-allowed"
            onClick={() => onGo(0)}
            disabled={index === 0}
            title="回到开局局面"
          >
            ⏮
          </button>
          <button
            type="button"
            className="w-7 h-7 flex items-center justify-center rounded-lg text-ink-2 hover:text-ink-0 hover:bg-paper-2 transition cursor-pointer border border-transparent disabled:opacity-25 disabled:cursor-not-allowed"
            onClick={() => onGo(index - 1)}
            disabled={index === 0}
            title="退回一手（←）"
          >
            ◀
          </button>

          <span
            className="font-num tabular-nums text-[11.5px] font-semibold px-2 py-0.5 rounded bg-paper-2/80 text-ink-1 min-w-[72px] text-center"
            data-replay-at=""
          >
            {index} / {totalPlies}
          </span>

          <button
            type="button"
            className="w-7 h-7 flex items-center justify-center rounded-lg text-ink-2 hover:text-ink-0 hover:bg-paper-2 transition cursor-pointer border border-transparent disabled:opacity-25 disabled:cursor-not-allowed"
            onClick={() => onGo(index + 1)}
            disabled={index >= totalPlies}
            title="前进一步（→）"
          >
            ▶
          </button>
          <button
            type="button"
            className="w-7 h-7 flex items-center justify-center rounded-lg text-ink-2 hover:text-ink-0 hover:bg-paper-2 transition cursor-pointer border border-transparent disabled:opacity-25 disabled:cursor-not-allowed"
            onClick={() => onGo(totalPlies)}
            disabled={index >= totalPlies}
            title="跳到终局"
          >
            ⏭
          </button>
        </div>

        <div className="w-px h-3.5 bg-hairline-strong/60 mx-1 shrink-0" aria-hidden="true" />

        {/* 2. 自动逐手连播控制 */}
        <button
          type="button"
          className={`h-7 px-2.5 rounded-lg text-xs font-medium transition cursor-pointer flex items-center gap-1 border shrink-0 ${
            autoPlay
              ? 'bg-cinnabar text-white border-cinnabar font-semibold shadow-xs'
              : 'bg-paper-2/70 hover:bg-paper-2 text-ink-2 border-hairline'
          }`}
          onClick={onToggleAutoPlay}
          disabled={totalPlies === 0}
          title={autoPlay ? '暂停自动播放' : '自动逐手连播'}
        >
          <span>{autoPlay ? '⏸ 暂停' : '▶ 连播'}</span>
        </button>

        <div className="w-px h-3.5 bg-hairline-strong/60 mx-1 shrink-0" aria-hidden="true" />

        {/* 3. 关键判分/漏着跳转与视角切换 */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="h-7 px-2 rounded-lg text-[11px] text-ink-2 hover:text-ink-0 bg-paper-2/60 hover:bg-paper-2 border border-hairline transition cursor-pointer disabled:opacity-25 disabled:cursor-not-allowed flex items-center gap-0.5"
            data-replay-prev-graded=""
            onClick={() => onGo(prevGradedIndex)}
            disabled={prevGradedIndex === index}
            title="跳转到上一处判分/失误点"
          >
            <span>⇤</span>
            <span className="hidden sm:inline">上处判分</span>
          </button>
          <button
            type="button"
            className="h-7 px-2 rounded-lg text-[11px] text-ink-2 hover:text-ink-0 bg-paper-2/60 hover:bg-paper-2 border border-hairline transition cursor-pointer disabled:opacity-25 disabled:cursor-not-allowed flex items-center gap-0.5"
            data-replay-next-graded=""
            onClick={() => onGo(nextGradedIndex)}
            disabled={nextGradedIndex === index}
            title="跳转到下一处判分/失误点"
          >
            <span className="hidden sm:inline">下处判分</span>
            <span>⇥</span>
          </button>

          <button
            type="button"
            className="w-7 h-7 flex items-center justify-center rounded-lg text-ink-2 hover:text-ink-0 hover:bg-paper-2 transition cursor-pointer border border-hairline ml-0.5 text-xs font-medium"
            onClick={onToggleFlip}
            title="翻转棋盘视角（快捷键 F）"
          >
            ⇅
          </button>
        </div>
      </div>
    </div>
  )
}
