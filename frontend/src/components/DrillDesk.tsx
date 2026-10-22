import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, ApiError } from '../api'
import type {
  AnimatedStep,
  ChoiceOption,
  GameSnapshot,
  ProsConsAnalysis,
  PuzzleCategory,
  ThinkingGuide,
  TrainingHintReply,
  TrainingPuzzle,
  TrainingSummary,
  XiangqiXRay,
} from '../types'
import { Board } from './Board'
import { buildAnimatedFrames } from '../lib/replay'
import { play } from '../lib/sound'
import { useExitPhase } from '../hooks/useExitPhase'
import { useGameContext } from '../context/GameContext'
import { useUIContext } from '../context/UIContext'
import { DrillHeader } from './drill/DrillHeader'
import { DrillStageBar, DrillActionDock } from './drill/DrillControls'
import { DrillTacticsHUD } from './drill/DrillTacticsHUD'
import { DrillExplanationModal } from './drill/DrillExplanationModal'

export interface DrillDeskProps {
  open?: boolean
  initialPuzzleId?: string | null
  initialGameId?: string | null
  onClose?: () => void
  onToast?: (text: string, tone?: 'info' | 'warn' | 'error') => void
}

type AnimMode = 'none' | 'bad' | 'good' | 'threat'

const MOTIF_LABELS: Record<string, string> = {
  missed_mate: '错失必杀',
  walked_into_mate: '漏防杀棋',
  greedy_capture: '贪吃失先',
  fork_or_skewer: '遭抽将捉双',
  left_hanging: '丢无根子',
  missed_tactics: '漏看妙手',
  king_exposed: '九宫受逼',
  lost_tempo: '缓手失先',
}

