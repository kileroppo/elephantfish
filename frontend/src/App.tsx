import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from './api'
import { Board } from './components/Board'
import { RelayConsole } from './components/RelayConsole'
import { RightRail } from './components/RightRail'
import { ReplayDesk } from './components/ReplayDesk'
import { DrillDesk } from './components/DrillDesk'
import { ControlRail } from './components/ControlRail'
import { TopBar } from './components/TopBar'
import { SetupStudio } from './components/setup/SetupStudio'
import { HelpOverlay, Toasts } from './components/Overlays'
import { BootScreen } from './components/app/BootScreen'
import { ZenHud } from './components/app/ZenHud'
import { StageHead } from './components/app/StageHead'
import { ResultModal } from './components/app/ResultModal'
import { RailTabs } from './components/app/RailTabs'
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
      // side 为 engine_side
      // 代下模式：引擎朝下（引擎黑 -> flipped = true）
      // 陪练模式：我执朝下（引擎红 = 我黑 -> flipped = true）
      const shouldFlip = ui.playMode === 'relay' ? side === 'black' : side === 'red'
      ui.setFlipOverride(shouldFlip)
      void g.newGame(side)
    },
    [g, ui],
  )

  const handleReplayCurrent = useCallback(async () => {
    setDismissedOver(true)
    try {
      const res = await api.games()
      const latest = res.games?.[0]
      if (!latest) {
        g.pushToast('库中暂无本局存档', 'warn')
        return
      }
      let keyPly: number | null = null
      if (game?.records) {
        for (const r of game.records) {
          if (r.by === 'opponent' && r.review) {
            const rv = r.review
            const isCritical =
              rv.tactics?.severity === 'critical' ||
              rv.tactics?.severity === 'warn' ||
              rv.status === 'outside' ||
              rv.loss_kind === 'mate' ||
              (typeof rv.loss === 'number' && rv.loss >= 90)
            if (isCritical) {
              keyPly = r.ply
              break
            }
          }
        }
      }
      ui.openReplayAt(latest.game_id, keyPly ?? 1)
    } catch {
      g.pushToast('打开复盘失败', 'error')
    }
  }, [game?.records, g, ui])

  // 终局弹窗延迟 3 秒弹出
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
      if (e.key === ']' || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b')) {
        e.preventDefault()
        if (ui.railR) {
          ui.closeCoachLive()
        }
        ui.toggleRailR()
        return
      }
      if (e.key === 'Escape' && ui.zenMode) {
        e.preventDefault()
        ui.setZenMode(false)
        return
      }
      if (e.key === 'f' || e.key === 'F' || e.key === 'x' || e.key === 'X') {
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
      const shouldFlip = ui.playMode === 'relay' ? nextSide === 'black' : nextSide === 'red'
      ui.setFlipOverride(shouldFlip)
      g.pushToast(
        ui.playMode === 'relay'
          ? `排局设定：引擎执${nextSide === 'red' ? '红' : '黑'}（引擎${nextSide === 'red' ? '红' : '黑'}方朝下）`
          : `排局设定：引擎执${nextSide === 'red' ? '红' : '黑'}（我方执${nextSide === 'red' ? '黑' : '红'}朝下）`,
        'info',
      )
    } else if (game) {
      const nextSide = game.engine_side === 'red' ? 'black' : 'red'
      handleNewGame(nextSide)
      g.pushToast(
        ui.playMode === 'relay'
          ? `已切换为引擎执${nextSide === 'red' ? '红' : '黑'}（引擎朝下）`
          : `已切换为我执${nextSide === 'red' ? '黑' : '红'}（我方朝下）`,
        'ok',
      )
    }
  }, [setup, game, handleNewGame, g, ui])

  if (g.booting && !g.state) {
    return <BootScreen booting />
  }

  if (!g.state || !game) {
    return <BootScreen onRetry={() => void g.refresh()} />
  }

  const turnText = setup.active
    ? `补棋排局中 · 设定【${setup.turn === 'red' ? '红先' : '黑先'}】`
    : isPlaying
      ? g.thinking
        ? '引擎深度计算中…'
        : `轮到${sideName(game.turn)}${
            game.turn === game.engine_side
              ? '（引擎出招）'
              : ui.playMode === 'relay'
              ? '（请录入对方走法）'
              : '（您出招，请在盘面落子）'
          }`
      : game.status.reason || '对局结束'

  return (
    <div className={`app${g.thinking ? ' is-thinking' : ''}${ui.zenMode ? ' is-zen-mode' : ''}`}>
      {!setup.active && (
        <TopBar
          setupMode={setup.active}
          onToggleSetup={setup.toggle}
          onToggleEngineSide={onToggleEngineSide}
        />
      )}

      {ui.zenMode && (
        <ZenHud
          isPlaying={isPlaying}
          turn={game.turn}
          thinking={g.thinking}
          onExit={() => ui.setZenMode(false)}
        />
      )}

      {setup.active ? (
        <main className="workspace workspace-setup-studio">
          <SetupStudio
            game={game}
            boardMap={setup.boardMap}
            pieces={setup.pieces}
            remaining={setup.remaining}
            validation={setup.validation}
            currentFen={setup.currentFen}
            turn={setup.turn}
            engineSide={setup.engineSide}
            flipped={ui.flipped}
            selectedTrayPiece={setup.selectedTrayPiece}
            pickedBoardSquare={setup.pickedBoardSquare}
            onSelectTrayPiece={setup.selectTrayPiece}
            onClearBoard={setup.clearBoard}
            onResetStandard={setup.resetStandard}
            onRevertOriginal={setup.revertOriginal}
            onSetupSquareTap={setup.tapSquare}
            onSetupPieceMove={setup.movePiece}
            onSetupPieceRemove={setup.removePiece}
            onSetupPickBoardSquare={setup.pickSquare}
            onSetupPieceDropFromTray={setup.dropPieceToSquare}
            onTurnChange={setup.setTurn}
            onEngineSideChange={(side) => {
              setup.setEngineSide(side)
              const shouldFlip = ui.playMode === 'relay' ? side === 'black' : side === 'red'
              ui.setFlipOverride(shouldFlip)
            }}
            onImportFen={setup.importFen}
            onStartGame={() => {
              const shouldFlip = ui.playMode === 'relay' ? setup.engineSide === 'black' : setup.engineSide === 'red'
              ui.setFlipOverride(shouldFlip)
              void setup.startGame()
            }}
            onExitSetup={setup.exit}
            onToast={g.pushToast}
          />
        </main>
      ) : (
        <main className={`workspace${ui.railL && !ui.zenMode ? '' : ' no-left'}${ui.railR && !ui.zenMode ? '' : ' no-right'}`}>
          {!ui.zenMode && (
            <RailTabs
              railL={ui.railL}
              railR={ui.railR}
              onToggleL={ui.toggleRailL}
              onToggleR={ui.toggleRailR}
            />
          )}

          <ControlRail
            setupMode={setup.active}
            onToggleSetup={setup.toggle}
            onNewGame={handleNewGame}
          />

          <div className="stage">
            <StageHead
              turn={game.turn}
              turnText={turnText}
              isPlaying={isPlaying}
              isEngineTurn={isPlaying && game.turn === game.engine_side}
              inCheck={game.in_check}
              setupActive={setup.active}
              ply={game.ply}
            />

            <div className={`board-wrap relative ${showOverModal ? 'is-over' : ''}`}>
              <Board
                game={ui.previewGame ? ui.previewGame : game}
                flipped={ui.flipped}
                flipping={ui.flipping}
                thinking={g.thinking}
                pv={
                  ui.previewPv.length > 0
                    ? ui.previewPv
                    : g.thinking
                      ? (g.task?.progress?.pv ?? [])
                      : []
                }
                visualClues={ui.liveClues ?? undefined}
                readOnly={ui.previewGame !== null}
                onMove={onBoardMove}
              />

              {overMounted && (
                <ResultModal
                  game={game}
                  overLeaving={overLeaving}
                  engineMoves={g.state.stats.moves}
                  onClose={() => setDismissedOver(true)}
                  onNewGame={() => handleNewGame(game.engine_side)}
                  onReplayCurrent={() => void handleReplayCurrent()}
                  onUndoRound={() => void g.undoRound()}
                  onOpenDrillAt={(motif, gameId) => ui.openDrillAt(motif, gameId)}
                />
              )}
            </div>

            <RelayConsole />
          </div>

          <RightRail open={ui.railR} />
        </main>
      )}

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
