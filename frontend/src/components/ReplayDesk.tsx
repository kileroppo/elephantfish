import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, ApiError } from '../api'
import type { ReplayReply } from '../types'
import { buildReplay, describeSource, snapshotAt } from '../lib/replay'
import { gradeDetail, gradeLabel, relativeTime, scoreText, shortSide, sideName, whySentence } from '../lib/format'
import { Board } from './Board'
import { useExitPhase } from '../hooks/useExitPhase'

/**
 * 复盘台：把**存档里那一局**一手手摆回盘上。
 *
 * 它是错题本答不了的那一半。错题本问的是「这个局面你错过几次」，这里问的是
 * 「那一局究竟是怎么走到那个局面的」—— 人要重下一手漏着的棋，需要的不是那道题的
 * 答案，是从第一手起的那段来路。所以这里的每一手都带着它自己的判分与「为什么」，
 * 措辞仍然只从 `lib/format.ts` 出来。
 *
 * 只读，而且**只读存档**：数据全部来自 `GET /api/game`，一眼都不看会话的实况。
 * 眼下这一局在底下照旧进行，关掉这层就回到原位 —— 回放一局不该改变任何一局。
 * 这条纪律不是装饰：`tools/smoke_http.py` 12 段就是拿「读历史前后 /api/state
 * 逐字段相同、三张表行数一根手指没动」把它钉住的。
 */

export interface ReplaySeed {
  gameId: string
  /** 从错题本跳过来时要点开的那一手（1 起）；null = 从开局看起 */
  focusPly: number | null
}

