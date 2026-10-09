import type { ApiReply, AppState, SearchTask } from './types'

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

  settings: (payload: { max_depth?: number; think_ms?: number; auto_reply?: boolean }) =>
    request<ApiReply>('/api/settings', { method: 'POST', body: JSON.stringify(payload) }),

  opponentConfig: (payload: Record<string, unknown>) =>
    request<ApiReply>('/api/opponent/config', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  opponentPoll: () =>
    request<ApiReply>('/api/opponent/poll', { method: 'POST', body: '{}' }),

  health: () => request<{ ok: boolean; engine: string; python: string }>('/api/health'),
}
