import { useCallback, useEffect, useRef, useState } from 'react'
import { api, ApiError } from '../api'
import type { AppState, SearchTask } from '../types'
import { play } from '../lib/sound'
import { landMs } from '../lib/board'

const POLL_MS = 130
/** 没有搜索在跑时的慢心跳。见文件末尾「空闲心跳」那段。 */
const IDLE_MS = 1000

export interface Toast {
  id: number
  text: string
  tone: 'ok' | 'warn' | 'error' | 'info'
  /** 退场中：先播 spring 收走动画，再从列表里删掉 */
  leaving?: boolean
}

/** 录入一步棋的结果。`queued` 表示引擎还在算，服务端已把这步记下，稍后自动落子。 */
export type SubmitOutcome = 'ok' | 'queued' | 'error'

interface UseGame {
  state: AppState | null
  task: SearchTask | null
  thinking: boolean
  connected: boolean
  booting: boolean
  toasts: Toast[]
  /** 服务端已经记下、等引擎收手就自动落子的那一步 */
  queued: string | null
  dismissToast: (id: number) => void
  pushToast: (text: string, tone?: Toast['tone']) => void
  refresh: () => Promise<void>
  newGame: (engineSide: 'red' | 'black') => Promise<void>
  submitMove: (text: string) => Promise<SubmitOutcome>
  clearQueue: () => Promise<void>
  engineMove: () => Promise<void>
  undoRound: () => Promise<void>
  resign: () => Promise<void>
  stopThinking: () => Promise<void>
  updateSettings: (patch: Partial<AppState['settings']>) => Promise<void>
  loadPosition: (fen: string, engine_side?: 'red' | 'black') => Promise<void>
}

