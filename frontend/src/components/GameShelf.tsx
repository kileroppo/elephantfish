import { useCallback, useEffect, useState } from 'react'
import type { GameRow, GamesSummary } from '../types'
import { api, ApiError } from '../api'
import { describeSource } from '../lib/replay'
import { relativeTime, shortSide, sideName } from '../lib/format'
import { useUIContext } from '../context/UIContext'

/**
 * 复盘架：存档里**下过的那些局**，新的在前，点一局就开复盘台。
 *
 * 错题本按局面问「这种局面你错过几次」，这里按局问「哪一局值得重看」，靠的就是
 * 每行那个 `graded_plies`（这一局有几手带着判分）—— 判分是挂在能重放的棋谱上的，
 * 有判分的局才谈得上「复盘」。
 *
 * 与错题本同一条纪律：只在页面装载和按「重读」时发一次 `GET /api/games`，
 * **不进 130ms 那条轮询**。它读的是存档，不是会话，读多少遍都不该改变任何一局；
 * 把它挂进轮询就等于让一个「看看下过什么」的请求去跟对局抢带宽。
 */

export interface GameShelfProps {
  /** 点开某一局：把 game_id 交给上层去开复盘台（那里才知道 focusPly 的事）。 */
  onPick?: (gameId: string) => void
}

export function GameShelf(props: GameShelfProps) {
  const ui = useUIContext()
  const onPick = props.onPick ?? ui.openReplay
  const [rows, setRows] = useState<GameRow[] | null>(null)
  const [summary, setSummary] = useState<GamesSummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const reply = await api.games()
      setRows(reply.games ?? [])
      setSummary(reply.summary ?? null)
      setError(null)
    } catch (err) {
      // 读失败就说读失败：留一副看起来「没下过棋」的空架比报个错更坏
      setError(err instanceof ApiError ? err.message : '历史那几局没读回来')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  return (
    <section className="panel shelf" aria-label="复盘架" data-shelf="">
      <header className="panel-head">
        <h2>复盘架</h2>
        <button
          type="button"
          className="mistake-reload shelf-reload"
          data-shelf-reload=""
          onClick={() => void reload()}
          disabled={loading}
          title="重新读一遍存档（这一步不改任何一局）"
        >
          {loading ? '读取中' : '重读'}
        </button>
      </header>

      <p className="mistake-source shelf-source">
        {summary
          ? `共 ${summary.total_games} 局存档 · ${summary.graded_games} 局含教练判分`
          : '存档里的历次对局，新的在前。'}
      </p>

      {error && <p className="hint mistake-hint">{error}</p>}

      {!error && summary && !summary.store_enabled && (
        <p className="hint mistake-hint">
          存档是关着的（EF_STORE=off），这里没有可回放的棋谱。
        </p>
      )}

      {!error && summary?.store_enabled && rows?.length === 0 && (
        <p className="hint mistake-hint">库里还没有一局：下完（或录完）一局再来重读。</p>
      )}

      {rows && rows.length > 0 && (
        <ul className="shelf-list">
          {rows.map((row) => (
            <li key={row.game_id} className="shelf-row">
              <div className="flex items-center gap-1.5 w-full">
                <button
                  type="button"
                  className={`shelf-pick flex-1${row.graded_plies ? ' has-graded' : ''}`}
                  onClick={() => onPick(row.game_id)}
                  title={`把这一局摆到复盘台上（${row.ply_count} 手）`}
                  data-shelf-game={row.game_id}
                >
                  <span className="shelf-kind">{describeSource(row.source)}</span>
                  <span className="shelf-count">
                    {row.ply_count} 手
                    {row.graded_plies ? ` · ${row.graded_plies} 手有判分` : ''}
                  </span>
                  <span className="shelf-side">引擎执{shortSide(row.engine_side)}</span>
                  <span className="shelf-when">{relativeTime(row.updated_at)}</span>
                  <span className="shelf-over">
                    {row.state && row.state !== 'playing'
                      ? row.reason || (row.winner ? `${sideName(row.winner)}胜` : '结束')
                      : '进行中'}
                  </span>
                </button>
                {row.graded_plies > 0 && (
                  <button
                    type="button"
                    className="btn btn-outline btn-xs px-2 py-1 text-[11px] shrink-0 text-cinnabar border-cinnabar/40 hover:bg-cinnabar/10 rounded cursor-pointer"
                    onClick={() => ui.openDrillAt(undefined, row.game_id)}
                    title={`在训练营中拆解本局 ${row.graded_plies} 处胜负手`}
                  >
                    ⚔️ 拆解特训
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {summary?.truncated && (
        <p className="hint shelf-more">
          还有 {summary.total_games - summary.listed} 局没列出来（一次给 {summary.limit} 行）。
        </p>
      )}
    </section>
  )
}
