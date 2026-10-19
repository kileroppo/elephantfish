import { useCallback, useEffect, useState } from 'react'
import type { MistakeEntry, MistakeSummary } from '../types'
import { api, ApiError } from '../api'
import { bestLineWord, gradeDetail, gradeLabel, relativeTime, sideName, whySentence } from '../lib/format'

/**
 * 错题本：把**存档里历次对局**的判分按局面聚在一起，一题一个局面。
 *
 * 它和左边那块「判分」是两种读数：那块讲眼下这一手，这块讲「这种局面你反复错过
 * 几次」。所以数据只从 `GET /api/mistakes` 来 —— 那是存档的只读投影，不动棋、
 * 也不动会话，读多少遍都不会改变任何一局。
 *
 * 一句判分的措辞仍然只从 `lib/format.ts` 出来（`gradeLabel` / `gradeDetail` /
 * `bestLineWord`）：服务端给的是事实（名次、差值、界类型、整份判分），
 * 「这个数能当真到什么程度」由那一个出口决定，这里不另拼一句话。
 */
interface MistakeBookProps {
  /** 「摆到盘上」：把这一题最差那次所在的那一局、那一手交给复盘台。 */
  onReplay: (gameId: string, ply: number | null) => void
  /** 「入营重练」：将该失误局面直接作为题目调入精训营进行攻坚实训 */
  onDrill?: (puzzleId: string) => void
}

export function MistakeBook({ onReplay, onDrill }: MistakeBookProps) {
  const [entries, setEntries] = useState<MistakeEntry[] | null>(null)
  const [summary, setSummary] = useState<MistakeSummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const reply = await api.mistakes()
      setEntries(reply.mistakes ?? [])
      setSummary(reply.summary ?? null)
      setError(null)
    } catch (err) {
      // 读失败就说读失败：留着一本看起来「没错题」的空账比报个错更坏
      setError(err instanceof ApiError ? err.message : '错题本没读回来')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const listed = entries?.length ?? 0

  return (
    <section className="panel mistakes" aria-label="错题本" data-mistakes="">
      <header className="panel-head">
        <h2>错题本</h2>
        <button
          type="button"
          className="mistake-reload"
          onClick={() => void reload()}
          disabled={loading}
          title="重新读一遍存档（这一步不改任何一局）"
        >
          {loading ? '读取中' : '重读'}
        </button>
      </header>

      <p className="mistake-source">
        {summary
          ? `来源：存档里的 ${summary.games} 局历次对局 —— 同一个局面被走过 ${summary.graded_plies} 次，` +
            `其中 ${summary.misses} 次证得出比引擎的第一选择差。不是这一局的棋谱。`
          : '来源：存档里的历次对局，按局面（不是按手数）把判分聚在一起。'}
      </p>

      {error && <p className="hint mistake-hint">{error}</p>}

      {!error && summary && summary.listed === 0 && (
        <p className="hint mistake-hint">
          {!summary.store_enabled
            ? '存档是关着的（EF_STORE=off），错题本没有东西可读。'
            : summary.positions === 0
              ? '还没有带判分的人步：开着判分下几手，这里才会有题。'
              : `判过分 ${summary.positions} 个局面，一次都没证出错 —— 这不等于都下对了，见下面那句。`}
        </p>
      )}

      {entries && entries.length > 0 && (
        <ul className="mistake-list">
          {entries.map((e) => (
            <MistakeRow key={e.fen_before} entry={e} onReplay={onReplay} onDrill={onDrill} />
          ))}
        </ul>
      )}

      {summary && (summary.blurred > 0 || summary.unreadable > 0) && (
        <p className="mistake-caveat">
          另有 {summary.blurred} 次判分证不出对错（界的方向互相抵消、或那一手压根没进引擎前几名），
          没有算进错题{summary.unreadable ? `；还有 ${summary.unreadable} 次判分读不出来` : ''}。
          这些也不是「下对了」。
        </p>
      )}

      {listed > 0 && (
        <p className="hint mistake-hint">
          「摆到盘上」开的是复盘台：它读的是存档里那一局，一手手摆回去；
          「入营重练」将此局面送入精训营由引擎动态防守实战攻坚。
        </p>
      )}
    </section>
  )
}

