import { useCallback, useEffect, useRef, useState } from 'react'
import { Board } from './components/Board'
import { RelayConsole } from './components/RelayConsole'
import { AnalysisPanel } from './components/AnalysisPanel'
import { MoveList } from './components/MoveList'
import { MistakeBook } from './components/MistakeBook'
import { GameShelf } from './components/GameShelf'
import { ReplayDesk } from './components/ReplayDesk'
import { DrillDesk } from './components/DrillDesk'
import { ControlRail } from './components/ControlRail'
import { TopBar } from './components/TopBar'
import { SetupPanel } from './components/SetupPanel'
import { HelpOverlay, Toasts } from './components/Overlays'
import { GameProvider, useGameContext } from './context/GameContext'
import { UIProvider, useUIContext } from './context/UIContext'
import { isSoundEnabled, play } from './lib/sound'
import { sideName } from './lib/format'
import { useSetupMode } from './hooks/useSetupMode'
import { useExitPhase } from './hooks/useExitPhase'

function AppContent() {
  const g = useGameContext()
  const ui = useUIContext()

  const game = g.state?.game

  // ---- 补棋 / 自定义排局模式 ----
  const setup = useSetupMode({
    game,
    pushToast: g.pushToast,
    loadPosition: g.loadPosition,
  })

  const handleNewGame = useCallback(
    (side: 'red' | 'black') => {
      ui.setFlipped(side === 'black')
      void g.newGame(side)
    },
    [g, ui],
  )

  // 终局弹窗延迟 3 秒弹出：给最后一手杀棋、吃子动画和盘面定格留出 3 秒充足时间看清走子
  const [showOverModal, setShowOverModal] = useState(false)
  const [dismissedOver, setDismissedOver] = useState(false)
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
        ui.setHelp(false)
        if (setup.active) {
          setup.clearSelection()
        }
        if (typing) (target as HTMLInputElement).blur()
        return
      }
      if (typing) return

      if (ui.replay) return

      if (setup.active && (e.key === 'Delete' || e.key === 'Backspace')) {
        if (setup.pickedBoardSquare) {
          e.preventDefault()
          setup.removePiece(setup.pickedBoardSquare)
        }
        return
      }

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
      if (e.key === 'z' || e.key === 'Z') {
        e.preventDefault()
        ui.toggleZen()
        return
      }
      if (e.key === 't' || e.key === 'T') {
        e.preventDefault()
        ui.cycleTheme()
        return
      }
      if (e.key === 'Escape' && ui.zenMode) {
        e.preventDefault()
        ui.setZenMode(false)
        return
      }
      if (e.key === 'f' || e.key === 'F') {
        ui.turnBoard()
        return
      }
      if (e.key === '?' || (e.shiftKey && e.key === '/')) {
        ui.setHelp(true)
        return
      }
      if (e.key === ' ') {
        e.preventDefault()
        if (g.thinking) void g.stopThinking()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [g, game, handleNewGame, ui, setup])

  const onToggleEngineSide = useCallback(() => {
    if (setup.active) {
      const nextSide = setup.engineSide === 'red' ? 'black' : 'red'
      setup.setEngineSide(nextSide)
      ui.setFlipped(nextSide === 'black')
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
  }, [setup, game, handleNewGame, g, ui])

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
    <div className={`app${g.thinking ? ' is-thinking' : ''}${ui.zenMode ? ' is-zen-mode' : ''}`}>
      <TopBar
        setupMode={setup.active}
        onToggleSetup={setup.toggle}
        onToggleEngineSide={onToggleEngineSide}
      />

      {ui.zenMode && (
        <div className="zen-hud" role="status" aria-live="polite">
          <div className="zen-hud-pill">
            <span className="zen-hud-seal" aria-hidden="true">禅</span>
            <span className="zen-hud-title">静虑深思</span>
            <span className="zen-hud-turn">{isPlaying ? (game.turn === 'red' ? '红先出招' : '黑方行棋') : '对局终了'}</span>
            {g.thinking && <span className="zen-hud-thinking">· 引擎推演中…</span>}
            <button
              type="button"
              className="zen-hud-exit"
              onClick={() => ui.setZenMode(false)}
              title="退出禅意专注模式 (Esc / Z)"
            >
              退出禅境 ✕
            </button>
          </div>
        </div>
      )}

      <main className={`workspace${ui.railL && !ui.zenMode ? '' : ' no-left'}${ui.railR && !ui.zenMode ? '' : ' no-right'}`}>
        {/* 侧栏把手：一边一个，跟着抽屉边缘走 —— 收起时贴屏幕边，展开时贴在栏外沿 */}
        <button
          type="button"
          className={`rail-tab rail-tab-left${ui.railL ? ' is-open' : ''}`}
          onClick={ui.toggleRailL}
          aria-label={ui.railL ? '收起对局设置' : '展开对局设置'}
          aria-expanded={ui.railL}
        >
          <span className="rail-tab-chev" aria-hidden="true">
            <svg viewBox="0 0 10 10" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="1.6">
              <path d="M3.5 2 6.5 5 3.5 8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <span className="rail-tab-text">{ui.railL ? '收起' : '设置'}</span>
        </button>
        <button
          type="button"
          className={`rail-tab rail-tab-right${ui.railR ? ' is-open' : ''}`}
          onClick={ui.toggleRailR}
          aria-label={ui.railR ? '收起分析与棋谱' : '展开分析与棋谱'}
          aria-expanded={ui.railR}
        >
          <span className="rail-tab-chev" aria-hidden="true">
            <svg viewBox="0 0 10 10" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="1.6">
              <path d="M6.5 2 3.5 5 6.5 8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <span className="rail-tab-text">{ui.railR ? '收起' : '棋谱'}</span>
        </button>

        <ControlRail
          setupMode={setup.active}
          onToggleSetup={setup.toggle}
          onNewGame={handleNewGame}
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
              data-turn-badge=""
            >
              <span key={game.turn} className="turn-disc" />
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
              game={!setup.active && ui.previewGame ? ui.previewGame : game}
              flipped={ui.flipped}
              flipping={ui.flipping}
              thinking={g.thinking}
              pv={
                !setup.active && ui.previewPv.length > 0
                  ? ui.previewPv
                  : g.thinking && !setup.active
                    ? (g.task?.progress?.pv ?? [])
                    : []
              }
              visualClues={!setup.active ? (ui.liveClues ?? undefined) : undefined}
              readOnly={!setup.active && ui.previewGame !== null}
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
                ui.setFlipped(side === 'black')
              }}
              onImportFen={setup.importFen}
              onStartGame={() => {
                ui.setFlipped(setup.engineSide === 'black')
                void setup.startGame()
              }}
              onExitSetup={setup.exit}
              onToast={g.pushToast}
            />
          ) : (
            <RelayConsole />
          )}
        </div>

        <aside
          className={`rail rail-right${ui.railR ? ' is-open' : ''}`}
          aria-label="分析与棋谱"
          aria-hidden={!ui.railR}
          {...(ui.railR ? {} : { inert: '' })}
        >
          <AnalysisPanel />
          <MoveList />
          <MistakeBook />
          <GameShelf />
        </aside>
      </main>

      <ReplayDesk />
      <DrillDesk />
      <Toasts />
      <HelpOverlay />
      {!isSoundEnabled() && ui.soundOn && (
        <span className="sr-only">音效已启用，等待首次交互解锁</span>
      )}
    </div>
  )
}

export default function App() {
  return (
    <GameProvider>
      <UIProvider>
        <AppContent />
      </UIProvider>
    </GameProvider>
  )
}
