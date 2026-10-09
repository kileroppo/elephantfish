import type { GameSnapshot } from '../types'
import { sideName } from '../lib/format'

interface Props {
  game: GameSnapshot
  connected: boolean
  thinking: boolean
  flipped: boolean
  soundOn: boolean
  onFlip: () => void
  onToggleSound: () => void
  onHelp: () => void
  onRefresh: () => void
}

export function TopBar({
  game,
  connected,
  thinking,
  flipped,
  soundOn,
  onFlip,
  onToggleSound,
  onHelp,
  onRefresh,
}: Props) {
  const state = game.status.state
  const over = state !== 'playing'

  const pill = over
    ? {
        tone: game.status.winner === game.engine_side ? 'win' : game.status.winner ? 'lose' : 'draw',
        text: statusText(game),
      }
    : thinking
      ? { tone: 'think', text: '引擎思考中' }
      : game.opponent_to_move
        ? { tone: 'wait', text: '等你录入对方走法' }
        : { tone: 'idle', text: '待命' }

  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true">
          <svg viewBox="0 0 40 40" width="34" height="34">
            <circle cx="20" cy="20" r="18" fill="none" stroke="currentColor" strokeWidth="2" />
            <circle cx="20" cy="20" r="12.5" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.55" />
            <text
              x="20"
              y="21.5"
              textAnchor="middle"
              dominantBaseline="central"
              fontSize="19"
              fill="currentColor"
            >
              象
            </text>
          </svg>
        </span>
        <div className="brand-text">
          <h1>转述台</h1>
          <p>
            elephantfish 引擎 · 你执{sideName(game.opponent_side).replace('方', '')}对面那台大模型
          </p>
        </div>
      </div>

      <div className="topbar-center">
        <span className={`pill pill-${pill.tone}`}>
          {pill.tone === 'think' && <span className="pill-spin" />}
          {pill.text}
        </span>
        <span className="side-indicator" title="棋盘下方是哪一方">
          <span className={`side-dot ${flipped ? game.turn : other(game.turn)}`} />
          视角 {flipped ? '已翻转' : '标准'}
        </span>
      </div>

      <div className="topbar-actions">
        {!connected && (
          <button type="button" className="icon-btn warn" onClick={onRefresh} title="重新连接">
            断线
          </button>
        )}
        <button type="button" className="icon-btn" onClick={onFlip} title="翻转视角">
          <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6">
            <path d="M4 7a6 6 0 0 1 10-3.5M16 13a6 6 0 0 1-10 3.5" />
            <path d="M14 1v3h-3M6 19v-3h3" strokeLinecap="round" />
          </svg>
          <span>翻转</span>
        </button>
        <button
          type="button"
          className="icon-btn"
          onClick={onToggleSound}
          title={soundOn ? '关闭音效' : '打开音效'}
        >
          {soundOn ? '♪' : '♪̸'}
        </button>
        <button type="button" className="icon-btn" onClick={onHelp} title="怎么用（快捷键）">
          ?
        </button>
      </div>
    </header>
  )
}

function other(side: 'red' | 'black') {
  return side === 'red' ? 'black' : 'red'
}

function statusText(game: GameSnapshot) {
  const s = game.status
  if (s.state === 'playing') return '进行中'
  if (s.state === 'resign') return `${s.winner === 'red' ? '红方' : '黑方'}认输`
  if (s.state === 'checkmate') return `将死 · ${s.winner === 'red' ? '红胜' : '黑胜'}`
  if (s.state === 'stalemate') return `困毙 · ${s.winner === 'red' ? '红胜' : '黑胜'}`
  return s.state === 'draw_repetition' ? '三次重复 · 和' : '六十回合无吃子 · 和'
}
