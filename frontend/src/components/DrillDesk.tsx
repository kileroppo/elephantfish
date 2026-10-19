import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from '../api'
import type {
  GameSnapshot,
  PuzzleCategory,
  TrainingHintReply,
  TrainingPuzzle,
  TrainingSummary,
} from '../types'
import { Board } from './Board'
import { useExitPhase } from '../hooks/useExitPhase'

export interface DrillDeskProps {
  open: boolean
  initialPuzzleId?: string | null
  onClose: () => void
  onToast: (text: string, tone?: 'info' | 'warn' | 'error') => void
}

export function DrillDesk({ open, initialPuzzleId, onClose, onToast }: DrillDeskProps) {
  const [mounted, leaving] = useExitPhase(open)

  const [categories, setCategories] = useState<PuzzleCategory[]>([])
  const [puzzles, setPuzzles] = useState<TrainingPuzzle[]>([])
  const [summary, setSummary] = useState<TrainingSummary | null>(null)
  const [activeCategory, setActiveCategory] = useState<string>('kill_tactics')

  const [currentPuzzle, setCurrentPuzzle] = useState<TrainingPuzzle | null>(null)
  const [game, setGame] = useState<GameSnapshot | null>(null)
  const [thinking, setThinking] = useState(false)
  const [solved, setSolved] = useState(false)
  const [feedback, setFeedback] = useState<{ text: string; tone: 'info' | 'success' | 'warn' | 'error' }>({
    text: '正在加载题目…',
    tone: 'info',
  })

  const [hints, setHints] = useState<string[]>([])
  const [hintLevel, setHintLevel] = useState(0)
  const [sandbox, setSandbox] = useState(false)
  const [pv, setPv] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [flipped, setFlipped] = useState(false)

  // 1. 加载单道题目进入实训
  const loadPuzzle = async (puzzleId: string) => {
    setLoading(true)
    setHints([])
    setHintLevel(0)
    setSolved(false)
    setPv([])
    try {
      const res = await api.trainingStart(puzzleId)
      setCurrentPuzzle(res.puzzle)
      setGame(res.game)
      setSolved(res.solved)
      setSandbox(res.sandbox)
      setFeedback({
        text: `🎯 题目就绪：【${res.puzzle.target}】。请红方执子落招！`,
        tone: 'info',
      })
    } catch (err) {
      onToast(err instanceof ApiError ? err.message : '进入实训失败', 'error')
    } finally {
      setLoading(false)
    }
  }

  // 2. 静默刷新题库状态与档案（不重置当前棋盘）
  const refreshCatalog = useCallback(async () => {
    try {
      const res = await api.trainingPuzzles()
      setCategories(res.categories || [])
      setPuzzles(res.puzzles || [])
      setSummary(res.summary || null)
      if (currentPuzzle) {
        const updated = res.puzzles.find((p) => p.id === currentPuzzle.id)
        if (updated) {
          setCurrentPuzzle((prev) => (prev ? { ...prev, ...updated } : updated))
        }
      }
    } catch {
      // 静默失败，不打扰当前下棋
    }
  }, [currentPuzzle])

  // 3. 打开精训营时初始化题库并进入第一道题
  useEffect(() => {
    if (!open) return
    let active = true

    const init = async () => {
      try {
        const res = await api.trainingPuzzles()
        if (!active) return
        setCategories(res.categories || [])
        setPuzzles(res.puzzles || [])
        setSummary(res.summary || null)

        const targetId = initialPuzzleId || (res.puzzles?.[0]?.id ?? null)
        if (targetId) {
          const found = res.puzzles.find((p) => p.id === targetId) || res.puzzles[0]
          if (found) {
            setActiveCategory(found.category)
            void loadPuzzle(found.id)
          }
        }
      } catch (err) {
        if (active) {
          onToast(err instanceof ApiError ? err.message : '题库加载失败', 'error')
        }
      }
    }

    void init()
    return () => {
      active = false
    }
  }, [open, initialPuzzleId, onToast])

  // 4. 落子实训走法
  const handleMove = async (iccs: string): Promise<boolean> => {
    if (!currentPuzzle || solved || thinking) return false
    setThinking(true)
    try {
      const res = await api.trainingStep(currentPuzzle.id, iccs, sandbox)
      if (res.game) {
        setGame(res.game)
      }

      if (res.outcome === 'solved') {
        setSolved(true)
        setFeedback({
          text: `🏆 ${res.message}`,
          tone: 'success',
        })
        onToast('恭喜！成功攻克本题！', 'info')
        // 刷新题库通关状态，绝不能重置当前棋盘！
        void refreshCatalog()
      } else if (res.outcome === 'continue') {
        setFeedback({
          text: `⚡ ${res.message}`,
          tone: 'info',
        })
        void refreshCatalog()
      } else {
        setFeedback({
          text: `⚠️ ${res.message}`,
          tone: 'warn',
        })
      }
      return true
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : '走子无效'
      setFeedback({ text: `❌ ${msg}`, tone: 'error' })
      return false
    } finally {
      setThinking(false)
    }
  }

  // 4. 悔棋
  const handleUndo = async () => {
    if (!currentPuzzle) return
    try {
      const res = await api.trainingUndo(currentPuzzle.id)
      setGame(res.game)
      setSolved(false)
      setFeedback({ text: '已撤回上一步，请重新思考。', tone: 'info' })
    } catch (err) {
      onToast(err instanceof ApiError ? err.message : '悔棋失败', 'warn')
    }
  }

  // 5. 重做当前题
  const handleReset = async () => {
    if (!currentPuzzle) return
    try {
      const res = await api.trainingReset(currentPuzzle.id)
      setGame(res.game)
      setSolved(false)
      setFeedback({ text: '已重置盘面，请重新挑战！', tone: 'info' })
    } catch (err) {
      onToast(err instanceof ApiError ? err.message : '重置失败', 'warn')
    }
  }

  // 6. 阶梯获取启发提示
  const handleRequestHint = async () => {
    if (!currentPuzzle) return
    const nextLevel = Math.min(hintLevel + 1, 3)
    try {
      const res: TrainingHintReply = await api.trainingHint(currentPuzzle.id, nextLevel)
      setHintLevel(res.level)
      setHints((prev) => {
        const next = [...prev]
        next[res.level - 1] = res.hint
        return next
      })
      onToast(`已获取第 ${res.level} 阶思考提示`, 'info')
    } catch (err) {
      onToast(err instanceof ApiError ? err.message : '获取提示失败', 'warn')
    }
  }

  // 7. 切换下一题
  const handleNextPuzzle = () => {
    if (!currentPuzzle) return
    const filtered = puzzles.filter((p) => p.category === activeCategory)
    const idx = filtered.findIndex((p) => p.id === currentPuzzle.id)
    if (idx >= 0 && idx + 1 < filtered.length) {
      void loadPuzzle(filtered[idx + 1].id)
    } else if (filtered.length > 0) {
      void loadPuzzle(filtered[0].id)
    }
  }

  // 键盘快捷键监听
  useEffect(() => {
    if (!mounted || leaving) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      } else if (e.key === 'f' || e.key === 'F') {
        const t = e.target as HTMLElement | null
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return
        e.preventDefault()
        setFlipped((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mounted, leaving, onClose])

  if (!mounted) return null

  const categoryPuzzles = puzzles.filter((p) => p.category === activeCategory)

  return (
    <div
      className={`overlay drill-veil${leaving ? ' is-leaving' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label="象棋精训营"
      data-drill=""
      onClick={onClose}
    >
      <div
        className={`sheet drill-desk${leaving ? ' is-leaving' : ''}`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 顶部标题与战报摘要 */}
        <header className="sheet-head drill-head">
          <div className="drill-head-brand">
            <span className="drill-badge">精训营</span>
            <h2>象鱼专项棋力实训</h2>
            {summary && (
              <span className="drill-stats-pill">
                已攻克 {summary.total_solved} 题 · 精通 {summary.mastered} 题 · 首发正解率{' '}
                {summary.first_try_accuracy}%
              </span>
            )}
          </div>
          <div className="drill-head-actions">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setFlipped((v) => !v)}
              title="翻转视角 (F)"
            >
              ⇄ 翻转视角
            </button>
            <button
              type="button"
              className="icon-btn"
              onClick={onClose}
              aria-label="退出精训营"
              title="退出精训营，返回转述对局 (Esc)"
            >
              ✕
            </button>
          </div>
        </header>

        {/* 专题分类导航条 */}
        <nav className="drill-categories-tab" aria-label="题库分类">
          {categories.map((cat) => {
            const count = puzzles.filter((p) => p.category === cat.id).length
            const isCurrent = activeCategory === cat.id
            return (
              <button
                key={cat.id}
                type="button"
                className={`drill-tab-item${isCurrent ? ' is-active' : ''}`}
                onClick={() => {
                  setActiveCategory(cat.id)
                  const firstOfCat = puzzles.find((p) => p.category === cat.id)
                  if (firstOfCat) void loadPuzzle(firstOfCat.id)
                }}
              >
                <span className="drill-tab-icon">{cat.icon}</span>
                <span className="drill-tab-name">{cat.name}</span>
                <span className="drill-tab-count">({count})</span>
              </button>
            )
          })}
        </nav>

        {/* 主体工作区：左棋盘 + 右解题面板 */}
        <div className={`drill-body${loading ? ' is-loading' : ''}`}>
          {/* 左侧棋盘区 */}
          <div className="drill-board-column">
            <div className="board-wrap drill-board-wrap">
              {game ? (
                <Board
                  game={game}
                  flipped={flipped}
                  flipping={false}
                  thinking={thinking}
                  pv={pv}
                  onMove={handleMove}
                />
              ) : (
                <div className="drill-loading-placeholder">加载盘面中…</div>
              )}
            </div>

            {/* 盘底实训快捷控制条 */}
            <div className="drill-ctrl-bar">
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={handleUndo}
                disabled={!game || game.records.length === 0 || thinking}
                title="撤销上一步走法"
              >
                ↩ 悔棋
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={handleReset}
                disabled={!game || thinking}
                title="重新摆盘本题初始局面"
              >
                🔄 重新摆盘
              </button>
              <button
                type="button"
                className={`btn btn-sm ${sandbox ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => setSandbox((v) => !v)}
                title={sandbox ? '正在自由推演中（不计入失误统计）' : '开启分支推演沙盒模式'}
              >
                {sandbox ? '🧪 推演中(免计分)' : '🧪 分支推演'}
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={handleNextPuzzle}
                title="跳到本分类下一道题"
              >
                ⏭ 下一题
              </button>
            </div>
          </div>

          {/* 右侧解题教练与线索面板 */}
          <div className="drill-panel-column">
            {currentPuzzle && (
              <div className="drill-puzzle-card">
                <div className="drill-card-top">
                  <span className="drill-puzzle-tag">{currentPuzzle.target}</span>
                  <span className={`drill-status-chip status-${currentPuzzle.status}`}>
                    {currentPuzzle.status === 'mastered'
                      ? '已精通 ⚡'
                      : currentPuzzle.status === 'solved_with_hints'
                        ? '已通关 ✔'
                        : currentPuzzle.status === 'in_progress'
                          ? '攻坚中'
                          : '未开始'}
                  </span>
                </div>
                <h3 className="drill-puzzle-title">{currentPuzzle.title}</h3>
                <div className="drill-puzzle-meta">
                  <span>难度：{'★'.repeat(currentPuzzle.difficulty)}</span>
                  <span>历史尝试：{currentPuzzle.attempts} 次</span>
                  <span>执子：红先</span>
                </div>
              </div>
            )}

            {/* 教练战报提示区 */}
            <div className={`drill-feedback-box tone-${feedback.tone}`}>
              <div className="drill-feedback-text">{feedback.text}</div>
              {solved && currentPuzzle?.explanation && (
                <div className="drill-explanation-card">
                  <h4>📖 战术精解</h4>
                  <p>{currentPuzzle.explanation}</p>
                </div>
              )}
            </div>

            {/* 阶梯启发提示区 */}
            <div className="drill-hints-card">
              <div className="drill-hints-header">
                <h4>💡 战术启发线索 ({hints.length}/3)</h4>
                <button
                  type="button"
                  className="btn btn-ghost btn-xs"
                  onClick={handleRequestHint}
                  disabled={hintLevel >= 3 || solved}
                >
                  {hintLevel >= 3 ? '已全部揭晓' : `获取第 ${hintLevel + 1} 阶提示`}
                </button>
              </div>
              <div className="drill-hints-list">
                {hints.length === 0 ? (
                  <p className="hint drill-no-hint">
                    先自行观察黑方破绽；若算路遇阻，可随时点击上方按钮获取渐进式提示。
                  </p>
                ) : (
                  hints.map((h, i) => (
                    <div key={i} className="drill-hint-bubble">
                      <span className="drill-hint-badge">阶梯 {i + 1}</span>
                      <span className="drill-hint-content">{h}</span>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* 本专题闯关题目列表 */}
            <div className="drill-puzzles-drawer">
              <div className="drill-drawer-head">
                <h4>本专题题目 ({categoryPuzzles.length})</h4>
              </div>
              <div className="drill-drawer-list">
                {categoryPuzzles.map((pz, idx) => {
                  const isCurrent = currentPuzzle?.id === pz.id
                  return (
                    <button
                      key={pz.id}
                      type="button"
                      className={`drill-drawer-item${isCurrent ? ' is-selected' : ''} status-${
                        pz.status
                      }`}
                      onClick={() => void loadPuzzle(pz.id)}
                    >
                      <span className="drill-item-num">#{idx + 1}</span>
                      <span className="drill-item-title">{pz.title}</span>
                      <span className="drill-item-status">
                        {pz.status === 'mastered'
                          ? '⚡'
                          : pz.status === 'solved_with_hints'
                            ? '✔'
                            : pz.status === 'in_progress'
                              ? '⏳'
                              : '○'}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
