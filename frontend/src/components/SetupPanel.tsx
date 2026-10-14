import { useState } from 'react'
import {
  BLACK_PIECES,
  type BoardMap,
  PIECE_SPECS,
  RED_PIECES,
  boardMapToFen,
  fenToBoardMap,
  getRemainingCounts,
  validateSetupBoard,
} from '../lib/setup'

interface SetupPanelProps {
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
    <div className="setup-panel">
      {/* 顶部标题与快速动作 */}
      <div className="setup-panel-header">
        <div className="setup-title-box">
          <span className="setup-badge">排局模式</span>
          <span className="setup-subtitle">自由增减与调动棋子，排布专属残局或杀局</span>
        </div>
        <div className="setup-quick-actions">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={onClearBoard}
            title="清空棋盘所有棋子"
          >
            清空棋盘
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={onResetStandard}
            title="恢复为正规标准开局 32 颗棋子"
          >
            标准开局
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={onRevertOriginal}
            title="还原为进入补棋模式前的局面"
          >
            恢复原局
          </button>
          <button
            type="button"
            className={`btn btn-ghost btn-sm ${fenOpen ? 'is-active' : ''}`}
            onClick={() => setFenOpen((v) => !v)}
            title="导入或导出 FEN 局面代码"
          >
            FEN 工具 {fenOpen ? '▲' : '▼'}
          </button>
        </div>
      </div>

      {/* FEN 抽屉 */}
      {fenOpen && (
        <div className="setup-fen-box">
          <div className="fen-row">
            <span className="fen-label">当前 FEN:</span>
            <input
              type="text"
              readOnly
              value={currentFen}
              className="fen-input"
              onClick={(e) => (e.target as HTMLInputElement).select()}
            />
            <button type="button" className="btn btn-ghost btn-sm" onClick={handleCopyFen}>
              复制
            </button>
          </div>
          <div className="fen-row">
            <span className="fen-label">导入 FEN:</span>
            <input
              type="text"
              placeholder="粘贴 FEN 字符串，如 4k4/9/9/9/9/9/9/9/9/4K4 w - - 0 1"
              value={fenInput}
              onChange={(e) => setFenInput(e.target.value)}
              className="fen-input"
            />
            <button type="button" className="btn btn-primary btn-sm" onClick={handleApplyFen}>
              导入
            </button>
          </div>
        </div>
      )}

      {/* 备用棋子托盘 (红方与黑方) */}
      <div className="setup-trays">
        {/* 红方备用盒 */}
        <div className="piece-tray red-tray">
          <div className="tray-label">
            <span className="tray-dot red-dot" />
            <span>红方备用子</span>
          </div>
          <div className="tray-pieces">
            {RED_PIECES.map((ch) => {
              const spec = PIECE_SPECS[ch]
              const rem = remaining[ch] ?? 0
              const isSelected = selectedTrayPiece === ch
              const isDisabled = rem <= 0

              return (
                <button
                  key={ch}
                  type="button"
                  className={`tray-piece-btn red ${isSelected ? 'is-selected' : ''} ${
                    isDisabled ? 'is-empty' : ''
                  }`}
                  disabled={isDisabled && !isSelected}
                  onClick={() => onSelectTrayPiece(isSelected ? null : ch)}
                  title={
                    isDisabled
                      ? `${spec.name} 已全部上盘`
                      : `点击选择【红方 ${spec.name}】，剩余 ${rem} 枚可用`
                  }
                >
                  <span className="tray-piece-circle">
                    <span className="tray-piece-glyph">{spec.glyph}</span>
                  </span>
                  <span className="tray-count-tag">×{rem}</span>
                </button>
              )
            })}
          </div>
        </div>

