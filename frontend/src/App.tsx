import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Board } from './components/Board'
import { RelayConsole } from './components/RelayConsole'
import { AnalysisPanel } from './components/AnalysisPanel'
import { MoveList } from './components/MoveList'
import { ControlRail } from './components/ControlRail'
import { TopBar } from './components/TopBar'
import { HelpOverlay, Toasts } from './components/Overlays'
import { useGame } from './hooks/useGame'
import { isSoundEnabled, play, setSoundEnabled, unlockAudio } from './lib/sound'
import { sideName } from './lib/format'
import { api } from './api'

const LS_FLIP = 'ef.flipped'
const LS_SOUND = 'ef.sound'
const LS_RAIL_L = 'ef.rail-left'
const LS_RAIL_R = 'ef.rail-right'

export default function App() {
  const g = useGame()
  const [selected, setSelected] = useState<string | null>(null)
  const [flipped, setFlipped] = useState(() => localStorage.getItem(LS_FLIP) === '1')
  const [soundOn, setSoundOn] = useState(() => localStorage.getItem(LS_SOUND) !== '0')
  const [help, setHelp] = useState(false)
  // 专注模式：左右两栏默认收起，只留棋盘和转述台。下棋时不需要看设置和分析，
  // 想看的时候点边缘的耳片展开，选择会被记住。
  const [railL, setRailL] = useState(() => localStorage.getItem(LS_RAIL_L) === '1')
  const [railR, setRailR] = useState(() => localStorage.getItem(LS_RAIL_R) === '1')

  const game = g.state?.game

  // 引擎执黑时默认把黑方摆在下面 —— 那才是「我方」
  useEffect(() => {
    if (!game) return
    const stored = localStorage.getItem(LS_FLIP)
    if (stored === null) setFlipped(game.engine_side === 'black')
  }, [game?.engine_side]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setSoundEnabled(soundOn)
    localStorage.setItem(LS_SOUND, soundOn ? '1' : '0')
  }, [soundOn])

  useEffect(() => {
    localStorage.setItem(LS_FLIP, flipped ? '1' : '0')
  }, [flipped])

  useEffect(() => {
    localStorage.setItem(LS_RAIL_L, railL ? '1' : '0')
  }, [railL])

  useEffect(() => {
    localStorage.setItem(LS_RAIL_R, railR ? '1' : '0')
  }, [railR])

  // 浏览器要求先有用户手势才允许出声
  useEffect(() => {
    const unlock = () => unlockAudio()
    window.addEventListener('pointerdown', unlock, { once: true })
    window.addEventListener('keydown', unlock, { once: true })
    return () => {
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('keydown', unlock)
    }
  }, [])

  // 终局提示音
  useEffect(() => {
    if (!game || game.status.state === 'playing') return
    if (game.status.winner === null) return
    play(game.status.winner === game.engine_side ? 'win' : 'lose')
  }, [game?.status.state, game?.status.winner, game?.engine_side]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setSelected(null)
  }, [game?.ply, game?.engine_side, game?.status.state])

  // 打开页面时如果正好轮到引擎、又没有在算的活，就替它起个头。
  // 只做一次，避免和「自动应手」关开后的手动流程打架。
  const autoStarted = useRef(false)
  useEffect(() => {
    if (!game || autoStarted.current) return
    if (game.ply === 0 && game.engine_to_move && game.status.state === 'playing' && !g.thinking) {
      autoStarted.current = true
      void g.engineMove()
    }
  }, [game, g])

  const targets = useMemo(() => {
    if (!selected || !game) return []
    return game.legal_moves.filter((m) => m.from === selected).map((m) => m.to)
  }, [selected, game])

  // 录入有两条路：在棋盘上直接摆子，或者在框里敲记谱。这两件事的节奏不一样 ——
  // 敲键盘的人希望焦点一直留在框里；玩棋盘的人最烦的恰恰是每落一手焦点被抢走。
  // 所以记一下最后一次用的是哪种，只对「键盘流」自动聚焦。
  const [inputMode, setInputMode] = useState<'type' | 'board'>('type')

  const onBoardSelect = useCallback((square: string) => {
    setInputMode('board')
    setSelected(square)
  }, [])

  /** 拖拽落子：起点终点都由棋盘给，这里再校验一次合法性。 */
  const onBoardDrop = useCallback(
    (from: string, to: string) => {
      if (!game || g.thinking || game.status.state !== 'playing') return
      const mv = game.legal_moves.find((m) => m.from === from && m.to === to)
      if (!mv) return
      setInputMode('board')
      setSelected(null)
      void g.submitMove(mv.iccs)
    },
    [game, g],
  )

  const onSquareClick = useCallback(
    (square: string) => {
      if (!game || g.thinking || game.status.state !== 'playing') return
      setInputMode('board')
      if (selected) {
        const mv = game.legal_moves.find((m) => m.from === selected && m.to === square)
        if (mv && mv.from !== mv.to) {
          void g.submitMove(mv.iccs)
          setSelected(null)
          return
        }
      }
      const piece = game.pieces.find((p) => p.square === square)
      if (piece && piece.side === game.turn) {
        setSelected((prev) => (prev === square ? null : square))
      } else {
        setSelected(null)
      }
    },
    [game, g, selected],
  )

  // ---- 键盘 ---------------------------------------------------------- //

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const typing = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')

      if (e.key === 'Escape') {
        setHelp(false)
        setSelected(null)
        if (typing) (target as HTMLInputElement).blur()
        return
      }
      if (typing) return

      if (e.key === '/' ) {
        e.preventDefault()
        document.querySelector<HTMLInputElement>('.relay-field input')?.focus()
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        void g.undoRound()
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault()
        if (game) void g.newGame(game.engine_side)
        return
      }
      if (e.key === 'f' || e.key === 'F') {
        setFlipped((v) => !v)
        return
      }
      if (e.key === '?' || (e.shiftKey && e.key === '/')) {
        setHelp(true)
        return
      }
      if (e.key === ' ') {
        e.preventDefault()
        if (g.thinking) void g.stopThinking()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [g, game])

  // ---- 首屏 ---------------------------------------------------------- //

  if (g.booting && !g.state) {
    return (
      <div className="boot">
        <div className="boot-mark">象</div>
        <p>正在连接引擎…</p>
      </div>
    )
  }

  if (!g.state || !game) {
    return (
      <div className="boot">
        <div className="boot-mark dim">象</div>
        <h2>连不上引擎服务</h2>
        <p className="hint">
          先在项目根目录跑起后端：<code>python server/app.py</code>，然后刷新本页。
        </p>
        <button type="button" className="btn btn-primary" onClick={() => void g.refresh()}>
          重试
        </button>
      </div>
    )
  }

  const over = game.status.state !== 'playing'

  return (
    <div className="app">
      <TopBar
        game={game}
        connected={g.connected}
        thinking={g.thinking}
        flipped={flipped}
        soundOn={soundOn}
        onFlip={() => setFlipped((v) => !v)}
        onToggleSound={() => setSoundOn((v) => !v)}
        onHelp={() => setHelp(true)}
        onRefresh={() => void g.refresh()}
      />

      <main className={`workspace${railL ? '' : ' no-left'}${railR ? '' : ' no-right'}`}>
        {/* 收起的两栏各留一枚耳片，贴着屏幕边缘，不抢戏但摸得到 */}
        {!railL && (
          <button
            type="button"
            className="rail-tab rail-tab-left"
            onClick={() => setRailL(true)}
            aria-label="展开对局设置"
          >
            设置
          </button>
        )}
        {railL && (
          <button
            type="button"
            className="rail-tab rail-tab-left is-open"
            onClick={() => setRailL(false)}
            aria-label="收起对局设置"
          >
            收起
          </button>
        )}
        {!railR && (
          <button
            type="button"
            className="rail-tab rail-tab-right"
            onClick={() => setRailR(true)}
            aria-label="展开分析与棋谱"
          >
            分析
          </button>
        )}
        {railR && (
          <button
            type="button"
            className="rail-tab rail-tab-right is-open"
            onClick={() => setRailR(false)}
            aria-label="收起分析与棋谱"
          >
            收起
          </button>
        )}

        {railL && (
          <ControlRail
            state={g.state}
            onNewGame={(side) => void g.newGame(side)}
            onUndo={() => void g.undoRound()}
            onResign={() => void g.resign()}
            onSettings={(patch) => void g.updateSettings(patch)}
            onLoadFen={(fen) => void g.loadPosition(fen)}
            onOpponentConfig={(patch) => {
              void api
                .opponentConfig(patch)
                .then((r) => r.state && g.refresh())
                .catch(() => g.pushToast('对手接入配置失败', 'error'))
            }}
            onOpponentPoll={() => {
              void api
                .opponentPoll()
                .then((r) => {
                  if (r.message) g.pushToast(r.message, 'ok')
                  void g.refresh()
                })
                .catch((err) => g.pushToast(err.message || '拉取失败', 'error'))
            }}
          />
        )}

        <div className="stage">
          <div className="stage-head">
            <span className={`turn-badge side-${game.turn}`}>
              <span className="turn-disc" />
              {game.status.state === 'playing'
                ? `轮到${sideName(game.turn)}${game.turn === game.engine_side ? '（我方引擎）' : '（对方）'}`
                : game.status.reason || '对局结束'}
            </span>
            {game.in_check && game.status.state === 'playing' && (
              <span className="check-flag">将军</span>
            )}
          </div>

          <div className={`board-wrap ${over ? 'is-over' : ''}`}>
            <Board
              game={game}
              flipped={flipped}
              selected={selected}
              targets={targets}
              onSquareClick={onSquareClick}
              onSelect={onBoardSelect}
              onDragDrop={onBoardDrop}
              thinking={g.thinking}
              pv={[]}
            />
            {over && (
              <div className={`result-veil winner-${game.status.winner ?? 'none'}`}>
                {/* 终局镜头：棋盘先下压降饱和、胜方的王亮余光，
                    然后这枚印章盖下来，墨渍散开，遮罩和按钮最后才浮出来 */}
                <div className="seal" aria-hidden="true">
                  <span>{game.status.winner === null ? '和' : '胜'}</span>
                </div>
                <div className="result-card">
                  <span className="result-kicker">
                    {game.status.winner === null
                      ? '和棋'
                      : game.status.winner === game.engine_side
                        ? '我方引擎获胜'
                        : '对方获胜'}
                  </span>
                  <h2>{game.status.reason || '对局结束'}</h2>
                  <p className="hint">
                    共 {game.ply} 手 · 引擎出招 {g.state.stats.moves} 次 · 累计搜索{' '}
                    {g.state.stats.think_time.toFixed(1)} 秒
                  </p>
                  <div className="result-actions">
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => void g.newGame(game.engine_side)}
                    >
                      再来一局
                    </button>
                    <button type="button" className="btn btn-ghost" onClick={() => void g.undoRound()}>
                      退回去接着下
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          <RelayConsole
            game={game}
            thinking={g.thinking}
            queued={g.queued}
            autoFocus={inputMode === 'type'}
            onTypeInput={() => setInputMode('type')}
            onSubmit={g.submitMove}
            onClearQueue={g.clearQueue}
            onStop={() => void g.stopThinking()}
            onEngineMove={() => void g.engineMove()}
          />
        </div>

        {railR && (
          <aside className="rail rail-right">
            <AnalysisPanel game={game} task={g.task} thinking={g.thinking} />
            <MoveList game={game} />
          </aside>
        )}
      </main>

      <Toasts items={g.toasts} onDismiss={g.dismissToast} />
      {help && <HelpOverlay onClose={() => setHelp(false)} />}
      {!isSoundEnabled() && soundOn && (
        <span className="sr-only">音效已启用，等待首次交互解锁</span>
      )}
    </div>
  )
}
