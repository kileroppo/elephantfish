import { useEffect, useMemo, useRef, useState } from 'react'
import type { GameSnapshot } from '../types'
import { scoreText, seconds } from '../lib/format'
import type { SubmitOutcome } from '../hooks/useGame'

interface Props {
  game: GameSnapshot
  thinking: boolean
  /** 已排队、等引擎收手就自动录入的那一步 */
  queued: string | null
  /** 是否自动把焦点交给输入框。用户改在棋盘上摆子之后，就不该再抢。 */
  autoFocus: boolean
  onTypeInput: () => void
  onSubmit: (text: string) => Promise<SubmitOutcome>
  onClearQueue: () => void
  onStop: () => void
  onEngineMove: () => void
}

/**
 * 转述台：整个界面的心脏。
 *
 * 左边是「对方走了什么」，右边是「我们回什么」。整个软件存在的意义就是把
 * 这两件事之间的摩擦降到零。
 *
 * 录入有两条路，**棋盘优先**：在盘上点一下子、再点落点（或者直接按住拖过去）
 * 是手最快的，不需要把棋步翻译成任何符号；只有习惯键盘的人，才在①里敲
 * 坐标或中文记谱。焦点策略跟着这个优先级走 —— 见 autoFocus 的用法。
 *
 * 有一点是刻意的：**引擎算棋的时候，输入框照样能打字**。人是从另一个窗口
 * 读对手的棋，没道理被我们这边的计算时间卡住；抢先录入的那一步会排队，
 * 引擎一收手立刻自动落子。
 */
