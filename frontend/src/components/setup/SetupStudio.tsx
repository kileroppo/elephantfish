import { useState, useCallback, memo } from 'react'
import type { GameSnapshot, PieceInfo } from '../../types'
import type { BoardMap, ValidationResult } from '../../lib/setup'
import { Board } from '../Board'
import { PoofOverlay, type PoofBurst } from '../board/PoofOverlay'
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

let poofIdCounter = 1

/**
 * 排局工作室（Setup Studio）主舞台
 * - 沉浸全屏工作室形态，自动剔除冗余侧栏与上一局棋谱
 * - 棋盘居中铺展至视口极限（不被下方大面板挤压）
 * - 左右双翼红黑实木悬浮棋架（支持直接拖入盘面、支持连盖印章）
 * - 顶部微悬浮灵动 HUD + 底部一体化控制坞
 * - 离盘化烟消散（macOS Poof 粒子特效）
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
  // 离盘化烟爆散粒子队列
  const [poofBursts, setPoofBursts] = useState<PoofBurst[]>([])

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
      <div className="studio-arena flex items-center justify-center gap-3 sm:gap-6 w-full flex-1 min-h-0 relative overflow-hidden my-1">
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
        </div>

        {/* 右翼：黑方棋槽 */}
        <SetupStudioWingRack
          side="black"
          remaining={remaining}
          selectedTrayPiece={selectedTrayPiece}
          onSelectTrayPiece={onSelectTrayPiece}
        />
      </div>

      {/* 4. 底部一体化高定控制坞 */}
      <SetupStudioBottomDock
        turn={turn}
        engineSide={engineSide}
        valid={validation.valid}
        errors={validation.errors}
        onTurnChange={onTurnChange}
        onEngineSideChange={onEngineSideChange}
        onStartGame={onStartGame}
        onToast={onToast}
      />
    </div>
  )
})
