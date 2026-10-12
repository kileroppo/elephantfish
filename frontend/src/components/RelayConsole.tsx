import { useEffect, useMemo, useRef, useState } from 'react'
import type { GameSnapshot } from '../types'
import { scoreText, seconds } from '../lib/format'
import type { SubmitOutcome } from '../hooks/useGame'

interface Props {
  game: GameSnapshot
  thinking: boolean
  queued: string | null
  onSubmit: (text: string) => Promise<SubmitOutcome>
  onClearQueue: () => void
  onStop: () => void
  onEngineMove: () => void
}

export function RelayConsole({
  game,
  thinking,
  queued,
  onSubmit,
  onClearQueue,
  onStop,
  onEngineMove,
}: Props) {
  const [text, setText] = useState('')
  const [showTypeInput, setShowTypeInput] = useState(false)
  const [copied, setCopied] = useState(false)
  const [rejected, setRejected] = useState(0)
  const copyTimer = useRef<number>()

  const lastEngineMove = useMemo(() => {
    for (let i = game.records.length - 1; i >= 0; i -= 1) {
      if (game.records[i].by === 'engine') return game.records[i]
    }
    return null
  }, [game.records])

  const playing = game.status.state === 'playing'

  // '/'：在任何地方（输入框外）按下都展开录入栏并聚焦
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return
      e.preventDefault()
      setShowTypeInput(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => () => window.clearTimeout(copyTimer.current), [])

  // 换了一手，复制态归零 —— 「已复制」只属于那一手
  useEffect(() => {
    setCopied(false)
  }, [lastEngineMove?.ply])

  const submit = async () => {
    const payload = text.trim()
    if (!payload) return
    const outcome = await onSubmit(payload)
    if (outcome === 'ok' || outcome === 'queued') {
      setText('')
      setShowTypeInput(false)
    } else {
      // 走法不合法：输入框横向抖一下，比只弹一条 toast 更贴手
      setRejected((n) => n + 1)
    }
  }

  const copyMove = async (iccs: string, chinese: string) => {
    try {
      await navigator.clipboard.writeText(`${iccs} ${chinese}`)
      setCopied(true)
      window.clearTimeout(copyTimer.current)
      copyTimer.current = window.setTimeout(() => setCopied(false), 1600)
    } catch {
      setCopied(false)
    }
  }

  return (
    <section className="relay-compact" aria-label="应手与控制">
      {/* 核心应手展示区 */}
      <div className={`engine-hero ${thinking ? 'is-thinking' : ''}`}>
        {thinking ? (
          <div className="hero-thinking">
            {/* 静态的「算」字印：思考期间全站停摆，这里也不转圈 */}
            <span className="hero-think-seal" aria-hidden="true">
              算
            </span>
            <span className="thinking-title">引擎正在深度计算应手…</span>
            <button type="button" className="btn btn-ghost btn-sm" onClick={onStop}>
              采用当前最优步
              <kbd className="btn-kbd">Space</kbd>
            </button>
          </div>
        ) : lastEngineMove ? (
          <div className="hero-content">
            <div className="hero-label">引擎下一步应手</div>
            <button
              key={lastEngineMove.ply}
              type="button"
              className={`hero-action-card${copied ? ' is-copied' : ''}`}
              onClick={() => void copyMove(lastEngineMove.iccs, lastEngineMove.chinese)}
              title="点击复制走法"
            >
              <span className="hero-move-cn">{lastEngineMove.chinese}</span>
              <span className="hero-move-iccs">{lastEngineMove.iccs}</span>
              <span className="hero-copy-pill">
                <svg
                  className="hero-copy-icon"
                  viewBox="0 0 12 12"
                  width="10"
                  height="10"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  aria-hidden="true"
                >
                  {copied ? (
                    <path d="M2.5 6.4 5 8.8 9.6 3.4" strokeLinecap="round" strokeLinejoin="round" />
                  ) : (
                    <>
                      <rect x="3.8" y="3.8" width="6" height="6" rx="1.2" />
                      <path d="M8.2 2.2H3.4c-.7 0-1.2.5-1.2 1.2v4.8" strokeLinecap="round" />
                    </>
                  )}
                </svg>
                {copied ? '已复制' : '复制'}
              </span>
            </button>
            <div key={`m${lastEngineMove.ply}`} className="hero-meta">
              深度 {lastEngineMove.depth} · 耗时 {seconds(lastEngineMove.time)}
              {lastEngineMove.eval !== null && ` · 评估 ${scoreText(lastEngineMove.eval)}`}
            </div>
          </div>
        ) : (
          <div className="hero-idle">
            <span>对局初始，等待走子或引擎出招</span>
            {game.engine_to_move && playing && (
              <button type="button" className="btn btn-primary btn-sm" onClick={onEngineMove}>
                让引擎先出招
              </button>
            )}
          </div>
        )}
      </div>

      {/* 排队步提醒 */}
      {queued && (
        <div className="queued-strip">
          <span>已排队录入对方走法：<strong>{queued}</strong>（等待计算结束）</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClearQueue}>
            撤销
          </button>
        </div>
      )}

      {/* 极轻量录入栏（默认折叠，支持快捷键 / 触发） */}
      <div className="type-toggle-bar">
        {!showTypeInput ? (
          <button
            type="button"
            className="type-toggle-btn"
            onClick={() => setShowTypeInput(true)}
          >
            <span>键盘文本录入</span>
            <kbd>/</kbd>
          </button>
        ) : (
          <div key={`box${rejected}`} className={`type-inline-box${rejected ? ' is-rejected' : ''}`}>
            <input
              autoFocus
              value={text}
              placeholder="输入记谱 (如 炮二平五 或 h2e2)"
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submit()
                if (e.key === 'Escape') setShowTypeInput(false)
              }}
            />
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={!text.trim()}
              onClick={() => void submit()}
            >
              提交
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowTypeInput(false)}>
              收起
            </button>
          </div>
        )}
      </div>
    </section>
  )
}
