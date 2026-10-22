import { useEffect, useMemo, useRef } from 'react'
import type { GameSnapshot, MoveRecord } from '../types'
import { useGameContext } from '../context/GameContext'
import { MoveListCell } from './panels/MoveListCell'

export interface MoveListProps {
  game?: GameSnapshot
  gameId?: string
}

interface Round {
  index: number
  red: MoveRecord | null
  black: MoveRecord | null
}

export function MoveList(props: MoveListProps) {
  const g = useGameContext()
  const game = props.game ?? g.state?.game
  if (!game) return null

  const rounds = useMemo<Round[]>(() => {
    const out: Round[] = []
    let red: MoveRecord | null = null
    game.records.forEach((rec) => {
      if (rec.side === 'red') {
        if (red) out.push({ index: out.length + 1, red, black: null })
        red = rec
      } else {
        out.push({ index: out.length + 1, red, black: rec })
        red = null
      }
    })
    if (red) out.push({ index: out.length + 1, red, black: null })
    return out
  }, [game.records])

  const scroller = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = scroller.current
    if (el) el.scrollTop = el.scrollHeight
  }, [game.records.length])

  const lastPly = game.records.length

  return (
    <section
      className="panel movelist flex flex-col min-h-[180px] flex-1 max-h-[360px] pt-3 pb-1 border-t border-hairline"
      aria-label="棋谱"
    >
      <header className="panel-head flex items-center justify-between mb-2 px-1">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-3">棋谱</h2>
        <span className="panel-count text-[11px] font-num text-ink-mute bg-paper-2 px-2 py-0.5 rounded-full border border-hairline">
          {lastPly} 手
        </span>
      </header>

      <div
        className="move-scroll flex-1 min-h-[120px] overflow-y-auto scroll-smooth px-1 -mx-1"
        ref={scroller}
      >
        <table className="w-full border-collapse text-left">
          <tbody>
            {rounds.map((round) => (
              <tr
                key={round.index}
                className="move-round even:bg-paper-1/40 hover:bg-paper-2/30 transition-colors border-b border-hairline/40 last:border-b-0"
              >
                <td className="round-no w-7 py-1 pr-2 text-right font-num text-[10.5px] text-ink-mute align-middle select-none">
                  {round.index}
                </td>
                <td className="py-1 px-1 w-1/2 align-middle">
                  <MoveListCell
                    rec={round.red}
                    isLast={!!round.red && round.red.ply === lastPly}
                    gameId={game.game_id}
                  />
                </td>
                <td className="py-1 px-1 w-1/2 align-middle">
                  <MoveListCell
                    rec={round.black}
                    isLast={!!round.black && round.black.ply === lastPly}
                    gameId={game.game_id}
                  />
                </td>
              </tr>
            ))}
            {!rounds.length && (
              <tr>
                <td colSpan={3} className="move-empty py-6 text-center text-xs text-ink-mute font-kai">
                  还没有棋步
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}
