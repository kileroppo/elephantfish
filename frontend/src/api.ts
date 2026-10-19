import type {
  ApiReply,
  AppState,
  GameSnapshot,
  GamesReply,
  MistakeBookReply,
  ReplayReply,
  SearchTask,
  TrainingHintReply,
  TrainingPuzzlesReply,
  TrainingStartReply,
  TrainingStepReply,
} from './types'

const BASE = ''

export class ApiError extends Error {
  status: number
  constructor(message: string, status = 0) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(BASE + path, {
      headers: { 'Content-Type': 'application/json' },
      ...init,
    })
  } catch {
    throw new ApiError('连不上引擎服务，确认它还在运行', 0)
  }

  const text = await res.text()
  let data: unknown = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    throw new ApiError('服务返回了无法解析的内容', res.status)
  }

  const payload = data as ApiReply
  if (!res.ok || (payload && payload.ok === false)) {
    throw new ApiError(payload?.message || `请求失败（${res.status}）`, res.status)
  }
  return data as T
}

export const api = {
  state: () => request<{ ok: boolean; state: AppState }>('/api/state'),

  task: (id: string) =>
    request<{ ok: boolean; task: SearchTask; state: AppState; stale?: boolean }>(
      `/api/task/${id}`,
    ),

  stopTask: (id: string) =>
    request<{ ok: boolean; state: AppState }>(`/api/task/${id}/stop`, { method: 'POST' }),

  newGame: (payload: {
    engine_side?: 'red' | 'black'
    max_depth?: number
    think_ms?: number
    auto_reply?: boolean
  }) => request<ApiReply>('/api/new', { method: 'POST', body: JSON.stringify(payload) }),

  move: (move: string) =>
    request<ApiReply>('/api/move', { method: 'POST', body: JSON.stringify({ move }) }),

  engineMove: () => request<ApiReply>('/api/engine-move', { method: 'POST', body: '{}' }),

  clearPending: () =>
    request<ApiReply>('/api/clear-pending', { method: 'POST', body: '{}' }),

  undo: (round = true, plies = 1) =>
    request<ApiReply>('/api/undo', {
      method: 'POST',
      body: JSON.stringify({ round, plies }),
    }),

  resign: (side?: 'red' | 'black') =>
    request<ApiReply>('/api/resign', { method: 'POST', body: JSON.stringify({ side }) }),

  load: (payload: { fen?: string; moves?: string[]; engine_side?: 'red' | 'black' }) =>
    request<ApiReply>('/api/load', { method: 'POST', body: JSON.stringify(payload) }),

  settings: (payload: {
    max_depth?: number
    think_ms?: number
    auto_reply?: boolean
    engine_type?: 'pikafish' | 'builtin'
    threads?: number
    hash_mb?: number
    analyze?: boolean
    analyze_ms?: number
    analyze_depth?: number
    analyze_width?: number
  }) =>
    request<ApiReply>('/api/settings', { method: 'POST', body: JSON.stringify(payload) }),

  opponentConfig: (payload: Record<string, unknown>) =>
    request<ApiReply>('/api/opponent/config', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  opponentPoll: () =>
    request<ApiReply>('/api/opponent/poll', { method: 'POST', body: '{}' }),

  health: () => request<{ ok: boolean; engine: string; python: string }>('/api/health'),

  /**
   * 错题本：服务端只读存档的一趟聚合，不带 payload、也不参加 130ms 轮询。
   * 它讲的是历次对局，与眼下这一局的状态没有因果关系 —— 读它不会改变任何一局。
   */
  mistakes: () => request<MistakeBookReply>('/api/mistakes'),

  /**
   * 历次对局的列表（挑一局来回放）。同样是只读、不进轮询。
   * `limit` 只有界面要「还有 N 局没列」时才传；缺省交给服务端的常量。
   */
  games: (limit?: number) =>
    request<GamesReply>(
      limit === undefined ? '/api/games' : `/api/games?limit=${encodeURIComponent(limit)}`,
    ),

  /**
   * 某一局的每一手 —— 回放要的全部真值都在这一份里（`start_fen` + 有序 ICCS，
   * 每手再带一个 `fen_before` 好让界面不必自己推）。
   * 库里没有这一局 / 存档关着都会抛 `ApiError`（404 与 503 是两件不同的事，
   * 服务端的 `message` 已经把它区分开了，这里不替它改口）。
   */
  game: (gameId: string) =>
    request<ReplayReply>(`/api/game?game_id=${encodeURIComponent(gameId)}`),

  // ---------------- 实训营（Drill Lab）接口 ----------------
  trainingPuzzles: (category?: string) =>
    request<TrainingPuzzlesReply>(
      category ? `/api/training/puzzles?category=${encodeURIComponent(category)}` : '/api/training/puzzles',
    ),

  trainingStart: (puzzleId: string) =>
    request<TrainingStartReply>('/api/training/start', {
      method: 'POST',
      body: JSON.stringify({ puzzle_id: puzzleId }),
    }),

  trainingStep: (puzzleId: string, move: string, sandbox = false) =>
    request<TrainingStepReply>('/api/training/step', {
      method: 'POST',
      body: JSON.stringify({ puzzle_id: puzzleId, move, sandbox }),
    }),

  trainingUndo: (puzzleId: string) =>
    request<{ ok: boolean; message: string; game: GameSnapshot }>('/api/training/undo', {
      method: 'POST',
      body: JSON.stringify({ puzzle_id: puzzleId }),
    }),

  trainingHint: (puzzleId: string, level: number) =>
    request<TrainingHintReply>('/api/training/hint', {
      method: 'POST',
      body: JSON.stringify({ puzzle_id: puzzleId, level }),
    }),

  trainingReset: (puzzleId: string) =>
    request<{ ok: boolean; message: string; game: GameSnapshot; hints_used: number; solved: boolean }>(
      '/api/training/reset',
      {
        method: 'POST',
        body: JSON.stringify({ puzzle_id: puzzleId }),
      },
    ),
}

