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
  /**
   * 红方视角 centipawn（一兵 = 100）。
   *
   * 引擎那一步带的是它自己搜出来的分；人录的一步**也有分** —— 服务端判分时
   * 把人这手所在的排名线换算成红方视角回填（见 server/session.py 的
   * `_attach_review`），走势线因此不再是只有引擎的半条。掉出引擎前几名之外时
   * 仍然留 null：那一手的分根本没搜出来，编一个比留空更糟。
   */
  eval: number | null
  /** 杀棋距离（步，0=已被将死）；方向看 eval 的正负，None = 不是杀棋。 */
  mate_in?: number | null
  depth: number | null
  time: number | null
  /**
   * 只有人走的步可能有，且可能没有（判分没跑成、或跑晚了就不算）。
   * 见 `MoveReview`：这份判分是「拿引擎当下排好的前几名比这一手」，
   * 不是现场重搜，所以它带着搜索宽度与界类型，措辞必须跟着这些走。
   */
  review?: MoveReview | null
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

/** 分数的可信程度：`exact` 是全窗精确值，两个 bound 是截断（fail-low）来的界。 */
export type ScoreBound = 'exact' | 'lowerbound' | 'upperbound'

/**
 * 同一个局面上一条排名线（multipv 的第 rank 名）。
 *
 * `score` 是**走子方视角**、`eval_red` 是红方视角，两份都给是因为两边要的
 * 参考系天生不同：判分要在走子方视角上做减法，而评估条、走势线、棋谱一律
 * 读红方视角。前端自己翻符号是最容易翻错的地方，所以不要翻，取 `eval_red`。
 */
export interface RankedLine {
  rank: number
  iccs: string
  chinese: string
  score: number
  eval_red: number
  mate: boolean
  mate_in: number | null
  bound: ScoreBound
  depth: number
  nodes: number
  time: number
  pv: PvStep[]
}

/**
 * 差值可信程度的分类（与服务端 `LOSS_KINDS` 一字不差）。
 *
 * 名字说的是「这个 loss 能不能当真值用」，不是「这步下得好不好」：
 *   exact      两条线都是精确值，差多少就是多少
 *   at_least   真值只会更大（截断来的分数撑不起「只差这么多」）
 *   at_most    真值只会更小
 *   uncertain  两个界的方向互相抵消，什么都证不出来 —— 只许报名次
 *   mate       有一条线是杀棋，centipawn 的减法在这里没有意义
 *   below_top  人这手没进前几名，连它的分都不知道
 */
export type LossKind = 'exact' | 'at_least' | 'at_most' | 'uncertain' | 'mate' | 'below_top'

/** 人走的某一步对着排名线的判分。措辞一律走 `lib/format.ts` 的 `gradeLabel`。 */
/**
 * 一条主变里**第一次吃到子**的那一手。服务端只给事实（第几手、谁吃的、吃了什么），
 * 「这句话能讲多硬」一律由 `lib/format.ts` 决定 —— 全站措辞只有一个出口。
 */
export interface PvCapture {
  /** 这条主变的第几手，1 起，双方交替都算 */
  ply: number
  iccs: string
  chinese: string
  /** 吃掉别人的那一方 */
  by: Side
  /** 被吃那颗子的中文名，与棋谱行的 `captured` 同一套词 */
  captured: string
}

/** 判分附带的主变事实：两条线各自先吃到子的那一手，或「看了，没吃到」。 */
export interface ReviewReason {
  /** 被打分的那一手是谁走的（也就是界面里的「你」） */
  side: Side
  /** 两条主变各自最多看几手 —— 「六步内没吃到子」的那个六 */
  pv_plies: number
  best: PvCapture | null
  played: PvCapture | null
}

export interface MoveReview {
  status: 'ok' | 'outside'
  /** 这批排名线来自哪一层、花了多少算力 —— 「排第 3」这句话的可信程度全在这 */
  depth: number
  nodes: number
  time: number
  /** 搜索宽度：`width` 就是「前几名」的那个几，掉出去时要说「没进引擎前 width 名」 */
  width: number
  best_iccs: string
  best_eval_red: number | null
  best_mate_in: number | null
  best_bound: ScoreBound | null
  /** 人这一手排在第几；没进前几名时为 null */
  rank: number | null
  played_iccs: string
  played_eval_red: number | null
  played_mate_in: number | null
  played_bound: ScoreBound | null
  /** 走子方视角的差值（centipawn，一兵 = 100）；不能当数值用时为 null */
  loss: number | null
  loss_kind: LossKind | null
  /** 每条线的主变截到 6 步 */
  lines: RankedLine[]
  /**
   * 主变里先吃到子的那一手（讲「为什么这手差」用的事实）。
   * **没有这个键 = 压根没看过**（这一手掉出前几名，就没有它的主变可对），
   * 与「看了、六步内都不吃子」是两件事，后者是 `reason.best` 与 `reason.played`
   * 都为 null。界面不许把前者念成后者。
   */
  reason?: ReviewReason | null
}