const MOTIF_FALLBACK_CATEGORY: Record<string, string> = {
  missed_mate: 'kill_tactics',
  walked_into_mate: 'kill_tactics',
  king_exposed: 'kill_tactics',
  greedy_capture: 'midgame',
  fork_or_skewer: 'midgame',
  left_hanging: 'midgame',
  missed_tactics: 'midgame',
  lost_tempo: 'endgame',
}

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
  const [focusMotif, setFocusMotif] = useState<string | null>(null)
  const [activeGameId, setActiveGameId] = useState<string | null>(props?.initialGameId ?? ui.drillGameId ?? null)
  const [gameBreakdown, setGameBreakdown] = useState<any>(null)

  const [currentPuzzle, setCurrentPuzzle] = useState<TrainingPuzzle | null>(null)
  const [game, setGame] = useState<GameSnapshot | null>(null)
  const [baseGame, setBaseGame] = useState<GameSnapshot | null>(null)
  const [thinking, setThinking] = useState(false)
  const [solved, setSolved] = useState(false)
  const [stage, setStage] = useState<'demo' | 'drill' | 'exam' | 'mirror'>('drill')
  const [activeTab, setActiveTab] = useState<'pros_cons' | 'thinking' | 'breakdown' | 'catalog'>('pros_cons')
  const [choiceMode, setChoiceMode] = useState<boolean>(true)
  const [spotlightActive, setSpotlightActive] = useState<boolean>(false)
  const [xrayActive, setXrayActive] = useState<boolean>(true)
  const [choiceOptions, setChoiceOptions] = useState<ChoiceOption[]>([])
  const [xray, setXray] = useState<XiangqiXRay | null>(null)
  const [hoveredChoice, setHoveredChoice] = useState<ChoiceOption | null>(null)

  // 分步动画与优劣势对比数据
  const [goodSteps, setGoodSteps] = useState<AnimatedStep[]>([])
  const [badSteps, setBadSteps] = useState<AnimatedStep[]>([])
  const [threatSteps, setThreatSteps] = useState<AnimatedStep[]>([])
  const [prosCons, setProsCons] = useState<ProsConsAnalysis | null>(null)
  const [thinkingGuide, setThinkingGuide] = useState<ThinkingGuide | null>(null)

  // 分步动画播放器状态
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

  // 加载特定对局拆解数据
  const loadGameBreakdown = useCallback(async (gid?: string) => {
    try {
      const res = await api.trainingGameBreakdown(gid)
      if (res.ok) {
        setGameBreakdown(res)
        setActiveGameId(res.game_id)
        if (res.puzzles && res.puzzles.length > 0) {
          setPuzzles((prev) => {
            const others = prev.filter((p) => p.category !== 'game_breakdown')
            return [...res.puzzles, ...others]
          })
        }
      }
    } catch {
      // 静默处理
    }
  }, [])

  // 核心战区聚光灯 squares
  const spotlightSquares = useMemo(() => {
    if (!spotlightActive) return null
    const set = new Set<string>()
    if (currentPuzzle?.visual_clues?.key_pieces) {
      currentPuzzle.visual_clues.key_pieces.forEach((s) => set.add(s))
    }
    if (currentPuzzle?.visual_clues?.weakness_squares) {
      currentPuzzle.visual_clues.weakness_squares.forEach((s) => set.add(s))
    }
    if (goodSteps.length > 0 && goodSteps[0].iccs) {
      set.add(goodSteps[0].iccs.slice(0, 2))
      set.add(goodSteps[0].iccs.slice(2, 4))
    }
    return Array.from(set)
  }, [spotlightActive, currentPuzzle, goodSteps])

  // What-If 走前试探残影 (Ghost Move)
  const ghostMove = useMemo(() => {
    if (!hoveredChoice || !hoveredChoice.iccs || hoveredChoice.iccs.length < 4) return null
    const from = hoveredChoice.iccs.slice(0, 2)
    const to = hoveredChoice.iccs.slice(2, 4)
    let counterMove: string | undefined = undefined
    if (hoveredChoice.steps && hoveredChoice.steps.length > 1) {
      counterMove = hoveredChoice.steps[1].iccs
    }
    const pieceSide = currentPuzzle?.side || 'red'
    return {
      from,
      to,
      counterMove,
      pieceGlyph: hoveredChoice.chinese ? hoveredChoice.chinese.slice(0, 1) : '试',
      pieceSide,
    }
  }, [hoveredChoice, currentPuzzle])

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

  // 根据 baseGame 与 activeSteps 生成逐帧快照
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

  // 自动连播定时器
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
      setXray(res.xray || null)
      setChoiceOptions(res.choice_options || [])

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
        const res = await api.trainingPuzzles(undefined, undefined, activeGameId || undefined)
        if (!active) return
        setCategories(res.categories || [])
        setPuzzles(res.puzzles || [])
        setSummary(res.summary || null)

        // 若传入了指定对局或当前处于特定对局拆解
        if (activeGameId) {
          void loadGameBreakdown(activeGameId)
        }

        const targetId = initialPuzzleId || (res.puzzles?.[0]?.id ?? null)
        if (targetId) {
          // 1. 是否精确匹配题目 ID
          const byId = res.puzzles?.find((p) => p.id === targetId)
          if (byId) {
            setActiveCategory(byId.category)
            setFocusMotif(byId.motif || null)
            void loadPuzzle(byId.id, 'drill')
            return
          }

          // 2. 是否匹配分类 ID
          const byCategory = res.puzzles?.find((p) => p.category === targetId)
          if (byCategory) {
            setActiveCategory(targetId)
            setFocusMotif(null)
            void loadPuzzle(byCategory.id, 'drill')
            return
          }

          // 3. 是否匹配病因 motif
          const motifClean = targetId.startsWith('motif:') ? targetId.slice(6) : targetId
          const matchingMotif = (res.puzzles || []).filter((p) => p.motif === motifClean)
          if (matchingMotif.length > 0) {
            setFocusMotif(motifClean)
            const unmastered = matchingMotif.filter((p) => p.status !== 'mastered')
            const chosen =
              unmastered.length > 0
                ? unmastered[Math.floor(Math.random() * unmastered.length)]
                : matchingMotif[Math.floor(Math.random() * matchingMotif.length)]
            setActiveCategory(chosen.category)
            void loadPuzzle(chosen.id, 'drill')
            const label = MOTIF_LABELS[motifClean] || motifClean
            onToast(`🎯 已为你匹配【${label}】专项同类题（共 ${matchingMotif.length} 题）`, 'info')
            return
          }

          // 4. 智能阶梯降级
          const fallbackCat = MOTIF_FALLBACK_CATEGORY[motifClean] || 'kill_tactics'
          const catPuzzles = (res.puzzles || []).filter((p) => p.category === fallbackCat)
          const chosen = catPuzzles.find((p) => p.status !== 'mastered') || catPuzzles[0] || res.puzzles?.[0]
          if (chosen) {
            setFocusMotif(null)
            setActiveCategory(chosen.category)
            void loadPuzzle(chosen.id, 'drill')
            const motifLabel = MOTIF_LABELS[motifClean] || motifClean
            const catName = res.categories?.find((c) => c.id === fallbackCat)?.name || '经典战术'
            onToast(`暂无【${motifLabel}】专属错题，为你推荐相近「${catName}」攻防实训`, 'info')
            return
          }

          // 5. 兜底加载第一题
          if (res.puzzles && res.puzzles[0]) {
            setFocusMotif(null)
            setActiveCategory(res.puzzles[0].category)
            void loadPuzzle(res.puzzles[0].id, 'drill')
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

  // 4. 落子实训走法
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
        if (res.xray) setXray(res.xray)
        play('win')

        if (focusMotif && motifPuzzles.length > 0) {
          const remaining = motifPuzzles.filter((p) => p.id !== currentPuzzle.id && p.status !== 'mastered').length
          if (remaining === 0) {
            setFeedback({
              text: `🎉 恭喜！【${MOTIF_LABELS[focusMotif] || focusMotif}】专项所有同类题已全部攻克！`,
              tone: 'success',
            })
            onToast(`🎉 恭喜！已攻破【${MOTIF_LABELS[focusMotif] || focusMotif}】专项心魔，所有同类题全部通关！`, 'info')
          } else {
            setFeedback({
              text: `正解！本专项还剩 ${remaining} 道同类题待攻坚，点击「下一题」继续挑战！`,
              tone: 'success',
            })
            onToast(stage === 'exam' ? '实战检验通关！' : `走对了！本专项还剩 ${remaining} 道同类题`, 'info')
          }
        } else {
          setFeedback({
            text: res.message,
            tone: 'success',
          })
          onToast(stage === 'exam' ? '实战检验通关！已标记为【精通】！' : '走对了！成功拿下此题！', 'info')
        }
        void refreshCatalog()
      } else if (res.outcome === 'bad_move' && res.rebuttal) {
        setInRebuttal(true)
        const bSteps = res.bad_steps || res.punish_detail?.bad_steps || []
        const gSteps = res.good_steps || res.punish_detail?.good_steps || goodSteps
        const pc = res.pros_cons || res.punish_detail?.pros_cons || prosCons
        const tg = res.thinking_guide || res.punish_detail?.thinking_guide || thinkingGuide
        const xrayData = res.xray || res.punish_detail?.xray
        const optData = res.choice_options || res.punish_detail?.choice_options

        if (bSteps.length > 0) setBadSteps(bSteps)
        if (gSteps.length > 0) setGoodSteps(gSteps)
        if (pc) setProsCons(pc)
        if (tg) setThinkingGuide(tg)
        if (xrayData) setXray(xrayData)
        if (optData) setChoiceOptions(optData)

        setFeedback({
          text: res.message,
          tone: 'error',
        })

        if (bSteps.length > 0 && res.base_game) {
          setBaseGame(res.base_game)
          setAnimMode('bad')
          setAnimStep(1)
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

  // 5. 退回重走
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
  const handleReset = async (newStage?: 'demo' | 'drill' | 'exam' | 'mirror') => {
    clearAnimTimer()
    if (!currentPuzzle) return
    const targetStage = newStage || stage
    try {
      const res = await api.trainingReset(currentPuzzle.id, targetStage)
      if (res.puzzle) setCurrentPuzzle(res.puzzle)
      setGame(res.game)
      setBaseGame(res.base_game || res.game)
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
      if (res.good_steps) setGoodSteps(res.good_steps)
      if (res.default_bad_steps) setBadSteps(res.default_bad_steps)
      if (res.opponent_threat_steps) setThreatSteps(res.opponent_threat_steps)
      if (res.pros_cons) setProsCons(res.pros_cons)
      if (res.thinking_guide) setThinkingGuide(res.thinking_guide)
      if (res.xray) setXray(res.xray)
      if (res.choice_options) setChoiceOptions(res.choice_options)

      const sideLabel = (res.puzzle?.side || currentPuzzle.side) === 'black' ? '黑方' : '红方'
      if (targetStage === 'demo') {
        startAnimation('good', res.good_steps || goodSteps, res.game)
      } else if (targetStage === 'exam') {
        setFeedback({
          text: `【无提示实战检验】当前你执${sideLabel}先行。不看提示一次走对即可点亮「已掌握」！`,
          tone: 'warn',
        })
      } else if (targetStage === 'mirror') {
        setFeedback({
          text: `【左右水平镜像变式】全盘棋子已沿中轴线镜像对称！原理相通，请凭第一性原理走出对称正着！`,
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

  // 6.1 左右水平镜像变式秒测
  const handleMirrorDrill = async () => {
    if (!currentPuzzle) return
    clearAnimTimer()
    setLoading(true)
    try {
      await handleReset('mirror')
      onToast('已开启左右镜像变式检验！', 'info')
    } finally {
      setLoading(false)
    }
  }

  // 7. 分步提示获取
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
    if (focusMotif && motifPuzzles.length > 0) {
      const unmastered = motifPuzzles.filter((p) => p.status !== 'mastered' && p.id !== currentPuzzle.id)
      if (unmastered.length > 0) {
        const nextPz = unmastered[Math.floor(Math.random() * unmastered.length)]
        void loadPuzzle(nextPz.id, 'drill')
        return
      }
      const curIdx = motifPuzzles.findIndex((p) => p.id === currentPuzzle.id)
      const nextIdx = (curIdx + 1) % motifPuzzles.length
      void loadPuzzle(motifPuzzles[nextIdx].id, 'drill')
      return
    }
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

  // 棋盘 HUD 字幕与漫画气泡
  const currentStepInfo = animMode !== 'none' && animStep > 0 ? activeSteps[animStep - 1] : null
  const boardCaption = currentStepInfo
    ? {
        badge: currentStepInfo.tag || (animMode === 'bad' ? '❌ 连锁后果' : animMode === 'good' ? '✅ 正着演示' : '👁️ 敌方企图'),
        text: currentStepInfo.plain || currentStepInfo.comment || '',
        tone: (animMode === 'bad' ? 'bad' : animMode === 'good' ? 'good' : 'threat') as 'bad' | 'good' | 'threat',
      }
    : inRebuttal
    ? {
        badge: '❌ 连锁后果',
        text: feedback.text,
        tone: 'bad' as const,
      }
    : null

  const moveBubble = currentStepInfo?.short_bubble && currentStepInfo.iccs
    ? {
        square: currentStepInfo.iccs.slice(2, 4),
        text: currentStepInfo.short_bubble,
        tone: (animMode === 'bad' ? 'bad' : animMode === 'good' ? 'good' : 'threat') as 'bad' | 'good' | 'threat',
      }
    : null

  const categoryPuzzles = puzzles.filter((p) => p.category === activeCategory)
  const motifPuzzles = useMemo(() => {
    if (!focusMotif) return []
    return puzzles.filter((p) => p.motif === focusMotif)
  }, [focusMotif, puzzles])
  const currentMotifIndex = useMemo(() => {
    if (!focusMotif || !currentPuzzle) return -1
    return motifPuzzles.findIndex((p) => p.id === currentPuzzle.id)
  }, [focusMotif, motifPuzzles, currentPuzzle])
  const masteredInMotifCount = useMemo(() => {
    return motifPuzzles.filter((p) => p.status === 'mastered').length
  }, [motifPuzzles])

  const displayCatalogPuzzles = useMemo(() => {
    if (focusMotif && motifPuzzles.length > 0) return motifPuzzles
    return categoryPuzzles
  }, [focusMotif, motifPuzzles, categoryPuzzles])

  const displayGame =
    animMode !== 'none' && animFrames.length > 0
      ? animFrames[Math.min(animStep, animFrames.length - 1)]
      : game

  const userSideLabel = currentPuzzle?.side === 'black' ? '黑方先行（你执黑）' : '红方先行（你执红）'

  return (
    <div
      className={`fixed inset-0 z-[300] bg-ink-0/65 backdrop-blur-xs flex items-center justify-center p-2 sm:p-4 transition-opacity duration-200 ${
        leaving ? 'opacity-0 pointer-events-none' : 'opacity-100'
      }`}
      role="dialog"
      aria-modal="true"
      aria-label="象棋实战闯关与优劣势动画实验室"
      onClick={onClose}
    >
      <div
        className={`w-[min(1140px,96vw)] h-[min(88vh,840px)] max-h-[calc(100vh-2rem)] flex flex-col overflow-hidden bg-paper-0 rounded-xl shadow-2xl border border-hairline transition-all duration-200 ${
          leaving ? 'scale-95 opacity-0' : 'scale-100 opacity-100'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 顶部标题栏与分类导航 */}
        <DrillHeader
          summary={summary}
          categories={categories}
          puzzles={puzzles}
          activeCategory={activeCategory}
          currentGameId={activeGameId}
          onSelectCategory={(catId) => {
            setFocusMotif(null)
            setActiveCategory(catId)
            if (catId === 'game_breakdown') {
              setActiveTab('breakdown')
              if (!gameBreakdown) {
                void loadGameBreakdown(activeGameId || undefined)
              }
            }
            const firstOfCat = puzzles.find((p) => p.category === catId)
            if (firstOfCat) void loadPuzzle(firstOfCat.id, 'drill')
          }}
          onSelectGame={(gid) => {
            setActiveGameId(gid)
            void loadGameBreakdown(gid)
          }}
          onGoTodayTask={() => {
            setFocusMotif(null)
            handleGoTodayTask()
          }}
          onFlip={() => setFlipped((v) => !v)}
          onClose={onClose}
        />

        {/* 顶部病因专项集训 HUD 状态条 */}
        {focusMotif && (
          <div className="flex items-center justify-between px-3 sm:px-5 py-2 bg-gradient-to-r from-amber-500/15 via-rose-500/10 to-transparent border-b border-amber-300/40 text-xs text-ink-1 shrink-0 animate-fadeIn">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-amber-500/20 text-amber-950 font-semibold border border-amber-400/50">
                🎯 专项强化：#{MOTIF_LABELS[focusMotif] || focusMotif}
              </span>
              <span className="text-ink-2">
                当前第 <b className="text-ink-0 font-bold">{currentMotifIndex >= 0 ? currentMotifIndex + 1 : 1}</b> / {motifPuzzles.length} 题
                {masteredInMotifCount > 0 && (
                  <span className="text-emerald-700 ml-1 font-medium">
                    （已攻破 {masteredInMotifCount} 题）
                  </span>
                )}
              </span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                className="btn btn-ghost btn-xs px-2.5 py-1 text-primary-800 bg-paper-0 border border-primary-300/80 hover:bg-paper-2 rounded font-medium transition cursor-pointer shadow-xs active:scale-95"
                onClick={handleNextPuzzle}
                title="切换到同病因下一道题（优先挑未攻克题目）"
              >
                🎲 换一题 / 下一题
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-xs px-2 py-1 text-ink-3 hover:text-ink-1 hover:bg-paper-2 rounded transition cursor-pointer"
                onClick={() => setFocusMotif(null)}
                title="退出专项训练模式，浏览全部课程分类"
              >
                ✕ 退出专题看全部
              </button>
            </div>
          </div>
        )}

        {/* 主体工作区：左棋盘 + 右侧通俗解说与动画推演面板 */}
        <div className={`flex-1 grid grid-cols-1 lg:grid-cols-[minmax(0,1.22fr)_minmax(340px,1fr)] min-h-0 overflow-hidden ${loading ? 'opacity-60 pointer-events-none' : ''}`}>
          {/* 左侧棋盘列 */}
          <div className="flex flex-col items-center p-3 border-b lg:border-b-0 lg:border-r border-hairline bg-paper-0 min-h-0 overflow-y-auto overflow-x-hidden gap-2">
            <DrillStageBar
              stage={stage}
              animMode={animMode}
              choiceMode={choiceMode}
              spotlightActive={spotlightActive}
              xrayActive={xrayActive}
              solved={solved}
              onStartGoodAnim={() => startAnimation('good')}
              onSwitchToDrill={() => {
                if (animMode !== 'none') {
                  stopAnimationToPlay()
                } else {
                  void handleReset('drill')
                }
              }}
              onReset={(s) => void handleReset(s)}
              onMirrorDrill={handleMirrorDrill}
              onToggleChoiceMode={() => setChoiceMode((v) => !v)}
              onToggleSpotlight={() => setSpotlightActive((v) => !v)}
              onToggleXray={() => setXrayActive((v) => !v)}
            />

            {/* 棋盘包围盒 */}
            <div className="w-full h-[clamp(380px,48vh,480px)] min-h-[380px] flex items-center justify-center relative">
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
                  boardCaption={boardCaption}
                  moveBubble={moveBubble}
                  xrayOverlay={xrayActive ? xray : null}
                  spotlightSquares={spotlightSquares}
                  ghostMove={ghostMove}
                />
              ) : (
                <div className="text-ink-3 text-sm">正在摆好棋盘…</div>
              )}
            </div>

            {/* 棋盘下方动作坞 */}
            <DrillActionDock
              animMode={animMode}
              badStepsCount={badSteps.length}
              threatStepsCount={threatSteps.length}
              inRebuttal={inRebuttal}
              hasGame={!!game}
              hasHistory={!!game && game.records.length > 0}
              thinking={thinking}
              sandbox={sandbox}
              onStartBadAnim={() => startAnimation('bad')}
              onStartThreatAnim={() => startAnimation('threat')}
              onStopAnim={stopAnimationToPlay}
              onUndo={handleUndo}
              onReset={() => void handleReset()}
              onToggleSandbox={() => setSandbox((v) => !v)}
              onNextPuzzle={handleNextPuzzle}
            />
          </div>

          {/* 右侧面板列 */}
          <div className="flex flex-col gap-3 p-4 overflow-y-auto bg-paper-1 min-h-0">
            <DrillTacticsHUD
              currentPuzzle={currentPuzzle}
              feedback={feedback}
              inRebuttal={inRebuttal}
              badStepsCount={badSteps.length}
              solved={solved}
              userSideLabel={userSideLabel}
              choiceMode={choiceMode}
              choiceOptions={choiceOptions}
              animMode={animMode}
              hoveredChoice={hoveredChoice}
              onUndo={handleUndo}
              onStartBadAnim={() => startAnimation('bad')}
              onStartGoodAnim={() => startAnimation('good')}
              onMirrorDrill={handleMirrorDrill}
              onNextPuzzle={handleNextPuzzle}
              onHoverChoice={setHoveredChoice}
              onSelectChoiceRehearse={(opt) => {
                if (opt.steps && opt.steps.length > 0) {
                  startAnimation(opt.is_correct ? 'good' : 'bad', opt.steps)
                }
              }}
              onMakeMove={(iccs) => void handleMove(iccs)}
            />

            <DrillExplanationModal
              activeTab={activeTab}
              onTabChange={setActiveTab}
              animMode={animMode}
              animStep={animStep}
              animPlaying={animPlaying}
              inRebuttal={inRebuttal}
              activeSteps={activeSteps}
              prosCons={prosCons}
              badStepsCount={badSteps.length}
              goodStepsCount={goodSteps.length}
              hints={hints}
              hintLevel={hintLevel}
              solved={solved}
              stage={stage}
              onResetAnimStep={() => {
                clearAnimTimer()
                setAnimPlaying(false)
                setAnimStep(0)
              }}
              onPrevAnimStep={() => {
                clearAnimTimer()
                setAnimPlaying(false)
                setAnimStep((s) => Math.max(0, s - 1))
              }}
              onTogglePlayAnim={() => {
                if (animPlaying) {
                  clearAnimTimer()
                  setAnimPlaying(false)
                } else {
                  if (animStep >= activeSteps.length) setAnimStep(0)
                  setAnimPlaying(true)
                }
              }}
              onNextAnimStep={() => {
                clearAnimTimer()
                setAnimPlaying(false)
                setAnimStep((s) => Math.min(activeSteps.length, s + 1))
              }}
              onSelectAnimStep={(stepIndex) => {
                clearAnimTimer()
                setAnimPlaying(false)
                setAnimStep(stepIndex)
              }}
              onStartBadAnim={() => startAnimation('bad')}
              onStartGoodAnim={() => startAnimation('good')}
              onRequestHint={handleRequestHint}
              thinkingGuide={thinkingGuide}
              threatStepsCount={threatSteps.length}
              onStartThreatAnim={() => startAnimation('threat')}
              onFocusWeakness={(square) => {
                setVisualClues((prev) => ({
                  ...prev,
                  weakness_squares: [square],
                }))
              }}
              gameBreakdown={gameBreakdown}
              categoryPuzzles={displayCatalogPuzzles}
              currentPuzzleId={currentPuzzle?.id}
              onSelectPuzzle={(id) => void loadPuzzle(id, 'drill')}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
