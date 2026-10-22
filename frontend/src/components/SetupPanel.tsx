import { useState } from 'react'
import {
  type BoardMap,
  PIECE_SPECS,
  boardMapToFen,
  fenToBoardMap,
  getRemainingCounts,
  validateSetupBoard,
} from '../lib/setup'
import { SetupHeader } from './panels/SetupHeader'
import {
  SetupTemplates,
  ENDGAME_TEMPLATES,
  type EndgameTemplate,
} from './panels/SetupTemplates'
import { SetupTrays } from './panels/SetupTrays'
import { SetupStatusStrip } from './panels/SetupStatusStrip'
import { SetupValidation } from './panels/SetupValidation'
import { SetupFooter } from './panels/SetupFooter'

export { ENDGAME_TEMPLATES, type EndgameTemplate }

export interface SetupPanelProps {
  boardMap: BoardMap
  turn: 'red' | 'black'
  engineSide: 'red' | 'black'
  selectedTrayPiece: string | null
  pickedBoardSquare: string | null
  onSelectTrayPiece: (char: string | null) => void
  onClearBoard: () => void
  onResetStandard: () => void
  onRevertOriginal: () => void
  onRemovePickedPiece: () => void
  onCancelPick: () => void
  onTurnChange: (turn: 'red' | 'black') => void
  onEngineSideChange: (side: 'red' | 'black') => void
  onImportFen: (fen: string) => void
  onStartGame: () => void
  onExitSetup: () => void
  onToast: (text: string, tone?: 'info' | 'warn' | 'error') => void
}

export function SetupPanel({
  boardMap,
  turn,
  engineSide,
  selectedTrayPiece,
  pickedBoardSquare,
  onSelectTrayPiece,
  onClearBoard,
  onResetStandard,
  onRevertOriginal,
  onRemovePickedPiece,
  onCancelPick,
  onTurnChange,
  onEngineSideChange,
  onImportFen,
  onStartGame,
  onExitSetup,
  onToast,
}: SetupPanelProps) {
  const [fenOpen, setFenOpen] = useState(false)
  const [fenInput, setFenInput] = useState('')

  const remaining = getRemainingCounts(boardMap)
  const validation = validateSetupBoard(boardMap, turn)
  const currentFen = boardMapToFen(boardMap, turn)

  const handleCopyFen = async () => {
    try {
      await navigator.clipboard.writeText(currentFen)
      onToast('FEN 字符串已复制到剪贴板', 'info')
    } catch {
      onToast('复制失败，请手动选取复制', 'warn')
    }
  }

  const handleApplyFen = () => {
    const trimmed = fenInput.trim()
    if (!trimmed) {
      onToast('请输入有效的 FEN 字符串', 'warn')
      return
    }
    const res = fenToBoardMap(trimmed)
    if (!res || res.error) {
      onToast(res?.error || 'FEN 解析失败，请检查格式', 'error')
      return
    }
    onImportFen(trimmed)
    setFenInput('')
    setFenOpen(false)
    onToast('已成功导入 FEN 局面', 'info')
  }

  const pickedChar = pickedBoardSquare ? boardMap[pickedBoardSquare] : null
  const pickedSpec = pickedChar ? PIECE_SPECS[pickedChar] : null

  return (
    <div className="setup-panel flex flex-col gap-3 p-4 rounded-lg bg-paper-1/95 border border-hairline-strong shadow-md animate-in fade-in duration-200">
      <SetupHeader
        fenOpen={fenOpen}
        onClearBoard={onClearBoard}
        onResetStandard={onResetStandard}
        onRevertOriginal={onRevertOriginal}
        onToggleFen={() => setFenOpen((v) => !v)}
      />

      <SetupTemplates
        fenOpen={fenOpen}
        currentFen={currentFen}
        fenInput={fenInput}
        onFenInputChange={setFenInput}
        onCopyFen={handleCopyFen}
        onApplyFen={handleApplyFen}
        onLoadTemplate={(tmpl) => {
          onImportFen(tmpl.fen)
          onToast(`已载入残局模板「${tmpl.name}」`, 'info')
        }}
      />

      <SetupTrays
        remaining={remaining}
        selectedTrayPiece={selectedTrayPiece}
        onSelectTrayPiece={onSelectTrayPiece}
      />

      <SetupStatusStrip
        selectedTrayPiece={selectedTrayPiece}
        pickedBoardSquare={pickedBoardSquare}
        pickedSpec={pickedSpec}
        remainingCount={selectedTrayPiece ? remaining[selectedTrayPiece] : 0}
        onCancelTrayPiece={() => onSelectTrayPiece(null)}
        onRemovePickedPiece={onRemovePickedPiece}
        onCancelPick={onCancelPick}
      />

      <SetupValidation valid={validation.valid} errors={validation.errors} />

      <SetupFooter
        turn={turn}
        engineSide={engineSide}
        valid={validation.valid}
        onTurnChange={onTurnChange}
        onEngineSideChange={onEngineSideChange}
        onExitSetup={onExitSetup}
        onStartGame={onStartGame}
      />
    </div>
  )
}
