import { useCallback, useEffect, useRef, useState } from 'react'
import type { GameRow, GamesSummary } from '../types'
import { api, ApiError } from '../api'
import { relativeTime, shortSide, sideName } from '../lib/format'
import { useUIContext } from '../context/UIContext'

/**
 * 复盘架：存档里**下过的那些局**，新的在前，点一局就开复盘台。
 *
 * 错题本按局面问「这种局面你错过几次」，这里按局问「哪一局值得重看」，靠的就是
 * 每行那个 `graded_plies`（这一局有几手带着判分）—— 判分是挂在能重放的棋谱上的，
 * 有判分的局才谈得上「复盘」。
 *
 * 与错题本同一条纪律：只在页面装载、按「重读」、切筛选（搜索词过 250ms 防抖）
 * 时发 `GET /api/games`，**不进 130ms 那条轮询**。它读的是存档，不是会话，读多少遍都不该改变任何一局；
 * 把它挂进轮询就等于让一个「看看下过什么」的请求去跟对局抢带宽。
 */

export interface GameShelfProps {
  /** 点开某一局：把 game_id 交给上层去开复盘台（那里才知道 focusPly 的事）。 */
  onPick?: (gameId: string) => void
}

export function downloadExportFile(content: string, filename: string, type = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export function GameShelf(props: GameShelfProps) {
  const ui = useUIContext()
  const onPick = props.onPick ?? ui.openReplay
  const [rows, setRows] = useState<GameRow[] | null>(null)
  const [summary, setSummary] = useState<GamesSummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [modeFilter, setModeFilter] = useState<'all' | 'sparring' | 'relay'>('all')
  const [searchQuery, setSearchQuery] = useState('')
  // 搜索框 value 只管受控回显（敲一键立刻显示），真正发给接口的查询词晚 250ms 才
  // 跟上：连续敲键的中间态根本不会发请求。首载不经防抖——debouncedQuery 初始就是
  // ''，下面的 reload effect 在装载时立即查一次；切筛选/按「重读」也直接走 reload。
  const [debouncedQuery, setDebouncedQuery] = useState('')
  // 过期响应守卫：每次发请求先领号，响应回来时若号已被更新的请求顶掉，整份丢弃——
  // 防止「先发后到」的慢响应把新结果盖回去（快速输入时列表乱序闪动的根源）。
  const requestSeqRef = useRef(0)

  const reload = useCallback(async () => {
    const seq = ++requestSeqRef.current
    setLoading(true)
    try {
      const reply = await api.games(undefined, modeFilter, debouncedQuery)
      if (seq !== requestSeqRef.current) return // 过期响应：已有更新的请求，丢弃
      setRows(reply.games ?? [])
      setSummary(reply.summary ?? null)
      setError(null)
    } catch (err) {
      if (seq !== requestSeqRef.current) return
      // 读失败就说读失败：留一副看起来「没下过棋」的空架比报个错更坏
      setError(err instanceof ApiError ? err.message : '历史那几局没读回来')
    } finally {
      if (seq === requestSeqRef.current) setLoading(false)
    }
  }, [modeFilter, debouncedQuery])

  // 搜索防抖：输入每敲一键只改 searchQuery，这里反复 clearTimeout 把 250ms 内的
  // 连击合并成停手后的一次查询词更新；组件卸载时 cleanup 兜底清掉定时器。
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(searchQuery), 250)
    return () => window.clearTimeout(timer)
  }, [searchQuery])

  useEffect(() => {
    void reload()
  }, [reload])

  const handleExportDataset = useCallback(
    async (format: 'jsonl' | 'pgn') => {
      setExporting(true)
      try {
        const res = await api.exportDataset(modeFilter, format)
        if (res.ok && res.content) {
          downloadExportFile(res.content, res.filename || `dataset-${modeFilter}.${format}`)
        }
      } catch (err) {
        setError(err instanceof ApiError ? err.message : '导出训练集失败')
      } finally {
        setExporting(false)
      }
    },
    [modeFilter],
  )

  return (
    <section className="panel shelf" aria-label="复盘架" data-shelf="">
      <header className="panel-head flex items-center justify-between">
        <h2>复盘架</h2>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            className="btn btn-outline btn-xs px-2 py-0.5 text-[11px] rounded cursor-pointer text-fg-muted hover:text-fg border-border-subtle"
            onClick={() => void handleExportDataset('jsonl')}
            disabled={exporting || !rows || rows.length === 0}
            title="批量导出当前筛选对局为训练集（JSONL 包含 FEN、走法、评分及 MultiPV）"
          >
            {exporting ? '导出中...' : '📥 导出训练集'}
          </button>
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
        </div>
      </header>

            {/* 搜索与过滤栏 */}
      <div className="flex items-center gap-1.5 my-1">
        <input
          type="text"
          placeholder="搜索对手 / 局号..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="flex-1 px-2 py-1 text-xs rounded border border-border-subtle/70 bg-paper-1 text-ink-0 placeholder:text-ink-3/60 focus:outline-hidden focus:border-primary/50"
        />
        {searchQuery && (
          <button
            type="button"
            className="text-xs text-ink-3 hover:text-ink-0 px-1"
            onClick={() => setSearchQuery('')}
            title="清空搜索"
          >
            ✕
          </button>
        )}
      </div>

      {/* 模式切换胶囊 Tab */}
      <div className="flex items-center gap-1 my-1.5 border-b border-border-subtle/50 pb-1.5 text-xs">
        <button
          type="button"
          className={`px-2 py-0.5 rounded cursor-pointer transition-colors ${
            modeFilter === 'all'
              ? 'bg-primary/10 text-primary font-medium'
              : 'text-fg-muted hover:text-fg'
          }`}
          onClick={() => setModeFilter('all')}
        >
          全部 {summary ? `(${summary.total_games})` : ''}
        </button>
        <button
          type="button"
          className={`px-2 py-0.5 rounded cursor-pointer transition-colors ${
            modeFilter === 'sparring'
              ? 'bg-cinnabar/10 text-cinnabar font-medium'
              : 'text-fg-muted hover:text-fg'
          }`}
          onClick={() => setModeFilter('sparring')}
        >
          ⚔️ 实战对战 {summary?.sparring_games !== undefined ? `(${summary.sparring_games})` : ''}
        </button>
        <button
          type="button"
          className={`px-2 py-0.5 rounded cursor-pointer transition-colors ${
            modeFilter === 'relay'
              ? 'bg-indigo-500/10 text-indigo-500 font-medium'
              : 'text-fg-muted hover:text-fg'
          }`}
          onClick={() => setModeFilter('relay')}
        >
          🤖 信使代下 {summary?.relay_games !== undefined ? `(${summary.relay_games})` : ''}
        </button>
      </div>

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
        <p className="hint mistake-hint">当前筛选条件下暂无对局记录。</p>
      )}

      {rows && rows.length > 0 && (
        <ul className="shelf-list">
          {rows.map((row) => {
            const isRelay = row.play_mode === 'relay'
            const isSetup = row.source === 'setup'
            const modeTag = isSetup
              ? '排局'
              : isRelay
              ? `代下${row.opponent_model ? ` · ${row.opponent_model}` : ''}`
              : '对战'

            return (
              <li key={row.game_id} className="shelf-row">
                <div className="flex items-center gap-1.5 w-full">
                  <button
                    type="button"
                    className={`shelf-pick flex-1${row.graded_plies ? ' has-graded' : ''}`}
                    onClick={() => onPick(row.game_id)}
                    title={`把这一局摆到复盘台上（${row.ply_count} 手）`}
                    data-shelf-game={row.game_id}
                  >
                    <span
                      className={`shelf-kind text-[11px] px-1.5 py-0.5 rounded font-medium ${
                        isRelay
                          ? 'text-indigo-500 bg-indigo-500/10'
                          : isSetup
                          ? 'text-fg-muted bg-fg-muted/10'
                          : 'text-cinnabar bg-cinnabar/10'
                      }`}
                    >
                      {modeTag}
                    </span>
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
            )
          })}
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