/** 一题：一个局面 + 它跨局攒下的那几笔账。要点开的是**最差那一次**所在的那一局。 */
function MistakeRow({
  entry,
  onReplay,
  onDrill,
}: {
  entry: MistakeEntry
  onReplay: (gameId: string, ply: number | null) => void
  onDrill?: (puzzleId: string) => void
}) {
  const review = entry.worst_review
  const grade = gradeLabel(review)
  const word = review ? bestLineWord(review) : '引擎第一选择'
  const why = whySentence(review)
  const blurredText = Object.entries(entry.blurred_kinds)
    .map(([kind, n]) => `${kind} ${n} 次`)
    .join(' · ')

  return (
    <li className={`mistake-row side-${entry.side}`}>
      <div className="mistake-top">
        <span className="mistake-side">{sideName(entry.side)}走</span>
        <span className="mistake-count" title={`这个局面带判分走过 ${entry.graded_plies} 次`}>
          错过 {entry.misses} / {entry.graded_plies} 次
        </span>
        <span className="mistake-games">{entry.games} 局</span>
      </div>

      <div className="mistake-line">
        {grade && (
          <span className={`grade-chip tone-${grade.tone}`} title={gradeDetail(review)}>
            {grade.text}
          </span>
        )}
        <span className="mistake-best">
          {word} <b>{entry.best_chinese || entry.best_iccs || '—'}</b>
          {entry.worst_chinese && (
            <em>
              你走 {entry.worst_chinese}
              {entry.worst_rank !== null ? ` · 第 ${entry.worst_rank} 名` : ''}
            </em>
          )}
        </span>
      </div>

      {/* 错题本挑的是**最差那次**，所以这句「为什么」讲的也是那一次的主变，
          不是眼前这一局 —— 与左边判分块共用同一个出口，两句话不会各说一套。 */}
      {why && <p className="mistake-why">{why}</p>}

      <code className="mistake-fen" title="这个局面（FEN）：错题本按它把历次对局归到同一题">
        {entry.fen_before}
      </code>

      <div className="mistake-foot">
        <span>
          最近一次：{entry.last_game_id} 第 {entry.last_ply ?? '—'} 手 ·{' '}
          {relativeTime(entry.last_at)}
        </span>
        {blurredText && <span className="mistake-blurred">看不准：{blurredText}</span>}
        {/* 摆上去的是**最差那一次**：这一题上面那句判分与那句「为什么」讲的就是它，
            复盘台停在别处就成了另一道题。存档里没有那一局时（worst_game_id 空）
            这颗按钮整个不出现 —— 按下去读回来一个 404 是骗人。 */}
        <div className="mistake-actions">
          {entry.worst_game_id && (
            <button
              type="button"
              className="btn btn-ghost btn-sm mistake-replay"
              onClick={() => onReplay(entry.worst_game_id, entry.worst_ply)}
              title={`把最差那次那一局（${entry.worst_game_id}）摆到复盘台上${
                entry.worst_ply ? `，停在第 ${entry.worst_ply} 手` : ''
              }`}
              data-mistake-replay={entry.worst_game_id}
            >
              摆到盘上
            </button>
          )}
          {entry.worst_game_id && onDrill && (
            <button
              type="button"
              className="btn btn-outline btn-sm mistake-drill"
              onClick={() => onDrill(`mistake_${entry.worst_game_id}_${entry.worst_ply ?? 1}`)}
              title="将该局面送入精训营，进行人机实战防守重练"
            >
              入营重练
            </button>
          )}
        </div>
      </div>
    </li>
  )
}
