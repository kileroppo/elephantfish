export type Side = 'red' | 'black'

export interface PieceInfo {
  /** 服务端分配的稳定身份号，同一个号在整局里跟着这颗子走 */
  id: number
  square: string
  index: number
  char: string
  side: Side
  piece: string
  glyph: string
  file: number
  rank: number
}

export interface LegalMove {
  iccs: string
  chinese: string
  from: string
  to: string
}

export interface MoveRecord {
  ply: number
  side: Side
  by: 'engine' | 'opponent'
  iccs: string
  chinese: string
  from: string
  to: string
  piece: string
  glyph: string
  captured: string | null
  captured_glyph: string | null
  check: boolean
  mate: boolean
  eval: number | null
  depth: number | null
  time: number | null
  state: GameState
}

export type GameState =
  | 'playing'
  | 'checkmate'
  | 'stalemate'
  | 'draw_repetition'
  | 'draw_moves'
  | 'resign'

export interface Status {
  state: GameState
  winner: Side | null
  reason: string
}

export interface LastMove {
  from: string
  to: string
  iccs: string
  by: 'engine' | 'opponent'
  captured: string | null
}

export interface GameSnapshot {
  board: string
  pieces: PieceInfo[]
  turn: Side
  engine_side: Side
  opponent_side: Side
  engine_to_move: boolean
  opponent_to_move: boolean
  ply: number
  in_check: boolean
  legal_moves: LegalMove[]
  last_move: LastMove | null
  records: MoveRecord[]
  status: Status
  fen: string
  halfmove: number
  is_start: boolean
}

export interface PvStep {
  iccs: string
  chinese: string
}

export interface SearchProgress {
  depth: number
  score: number
  mate: boolean
  nodes: number
  time: number
  nps: number
  pv: string[]
  pv_detail?: PvStep[]
}

export interface SearchResult {
  status: string
  engine?: string
  move?: string
  chinese?: string
  depth?: number
  score?: number
  mate?: boolean
  nodes?: number
  time?: number
  nps?: number
  elapsed?: number
  stopped?: boolean
  message?: string
}

export interface SearchTask {
  id: string
  kind: 'engine-move' | 'analyze'
  status: 'running' | 'done' | 'error'
  progress: SearchProgress | null
  result: SearchResult | null
  error: string | null
  elapsed: number
}

export interface Settings {
  max_depth: number
  think_ms: number
  auto_reply: boolean
  engine_type?: 'pikafish' | 'builtin'
  threads?: number
  hash_mb?: number
}

export interface EngineInfo {
  active: 'pikafish' | 'builtin'
  pikafish_available: boolean
  pikafish_path?: string
}

export interface OpponentConfig {
  mode: 'manual' | 'http'
  url: string
  method: string
  move_field: string
  headers: Record<string, string>
  auto: boolean
  last_error: string | null
  last_poll: number | null
}

export interface EngineStats {
  moves: number
  nodes: number
  think_time: number
  /** 本局（跨局累计）达到过的最深搜索层数 */
  depth_max: number
  wins: number
  losses: number
  draws: number
}

/** 只看这一局的用量。跨局累计在 EngineStats 里。 */
export interface GameStats {
  moves: number
  nodes: number
  think_time: number
  depth_max: number
  /** 这一局的胜负是否已经计入累计战绩 */
  settled?: false | 'wins' | 'losses' | 'draws'
}

/** 引擎正在算棋时抢先录进来的对方走法，等引擎收手由服务端落子 */
export interface PendingMove {
  text: string
  at: number
}

/** 服务端主动要说的一句话，带序号，前端只在序号变化时弹一次 */
export interface Notice {
  seq: number
  text: string
  tone: 'ok' | 'warn' | 'error' | 'info'
}

export interface AppState {
  game: GameSnapshot
  task: SearchTask | null
  settings: Settings
  engine_info?: EngineInfo
  opponent: OpponentConfig
  stats: EngineStats
  game_stats: GameStats
  pending: PendingMove | null
  notice: Notice | null
  server_time: number
}

export interface ApiReply {
  ok: boolean
  state?: AppState
  message?: string
  record?: MoveRecord
  undone?: number
  queued?: boolean
  auto_task?: string | null
  task?: SearchTask
}
