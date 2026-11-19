import { useState, useCallback, useEffect, memo } from 'react'
import type { GameSnapshot, PieceInfo } from '../../types'
import type { BoardMap, ValidationResult } from '../../lib/setup'
import { useUIContext } from '../../context/UIContext'
import { Board } from '../Board'
import { PoofOverlay, type PoofBurst } from '../board/PoofOverlay'
import { consumeEsc } from './setupKeyboard'
import { SetupStudioTopHud } from './SetupStudioTopHud'
import { SetupStudioWingRack } from './SetupStudioWingRack'
import { SetupStudioBottomDock } from './SetupStudioBottomDock'

export interface SetupStudioProps {
  game: GameSnapshot
  boardMap: BoardMap
  pieces: PieceInfo[]
  remaining: Record<string, number>
  validation: ValidationResult
  currentFen: string
  turn: 'red' | 'black'
  engineSide: 'red' | 'black'
  flipped: boolean
  selectedTrayPiece: string | null
  pickedBoardSquare: string | null
  onSelectTrayPiece: (char: string | null) => void
  onClearBoard: () => void
  onResetStandard: () => void
  onRevertOriginal: () => void
  onSetupSquareTap: (sq: string) => void
  onSetupPieceMove: (from: string, to: string) => void
  onSetupPieceRemove: (sq: string) => void
  onSetupPickBoardSquare: (sq: string | null) => void
  onSetupPieceDropFromTray: (char: string, sq: string) => void
  onTurnChange: (turn: 'red' | 'black') => void
  onEngineSideChange: (side: 'red' | 'black') => void
  onImportFen: (fen: string) => boolean
  onStartGame: () => void
  onExitSetup: () => void
  onToast: (text: string, tone?: 'info' | 'warn' | 'error') => void
}

/** 首次进入排局台的退出提示：每个浏览器只郑重告知一次，之后静默 */
const EXIT_HINT_LS_KEY = 'ef.setup-exit-hint'

let poofIdCounter = 1

/**
 * 排局工作室（Setup Studio）主舞台
 * - 沉浸全屏工作室形态，自动剔除冗余侧栏与上一局棋谱
 * - 棋盘居中铺展至视口极限（不被下方大面板挤压）
 * - 左右双翼红黑实木悬浮棋架（支持直接拖入盘面、支持连盖印章）
 * - 顶部微悬浮灵动 HUD + 底部一体化控制坞
 * - 离盘化烟消散（macOS Poof 粒子特效）
 *
 * 键盘对等（F4）：Esc 的职责分三层 —— 收拢本地浮层 / 清选择 / 退出排局；
 * Z 在台内被拦截，禅意 HUD 不会叠到排局台上（禅意 × 排局叠加态拆除）。
 */