/** 「哪一局的哪一个局面」：判分要挂回去的那把键。 */
export interface AnalysisSubject {
  epoch: number
  board: string
  red_to_move: boolean
  ply: number
  fen: string
}

/**
 * 一层搜索的进度。
 *
 * 分数一律是 **centipawn**（一兵 = 100），服务端接缝负责把两个引擎各自的
 * 单位折算成这一个，前端不要再除任何分母。
 * `score` 是走子方视角，`eval_red` 是红方视角 —— 棋谱、评分条、走势线
 * 都按红方视角读，所以取数时优先用 `eval_red`，否则黑方思考时整个面板会反。
 * 杀棋时两个分数只是方向（±MATE_CP），距离读 `mate_in`（还有几步，0=已被杀）。
 */
export interface SearchProgress {
  depth: number
  score: number
  eval_red?: number
  mate: boolean
  mate_in?: number | null
  book?: boolean
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
  eval_red?: number
  mate?: boolean
  mate_in?: number | null
  book?: boolean
  nodes?: number
  time?: number
  nps?: number
  elapsed?: number
  stopped?: boolean
  message?: string
}

/**
 * 后台搜索的状态。
 *
 * `skipped` 只有判分那次会用：它借的是空闲算力，拿不到引擎锁就这一轮不判，
 * 不排队、不重试 —— 界面必须把「这一手没人给你打分」说出来，而不是转一个
 * 永远转不完的圈。
 */
export type TaskStatus = 'running' | 'done' | 'error' | 'skipped'

export interface SearchTask {
  id: string
  kind: 'engine-move' | 'analyze'
  status: TaskStatus
  progress: SearchProgress | null
  result: SearchResult | null
  error: string | null
  elapsed: number
  /** 判分那次专用：同一个局面按 rank 排好的线；engine-move 恒为空数组 */
  lines?: RankedLine[]
  /** 判分那次专用：这批线是对哪个局面搜的 */
  subject?: AnalysisSubject | null
}

/** `snapshot()['analysis']` 就是这一份，形状与 SearchTask 同源（同一个类）。 */
export type AnalysisTask = SearchTask

