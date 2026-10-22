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
    <div className="replay-board flex flex-col min-h-0">
      {/* 这一层直接沿用现场那块盘的几何（.board-wrap + .board 的
          height:100% / aspect-ratio / max-width）。另写一套尺寸算法的话，
          「复盘的盘」与「对局的盘」会在某个窗口宽度上长得不一样。 */}
      <div className="board-wrap replay-board-wrap min-w-0 flex-[0_1_auto] w-full max-h-full aspect-[720/800]">
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

      {/* 控制栏 */}
      <div className="replay-ctrl flex items-center justify-center gap-1.5 mt-2.5" data-replay-ctrl="">
        <button
          type="button"
          className="btn btn-ghost btn-sm text-xs px-2 py-1 rounded cursor-pointer disabled:opacity-40"
          onClick={() => onGo(0)}
          disabled={index === 0}
          title="回到开局那个局面"
        >
          ⏮
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm text-xs px-2 py-1 rounded cursor-pointer disabled:opacity-40"
          onClick={() => onGo(index - 1)}
          disabled={index === 0}
          title="退回一手（←）"
        >
          ◀
        </button>
        <span
          className="replay-at font-num tabular-nums text-[11.5px] text-ink-2 min-w-[92px] text-center"
          data-replay-at=""
        >
          第 {index} / {totalPlies} 手
        </span>
        <button
          type="button"
          className={`btn btn-ghost btn-sm text-xs px-2 py-1 rounded cursor-pointer disabled:opacity-40 ${
            autoPlay ? 'is-on !bg-paper-2 font-medium text-cinnabar' : ''
          }`}
          onClick={onToggleAutoPlay}
          disabled={totalPlies === 0}
          title={autoPlay ? '暂停自动回放' : '自动逐手连播'}
        >
          {autoPlay ? '⏸' : '▶ 连播'}
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm text-xs px-2 py-1 rounded cursor-pointer disabled:opacity-40"
          onClick={() => onGo(index + 1)}
          disabled={index >= totalPlies}
          title="走一手（→）"
        >
          ▶
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm text-xs px-2 py-1 rounded cursor-pointer disabled:opacity-40"
          onClick={() => onGo(totalPlies)}
          disabled={index >= totalPlies}
          title="到最后一手（End）"
        >
          ⏭
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm text-xs px-2 py-1 rounded cursor-pointer"
          onClick={onToggleFlip}
          title="换个视角看这一局"
        >
          转
        </button>
      </div>

      {/* 判分快速导航 */}
      <div className="replay-graded flex justify-center gap-2 mt-2">
        <button
          type="button"
          className="btn btn-ghost btn-sm text-xs px-2.5 py-1 rounded cursor-pointer disabled:opacity-40"
          data-replay-prev-graded=""
          onClick={() => onGo(prevGradedIndex)}
          disabled={prevGradedIndex === index}
          title="上一手有判分的（也就是您录的那一手）"
        >
          ⇤ 上一手判分
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm text-xs px-2.5 py-1 rounded cursor-pointer disabled:opacity-40"
          data-replay-next-graded=""
          onClick={() => onGo(nextGradedIndex)}
          disabled={nextGradedIndex === index}
          title="下一手有判分的"
        >
          下一手判分 ⇥
        </button>
      </div>
    </div>
  )
}