        {/* 黑方备用盒 */}
        <div className="piece-tray black-tray">
          <div className="tray-label">
            <span className="tray-dot black-dot" />
            <span>黑方备用子</span>
          </div>
          <div className="tray-pieces">
            {BLACK_PIECES.map((ch) => {
              const spec = PIECE_SPECS[ch]
              const rem = remaining[ch] ?? 0
              const isSelected = selectedTrayPiece === ch
              const isDisabled = rem <= 0

              return (
                <button
                  key={ch}
                  type="button"
                  className={`tray-piece-btn black ${isSelected ? 'is-selected' : ''} ${
                    isDisabled ? 'is-empty' : ''
                  }`}
                  disabled={isDisabled && !isSelected}
                  onClick={() => onSelectTrayPiece(isSelected ? null : ch)}
                  title={
                    isDisabled
                      ? `${spec.name} 已全部上盘`
                      : `点击选择【黑方 ${spec.name}】，剩余 ${rem} 枚可用`
                  }
                >
                  <span className="tray-piece-circle">
                    <span className="tray-piece-glyph">{spec.glyph}</span>
                  </span>
                  <span className="tray-count-tag">×{rem}</span>
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {/* 当前操作状态指示 */}
      <div className="setup-status-strip">
        {selectedTrayPiece ? (
          <div className="status-tip active-tray-tip">
            <span className="tip-icon">♟</span>
            <span>
              已选中备用子
              <strong>
                【{PIECE_SPECS[selectedTrayPiece].side === 'red' ? '红' : '黑'}
                {PIECE_SPECS[selectedTrayPiece].name}】
              </strong>
              ，点击棋盘任意空格即可放置（剩余可用 {remaining[selectedTrayPiece]} 枚）。
            </span>
            <button
              type="button"
              className="btn btn-ghost btn-xs"
              onClick={() => onSelectTrayPiece(null)}
            >
              取消放子
            </button>
          </div>
        ) : pickedBoardSquare && pickedSpec ? (
          <div className="status-tip active-picked-tip">
            <span className="tip-icon">📍</span>
            <span>
              已选中盘上
              <strong>
                【{pickedSpec.side === 'red' ? '红' : '黑'}
                {pickedSpec.name} 于 {pickedBoardSquare}】
              </strong>
              。点击另一空格可移位，或右键/点击右侧按钮移除：
            </span>
            <button
              type="button"
              className="btn btn-warn btn-xs"
              onClick={onRemovePickedPiece}
            >
              从盘上移除
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-xs"
              onClick={onCancelPick}
            >
              取消选择
            </button>
          </div>
        ) : (
          <div className="status-tip normal-tip">
            <span className="tip-icon">💡</span>
            <span>
              <strong>操作指南：</strong>
              从上方点击备用子，再点棋盘空格落盘；盘上已有子可自由拖动或点击挪位；右键或拖出棋盘可将棋子移除。
            </span>
          </div>
        )}
      </div>

      {/* 合法性校验警告/通过信息条 */}
      <div className="setup-validation-box">
        {validation.valid ? (
          <div className="validation-banner is-valid">
            <span className="validation-icon">✓</span>
            <span className="validation-text">盘面完全合规，随时可以开始对局</span>
          </div>
        ) : (
          <div className="validation-banner is-invalid">
            <div className="validation-head">
              <span className="validation-icon">⚠️</span>
              <span className="validation-title">
                盘面存在 {validation.errors.length} 处不合规（暂无法开始对局）：
              </span>
            </div>
            <ul className="validation-list">
              {validation.errors.map((err, i) => (
                <li key={i}>{err}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* 对局设定与启动动作 */}
      <div className="setup-bottom-bar">
        <div className="setup-settings-box">
          <div className="setup-options">
            {/* 谁先走 */}
            <div className="option-group">
              <span className="option-label">轮到走棋:</span>
              <div className="segmented-sm">
                <button
                  type="button"
                  className={`seg-btn ${turn === 'red' ? 'is-active' : ''}`}
                  onClick={() => onTurnChange('red')}
                >
                  <span className="dot red-dot" /> 轮到红方
                </button>
                <button
                  type="button"
                  className={`seg-btn ${turn === 'black' ? 'is-active' : ''}`}
                  onClick={() => onTurnChange('black')}
                >
                  <span className="dot black-dot" /> 轮到黑方
                </button>
              </div>
            </div>

            {/* 引擎执子 */}
            <div className="option-group">
              <span className="option-label">引擎执子:</span>
              <div className="segmented-sm">
                <button
                  type="button"
                  className={`seg-btn ${engineSide === 'red' ? 'is-active' : ''}`}
                  onClick={() => onEngineSideChange('red')}
                >
                  执红（朝下）
                </button>
                <button
                  type="button"
                  className={`seg-btn ${engineSide === 'black' ? 'is-active' : ''}`}
                  onClick={() => onEngineSideChange('black')}
                >
                  执黑（朝下）
                </button>
              </div>
            </div>
          </div>

          <div className="setup-scenario-hint">
            <span className="scenario-bulb">💡</span>
            <span className="scenario-text">
              开局状态：引擎执{engineSide === 'red' ? '红' : '黑'}（朝下），
              {turn === engineSide
                ? '开局由引擎自动出招'
                : `开局轮到${turn === 'red' ? '红' : '黑'}方（请在盘面落子）`}
            </span>
          </div>
        </div>

        <div className="setup-action-btns">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={onExitSetup}
            title="退出补棋模式，放弃未保存的摆子更改"
          >
            放弃并退出
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!validation.valid}
            onClick={onStartGame}
            title={validation.valid ? '载入该局面并开启新对局' : '请先修正盘面错误后再开局'}
          >
            确认并开始对局
          </button>
        </div>
      </div>
    </div>
  )
}