export interface Settings {
  max_depth: number
  think_ms: number
  auto_reply: boolean
  engine_type?: 'pikafish' | 'builtin'
  threads?: number
  hash_mb?: number
  /** 判分总开关。关掉之后服务端连排名线的槽一起清掉，棋谱里不会再出现新判分 */
  analyze?: boolean
  /** 判分那次的时限（毫秒，200–15000）：比走棋那次小，因为算力是借来的 */
  analyze_ms?: number
  /** 判分那次的层数上限（2–50） */
  analyze_depth?: number
  /** 排前几名（1–5）：也是「没进前几名」这句话里的那个几 */
  analyze_width?: number
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
  /**
   * 判分那次（低优先级的后台搜索）单独一个键：它不推棋、不该和引擎的应手混在
   * `task` 里 —— 「引擎在想」与「这一手排在第几」是两份读数，各有各的来源。
   */
  analysis: AnalysisTask | null
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

/**
 * 错题本的一题：**一个局面**在历次对局里攒下的判分账。
 *
 * 键是 `fen_before`（走这一步面对的局面）而不是「第几手」，所以这道题讲的是
 * 「这种局面你反复错过几次」，跨局累加。数字口径（服务端 store.review_verdict 是
 * 唯一一处判据）：`graded_plies = misses + clean + blurred + unreadable`。
 *
 * `blurred` 那几次**不是**「没错」，是「这份判分证不出对错」（`at_most` /
 * `uncertain` / `below_top` / 比不出距离的杀棋），按 `loss_kind` 原样在
 * `blurred_kinds` 里给出来 —— 这一档要是被并进 `clean`，界面就会把
 * 「没证出来的比较」念成「这手挺好」。
 */
export interface MistakeEntry {
  fen_before: string
  side: Side
  /** 这个局面带判分走过几次（跨所有对局） */
  graded_plies: number
  misses: number
  exact_misses: number
  at_least_misses: number
  mate_misses: number
  clean: number
  blurred: number
  blurred_kinds: Record<string, number>
  unreadable: number
  /** 涉及几局：错题本讲的从来不是眼下这一局 */
  games: number
  /** 最差那次给出的正解那手（措辞仍由 format.ts 决定） */
  best_iccs: string
  best_chinese: string
  worst_rank: number | null
  worst_loss: number | null
  worst_loss_kind: LossKind | null
  /** 服务端那句「为什么算错」的事实描述，不是给人念的措辞 */
  worst_why: string
  worst_iccs: string
  worst_chinese: string
  worst_game_id: string
  worst_ply: number | null
  /** 最差那次的整份判分：界面拿它喂 gradeLabel / gradeDetail，不另造一套话 */
  worst_review: MoveReview | null
  last_game_id: string
  last_ply: number | null
  last_at: number | null
}

/** 错题本总账。`limit` 只切列表，这些总数照实报，不受列表长短影响。 */
export interface MistakeSummary {
  positions: number
  listed: number
  miss_positions: number
  graded_plies: number
  misses: number
  exact_misses: number
  at_least_misses: number
  mate_misses: number
  clean: number
  blurred: number
  unreadable: number
  games: number
  limit: number
  store_enabled: boolean
}

export interface MistakeBookReply extends ApiReply {
  mistakes: MistakeEntry[]
  summary: MistakeSummary
}

/**
 * 存档里的「一局」的局头。
 *
 * 键名就是 `server/store.py` 的 `GAME_HEAD_COLUMNS` 那 12 列，一列不多一列不少
 * —— `tools/smoke_http.py` 12 段拿字面量清单逐字段对账，那边悄悄加列这里就得红一次。
 *
 * `state` / `winner` / `reason` / `outcome` 四列是**派生值**（留着让列表页不必
 * 回放整局），说的都是存档那一刻，不是眼下这一局的实况。
 */
export interface GameHead {
  game_id: string
  /** 这一局的第一手之前的那个局面：回放的真值两件套之一（另一件是有序 ICCS） */
  start_fen: string
  engine_side: Side
  /** `play` = 下过的一局；`setup` = 排局/补棋摆出来的，不是同一件事，不许混进战绩 */
  source: string
  opened_at: number
  updated_at: number
  ply_count: number
  fen_now: string
  state: GameState | null
  winner: Side | null
  reason: string
  /** 引擎视角的胜负；还没结束是 null */
  outcome: 'wins' | 'losses' | 'draws' | null
}

/** 列表的一行 = 那 12 列再加「这一局有几手带判分」。 */
export interface GameRow extends GameHead {
  /** 这一局有几手带着判分 —— 「哪一局值得回看」就靠它 */
  graded_plies: number
}

/** `GET /api/games` 的总账。`limit` 只切列表，这些总数不受列表长短影响。 */
export interface GamesSummary {
  total_games: number
  listed: number
  truncated: boolean
  play_games: number
  setup_games: number
  graded_plies: number
  graded_games: number
  limit: number
  store_enabled: boolean
}

export interface GamesReply extends ApiReply {
  games: GameRow[]
  summary: GamesSummary
}

/**
 * 回放用的每一手（`GET /api/game` 的 `plies`）。
 *
 * 与实况的 `MoveRecord` 是两份东西，别混：这一份来自存档，没有 `from` / `to`
 * （落点从 `iccs` 切出来就是）、没有 `glyph`（被吃那颗子的字由盘面自己给，
 * 见 `lib/replay.ts`），`check` 这一列在库里叫 `gives_check`。
 * `review` 是判分整份原样搬回来的，里面有什么键由判分那一侧决定。
 */
export interface ReplayPly {
  ply: number
  side: Side
  by: 'engine' | 'opponent'
  iccs: string
  chinese: string
  piece: string | null
  captured: string | null
  gives_check: boolean
  mate: boolean
  eval_red: number | null
  mate_in: number | null
  depth: number | null
  think_time: number | null
  /** 走这一步之前面对的局面 —— 错题本按它归题，回放按它显示「这一步的题面」 */
  fen_before: string
  review: MoveReview | null
}

/** `GET /api/game` 里那一局自己的账。 */
export interface ReplaySummary {
  plies: number
  graded_plies: number
  unreadable: number
  game_id: string
}

export interface ReplayReply extends ApiReply {
  found: boolean
  store_enabled: boolean
  game: GameHead
  plies: ReplayPly[]
  summary: ReplaySummary
}
