import { useEffect, useMemo, useRef } from 'react'
import type { GameSnapshot, MoveRecord } from '../types'
import { gradeDetail, gradeLabel, scoreText } from '../lib/format'

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
  // 每一手把棋谱带回最新那一行。「走这一段」不在这里写：
  // .move-scroll 上有 scroll-behavior: smooth，赋值本身就是平滑滚动，
  // 而且由合成器跑，不占落子那几百毫秒的主线程。
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
  // 判分只给人的步。引擎那一步的分是它自己搜出来的，旁边再挂一枚「第 2 名」
  // 只会把更可信的读数盖掉，所以引擎行留空 —— 空着比灰着更安静。
  const grade = rec.by === 'engine' ? null : gradeLabel(rec.review)
  return (
    <span className={`move-cell by-${rec.by} side-${rec.side} ${isLast ? 'is-last' : ''}`}>
      <span className="move-glyph">{rec.glyph}</span>
      <span className="move-cn">{rec.chinese}</span>
      <span className="move-tags">
        {rec.captured_glyph && <em className="tag tag-capture">吃{rec.captured_glyph}</em>}
        {rec.check && <em className="tag tag-check">将</em>}
        {rec.mate && <em className="tag tag-mate">杀</em>}
      </span>
      {grade ? (
        /* key = 文案：判分从「未判分」变成「至少差 1.4 兵」那一下才重挂载、播一次
           入场；同一句话在 130ms 轮询里反复渲染不会自己重播。 */
        <em
          key={`g${grade.text}`}
          className={`grade-chip tone-${grade.tone}`}
          title={gradeDetail(rec.review)}
        >
          {grade.text}
        </em>
      ) : (
        rec.by === 'opponent' && (
          <em
            className="grade-chip tone-mute"
            title="轮到你的时候引擎才在空档里算前几名；关掉判分、引擎正忙、或这一步还在搜索里时都不会有判分"
          >
            未判分
          </em>
        )
      )}
      {rec.eval !== null && rec.by === 'engine' && (
        <span className="move-eval" title={rec.mate_in !== null && rec.mate_in !== undefined
          ? '引擎算到这一步已经是杀棋'
          : '引擎落这一手时的评估，一个兵算 1.0'}>
          {scoreText(rec.eval, rec.mate_in ?? null)}
        </span>
      )}
    </span>
  )
}