export const SetupStudio = memo(function SetupStudio({
  game,
  boardMap: _boardMap,
  pieces,
  remaining,
  validation,
  currentFen,
  turn,
  engineSide,
  flipped,
  selectedTrayPiece,
  pickedBoardSquare,
  onSelectTrayPiece,
  onClearBoard,
  onResetStandard,
  onRevertOriginal,
  onSetupSquareTap,
  onSetupPieceMove,
  onSetupPieceRemove,
  onSetupPickBoardSquare,
  onSetupPieceDropFromTray,
  onTurnChange,
  onEngineSideChange,
  onImportFen,
  onStartGame,
  onExitSetup,
  onToast,
}: SetupStudioProps) {
  const ui = useUIContext()
  const { help: helpOpen, setHelp, setZenMode } = ui
  // 离盘化烟爆散粒子队列
  const [poofBursts, setPoofBursts] = useState<PoofBurst[]>([])
  // 首次进入的退出提示（localStorage 记住「已告知」）
  const [showExitHint, setShowExitHint] = useState(
    () => typeof window === 'undefined' || !window.localStorage.getItem(EXIT_HINT_LS_KEY),
  )

  const triggerPoof = useCallback((x: number, y: number) => {
    setPoofBursts((prev) => [...prev, { id: poofIdCounter++, x, y }])
  }, [])

  const removePoof = useCallback((id: number) => {
    setPoofBursts((prev) => prev.filter((b) => b.id !== id))
  }, [])

  // 处理盘面棋子移除（同时激化烟粒子动效）
  const handlePieceRemoveWithPoof = useCallback(
    (sq: string) => {
      onSetupPieceRemove(sq)
    },
    [onSetupPieceRemove],
  )

  const dismissExitHint = useCallback(() => {
    try {
      window.localStorage.setItem(EXIT_HINT_LS_KEY, '1')
    } catch {
      // 隐私模式下 localStorage 不可写：退化为仅本次会话不再提示
    }
    setShowExitHint(false)
  }, [])

  /**
   * 键盘对等（F4）—— 捕获相监听，跑在 App.tsx 全局 handler（冒泡相）之前。
   * 两个全局键在排局台内被收编：
   *  · Z：排局进行中不切禅意。App.tsx:165-169 的全局 Z 没有 setup 守卫，
   *    按一下禅意 HUD 就叠到排局台上 —— 一台谁也没设计过的混合机器。
   *  · Esc：有明确的取消层次，而不是被截胡成「只清选择、退不出去」。
   * 帮助层开着时 Esc 优先关帮助（一次 Esc 只做一件事），其余情况一律
   * preventDefault + stopPropagation，不让 Esc/Z 穿透到全局 handler。
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const typing = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')

      // Z（无修饰键，且不在打字）：拦截禅意切换 affordance
      if ((e.key === 'z' || e.key === 'Z') && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault()
        e.stopPropagation()
        return
      }

      if (e.key !== 'Escape') return

      // 帮助层开着：先关帮助，一次 Esc 只做一件事
      if (helpOpen) {
        e.preventDefault()
        e.stopPropagation()
        setHelp(false)
        return
      }
      // 本地浮层开着（FEN 弹窗 / 残局下拉 / 异常气泡）：收拢最上面那层
      if (consumeEsc()) {
        e.preventDefault()
        e.stopPropagation()
        return
      }
      // 有选中：第一段 Esc 清选择（拖拽/连盖/盘上拾取态），并告知下一段是退出
      if (selectedTrayPiece || pickedBoardSquare) {
        e.preventDefault()
        e.stopPropagation()
        onSelectTrayPiece(null)
        onSetupPickBoardSquare(null)
        onToast('选择已放下，再按一次 Esc 退出排局', 'info')
        return
      }
      // 无选中：退出排局 —— 与其余 Desk 的 Esc 语义对齐
      e.preventDefault()
      e.stopPropagation()
      onExitSetup()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [helpOpen, setHelp, selectedTrayPiece, pickedBoardSquare, onSelectTrayPiece, onSetupPickBoardSquare, onExitSetup, onToast])

  /**
   * 叠加态拆除（App 层修好前的自保）：从禅意模式点进排局台时，SetupStudio
   * 挂载即退出禅意 —— 否则 ZenHud 会悬浮在排局台上方。挂载后 zenMode 再无
   * 入口（上面的 Z 守卫拦着），这个 effect 只是把进台前遗留的态摆正。
   */
  useEffect(() => {
    if (ui.zenMode) setZenMode(false)
  }, [ui.zenMode, setZenMode])

  const boardEmpty = pieces.length === 0

  return (
    <div className="setup-studio flex flex-col items-center justify-between w-full h-full max-h-screen px-3 py-2 gap-2 relative select-none animate-in fade-in duration-200 box-border overflow-hidden">
      {/* 1. 离盘化烟粒子层 */}
      <PoofOverlay bursts={poofBursts} onComplete={removePoof} />

      {/* 2. 顶部微悬浮灵动 HUD */}
      <SetupStudioTopHud
        currentFen={currentFen}
        onExit={onExitSetup}
        onImportFen={onImportFen}
        onClearBoard={onClearBoard}
        onResetStandard={onResetStandard}
        onRevertOriginal={onRevertOriginal}
        onToast={onToast}
      />

      {/* 3. 核心对决排局中心舞台（左右双翼实木棋槽 + 居中巨幅棋盘） */}
      <div className="studio-arena setup-enter-arena flex items-center justify-center gap-3 sm:gap-6 w-full flex-1 min-h-0 relative overflow-hidden my-1">
        {/* 左翼：红方棋槽 */}
        <SetupStudioWingRack
          side="red"
          remaining={remaining}
          selectedTrayPiece={selectedTrayPiece}
          onSelectTrayPiece={onSelectTrayPiece}
        />

        {/* 中路巨幅棋盘容器 */}
        <div className="studio-board-wrap relative flex items-center justify-center h-full max-h-full aspect-[720/800] z-10">
          <Board
            game={game}
            flipped={flipped}
            thinking={false}
            onMove={async () => false}
            setupMode={true}
            setupPieces={pieces}
            selectedTrayPiece={selectedTrayPiece}
            pickedBoardSquare={pickedBoardSquare}
            onSetupSquareTap={onSetupSquareTap}
            onSetupPieceMove={onSetupPieceMove}
            onSetupPieceRemove={handlePieceRemoveWithPoof}
            onSetupPickBoardSquare={onSetupPickBoardSquare}
            onSetupPieceDropFromTray={onSetupPieceDropFromTray}
            onPoofTriggered={triggerPoof}
            setupValidation={validation}
          />

          {/* 空状态：棋盘推平后不是一块茫然的白，是一张等着落子的画布 */}
          {boardEmpty && (
            <div className="studio-empty animate-in fade-in zoom-in-95 duration-200" role="status">
              <span className="studio-empty-glyph font-kai" aria-hidden="true">
                空
              </span>
              <p className="studio-empty-title font-display">盘面已空</p>
              <p className="studio-empty-body">
                空盘就是画布。从两侧棋架取子落盘，或让顶部的「经典残局」替你起个头。
              </p>
              <button
                type="button"
                className="studio-empty-action"
                onClick={onResetStandard}
                title="恢复标准开局（三十二子）"
              >
                载入标准开局
              </button>
            </div>
          )}
        </div>

        {/* 右翼：黑方棋槽 */}
        <SetupStudioWingRack
          side="black"
          remaining={remaining}
          selectedTrayPiece={selectedTrayPiece}
          onSelectTrayPiece={onSelectTrayPiece}
        />
      </div>

      {/* 首次进入的退出提示：定位槽 + 动画内胆分离，animate-in 的 transform
          不会冲掉居中位移；绝对定位不挤占布局（CLS=0）；Esc 二段式防误触 */}
      {showExitHint && (
        <div className="setup-exit-hint-slot">
          <div className="setup-exit-hint animate-in fade-in duration-200" role="note">
            <span className="setup-exit-hint-text">
              <span className="esc-chip" aria-hidden="true">
                Esc
              </span>
              先清选择，再按一次退出排局
            </span>
            <button
              type="button"
              className="setup-exit-hint-close"
              onClick={dismissExitHint}
              aria-label="知道了，不再提示"
              title="不再提示"
            >
              <span aria-hidden="true">✕</span>
            </button>
          </div>
        </div>
      )}

      {/* 4. 底部一体化高定控制坞 */}
      <SetupStudioBottomDock
        turn={turn}
        engineSide={engineSide}
        valid={validation.valid}
        errors={validation.errors}
        onTurnChange={onTurnChange}
        onEngineSideChange={onEngineSideChange}
        onStartGame={onStartGame}
        onExitSetup={onExitSetup}
        onToast={onToast}
      />
    </div>
  )
})