export function RelayConsole({
  game,
  thinking,
  queued,
  autoFocus,
  onTypeInput,
  onSubmit,
  onClearQueue,
  onStop,
  onEngineMove,
}: Props) {
  const [text, setText] = useState('')
  const [shake, setShake] = useState(0)
  const [copied, setCopied] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // ①→② 传送带的相位机：对方走法进来，墨点从①走到②；
  // 应手给出，朱砂点从②回到①。
  // 它把「转述」这个动作变成可见的物理过程。
  // 注意：引擎思考时墨点不动 —— 下棋的人不需要看着机器算，
  // 只有「走法到了」和「应手出来了」这两下值得被看见。
  type RelayPhase = 'idle' | 'inbound' | 'outbound'
  const [phase, setPhase] = useState<RelayPhase>('idle')
  const prevPly = useRef(game.ply)

  useEffect(() => {
    const prev = prevPly.current
    prevPly.current = game.ply
    const last = game.last_move
    if (!last || game.ply !== prev + 1) return
    if (last.by === 'opponent') {
      setPhase('inbound')
      const t = window.setTimeout(() => setPhase((p) => (p === 'inbound' ? 'idle' : p)), 640)
      return () => window.clearTimeout(t)
    }
    if (last.by === 'engine') {
      setPhase('outbound')
      const t = window.setTimeout(() => setPhase((p) => (p === 'outbound' ? 'idle' : p)), 640)
      return () => window.clearTimeout(t)
    }
  }, [game.ply, game.last_move])

  const lastEngineMove = useMemo(() => {
    for (let i = game.records.length - 1; i >= 0; i -= 1) {
      if (game.records[i].by === 'engine') return game.records[i]
    }
    return null
  }, [game.records])

  const playing = game.status.state === 'playing'
  const myTurnToRelay = game.opponent_to_move && !thinking && playing
  const canType = playing && !queued

  // 焦点只在「键盘流」手里自动收回来。用户一旦开始在棋盘上摆子，
  // 每落一手就把焦点抢进输入框会让人烦到放弃用棋盘 —— 那恰好是我们最想推的路。
  useEffect(() => {
    if (autoFocus && myTurnToRelay) inputRef.current?.focus()
  }, [autoFocus, myTurnToRelay, game.ply])

  // 排队那一步落地之后把焦点收回来，接着录下一步
  useEffect(() => {
    if (autoFocus && !queued && playing) inputRef.current?.focus()
  }, [autoFocus, queued, playing])

  const suggestions = useMemo(() => {
    const q = text.trim()
    if (!q || q.length > 6) return []
    const lower = q.toLowerCase()
    return game.legal_moves
      .filter((m) => m.iccs.startsWith(lower) || m.chinese.startsWith(q))
      .slice(0, 6)
  }, [text, game.legal_moves])

  const submit = async (value?: string) => {
    const payload = (value ?? text).trim()
    if (!payload) return
    const outcome = await onSubmit(payload)
    if (outcome === 'ok') {
      setText('')
      setShake(0)
    } else if (outcome === 'queued') {
      setText('')
      setShake(0)
    } else {
      setShake((s) => s + 1)
    }
  }

  const copyMove = async (iccs: string, chinese: string) => {
    try {
      await navigator.clipboard.writeText(`${iccs}  ${chinese}`)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      setCopied(false)
    }
  }

  return (
    <section className="relay" aria-label="转述台">
      <div className={`relay-input ${myTurnToRelay ? 'is-active' : ''}`}>
        <header className="relay-head">
          <span className="relay-step">①</span>
          <h2>录入对方走法</h2>
          <span className="relay-sub">
            {!playing
              ? '对局已结束'
              : queued
                ? '已排队，等引擎收手'
                : myTurnToRelay
                  ? '点棋盘落子，或输入记谱'
                  : '引擎思考中，可先输入'}
          </span>
        </header>

        <div className="relay-field" key={shake}>
          <input
            ref={inputRef}
            value={text}
            spellCheck={false}
            autoComplete="off"
            disabled={!canType}
            placeholder={canType ? 'h2e2  或  炮二平五' : '—'}
            onChange={(e) => setText(e.target.value)}
            onFocus={onTypeInput}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submit()
              if (e.key === 'Escape') setText('')
              if (e.key === 'Tab' && suggestions.length) {
                e.preventDefault()
                setText(suggestions[0].iccs)
              }
            }}
            aria-label="对方走法，可输入坐标或中文记谱"
          />
          <button
            type="button"
            className="relay-go"
            disabled={!canType || !text.trim()}
            onClick={() => void submit()}
          >
            落子
          </button>
        </div>

        <div className="relay-hints">
          {queued ? (
            <button type="button" className="queue-chip" onClick={onClearQueue}>
              <span className="queue-dot" />
              <span className="queue-text">已排队 {queued}</span>
              <span className="queue-x">撤销</span>
            </button>
          ) : suggestions.length > 0 ? (
            suggestions.map((m) => (
              <button
                key={m.iccs}
                type="button"
                className="chip"
                onClick={() => void submit(m.iccs)}
              >
                <span className="chip-iccs">{m.iccs}</span>
                <span className="chip-cn">{m.chinese}</span>
              </button>
            ))
          ) : (
            <span className="relay-tip">
              <b>直接点棋盘上的棋子落子</b>（也可以按住拖过去）；或输入坐标 <code>h2e2</code>、
              记谱 <code>炮二平五</code>。
            </span>
          )}
        </div>
      </div>

      <div className={`relay-link phase-${phase}`} aria-hidden="true">
        <span className="relay-link-line" />
        <span className="relay-link-dot" />
        <span className="relay-link-line" />
        {/* 旅行墨点：key 带相位与手数，连续同相位也能重新触发 */}
        <span key={`${phase}-${game.ply}`} className="relay-link-ink" />
      </div>

      <div className={`relay-output ${thinking ? 'is-live' : ''}`}>
        <header className="relay-head">
          <span className="relay-step">②</span>
          <h2>引擎应手</h2>
          <span className="relay-sub">
            {thinking ? '思考中' : lastEngineMove ? `深度 ${lastEngineMove.depth}` : '尚未出招'}
          </span>
        </header>

        {thinking ? (
          /* 思考过程全部不显示：没有跳动的数字、没有爬的进度条。
             只有一句静态的话和一个随时可用的「就用现在这步」。 */
          <div className="relay-thinking is-calm">
            <p className="relay-thinking-text">引擎思考中，出招后会显示在这里。</p>
            <button type="button" className="btn btn-ghost btn-sm" onClick={onStop}>
              就用现在这步
            </button>
          </div>
        ) : lastEngineMove ? (
          <div className="relay-move">
            <button
              type="button"
              className="relay-move-main"
              onClick={() => void copyMove(lastEngineMove.iccs, lastEngineMove.chinese)}
              title="点击复制"
            >
              <span className="relay-move-cn">{lastEngineMove.chinese}</span>
              <span className="relay-move-iccs">{lastEngineMove.iccs}</span>
            </button>
            <div className="relay-move-foot">
              <span className="relay-move-meta">
                深度 {lastEngineMove.depth} · {seconds(lastEngineMove.time)} ·{' '}
                {lastEngineMove.eval !== null
                  ? `评分 ${scoreText(lastEngineMove.eval)}`
                  : ''}
              </span>
              <span className={`copy-flag ${copied ? 'on' : ''}`}>
                {copied ? '已复制' : '点击复制'}
              </span>
            </div>
          </div>
        ) : (
          <div className="relay-empty">
            <p>还没有应手。</p>
            {game.engine_to_move && playing && (
              <button type="button" className="btn btn-primary btn-sm" onClick={onEngineMove}>
                让引擎出招
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  )
}