export function useGame(): UseGame {
  const [state, setState] = useState<AppState | null>(null)
  const [connected, setConnected] = useState(true)
  const [booting, setBooting] = useState(true)
  const [toasts, setToasts] = useState<Toast[]>([])

  const toastSeq = useRef(0)
  const lastPly = useRef<number>(-1)
  const lastNotice = useRef<number>(0)
  const pollTimer = useRef<number | null>(null)
  const pollInFlight = useRef(false)

  const pushToast = useCallback((text: string, tone: Toast['tone'] = 'info') => {
    toastSeq.current += 1
    const id = toastSeq.current
    // 最多留 3 条。多了会盖住转述台，那正是最不该被盖住的地方。
    setToasts((prev) => [...prev, { id, text, tone }].slice(-3))
    window.setTimeout(
      () => {
        // 先标记退场，让 CSS 播收走动画，播完才真正从列表里删
        setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, leaving: true } : t)))
        window.setTimeout(() => {
          setToasts((prev) => prev.filter((t) => t.id !== id))
        }, 300)
      },
      tone === 'error' ? 6000 : tone === 'info' ? 2600 : 3600,
    )
  }, [])

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, leaving: true } : t)))
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id))
    }, 300)
  }, [])

  // ---- 声音与播报：局面一变就响一次 ---------------------------------- //

  const voiceFor = useCallback(
    (next: AppState) => {
      const game = next.game
      const ply = game.ply
      if (ply <= lastPly.current) {
        lastPly.current = ply
        return
      }
      // 只有紧挨着的下一步才发音并播报，撤销/载入不要炸出一串
      if (ply === lastPly.current + 1 && lastPly.current >= 0) {
        const rec = game.records[ply - 1]
        if (rec) {
          // 音效跟棋子滑行**同一个时长**（同一份定义，见 lib/board.ts 的 glideMs）——
          // 在「看着落定」的那一刻敲，音画才对得上。这里原来写死 210ms，那是按固定的
          // 240ms 位移配出来的数；位移改成按跨度分级之后远手会滑到 360ms，
          // 死数就会在棋子还在半路上的时候响一声。
          const delay = landMs(rec.from, rec.to) || 210
          window.setTimeout(() => {
            if (rec.mate) play('win')
            else if (rec.check) play('check')
            else if (rec.captured) play('capture')
            else play('move')
          }, delay)
          // 引擎的应手不再另外弹 toast —— 它本来就会显示在转述台②里，
          // 每次出招都在右下角弹一下会让人以为界面在抖。
          // 声音留着：那是「走了一步」的提示，不占视觉。
        }
      }
      lastPly.current = ply
    },
    [],
  )

  const applyState = useCallback(
    (next: AppState) => {
      voiceFor(next)
      // 服务端要说的那句话：只在序号变化时弹一次，避免轮询重复上报
      if (next.notice && next.notice.seq !== lastNotice.current) {
        lastNotice.current = next.notice.seq
        pushToast(next.notice.text, next.notice.tone)
      }
      setState(next)
      setConnected(true)
    },
    [voiceFor, pushToast],
  )

  const handleError = useCallback(
    (err: unknown) => {
      const message = err instanceof ApiError ? err.message : '出了点状况'
      setConnected(err instanceof ApiError ? err.status !== 0 : true)
      pushToast(message, 'error')
    },
    [pushToast],
  )

  // ---- 轮询搜索进度 --------------------------------------------------- //

  const stopPolling = useCallback(() => {
    if (pollTimer.current !== null) {
      window.clearInterval(pollTimer.current)
      pollTimer.current = null
    }
  }, [])

  // 轮询一旦停下，必须保证还能被重新拉起来。光靠 taskId 变化不够：
  // 服务端换任务的那一瞬间（比如排队的那一步落地后立刻开了新的搜索），
  // 我们手上可能还是旧 id，而旧 id 的那次请求会 404。用 epoch 强制重来。
  const [pollEpoch, setPollEpoch] = useState(0)
  // startPolling 的 404 分支要调 refresh，而 refresh 定义在后面。
  // 用 ref 转一手，避免两个 useCallback 互相依赖成环。
  const refreshRef = useRef<() => Promise<void>>(async () => {})

  const startPolling = useCallback(
    (id: string) => {
      stopPolling()
      const tick = async () => {
        if (pollInFlight.current) return
        pollInFlight.current = true
        try {
          const res = await api.task(id)
          applyState(res.state)
          // 引擎出招的播报由局面变化驱动（见 voiceFor），这里只处理出错
          if (!res.stale && res.task.status !== 'running' && pollTimer.current !== null) {
            stopPolling()
            if (res.task.error) pushToast(res.task.error, 'error')
          }
        } catch (err) {
          stopPolling()
          if (err instanceof ApiError && err.status === 404) {
            // 这个任务已经被服务端换掉了。重新对齐一次，别把界面冻在旧状态上。
            setPollEpoch((n) => n + 1)
            void refreshRef.current()
          } else {
            handleError(err)
          }
        } finally {
          pollInFlight.current = false
        }
      }
      pollTimer.current = window.setInterval(tick, POLL_MS)
      void tick()
    },
    [applyState, handleError, pushToast, stopPolling],
  )

  useEffect(() => () => stopPolling(), [stopPolling])

  const taskId = state?.task?.status === 'running' ? state.task.id : null
  useEffect(() => {
    if (taskId) startPolling(taskId)
    else stopPolling()
  }, [taskId, pollEpoch, startPolling, stopPolling])

  // ---- 动作 ----------------------------------------------------------- //

  const refresh = useCallback(async () => {
    try {
      const res = await api.state()
      applyState(res.state)
    } catch (err) {
      handleError(err)
    } finally {
      setBooting(false)
    }
  }, [applyState, handleError])

  // startPolling 需要在 404 分支里调 refresh，而 refresh 定义在它后面。
  // 用 ref 转一手，避免两个 useCallback 互相依赖成环。
  useEffect(() => {
    refreshRef.current = refresh
  }, [refresh])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const run = useCallback(
    async (fn: () => Promise<{ state?: AppState; message?: string } | void>, quiet = false) => {
      try {
        const res = await fn()
        if (res && res.state) applyState(res.state)
        if (res && res.message && !quiet) pushToast(res.message, 'ok')
        return true
      } catch (err) {
        handleError(err)
        return false
      }
    },
    [applyState, handleError, pushToast],
  )

  const newGame = useCallback(
    async (engineSide: 'red' | 'black') => {
      lastPly.current = -1
      await run(() => api.newGame({ engine_side: engineSide }))
    },
    [run],
  )

  const submitMove = useCallback(
    async (text: string): Promise<SubmitOutcome> => {
      const trimmed = text.trim()
      if (!trimmed) return 'error'
      try {
        // 引擎在算棋的时候也直接发：服务端会把这步记下来，等引擎收手自己落子。
        // 前端既不用重试，也不用猜服务端忙不忙 —— 那件事服务端最清楚。
        const res = await api.move(trimmed)
        if (res.state) applyState(res.state)
        // 排队那一步不用弹提示：「① 录入」下面已经挂着排队条了，
        // 再弹一个只是把界面弄吵。
        if (res.message && !res.queued) pushToast(res.message, 'ok')
        return res.queued ? 'queued' : 'ok'
      } catch (err) {
        handleError(err)
        return 'error'
      }
    },
    [applyState, handleError, pushToast],
  )

  const clearQueue = useCallback(async () => {
    await run(() => api.clearPending(), true)
  }, [run])

  const engineMove = useCallback(async () => {
    await run(() => api.engineMove(), true)
  }, [run])

  const undoRound = useCallback(async () => {
    lastPly.current = -1
    await run(() => api.undo(true))
  }, [run])

  const resign = useCallback(async () => {
    await run(() => api.resign())
  }, [run])

  const stopThinking = useCallback(async () => {
    if (!state?.task) return
    try {
      await api.stopTask(state.task.id)
    } catch {
      /* 搜索可能刚好结束了，不必打扰用户 */
    }
  }, [state?.task])

  const updateSettings = useCallback(
    async (patch: Partial<AppState['settings']>) => {
      await run(() => api.settings(patch), true)
    },
    [run],
  )

  const loadPosition = useCallback(
    async (fen: string, engine_side?: 'red' | 'black') => {
      lastPly.current = -1
      await run(() => api.load({ fen, engine_side }))
    },
    [run],
  )

  /** 安静地重新对齐一次，失败也不出声。 */
  const refreshQuiet = useCallback(async () => {
    try {
      const res = await api.state()
      applyState(res.state)
    } catch {
      /* 心跳失败不值得打扰用户：真断线了，动作请求会自己报出来 */
    }
  }, [applyState])

  // ---- 空闲心跳 ------------------------------------------------------- //
  //
  // 搜索在跑的时候用 130ms 追进度；搜索一停，上面那个 effect 就把轮询关了。
  // 但「我们停下」不等于「世界停下」：另一个标签页、或者对手模型那边的 HTTP
  // 自动拉取，都可能在我们不动手的时候把局面推走。空闲时留一个一秒的慢心跳，
  // 界面就不会闭着眼 —— 代价可以忽略，而看不见对手的棋正是这个软件最忌讳的事。
  //
  // **心跳的条件里不能带「对局进行中」。** 以前这里写的是
  // `state.game.status.state === 'playing' && !taskId` —— 于是对局一结束
  // （被将死、认输、和棋）心跳就自己关了，而**下一局同样是由外界开的**
  // （对手模型的 HTTP、或者另一个标签页）。结果本页永远停在一个早已不存在的
  // 残局上：实测对局结束后 4 秒内 /api/state 请求 0 次，外部随后开的新局
  // 界面 7 秒内毫无察觉（见 .devtools/_idle_heartbeat_check.mjs）。
  // 换句话说，这个门禁恰好把心跳关在它最该工作的时候。条件只该是「我们没在搜」。
  const idle = !!state && !taskId
  useEffect(() => {
    if (!idle) return
    const timer = window.setInterval(() => void refreshQuiet(), IDLE_MS)
    return () => window.clearInterval(timer)
  }, [idle, refreshQuiet])

  return {
    state,
    task: state?.task ?? null,
    thinking: state?.task?.status === 'running',
    connected,
    booting,
    toasts,
    queued: state?.pending?.text ?? null,
    dismissToast,
    pushToast,
    refresh,
    newGame,
    submitMove,
    clearQueue,
    engineMove,
    undoRound,
    resign,
    stopThinking,
    updateSettings,
    loadPosition,
  }
}
