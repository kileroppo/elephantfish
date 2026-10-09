import { useEffect, useMemo, useRef } from 'react'
import type { GameSnapshot, MoveRecord } from '../types'
import { scoreText } from '../lib/format'

interface Props {
  game: GameSnapshot
}

interface Round {
  index: number
  red: MoveRecord | null
  black: MoveRecord | null
}

export function MoveList({ game }: Props) {
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
    <section className="panel movelist" aria-label="棋谱">
      <header className="panel-head">
        <h2>棋谱</h2>
        <span className="panel-count">{lastPly} 手</span>
      </header>

      <div className="move-scroll" ref={scroller}>
        <table>
          <tbody>
            {rounds.map((round) => (
              <tr key={round.index} className="move-round">
                <td className="round-no">{round.index}</td>
                <td>
                  <Cell rec={round.red} isLast={!!round.red && round.red.ply === lastPly} />
                </td>
                <td>
                  <Cell rec={round.black} isLast={!!round.black && round.black.ply === lastPly} />
                </td>
              </tr>
            ))}
            {!rounds.length && (
              <tr>
                <td colSpan={3} className="move-empty">
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

function Cell({ rec, isLast }: { rec: MoveRecord | null; isLast: boolean }) {
  if (!rec) return <span className="move-placeholder" />
  return (
    <span className={`move-cell by-${rec.by} side-${rec.side} ${isLast ? 'is-last' : ''}`}>
      <span className="move-glyph">{rec.glyph}</span>
      <span className="move-cn">{rec.chinese}</span>
      <span className="move-tags">
        {rec.captured_glyph && <em className="tag tag-capture">吃{rec.captured_glyph}</em>}
        {rec.check && <em className="tag tag-check">将</em>}
        {rec.mate && <em className="tag tag-mate">杀</em>}
      </span>
      {rec.eval !== null && rec.by === 'engine' && (
        <span className="move-eval">{scoreText(rec.eval)}</span>
      )}
    </span>
  )
}