interface ReplayDeskProps {
  /** null = 没开。关掉时不能一帧摘掉，退场交给 useExitPhase。 */
  seed: ReplaySeed | null
  onClose: () => void
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

/** 下一手 / 上一手「带着判分」的那些手。找不到就原地不动 —— 不许偷偷跳到别的手。 */
function nextGraded(plies: ReplayReply['plies'], from: number, dir: 1 | -1): number {
  const step = dir
  for (let i = from + step; i >= 1 && i <= plies.length; i += step) {
    if (plies[i - 1]?.review) return i
  }
  return from
}

export function ReplayDesk({ seed, onClose }: ReplayDeskProps) {
  const open = seed !== null
  const [mounted, leaving] = useExitPhase(open)
  const [reply, setReply] = useState<ReplayReply | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [index, setIndex] = useState(0)
  const [flipped, setFlipped] = useState(false)
  const stripRef = useRef<HTMLDivElement>(null)

  const gameId = seed?.gameId ?? null
  const focusPly = seed?.focusPly ?? null

  useEffect(() => {
    if (!gameId) return
    let dead = false
    setLoading(true)
    setError(null)
    api
      .game(gameId)
      .then((r) => {
        if (dead) return
        setReply(r)
        // 进来站在**走过第 1 手之后**那一格，而不是第 0 手那个空开局：从棋谱第 1 手
        // 起看才是「重看那一局」，停在 0 会让人以为这一局第一步没走 —— 尤其引擎
        // 执红时，存档里第 1 手就是它走的，第 0 手看上去像「还没开始」。
        // 错题本跳过来时仍要落在那一手上；那一手不在这一局里（存档被改过、或题号
        // 本来就错）就退回第 1 手 —— 摆一副对不上的盘比回到第一步更坏。
        const want = focusPly ?? 1
        setIndex(want >= 1 && want <= r.plies.length ? want : r.plies.length ? 1 : 0)
        // 视角与「走进来的那一手」无关：**我方**（非引擎那一侧）朝下，跟现场那块盘
        // 同一个朝向（App.tsx 那条约定：引擎执黑 → flipped = true）。
        // 以前这里跟着 `focusPly` 那一手的行棋方走，于是引擎执红、从第 1 手跳进来时
        // 摆的是「红方已经走了一步」却写着第 0 手 —— 数与像对不上，是同一件事的另一半。
        // 想换个视角看这一局，有那颗「转」。
        setFlipped(r.game.engine_side === 'black')
      })
      .catch((err: unknown) => {
        if (dead) return
        setError(err instanceof ApiError ? err.message : '这一局没读回来')
      })
      .finally(() => {
        if (!dead) setLoading(false)
      })
  }, [gameId, focusPly])

  const replay = useMemo(
    () => (reply ? buildReplay(reply.game, reply.plies) : null),
    [reply],
  )
  const game = useMemo(() => (replay ? snapshotAt(replay, index) : null), [replay, index])
  const plies = reply?.plies ?? []
  const current = index > 0 ? plies[index - 1] : null
  const grade = current && current.by !== 'engine' ? gradeLabel(current.review) : null
  const why = current && current.by !== 'engine' ? whySentence(current.review) : null

  useEffect(() => {
    const el = stripRef.current?.querySelector<HTMLElement>(`[data-ply="${index}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [index])

  const go = useCallback((to: number) => setIndex(clamp(to, 0, plies.length)), [plies.length])

  useEffect(() => {
    if (!mounted || leaving) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        go(index - 1)
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        go(index + 1)
      } else if (e.key === 'Home') {
        e.preventDefault()
        go(0)
      } else if (e.key === 'End') {
        e.preventDefault()
        go(plies.length)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mounted, leaving, index, plies.length, go, onClose])

  if (!mounted) return null

  const summary = reply?.summary
  const head = reply?.game

  return (
    <div className={`overlay replay-veil${leaving ? ' is-leaving' : ''}`} onClick={onClose}>
      <div
        className={`sheet replay-desk${leaving ? ' is-leaving' : ''}`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="逐手回放"
        /* 自检锚点：`.devtools` 那几套读 data-*，不读 class（类名归样式所有）。
           当前停在第几手也写在这里 —— 回放对不对，看的是这一个数。 */
        data-replay=""
        data-replay-game={head?.game_id ?? seed?.gameId ?? ''}
        data-replay-ply={index}
        data-replay-flipped={flipped ? 'true' : 'false'}
        data-replay-loading={loading ? 'true' : 'false'}
        data-replay-error={error ? '1' : '0'}
      >
        <header className="sheet-head replay-head">
          <div>
            <h2>复盘台</h2>
            {/* 引擎那一侧只有一个名字可用：「引擎执黑」，与顶栏那枚按钮同一个说法。 */}
            <p className="replay-sub">
              {head
                ? `${describeSource(head.source)} ${head.game_id} · 引擎执${shortSide(head.engine_side)} · ` +
                  `${head.ply_count} 手 · ${relativeTime(head.updated_at)}`
                : '读存档里的那一局'}
            </p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="关闭复盘台">
            ✕
          </button>
        </header>

        {error && (
          <p className="hint replay-hint" data-replay-error-text="">
            {error}
          </p>
        )}

        {replay?.error && <p className="hint replay-hint">{replay.error}</p>}

        {game && replay && !replay.error && (
          <div className={`replay-body${loading ? ' is-loading' : ''}`}>
            <div className="replay-board">
              {/* 这一层直接沿用现场那块盘的几何（.board-wrap + .board 的
                  height:100% / aspect-ratio / max-width）。另写一套尺寸算法的话，
                  「复盘的盘」与「对局的盘」会在某个窗口宽度上长得不一样。 */}
              <div className="board-wrap replay-board-wrap">
                {/* 盘只吃这九个数（见 lib/replay.ts 的 snapshotAt）。可走点恒为空、
                    且 readOnly：回放那一局不是再走一局。 */}
                <Board
                  game={game}
                  flipped={flipped}
                  flipping={false}
                  thinking={false}
                  pv={[]}
                  readOnly
                  onMove={async () => false}
                />
              </div>
              <div className="replay-ctrl" data-replay-ctrl="">
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => go(0)}
                  disabled={index === 0} title="回到开局那个局面">
                  ⏮
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => go(index - 1)}
                  disabled={index === 0} title="退回一手（←）">
                  ◀
                </button>
                <span className="replay-at" data-replay-at="">
                  第 {index} / {plies.length} 手
                </span>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => go(index + 1)}
                  disabled={index >= plies.length} title="走一手（→）">
                  ▶
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => go(plies.length)}
                  disabled={index >= plies.length} title="到最后一手（End）">
                  ⏭
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setFlipped((v) => !v)}
                  title="换个视角看这一局"
                >
                  转
                </button>
              </div>
              <div className="replay-graded">
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  data-replay-prev-graded=""
                  onClick={() => go(nextGraded(plies, index, -1))}
                  disabled={nextGraded(plies, index, -1) === index}
                  title="上一手有判分的（也就是您录的那一手）"
                >
                  ⇤ 上一手判分
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  data-replay-next-graded=""
                  onClick={() => go(nextGraded(plies, index, 1))}
                  disabled={nextGraded(plies, index, 1) === index}
                  title="下一手有判分的"
                >
                  下一手判分 ⇥
                </button>
              </div>
            </div>

            <div className="replay-side">
              <p className="replay-now" data-replay-now="">
                {current ? (
                  <>
                    <b>{current.chinese || current.iccs}</b>
                    <span className={`replay-by by-${current.by} side-${current.side}`}>
                      {sideName(current.side)}
                      {current.by === 'engine' ? '·引擎' : '·录入'}
                    </span>
                    {grade && (
                      <span className={`grade-chip tone-${grade.tone}`} title={gradeDetail(current.review)}>
                        {grade.text}
                      </span>
                    )}
                    {current.eval_red !== null && (
                      <span className="replay-eval" title="走完这一手之后的评估（红方视角）">
                        {scoreText(current.eval_red, current.mate_in)}
                      </span>
                    )}
                  </>
                ) : (
                  <span className="replay-start">开局那个局面，还没走</span>
                )}
              </p>
              {/* 与判分块、错题本共用那一条样式：措辞与长相都只有一个出口 */}
              {why && <p className="learn-why replay-why" data-replay-why="">{why}</p>}

              <div className="replay-strip" ref={stripRef} data-replay-strip="">
                {plies.map((p) => {
                  const g = p.by === 'engine' ? null : gradeLabel(p.review)
                  const on = p.ply === index
                  return (
                    <button
                      type="button"
                      key={p.ply}
                      className={`replay-row by-${p.by} side-${p.side}${on ? ' is-on' : ''}`}
                      data-replay-row=""
                      data-ply={p.ply}
                      data-graded={p.review ? '1' : '0'}
                      aria-current={on ? 'step' : undefined}
                      onClick={() => go(p.ply)}
                      title={g ? gradeDetail(p.review) : undefined}
                    >
                      <span className="replay-n">{p.ply}</span>
                      <span className="replay-cn">{p.chinese || p.iccs}</span>
                      {p.captured && <em className="tag tag-capture">吃{p.captured}</em>}
                      {p.gives_check && <em className="tag tag-check">将</em>}
                      {p.mate && <em className="tag tag-mate">杀</em>}
                      {g ? (
                        <em className={`grade-chip tone-${g.tone}`}>{g.text}</em>
                      ) : (
                        p.by !== 'engine' && !p.review && (
                          <em className="grade-chip tone-mute" title="这一手没有判分：判分关着、或引擎当时腾不出空档">
                            未判分
                          </em>
                        )
                      )}
                    </button>
                  )
                })}
              </div>

              {summary && (
                <p className="replay-foot">
                  这一局 {summary.plies} 手，其中 {summary.graded_plies} 手带着判分。
                  {summary.unreadable > 0 ? ` 另有 ${summary.unreadable} 手的判分读不动。` : ''}
                  {head?.state && head.state !== 'playing'
                    ? ` 结局：${head.reason || head.state}${head.winner ? `（${sideName(head.winner)}胜）` : ''}。`
                    : ''}
                </p>
              )}
              {plies.length === 0 && (
                <p className="hint replay-hint">这一局存档里一步都没走 —— 只能看开局那个局面。</p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
