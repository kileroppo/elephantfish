import { useCallback, useEffect, useRef, useState } from 'react'
import { Board } from './components/Board'
import { RelayConsole } from './components/RelayConsole'
import { AnalysisPanel } from './components/AnalysisPanel'
import { MoveList } from './components/MoveList'
import { ControlRail } from './components/ControlRail'
import { TopBar } from './components/TopBar'
import { SetupPanel } from './components/SetupPanel'
import { HelpOverlay, Toasts } from './components/Overlays'
import { useGame } from './hooks/useGame'
import { isSoundEnabled, play, setSoundEnabled, unlockAudio } from './lib/sound'
import { sideName } from './lib/format'
import { useSetupMode } from './hooks/useSetupMode'
import { useExitPhase } from './hooks/useExitPhase'

const LS_FLIP = 'ef.flipped'
/** 翻转视角：动画总长，以及「在动画最窄处换视角」的那个时刻。见 App 里的 turnBoard。 */
const FLIP_TOTAL_MS = 340
const FLIP_MID_MS = 150
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

  // ---- 补棋 / 自定义排局模式 ----
  const setup = useSetupMode({
    game,
    pushToast: g.pushToast,
    loadPosition: g.loadPosition,
  })

  // 引擎执哪一边，这边的棋就朝下：
  // 引擎执红 -> 红方在下（flipped = false）
  // 引擎执黑 -> 黑方在下（flipped = true）
  const prevEngineSide = useRef<string | null>(null)
  useEffect(() => {
    if (!game) return
    if (prevEngineSide.current !== game.engine_side) {
      prevEngineSide.current = game.engine_side
      setFlipped(game.engine_side === 'black')
    }
  }, [game?.engine_side])

  const handleNewGame = useCallback(
    (side: 'red' | 'black') => {
      setFlipped(side === 'black')
      void g.newGame(side)
    },
    [g],
  )

  useEffect(() => {
    setSoundEnabled(soundOn)
    localStorage.setItem(LS_SOUND, soundOn ? '1' : '0')
  }, [soundOn])

  useEffect(() => {
    localStorage.setItem(LS_FLIP, flipped ? '1' : '0')
  }, [flipped])

  // 翻转视角：不直接换 state，而是「收窄 → 换 → 展开」三段。
  // 直接换的话，盘面（连同 32 颗子和所有标记）是「唰」地镜像过去 —— 全站唯一
  // 一处纯切的硬边。换个视角本来就有方向感（我是想从对面看棋），把它演出来才对。
  // 时序：0ms 起播收窄，FLIP_MID 落在动画最窄那一段里，那时才真的换视角，
  // 于是「镜像」这个跳变被藏在盘面几乎看不见宽度的两帧里。
  const [flipping, setFlipping] = useState(false)
  const flipMid = useRef<number | null>(null)
  const flipEnd = useRef<number | null>(null)
  const flippedRef = useRef(flipped)
  flippedRef.current = flipped

  useEffect(
    () => () => {
      if (flipMid.current !== null) window.clearTimeout(flipMid.current)
      if (flipEnd.current !== null) window.clearTimeout(flipEnd.current)
    },
    [],
  )

  const turnBoard = useCallback(() => {
    // 转到一半又按：等这一转演完，不叠第二段（叠起来只会自己打断自己）
    if (flipMid.current !== null) return
    setFlipping(true)
    flipMid.current = window.setTimeout(() => {
      flipMid.current = null
      setFlipped(!flippedRef.current)
    }, FLIP_MID_MS)
    flipEnd.current = window.setTimeout(() => {
      flipEnd.current = null
      setFlipping(false)
    }, FLIP_TOTAL_MS)
  }, [])

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
  // 终局弹窗的退场：收起时不能一帧摘掉，得让「收」这件事也被看见
  const [overMounted, overLeaving] = useExitPhase(showOverModal && !dismissedOver && !setup.active)
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
  // 回一个「收没收」给 Board：它在本地先替这一步挪了一格，被拒时得知道要退回来。
  // 'queued' 也算收下（服务端已经记着，等引擎收手自己落子），只有 'error' 是没成。
  const onBoardMove = useCallback(
    async (iccs: string) => (await g.submitMove(iccs)) !== 'error',
    [g],
  )

  // ---- 键盘快捷键 ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const typing = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')

      if (e.key === 'Escape') {
        setHelp(false)
        if (setup.active) {
          setup.clearSelection()
        }
        // 棋盘的选中态归 Board 自己管（它也有自己的 Escape 分支）；
        // 这里只负责关帮助、把焦点从输入框上收回来。
        if (typing) (target as HTMLInputElement).blur()
        return
      }
      if (typing) return

      if (setup.active && (e.key === 'Delete' || e.key === 'Backspace')) {
        if (setup.pickedBoardSquare) {
          e.preventDefault()
          setup.removePiece(setup.pickedBoardSquare)
        }
        return
      }

      // '/' 由 RelayConsole 自己接管：它能先把折叠的录入框展开再聚焦
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        void g.undoRound()
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault()
        if (game) handleNewGame(game.engine_side)
        return
      }
      if (e.key === 'f' || e.key === 'F') {
        turnBoard()
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
  }, [g, game, handleNewGame, turnBoard])

  const onToggleEngineSide = useCallback(() => {
    if (setup.active) {
      const nextSide = setup.engineSide === 'red' ? 'black' : 'red'
      setup.setEngineSide(nextSide)
      setFlipped(nextSide === 'black')
      g.pushToast(
        `排局设定：引擎执${nextSide === 'red' ? '红' : '黑'}（${nextSide === 'red' ? '红' : '黑'}方朝下）`,
        'info',
      )
    } else if (game) {
      const nextSide = game.engine_side === 'red' ? 'black' : 'red'
      handleNewGame(nextSide)
      g.pushToast(
        `已切换为引擎执${nextSide === 'red' ? '红' : '黑'}（${nextSide === 'red' ? '红' : '黑'}方朝下）`,
        'ok',
      )
    }
  }, [setup.active, setup.engineSide, setup.setEngineSide, game, handleNewGame, g])

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

  const turnText = setup.active
    ? `补棋排局中 · 设定【${setup.turn === 'red' ? '红先' : '黑先'}】`
    : isPlaying
      ? g.thinking
        ? '引擎深度计算中…'
        : `轮到${sideName(game.turn)}${game.turn === game.engine_side ? '（引擎出招）' : '（您出招，请在盘面落子）'}`
      : game.status.reason || '对局结束'

  return (
    <div className={`app${g.thinking ? ' is-thinking' : ''}`}>
      <TopBar
        game={game}
        engineInfo={g.state?.engine_info}
        connected={g.connected}
        flipped={flipped}
        soundOn={soundOn}
        setupMode={setup.active}
        onToggleSetup={setup.toggle}
        onToggleEngine={() => {
          const current = g.state?.settings.engine_type ?? 'pikafish'
          const next = current === 'pikafish' ? 'builtin' : 'pikafish'
          void g.updateSettings({ engine_type: next })
        }}
        onToggleEngineSide={onToggleEngineSide}
        onFlip={turnBoard}
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
          setupMode={setup.active}
          onToggleSetup={setup.toggle}
          onNewGame={handleNewGame}
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
              /* 自检锚点：`audit.mjs` 量「回合条有没有被棋盘垫盖住」靠它。
                 类名归样式所有，随时可能改，所以断言读这个 data-*。 */
              data-turn-badge=""
            >
              {/* key=game.turn：每易手一次圆点重挂载，播一次 discPop 脉搏 */}
              <span key={game.turn} className="turn-disc" />
              {/* key = 文案本身：换一次状态，文字就淡入一次；文案不变时不打扰 */}
              <span key={turnText} className="turn-text">
                {turnText}
              </span>
            </span>
            {game.in_check && isPlaying && !setup.active && (
              <span key={`chk${game.ply}`} className="check-flag">
                将军！
              </span>
            )}
          </div>

          <div className={`board-wrap ${showOverModal && !setup.active ? 'is-over' : ''}`}>
            <Board
              game={game}
              flipped={flipped}
              flipping={flipping}
              thinking={g.thinking}
              pv={g.thinking && !setup.active ? (g.task?.progress?.pv ?? []) : []}
              onMove={onBoardMove}
              setupMode={setup.active}
              setupPieces={setup.pieces}
              selectedTrayPiece={setup.selectedTrayPiece}
              pickedBoardSquare={setup.pickedBoardSquare}
              onSetupSquareTap={setup.tapSquare}
              onSetupPieceMove={setup.movePiece}
              onSetupPieceRemove={setup.removePiece}
              onSetupPickBoardSquare={setup.pickSquare}
            />
            {overMounted && (
              <div
                className={`result-veil winner-${game.status.winner ?? 'none'}${
                  overLeaving ? ' is-leaving' : ''
                }`}
              >
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
                        ? '引擎获胜'
                        : '您获胜了！'}
                  </span>
                  <h2>{game.status.reason || '对局结束'}</h2>
                  <p className="hint">
                    共 {game.ply} 手 · 引擎应手 {g.state.stats.moves} 次
                  </p>
                  <div className="result-actions">
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => handleNewGame(game.engine_side)}
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

          {setup.active ? (
            <SetupPanel
              boardMap={setup.boardMap}
              turn={setup.turn}
              engineSide={setup.engineSide}
              selectedTrayPiece={setup.selectedTrayPiece}
              pickedBoardSquare={setup.pickedBoardSquare}
              onSelectTrayPiece={setup.selectTrayPiece}
              onClearBoard={setup.clearBoard}
              onResetStandard={setup.resetStandard}
              onRevertOriginal={setup.revertOriginal}
              onRemovePickedPiece={() =>
                setup.pickedBoardSquare && setup.removePiece(setup.pickedBoardSquare)
              }
              onCancelPick={setup.clearSelection}
              onTurnChange={setup.setTurn}
              onEngineSideChange={(side) => {
                setup.setEngineSide(side)
                setFlipped(side === 'black')
              }}
              onImportFen={setup.importFen}
              onStartGame={() => {
                setFlipped(setup.engineSide === 'black')
                void setup.startGame()
              }}
              onExitSetup={setup.exit}
              onToast={g.pushToast}
            />
          ) : (
            <RelayConsole
              game={game}
              thinking={g.thinking}
              queued={g.queued}
              onSubmit={g.submitMove}
              onClearQueue={g.clearQueue}
              onStop={() => void g.stopThinking()}
              onEngineMove={() => void g.engineMove()}
            />
          )}
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
      {/* 常挂：开与关都交给它自己（关掉时还要多活 180ms 播退场），
          见 hooks/useExitPhase */}
      <HelpOverlay open={help} onClose={() => setHelp(false)} />
      {!isSoundEnabled() && soundOn && (
        <span className="sr-only">音效已启用，等待首次交互解锁</span>
      )}
    </div>
  )
}
