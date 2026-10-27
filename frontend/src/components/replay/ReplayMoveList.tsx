import { useMemo, useEffect, useRef, type RefObject } from 'react'
import type { ReplayReply } from '../../types'
import { gradeDetail, gradeLabel } from '../../lib/format'

export interface ReplayMoveListProps {
  plies: ReplayReply['plies']
  currentIndex: number
  stripRef?: RefObject<HTMLDivElement>
  onSelectPly: (ply: number) => void
}

interface RoundRow {
  round: number
  red?: ReplayReply['plies'][number]
  black?: ReplayReply['plies'][number]
}

function compactSymbol(tone: string) {
  switch (tone) {
    case 'bad':
      return { sym: '??', cls: 'text-rose-700 bg-rose-500/15' }
    case 'warn':
      return { sym: '?', cls: 'text-amber-700 bg-amber-500/15' }
    case 'soft':
      return { sym: '?!', cls: 'text-yellow-700 bg-yellow-500/15' }
    case 'good':
      return { sym: '✓', cls: 'text-emerald-700 bg-emerald-500/15' }
    default:
      return null
  }
}

/**
 * 经典双列记谱表（回合｜红方｜黑方）
 * 遵循职业象棋比赛记谱规范，红黑并排，极简符号标记（?? / ? / ✓），优雅紧凑。
 */
export function ReplayMoveList({
  plies,
  currentIndex,
  onSelectPly,
}: ReplayMoveListProps) {
  const activeCellRef = useRef<HTMLButtonElement | null>(null)

  // 将连续的单步序列聚合为标准回合对（回合｜红｜黑）
  const rounds = useMemo<RoundRow[]>(() => {
    const list: RoundRow[] = []
    let currentRound: RoundRow | null = null

    for (const p of plies) {
      if (p.side === 'red' || !currentRound) {
        currentRound = { round: list.length + 1 }
        list.push(currentRound)
      }

      if (p.side === 'red') {
        currentRound.red = p
      } else {
        if (!currentRound.black) {
          currentRound.black = p
        } else {
          currentRound = { round: list.length + 1, black: p }
          list.push(currentRound)
        }
      }
    }
    return list
  }, [plies])

  // 保证当前选中的步数始终在可视区内滚动对齐
  useEffect(() => {
    if (activeCellRef.current) {
      activeCellRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
  }, [currentIndex])

  const renderCell = (p?: ReplayReply['plies'][number]) => {
    if (!p) {
      return (
        <span className="h-7.5 px-2 flex items-center text-xs text-ink-mute/30 select-none">
          —
        </span>
      )
    }

    const on = p.ply === currentIndex
    const g = p.by === 'engine' ? null : gradeLabel(p.review)
    const isBlunder = g && (g.tone === 'bad' || g.tone === 'warn')
    const sym = g ? compactSymbol(g.tone) : null

    return (
      <button
        ref={on ? activeCellRef : undefined}
        type="button"
        className={`h-7.5 px-2 rounded-md text-xs font-medium transition-all cursor-pointer flex items-center justify-between gap-1 w-full border ${
          on
            ? 'bg-cinnabar/10 text-cinnabar border-cinnabar/40 font-bold shadow-3xs'
            : isBlunder
            ? 'bg-rose-500/5 hover:bg-rose-500/12 text-rose-900 border-rose-300/40'
            : 'bg-transparent hover:bg-paper-2 text-ink-1 border-transparent'
        }`}
        onClick={() => onSelectPly(p.ply)}
        title={g ? `${g.text} · ${gradeDetail(p.review)}` : undefined}
      >
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="font-num text-[10.5px] opacity-40 shrink-0">
            {p.ply}
          </span>
          <span className="font-display font-medium truncate">
            {p.chinese || p.iccs}
          </span>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {p.gives_check && (
            <span className="text-[10px] font-bold text-red-600 bg-red-100/80 px-1 rounded">
              将
            </span>
          )}
          {p.mate && (
            <span className="text-[10px] font-bold text-white bg-red-600 px-1 rounded shadow-3xs">
              杀
            </span>
          )}
          {sym && (
            <span
              className={`font-mono text-[10.5px] px-1 py-0.2 rounded font-bold ${sym.cls}`}
            >
              {sym.sym}
            </span>
          )}
        </div>
      </button>
    )
  }

  return (
    <div className="dual-score-container flex-1 min-h-0 flex flex-col rounded-xl bg-paper-1/70 border border-hairline overflow-hidden text-xs">
      {/* 表头：回合 ｜ 红方 ｜ 黑方 */}
      <div className="grid grid-cols-[38px_1fr_1fr] items-center px-2 py-1 bg-paper-2/90 border-b border-hairline text-[11px] font-semibold text-ink-3 select-none shrink-0">
        <span className="text-center font-num">回合</span>
        <span className="px-2 text-piece-red">🔴 红方</span>
        <span className="px-2 text-piece-black">⚫ 黑方</span>
      </div>

      {/* 滚动对局回合表 */}
      <div className="overflow-y-auto scrollbar-thin flex-1 min-h-0 p-1 flex flex-col gap-0.5">
        {rounds.map((r) => (
          <div
            key={r.round}
            className="grid grid-cols-[38px_1fr_1fr] items-center rounded-md hover:bg-paper-0/60 transition-colors"
          >
            <span className="font-num text-[11px] font-semibold text-ink-4 text-center select-none">
              {r.round}
            </span>
            <div className="px-0.5">{renderCell(r.red)}</div>
            <div className="px-0.5">{renderCell(r.black)}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
