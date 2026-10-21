import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, ApiError } from '../api'
import type {
  AnimatedStep,
  GameSnapshot,
  ProsConsAnalysis,
  PuzzleCategory,
  ThinkingGuide,
  TrainingHintReply,
  TrainingPuzzle,
  TrainingSummary,
} from '../types'
import { Board } from './Board'
import { buildAnimatedFrames } from '../lib/replay'
import { play } from '../lib/sound'
import { useExitPhase } from '../hooks/useExitPhase'
import { useGameContext } from '../context/GameContext'
import { useUIContext } from '../context/UIContext'

export interface DrillDeskProps {
  open?: boolean
  initialPuzzleId?: string | null
  onClose?: () => void
  onToast?: (text: string, tone?: 'info' | 'warn' | 'error') => void
}

type AnimMode = 'none' | 'bad' | 'good' | 'threat'

export function DrillDesk(props?: DrillDeskProps) {
  const g = useGameContext()
  const ui = useUIContext()

  const open = props?.open !== undefined ? props.open : ui.drillOpen
  const initialPuzzleId = props?.initialPuzzleId !== undefined ? props.initialPuzzleId : ui.drillPuzzleId
  const onClose = props?.onClose ?? ui.closeDrill
  const onToast = props?.onToast ?? g.pushToast

  const [mounted, leaving] = useExitPhase(open)

  const [categories, setCategories] = useState<PuzzleCategory[]>([])
  const [puzzles, setPuzzles] = useState<TrainingPuzzle[]>([])
  const [summary, setSummary] = useState<TrainingSummary | null>(null)
  const [activeCategory, setActiveCategory] = useState<string>('kill_tactics')

  const [currentPuzzle, setCurrentPuzzle] = useState<TrainingPuzzle | null>(null)
  const [game, setGame] = useState<GameSnapshot | null>(null)
  const [baseGame, setBaseGame] = useState<GameSnapshot | null>(null)
  const [thinking, setThinking] = useState(false)
  const [solved, setSolved] = useState(false)
  const [stage, setStage] = useState<'demo' | 'drill' | 'exam'>('drill')

  // 分步动画与优劣势对比数据
  const [goodSteps, setGoodSteps] = useState<AnimatedStep[]>([])
  const [badSteps, setBadSteps] = useState<AnimatedStep[]>([])
  const [threatSteps, setThreatSteps] = useState<AnimatedStep[]>([])
  const [prosCons, setProsCons] = useState<ProsConsAnalysis | null>(null)
  const [thinkingGuide, setThinkingGuide] = useState<ThinkingGuide | null>(null)

  // 分步动画播放器状态（'none' 表示用户正在实时下棋；'bad'/'good'/'threat' 表示正在棋盘上播放分步动画）
  const [animMode, setAnimMode] = useState<AnimMode>('none')
  const [animStep, setAnimStep] = useState<number>(0)
  const [animPlaying, setAnimPlaying] = useState<boolean>(false)
  const animTimerRef = useRef<number | null>(null)

  // 反击惩罚态（Rebuttal）
  const [inRebuttal, setInRebuttal] = useState(false)

  const [feedback, setFeedback] = useState<{ text: string; tone: 'info' | 'success' | 'warn' | 'error' }>({
    text: '正在加载训练题…',
    tone: 'info',
  })

  // 视觉提示数据与盘面轨迹
  const [visualClues, setVisualClues] = useState<{
    weakness_squares?: string[]
    key_pieces?: string[]
    route?: string[]
  }>({})
  const [pvTrace, setPvTrace] = useState<string[]>([])

  const [hints, setHints] = useState<string[]>([])
  const [hintLevel, setHintLevel] = useState(0)
  const [sandbox, setSandbox] = useState(false)
  const [loading, setLoading] = useState(false)
  const [flipped, setFlipped] = useState(false)

  const clearAnimTimer = useCallback(() => {
    if (animTimerRef.current !== null) {
      window.clearInterval(animTimerRef.current)
      animTimerRef.current = null
    }
  }, [])

  // 当前选中的动画步骤数组
  const activeSteps: AnimatedStep[] = useMemo(() => {
    if (animMode === 'bad') return badSteps
    if (animMode === 'good') return goodSteps
    if (animMode === 'threat') return threatSteps
    return []
  }, [animMode, badSteps, goodSteps, threatSteps])

  // 根据 baseGame 与 activeSteps 生成逐帧快照（保留棋子 id，确保每一步在棋盘上平滑滑行 + 撞飞吃子）
  const animFrames: GameSnapshot[] = useMemo(() => {
    const startSnap = baseGame || game
    if (!startSnap || activeSteps.length === 0) return []
    return buildAnimatedFrames(startSnap, activeSteps)
  }, [baseGame, game, activeSteps])

  // 启动某个分步动画模式并自动逐帧播放
  const startAnimation = useCallback(
    (mode: 'bad' | 'good' | 'threat', stepsOverride?: AnimatedStep[], baseSnapOverride?: GameSnapshot) => {
      clearAnimTimer()
      if (baseSnapOverride) {
        setBaseGame(baseSnapOverride)
      }
      const list =
        stepsOverride ??
        (mode === 'bad' ? badSteps : mode === 'good' ? goodSteps : threatSteps)

      if (!list || list.length === 0) {
        onToast('当前局面暂无该路线的多步演示', 'info')
        return
      }

      setAnimMode(mode)
      setAnimStep(0)
      setAnimPlaying(true)
    },
    [badSteps, goodSteps, threatSteps, clearAnimTimer, onToast],
  )

  const stopAnimationToPlay = useCallback(() => {
    clearAnimTimer()
    setAnimPlaying(false)
    setAnimMode('none')
    setAnimStep(0)
    setPvTrace([])
  }, [clearAnimTimer])

  // 自动连播定时器：从第 0 帧（走前）平滑推进到最后一帧
  useEffect(() => {
    clearAnimTimer()
    if (!animPlaying || animMode === 'none' || activeSteps.length === 0) return

    const maxStep = activeSteps.length
    animTimerRef.current = window.setInterval(() => {
      setAnimStep((prev) => {
        if (prev < maxStep) {
          const next = prev + 1
          const stepInfo = activeSteps[next - 1]
          if (stepInfo?.captured) {
            play('capture')
          } else {
            play('move')
          }
          return next
        } else {
          clearAnimTimer()
          setAnimPlaying(false)
          return prev
        }
      })
    }, 1350)

    return clearAnimTimer
  }, [animPlaying, animMode, activeSteps, clearAnimTimer])

  // 当动画帧变化时，同步更新棋盘上的箭头和薄弱格高亮，以及顶部大白话解说
  useEffect(() => {
    if (animMode === 'none' || activeSteps.length === 0) return
    if (animStep === 0) {
      const first = activeSteps[0]
      setPvTrace(first ? [first.iccs || first.move] : [])
      const modeTitle =
        animMode === 'bad'
          ? '【走错后果动画 · 起点】先看走错前的初始棋盘，准备观察走错后 3~4 步怎么一步步吃亏…'
          : animMode === 'good'
            ? '【最佳走法动画 · 起点】先看初始棋盘，准备观察走对正着后如何步步抢占优势…'
            : '【对手企图动画 · 起点】假设这步我们不设防，看看对手接下来 2~3 步想怎么进攻我们…'
      setFeedback({
        text: modeTitle,
        tone: animMode === 'bad' ? 'error' : animMode === 'good' ? 'success' : 'warn',
      })
      return
    }

    const cur = activeSteps[animStep - 1]
    if (!cur) return
    const moveIccs = cur.iccs || cur.move
    setPvTrace(moveIccs ? [moveIccs] : [])
    if (cur.threat_squares && cur.threat_squares.length > 0) {
      setVisualClues((prev) => ({
        ...prev,
        weakness_squares: cur.threat_squares,
      }))
    }
    setFeedback({
      text: `${cur.tag || `第 ${cur.step} 步`}：${cur.chinese} —— ${cur.plain || cur.comment}`,
      tone: animMode === 'bad' ? 'error' : animMode === 'good' ? 'success' : 'warn',
    })
  }, [animMode, animStep, activeSteps])

  // 1. 加载单道训练题
  const loadPuzzle = async (puzzleId: string, initialStage: 'demo' | 'drill' | 'exam' = 'drill') => {
    clearAnimTimer()
    setLoading(true)
    setHints([])
    setHintLevel(0)
    setSolved(false)
    setPvTrace([])
    setInRebuttal(false)
    setVisualClues({})
    setStage(initialStage)
    setAnimMode('none')
    setAnimStep(0)
    setAnimPlaying(false)

    try {
      const res = await api.trainingStart(puzzleId, initialStage)
      setCurrentPuzzle(res.puzzle)
      setGame(res.game)
      setBaseGame(res.base_game || res.game)
      setSolved(res.solved)
      setSandbox(res.sandbox)
      setStage(initialStage)
      setFlipped(res.puzzle.side === 'black')

      const gSteps = res.good_steps || []
      const bSteps = res.default_bad_steps || []
      const tSteps = res.opponent_threat_steps || []
      setGoodSteps(gSteps)
      setBadSteps(bSteps)
      setThreatSteps(tSteps)
      setProsCons(res.pros_cons || null)
      setThinkingGuide(res.thinking_guide || res.puzzle.thinking_guide || null)

      const sideLabel = res.puzzle.side === 'black' ? '黑方' : '红方'
      if (initialStage === 'demo') {
        if (gSteps.length > 0) {
          startAnimation('good', gSteps, res.base_game || res.game)
        } else {
          setFeedback({
            text: `【正着动画演示】${res.puzzle.title}。点击下方步骤可逐步查看怎么赢。`,
            tone: 'info',
          })
        }
      } else if (initialStage === 'exam') {
        setFeedback({
          text: `【无提示实战检验】当前你执${sideLabel}先行。提示已关闭，请直接走出最佳走法！`,
          tone: 'warn',
        })
      } else {
        const sub = res.puzzle.plain_subtitle || res.puzzle.master_quote || res.puzzle.target
        setFeedback({
          text: `【当前任务：你执${sideLabel}先行】${sub}（如果看不懂局势，可随时点下方「👁️ 看对手想干嘛」或「🧠 算路三问」）`,
          tone: 'info',
        })
      }
    } catch (err) {
      onToast(err instanceof ApiError ? err.message : '加载训练题失败', 'error')
    } finally {
      setLoading(false)
    }
  }

  // 2. 静默刷新题库状态
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
      // 静默失败
    }
  }, [currentPuzzle])

  // 3. 打开精训营时初始化
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
            void loadPuzzle(found.id, 'drill')
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
      clearAnimTimer()
    }
  }, [open, initialPuzzleId, onToast, clearAnimTimer])

  // 4. 落子实训走法（走错时直接在棋盘上分步动画演示 3~4 步连锁后果，绝不遮挡棋盘！）
  const handleMove = async (iccs: string): Promise<boolean> => {
    if (!currentPuzzle || solved || thinking) return false
    if (animMode !== 'none') {
      stopAnimationToPlay()
    }
    setThinking(true)
    try {
      const res = await api.trainingStep(currentPuzzle.id, iccs, sandbox)
      if (res.game) {
        setGame(res.game)
      }
      if (res.base_game) {
        setBaseGame(res.base_game)
      }

      if (res.outcome === 'solved') {
        setSolved(true)
        setInRebuttal(false)
        play('win')
        setFeedback({
          text: res.message,
          tone: 'success',
        })
        onToast(stage === 'exam' ? '实战检验通关！已标记为【精通】！' : '走对了！成功拿下此题！', 'info')
        void refreshCatalog()
      } else if (res.outcome === 'bad_move' && res.rebuttal) {
        setInRebuttal(true)
        const bSteps = res.bad_steps || res.punish_detail?.bad_steps || []
        const gSteps = res.good_steps || res.punish_detail?.good_steps || goodSteps
        const pc = res.pros_cons || res.punish_detail?.pros_cons || prosCons
        const tg = res.thinking_guide || res.punish_detail?.thinking_guide || thinkingGuide

        if (bSteps.length > 0) setBadSteps(bSteps)
        if (gSteps.length > 0) setGoodSteps(gSteps)
        if (pc) setProsCons(pc)
        if (tg) setThinkingGuide(tg)

        setFeedback({
          text: res.message,
          tone: 'error',
        })

        // 自动在棋盘上播放「❌ 走错怎么亏（3~4步连锁反应动画）」，让用户亲眼看到为什么这步棋几步后会吃大亏
        if (bSteps.length > 0 && res.base_game) {
          setBaseGame(res.base_game)
          setAnimMode('bad')
          setAnimStep(1) // 从第1步（用户刚走的错着）开始往后连播第2、3、4步后果
          setAnimPlaying(true)
        }
        onToast('这步棋会吃亏！棋盘正在为你分步演示接下来几步的连锁后果', 'warn')
      } else if (res.outcome === 'continue') {
        setInRebuttal(false)
        setBaseGame(res.game)
        setFeedback({
          text: res.message,
          tone: 'info',
        })
        void refreshCatalog()
      } else {
        setFeedback({
          text: res.message,
          tone: 'warn',
        })
      }
      return true
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : '走子无效'
      setFeedback({ text: `【走法提示】${msg}`, tone: 'error' })
      return false
    } finally {
      setThinking(false)
    }
  }

  // 5. 退回重走：撤销上一步并退出反击/动画态
  const handleUndo = async () => {
    if (!currentPuzzle) return
    clearAnimTimer()
    setAnimPlaying(false)
    setAnimMode('none')
    setAnimStep(0)
    try {
      const res = await api.trainingUndo(currentPuzzle.id)
      setGame(res.game)
      setBaseGame(res.game)
      setSolved(false)
      setInRebuttal(false)
      setPvTrace([])
      setFeedback({
        text: '已退回走错之前的位置！你可以先点「✅ 看走对怎么赢」或直接重新落子。',
        tone: 'info',
      })
    } catch (err) {
      onToast(err instanceof ApiError ? err.message : '悔棋失败', 'warn')
    }
  }

  // 6. 重置盘面或切换阶段
  const handleReset = async (newStage?: 'demo' | 'drill' | 'exam') => {
    clearAnimTimer()
    if (!currentPuzzle) return
    const targetStage = newStage || stage
    try {
      const res = await api.trainingReset(currentPuzzle.id, targetStage)
      setGame(res.game)
      setBaseGame(res.game)
      setSolved(false)
      setInRebuttal(false)
      setStage(targetStage)
      setAnimMode('none')
      setAnimStep(0)
      setAnimPlaying(false)
      setVisualClues({})
      setPvTrace([])
      setHints([])
      setHintLevel(0)

      const sideLabel = currentPuzzle.side === 'black' ? '黑方' : '红方'
      if (targetStage === 'demo') {
        startAnimation('good', goodSteps, res.game)
      } else if (targetStage === 'exam') {
        setFeedback({
          text: `【无提示实战检验】当前你执${sideLabel}先行。不看提示一次走对即可点亮「已掌握」！`,
          tone: 'warn',
        })
      } else {
        setFeedback({
          text: `棋盘已重置（你执${sideLabel}先行）。你可以直接走棋，或点击下方按钮观看优劣势分步动画！`,
          tone: 'info',
        })
      }
    } catch (err) {
      onToast(err instanceof ApiError ? err.message : '重置失败', 'warn')
    }
  }

  // 7. 分步提示获取（1阶看对方破绽 -> 2阶看我方主力 -> 3阶看最佳路线）
  const handleRequestHint = async () => {
    if (!currentPuzzle) return
    if (stage === 'exam') {
      onToast('实战检验模式不提供提示，切换到「自己动手试走」即可使用提示！', 'warn')
      return
    }
    const nextLevel = Math.min(hintLevel + 1, 3)
    try {
      const res: TrainingHintReply = await api.trainingHint(currentPuzzle.id, nextLevel)
      setHintLevel(res.level)
      setHints((prev) => {
        const next = [...prev]
        next[res.level - 1] = res.hint
        return next
      })

      if (res.visual_data) {
        setVisualClues((prev) => ({
          ...prev,
          ...res.visual_data,
        }))
        if (res.visual_data.route && res.visual_data.route.length >= 2) {
          const r = res.visual_data.route
          const lines: string[] = []
          for (let i = 0; i < r.length - 1; i += 2) {
            lines.push(`${r[i]}${r[i + 1]}`)
          }
          setPvTrace(lines)
        }
      }

      const levelNames = ['第1步提示（看破绽位置）', '第2步提示（看该动哪颗子）', '第3步提示（看完整走法路线）']
      onToast(`已开启${levelNames[res.level - 1] || '提示'}`, 'info')
    } catch (err) {
      onToast(err instanceof ApiError ? err.message : '获取提示失败', 'warn')
    }
  }

  // 8. 切换下一题
  const handleNextPuzzle = () => {
    if (!currentPuzzle) return
    const filtered = puzzles.filter((p) => p.category === activeCategory)
    const idx = filtered.findIndex((p) => p.id === currentPuzzle.id)
    if (idx >= 0 && idx + 1 < filtered.length) {
      void loadPuzzle(filtered[idx + 1].id, 'drill')
    } else if (filtered.length > 0) {
      void loadPuzzle(filtered[0].id, 'drill')
    }
  }

  // 9. 今日推荐练习直达
  const handleGoTodayTask = () => {
    const unmastered = puzzles.find((p) => p.status !== 'mastered')
    if (unmastered) {
      setActiveCategory(unmastered.category)
      void loadPuzzle(unmastered.id, 'drill')
      onToast(`已打开推荐练习：${unmastered.title}`, 'info')
    } else if (puzzles.length > 0) {
      void loadPuzzle(puzzles[0].id, 'drill')
    }
  }

  // 键盘快捷键监听
  useEffect(() => {
    if (!mounted || leaving) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        clearAnimTimer()
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
  }, [mounted, leaving, onClose, clearAnimTimer])

  if (!mounted) return null

  const categoryPuzzles = puzzles.filter((p) => p.category === activeCategory)
  const displayGame =
    animMode !== 'none' && animFrames.length > 0
      ? animFrames[Math.min(animStep, animFrames.length - 1)]
      : game

  const userSideLabel = currentPuzzle?.side === 'black' ? '黑方先行（你执黑）' : '红方先行（你执红）'

  return (
    <div
      className={`overlay drill-veil${leaving ? ' is-leaving' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label="象棋实战闯关与优劣势动画实验室"
      data-drill=""
      onClick={onClose}
    >
      <div
        className={`sheet drill-desk${leaving ? ' is-leaving' : ''}`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 顶部标题栏：直白清晰 */}
        <header className="sheet-head drill-head">
          <div className="drill-head-brand">
            <span className="drill-badge">实战训练营</span>
            <h2>象棋优劣势推演 · 算路实验室</h2>
            {summary && (
              <span className="drill-stats-pill">
                已掌握 {summary.mastered} 题 · 一次走对率 {summary.first_try_accuracy}%
              </span>
            )}
          </div>
          <div className="drill-head-actions">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setFlipped((v) => !v)}
              title="翻转棋盘视角 (F)"
            >
              ⇄ 翻转棋盘
            </button>
            <button
              type="button"
              className="icon-btn"
              onClick={onClose}
              aria-label="退出训练营"
              title="返回下棋界面 (Esc)"
            >
              ✕
            </button>
          </div>
        </header>

        {/* 顶部薄弱项提示条 */}
        {summary?.diagnosis && (
          <aside className="drill-master-diagnosis" aria-label="练棋建议">
            <span className="drill-diagnosis-icon">💡 练棋建议</span>
            <span className="drill-diagnosis-text">{summary.diagnosis}</span>
            <button
              type="button"
              className="btn btn-primary btn-xs drill-task-btn"
              onClick={handleGoTodayTask}
            >
              开始推荐练习
            </button>
          </aside>
        )}

        {/* 四大专题分类导航条 */}
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
                  if (firstOfCat) void loadPuzzle(firstOfCat.id, 'drill')
                }}
              >
                <span className="drill-tab-icon">{cat.icon}</span>
                <span className="drill-tab-name">{cat.name}</span>
                <span className="drill-tab-count">({count})</span>
              </button>
            )
          })}
        </nav>

        {/* 主体工作区：左棋盘 + 右侧通俗解说与动画推演面板 */}
        <div className={`drill-body${loading ? ' is-loading' : ''}`}>
          {/* 左侧棋盘列 */}
          <div className="drill-board-column">
            {/* 三种学习模式切换 */}
            <div className="drill-stages-bar">
              <button
                type="button"
                className={`drill-stage-btn${stage === 'demo' || animMode === 'good' ? ' is-active' : ''}`}
                onClick={() => startAnimation('good')}
              >
                ① 看正确走法动画
              </button>
              <button
                type="button"
                className={`drill-stage-btn${stage === 'drill' && animMode === 'none' ? ' is-active' : ''}`}
                onClick={() => {
                  if (animMode !== 'none') {
                    stopAnimationToPlay()
                  } else {
                    void handleReset('drill')
                  }
                }}
              >
                ② 自己动手试走
              </button>
              <button
                type="button"
                className={`drill-stage-btn${stage === 'exam' ? ' is-active' : ''}`}
                onClick={() => void handleReset('exam')}
              >
                ③ 无提示实战检验
              </button>
            </div>

            {/* 棋盘：绝不用黑幕遮挡，所有走错/走对/对手威胁全部直接在棋盘上分步滑行演示 */}
            <div className="board-wrap drill-board-wrap">
              {displayGame ? (
                <Board
                  game={displayGame}
                  flipped={flipped}
                  flipping={false}
                  thinking={thinking}
                  pv={pvTrace}
                  visualClues={visualClues}
                  readOnly={animMode !== 'none'}
                  onMove={handleMove}
                />
              ) : (
                <div className="drill-loading-placeholder">正在摆好棋盘…</div>
              )}
            </div>

            {/* 棋盘正下方：一键切换「走错怎么亏 / 走对怎么赢 / 对手想干嘛」分步动画遥控器 */}
            <div className="drill-anim-quickbar" aria-label="分步动画推演器">
              <button
                type="button"
                className={`btn btn-xs drill-anim-tab is-bad${animMode === 'bad' ? ' is-active' : ''}`}
                onClick={() => startAnimation('bad')}
                disabled={badSteps.length === 0}
                title="在棋盘上一步步动画演示：走错这步棋后，接下来 3~4 步为什么会吃大亏"
              >
                ❌ 走错怎么亏 ({badSteps.length}步动画)
              </button>
              <button
                type="button"
                className={`btn btn-xs drill-anim-tab is-good${animMode === 'good' ? ' is-active' : ''}`}
                onClick={() => startAnimation('good')}
                disabled={goodSteps.length === 0}
                title="在棋盘上一步步动画演示：走对最佳正着后，接下来怎么步步占优或绝杀"
              >
                ✅ 走对怎么赢 ({goodSteps.length}步动画)
              </button>
              <button
                type="button"
                className={`btn btn-xs drill-anim-tab is-threat${animMode === 'threat' ? ' is-active' : ''}`}
                onClick={() => startAnimation('threat')}
                disabled={threatSteps.length === 0}
                title="看不懂对手想干嘛？在棋盘上动画演示：如果我们不设防，对手接下来 2~3 步怎么杀我们"
              >
                👁️ 对手想干嘛 ({threatSteps.length}步动画)
              </button>
              {animMode !== 'none' && (
                <button
                  type="button"
                  className="btn btn-xs btn-ghost"
                  onClick={stopAnimationToPlay}
                >
                  ✋ 退出动画自己走
                </button>
              )}
            </div>

            {/* 盘底常用操作条 */}
            <div className="drill-ctrl-bar">
              <button
                type="button"
                className={`btn btn-sm ${inRebuttal ? 'btn-primary' : 'btn-ghost'}`}
                onClick={handleUndo}
                disabled={!game || (game.records.length === 0 && !inRebuttal) || thinking}
                title="退回到走错之前的那一步重新走"
              >
                ↩ {inRebuttal ? '退回重走' : '悔棋一步'}
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => void handleReset()}
                disabled={!game || thinking}
                title="恢复到本题最开始的棋盘状态"
              >
                🔄 重新开始本题
              </button>
              <button
                type="button"
                className={`btn btn-sm ${sandbox ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => setSandbox((v) => !v)}
                title="开启自由试走模式后，随便试走任何分支都不计入失误次数"
              >
                {sandbox ? '🧪 自由试走中(不记错)' : '🧪 自由试走'}
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={handleNextPuzzle}
                title="切换到下一道题"
              >
                ⏭ 下一题
              </button>
            </div>
          </div>

          {/* 右侧通俗解说、分步动画剧场、优劣势对比与逆向算路面板 */}
          <div className="drill-panel-column">
            {/* 1. 题目信息卡（修正红先/黑先显示，配大白话副标题） */}
            {currentPuzzle && (
              <div className="drill-puzzle-card">
                <div className="drill-card-top">
                  <span className="drill-puzzle-tag">
                    {currentPuzzle.plain_motif_label || currentPuzzle.target}
                  </span>
                  <span className={`drill-status-chip status-${currentPuzzle.status}`}>
                    {currentPuzzle.status === 'mastered'
                      ? '★ 已掌握'
                      : currentPuzzle.status === 'solved_with_hints'
                        ? '✓ 已通关(用过提示)'
                        : currentPuzzle.status === 'in_progress'
                          ? '练习中'
                          : '待挑战'}
                  </span>
                </div>
                <h3 className="drill-puzzle-title">{currentPuzzle.title}</h3>
                {currentPuzzle.plain_subtitle && (
                  <p className="drill-puzzle-subtitle">{currentPuzzle.plain_subtitle}</p>
                )}
                <div className="drill-puzzle-meta">
                  <span>难度：{'★'.repeat(currentPuzzle.difficulty)}</span>
                  <span className="drill-side-indicator">{userSideLabel}</span>
                  <span>已试：{currentPuzzle.attempts} 次</span>
                </div>
              </div>
            )}

            {/* 2. 实时大白话解说横幅 */}
            <div className={`drill-feedback-box tone-${feedback.tone}`}>
              <div className="drill-feedback-text">{feedback.text}</div>
              {inRebuttal && (
                <div className="drill-rebuttal-inline-actions">
                  <button
                    type="button"
                    className="btn btn-primary btn-xs"
                    onClick={handleUndo}
                  >
                    ↩ 看懂了，退回重走这步
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-xs"
                    onClick={() => startAnimation('bad')}
                  >
                    ▶ 重播走错 {badSteps.length} 步动画
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-xs"
                    onClick={() => startAnimation('good')}
                  >
                    ✅ 看走对应该怎么赢
                  </button>
                </div>
              )}
              {solved && currentPuzzle?.explanation && (
                <div className="drill-explanation-card">
                  <h4>🎉 通关总结：为什么这步是好棋？</h4>
                  <p>{currentPuzzle.explanation}</p>
                </div>
              )}
            </div>

            {/* 3. 🎬 分步动画推演剧场（当处于动画模式或刚走错时展示每一步的连锁反应卡片） */}
            {(animMode !== 'none' || inRebuttal) && activeSteps.length > 0 && (
              <div className={`drill-theater-card mode-${animMode}`} aria-label="分步动画时间轴">
                <div className="drill-theater-head">
                  <div className="drill-theater-title">
                    {animMode === 'bad'
                      ? '🎬 走错会怎样（多步连锁亏损动画）'
                      : animMode === 'good'
                        ? '🎬 走对会怎样（最佳正着分步动画）'
                        : '🎬 对手想干嘛（不设防时对手杀招动画）'}
                  </div>
                  <div className="drill-theater-controls">
                    <button
                      type="button"
                      className="btn btn-ghost btn-xs"
                      onClick={() => {
                        clearAnimTimer()
                        setAnimPlaying(false)
                        setAnimStep(0)
                      }}
                      disabled={animStep === 0}
                      title="回到走棋前的初始局面"
                    >
                      ⏮ 走前
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-xs"
                      onClick={() => {
                        clearAnimTimer()
                        setAnimPlaying(false)
                        setAnimStep((s) => Math.max(0, s - 1))
                      }}
                      disabled={animStep <= 0}
                    >
                      ◀ 上一步
                    </button>
                    <button
                      type="button"
                      className="btn btn-primary btn-xs"
                      onClick={() => {
                        if (animPlaying) {
                          clearAnimTimer()
                          setAnimPlaying(false)
                        } else {
                          if (animStep >= activeSteps.length) setAnimStep(0)
                          setAnimPlaying(true)
                        }
                      }}
                    >
                      {animPlaying ? '⏸ 暂停' : '▶ 自动连播'}
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-xs"
                      onClick={() => {
                        clearAnimTimer()
                        setAnimPlaying(false)
                        setAnimStep((s) => Math.min(activeSteps.length, s + 1))
                      }}
                      disabled={animStep >= activeSteps.length}
                    >
                      下一步 ▶
                    </button>
                  </div>
                </div>

                {/* 分步卡片列表：点击任意一步棋盘立即滑行到该步 */}
                <div className="drill-theater-steps">
                  {activeSteps.map((st, idx) => {
                    const stepIndex = idx + 1
                    const isCurrent = animStep === stepIndex
                    const isPassed = animStep > stepIndex
                    return (
                      <button
                        key={st.step}
                        type="button"
                        className={`drill-step-item${isCurrent ? ' is-current' : ''}${isPassed ? ' is-passed' : ''}`}
                        onClick={() => {
                          clearAnimTimer()
                          setAnimPlaying(false)
                          setAnimStep(stepIndex)
                        }}
                      >
                        <div className="drill-step-top">
                          <span className="drill-step-badge">{st.tag || `第 ${st.step} 步`}</span>
                          <span className="drill-step-move">{st.chinese}</span>
                        </div>
                        <div className="drill-step-plain">{st.plain || st.comment}</div>
                        {((st.gains && st.gains.length > 0) || (st.losses && st.losses.length > 0)) && (
                          <div className="drill-step-tags">
                            {st.gains?.map((g, gi) => (
                              <span key={`g-${gi}`} className="step-pill is-gain">
                                + {g}
                              </span>
                            ))}
                            {st.losses?.map((l, li) => (
                              <span key={`l-${li}`} className="step-pill is-loss">
                                - {l}
                              </span>
                            ))}
                          </div>
                        )}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {/* 4. 📊 优劣势直观对比卡：走错失去什么 vs 走对赢得什么 */}
            {prosCons && (
              <div className="drill-pros-cons-card" aria-label="优劣势直观对比">
                <div className="pros-cons-header">
                  <h4>📊 走错失去什么 vs 走对赢得什么</h4>
                  {prosCons.pawn_drop > 0 && (
                    <span className="pros-cons-drop-badge">
                      走错亏约 {prosCons.pawn_drop} 个兵
                    </span>
                  )}
                </div>
                <p className="pros-cons-headline">{prosCons.verdict_headline}</p>

                <div className="pros-cons-grid">
                  {/* 左列：走错会失去什么 */}
                  <div className="pros-cons-col is-bad">
                    <div className="pros-cons-col-head">
                      <span className="col-title">
                        ❌ 走错{prosCons.wrong_chinese ? `「${prosCons.wrong_chinese}」` : ''}的劣势
                      </span>
                      {badSteps.length > 0 && (
                        <button
                          type="button"
                          className="btn btn-ghost btn-xs"
                          onClick={() => startAnimation('bad')}
                        >
                          ▶ 看动画({badSteps.length}步)
                        </button>
                      )}
                    </div>
                    <ul className="pros-cons-list">
                      {prosCons.wrong_losses.map((item, i) => (
                        <li key={i}>{item}</li>
                      ))}
                    </ul>
                  </div>

                  {/* 右列：走对能赢得什么 */}
                  <div className="pros-cons-col is-good">
                    <div className="pros-cons-col-head">
                      <span className="col-title">
                        ✅ 走对{prosCons.best_chinese ? `「${prosCons.best_chinese}」` : ''}的优势
                      </span>
                      {goodSteps.length > 0 && (
                        <button
                          type="button"
                          className="btn btn-ghost btn-xs"
                          onClick={() => startAnimation('good')}
                        >
                          ▶ 看动画({goodSteps.length}步)
                        </button>
                      )}
                    </div>
                    <ul className="pros-cons-list">
                      {prosCons.best_gains.map((item, i) => (
                        <li key={i}>{item}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            )}

            {/* 5. 🧠 走棋脑子想不明白？第一性原理 · 逆向思维 · 对抗式三问算路助手 */}
            {thinkingGuide && (
              <div className="drill-thinking-card" aria-label="第一性原理与逆向思维算路助手">
                <div className="thinking-card-head">
                  <h4>🧠 脑子想不明白接下来的走向？用这 3 步算路法</h4>
                  {threatSteps.length > 0 && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-xs"
                      onClick={() => startAnimation('threat')}
                    >
                      👁️ 动画看对手企图
                    </button>
                  )}
                </div>

                <div className="thinking-section">
                  <div className="thinking-badge is-fp">① 第一性原理（只抓盘面 3 件本质，不瞎算）</div>
                  <ul className="thinking-fp-list">
                    {thinkingGuide.first_principles.map((fp, idx) => (
                      <li key={idx}>{fp}</li>
                    ))}
                  </ul>
                </div>

                <div className="thinking-section">
                  <div className="thinking-badge is-inv">② 逆向思维（从 3 步后的结果倒推现在第 1 步）</div>
                  <p className="thinking-inv-text">{thinkingGuide.inversion_tip}</p>
                </div>

                <div className="thinking-section">
                  <div className="thinking-badge is-adv">③ 对抗式提问（落子前站到对手角度问自己 3 句话）</div>
                  <div className="thinking-qa-list">
                    {thinkingGuide.adversarial_qa.map((item, idx) => (
                      <div
                        key={idx}
                        className="thinking-qa-item"
                        onClick={() => {
                          if (item.focus) {
                            setVisualClues((prev) => ({
                              ...prev,
                              weakness_squares: [item.focus!],
                            }))
                          }
                        }}
                      >
                        <div className="qa-question">{item.q}</div>
                        <div className="qa-answer">👉 {item.a}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* 6. 💡 分步提示区（大白话 3 步提示） */}
            <div className="drill-hints-card">
              <div className="drill-hints-header">
                <h4>💡 实在想不出？看分步提示 ({hints.length}/3)</h4>
                <button
                  type="button"
                  className="btn btn-ghost btn-xs"
                  onClick={handleRequestHint}
                  disabled={hintLevel >= 3 || solved || stage === 'exam'}
                >
                  {stage === 'exam'
                    ? '实战检验中已关闭提示'
                    : hintLevel >= 3
                      ? '已显示全部 3 步提示'
                      : `点我看第 ${hintLevel + 1} 步提示`}
                </button>
              </div>
              <div className="drill-hints-list">
                {stage === 'exam' ? (
                  <p className="hint drill-no-hint" style={{ color: 'var(--cinnabar)' }}>
                    当前为无提示实战检验模式，不开启提示一次走对即可标记为「★ 已掌握」。
                  </p>
                ) : hints.length === 0 ? (
                  <p className="hint drill-no-hint">
                    点击右上角按钮可依次查看：① 对手破绽在哪一格 → ② 我方该动哪颗主力子 → ③ 具体走哪一步。
                  </p>
                ) : (
                  hints.map((h, i) => (
                    <div key={i} className="drill-hint-bubble">
                      <span className="drill-hint-badge">
                        {i === 0 ? '提示① 看破绽' : i === 1 ? '提示② 选主力' : '提示③ 走正着'}
                      </span>
                      <span className="drill-hint-content">{h}</span>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* 7. 本专题题目列表 */}
            <div className="drill-puzzles-drawer">
              <div className="drill-drawer-head">
                <h4>本类训练题列表 ({categoryPuzzles.length})</h4>
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
                      onClick={() => void loadPuzzle(pz.id, 'drill')}
                    >
                      <span className="drill-item-num">#{idx + 1}</span>
                      <span className="drill-item-title">{pz.title}</span>
                      <span className="drill-item-status">
                        {pz.status === 'mastered'
                          ? '★'
                          : pz.status === 'solved_with_hints'
                            ? '✓'
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
