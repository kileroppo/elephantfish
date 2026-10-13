import { useCallback, useEffect, useRef, useState } from 'react'
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

const LS_FLIP = 'ef.flipped'
const LS_SOUND = 'ef.sound'
const LS_RAIL_L = 'ef.rail-left'
const LS_RAIL_R = 'ef.rail-right'

export default function App() {
  const g = useGame()
  const [flipped, setFlipped] = useState(() => localStorage.getItem(LS_FLIP) === '1')
  const [soundOn, setSoundOn] = useState(() => localStorage.getItem(LS_SOUND) !== '0')
  const [help, setHelp] = useState(false)

  // 默认专注模式：默认左右两栏全收起，只留棋盘和应手区
  const [railL, setRailL] = useState(() => localStorage.getItem(LS_RAIL_L) === '1')
  const [railR, setRailR] = useState(() => localStorage.getItem(LS_RAIL_R) === '1')

  const game = g.state?.game

  // 引擎执黑时默认把黑方摆在下面 —— 归属我方视角
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

  // 浏览器音频手势解锁
  useEffect(() => {
    const unlock = () => unlockAudio()
    window.addEventListener('pointerdown', unlock, { once: true })
    window.addEventListener('keydown', unlock, { once: true })
    return () => {
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('keydown', unlock)
    }
  }, [])

  // 终局弹窗延迟 3 秒弹出：给最后一手杀棋、吃子动画和盘面定格留出 3 秒充足时间看清走子
  const [showOverModal, setShowOverModal] = useState(false)
  const [dismissedOver, setDismissedOver] = useState(false)
  const isPlaying = game?.status.state === 'playing'

  useEffect(() => {
    if (!game) return
    if (isPlaying) {
      setShowOverModal(false)
      setDismissedOver(false)
      return
    }

    const timer = window.setTimeout(() => {
      setShowOverModal(true)
      if (game.status.winner !== null) {
        play(game.status.winner === game.engine_side ? 'win' : 'lose')
      }
    }, 3000)

    return () => window.clearTimeout(timer)
  }, [isPlaying, game?.status.winner, game?.engine_side])

  // 页面加载引擎执红先行时自动起手
  const autoStarted = useRef(false)
  useEffect(() => {
    if (!game || autoStarted.current) return
    if (game.ply === 0 && game.engine_to_move && game.status.state === 'playing' && !g.thinking) {
      autoStarted.current = true
      void g.engineMove()
    }
  }, [game, g])

  /** 落子的唯一出口。走哪一步算一步、合法不合法，都由 Board 自己认完了才报上来 ——
   *  上层不再算一遍合法性，也就不会有「两处判得不一样」的余地。 */
  const onBoardMove = useCallback(
    (iccs: string) => {
      void g.submitMove(iccs)
    },
    [g],
  )

  // ---- 键盘快捷键 ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const typing = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')

      if (e.key === 'Escape') {
        setHelp(false)
        // 棋盘的选中态归 Board 自己管（它也有自己的 Escape 分支）；
        // 这里只负责关帮助、把焦点从输入框上收回来。
        if (typing) (target as HTMLInputElement).blur()
        return
      }
      if (typing) return

      // '/' 由 RelayConsole 自己接管：它能先把折叠的录入框展开再聚焦
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
          先在项目根目录运行：<code>python server/app.py</code>，然后刷新本页。
        </p>
        <button type="button" className="btn btn-primary" onClick={() => void g.refresh()}>
          重试
        </button>
      </div>
    )
  }

  const turnText = isPlaying
    ? g.thinking
      ? '引擎深度计算中…'
      : `轮到${sideName(game.turn)}${game.turn === game.engine_side ? '（我方引擎）' : '（对方，请在盘面点选）'}`
    : game.status.reason || '对局结束'

  return (
    <div className={`app${g.thinking ? ' is-thinking' : ''}`}>
      <TopBar
        game={game}
        engineInfo={g.state?.engine_info}
        connected={g.connected}
        flipped={flipped}
        soundOn={soundOn}
        onToggleEngine={() => {
          const current = g.state?.settings.engine_type ?? 'pikafish'
          const next = current === 'pikafish' ? 'builtin' : 'pikafish'
          void g.updateSettings({ engine_type: next })
        }}
        onFlip={() => setFlipped((v) => !v)}
        onToggleSound={() => setSoundOn((v) => !v)}
        onHelp={() => setHelp(true)}
        onRefresh={() => void g.refresh()}
      />

      <main className={`workspace${railL ? '' : ' no-left'}${railR ? '' : ' no-right'}`}>
        {/* 侧栏把手：一边一个，跟着抽屉边缘走 —— 收起时贴屏幕边，展开时贴在栏外沿 */}
        <button
          type="button"
          className={`rail-tab rail-tab-left${railL ? ' is-open' : ''}`}
          onClick={() => setRailL((v) => !v)}
          aria-label={railL ? '收起对局设置' : '展开对局设置'}
          aria-expanded={railL}
        >
          <span className="rail-tab-chev" aria-hidden="true">
            <svg viewBox="0 0 10 10" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="1.6">
              <path d="M3.5 2 6.5 5 3.5 8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <span className="rail-tab-text">{railL ? '收起' : '设置'}</span>
        </button>
        <button
          type="button"
          className={`rail-tab rail-tab-right${railR ? ' is-open' : ''}`}
          onClick={() => setRailR((v) => !v)}
          aria-label={railR ? '收起分析与棋谱' : '展开分析与棋谱'}
          aria-expanded={railR}
        >
          <span className="rail-tab-chev" aria-hidden="true">
            <svg viewBox="0 0 10 10" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="1.6">
              <path d="M6.5 2 3.5 5 6.5 8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <span className="rail-tab-text">{railR ? '收起' : '棋谱'}</span>
        </button>

        <ControlRail
          open={railL}
          state={g.state}
          onNewGame={(side) => void g.newGame(side)}
          onUndo={() => void g.undoRound()}
          onResign={() => void g.resign()}
          onSettings={(patch) => void g.updateSettings(patch)}
        />

        <div className="stage">
          {/* 单一状态核心 HUD：全屏唯一的局面指示 */}
          <div className="stage-head">
            <span
              className={[
                'turn-badge',
                `side-${game.turn}`,
                isPlaying ? '' : 'is-over',
                isPlaying && game.turn === game.engine_side ? 'is-engine' : '',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              <span className="turn-disc" />
              {/* key = 文案本身：换一次状态，文字就淡入一次；文案不变时不打扰 */}
              <span key={turnText} className="turn-text">
                {turnText}
              </span>
            </span>
            {game.in_check && isPlaying && (
              <span key={`chk${game.ply}`} className="check-flag">
                将军！
              </span>
            )}
          </div>

          <div className={`board-wrap ${showOverModal ? 'is-over' : ''}`}>
            <Board
              game={game}
              flipped={flipped}
              thinking={g.thinking}
              /* 主变直接接引擎算出来的那一条（以前这里写死 pv={[]}，
                 于是 Board 里那段虚线渲染从来没亮过）。
                 只在**思考中**画：task.progress 在落子之后并不清空，照单全画的话
                 引擎刚走过的那一步会被再画一条虚线，跟盘面上的墨痕叠在一起。 */
              pv={g.thinking ? (g.task?.progress?.pv ?? []) : []}
              onMove={onBoardMove}
            />
            {showOverModal && !dismissedOver && (
              <div className={`result-veil winner-${game.status.winner ?? 'none'}`}>
                <div className="seal" aria-hidden="true">
                  <span>{game.status.winner === null ? '和' : '胜'}</span>
                </div>
                <div className="result-card">
                  <button
                    type="button"
                    className="modal-close-btn"
                    onClick={() => setDismissedOver(true)}
                    title="收起弹窗，仔细查看棋盘"
                  >
                    ✕
                  </button>
                  <span className="result-kicker">
                    {game.status.winner === null
                      ? '和棋'
                      : game.status.winner === game.engine_side
                        ? '我方引擎获胜'
                        : '对方获胜'}
                  </span>
                  <h2>{game.status.reason || '对局结束'}</h2>
                  <p className="hint">
                    共 {game.ply} 手 · 引擎应手 {g.state.stats.moves} 次
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
                      退回一步
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => setDismissedOver(true)}
                    >
                      查看残局
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
            onSubmit={g.submitMove}
            onClearQueue={g.clearQueue}
            onStop={() => void g.stopThinking()}
            onEngineMove={() => void g.engineMove()}
          />
        </div>

        <aside
          className={`rail rail-right${railR ? ' is-open' : ''}`}
          aria-label="分析与棋谱"
          aria-hidden={!railR}
          {...(railR ? {} : { inert: '' })}
        >
          <AnalysisPanel game={game} task={g.task} thinking={g.thinking} />
          <MoveList game={game} />
        </aside>
      </main>

      <Toasts items={g.toasts} onDismiss={g.dismissToast} />
      {help && <HelpOverlay onClose={() => setHelp(false)} />}
      {!isSoundEnabled() && soundOn && (
        <span className="sr-only">音效已启用，等待首次交互解锁</span>
      )}
    </div>
  )
}
