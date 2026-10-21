import type {
  AnimatedStep,
  GameHead,
  GameSnapshot,
  MoveRecord,
  PieceInfo,
  ReplayPly,
  Side,
  Status,
} from '../types'
import { parseSquare } from './board'
import { boardMapToPieces, fenToBoardMap } from './setup'

/**
 * 逐手回放的读侧换算：存档里那一局 → 一步一个局面。
 *
 * 为什么前端还要「走一遍」，`fen_before` 不是已经每手都存了吗：因为盘面上要动的
 * 不是局面字符串，而是**一颗颗有身份号的子**。Board 的滑行、被吃子留到落地那一拍、
 * 撞飞方向，全按 `pieces[].id` 记账（见 components/Board.tsx 里 `prevVisual` 那段）——
 * 每一手重新从 FEN 摊一批子出来，身份号就每手都换，整盘会被当成「局面被整个换掉」
 * 而集体瞬移，一步棋的动效全丢。
 *
 * 所以这里按存档给的顺序把身份号一路传下去：`iccs` 的前两格是起点、后两格是落点，
 * 起点上那颗子带着自己的号搬到落点，落点上原本站着的那颗子退场。这条链**只认顺序，
 * 不判合法性** —— 判合法性是服务端的活儿，而且已经判过了：`tools/verify.py` 的 O 段
 * 与 `tools/smoke_http.py` 的 12 段各拿真规则把 `start_fen` + 有序 ICCS 重放一遍，
 * 逐手要求算出的局面 == 存档的 `fen_before`，最后还要求等于 `fen_now`。那两条红了
 * 这里才可能摆错；这里不重做一遍判据，免得两份规则各说各的。
 */

export interface ReplayStep {
  /** 0 = 还没走（就是 `start_fen` 那个局面），k = 走过第 k 手之后 */
  ply: number
  /** 此刻盘上的子。身份号从开局一路带到终局，中途不换。 */
  pieces: PieceInfo[]
  /** 此刻该谁走 */
  turn: Side
  /** 走到这一步所下的那一手；ply 0 没有 */
  move: ReplayPly | null
  /** 上面那一手翻译成 Board 认得的棋谱行（含被吃那颗子的字面） */
  record: MoveRecord | null
}

export interface ReplayGame {
  head: GameHead
  /** steps[0] 是开局局面，steps[k] 是走过第 k 手之后。长度 = 手数 + 1。 */
  steps: ReplayStep[]
  /** 开局局面读不动（FEN 坏）时的一句人话。此时 steps 是空的，界面不许硬摆一副空盘。 */
  error: string | null
}

function at(p: PieceInfo, square: string): PieceInfo {
  const { file, rank } = parseSquare(square)
  return { ...p, square, file, rank, index: rank * 16 + file }
}

function other(side: Side): Side {
  return side === 'red' ? 'black' : 'red'
}

export function buildReplay(head: GameHead, plies: ReplayPly[]): ReplayGame {
  const parsed = fenToBoardMap(head.start_fen)
  if (!parsed || parsed.error) {
    return {
      head,
      steps: [],
      error: `这一局的开局局面读不动：${parsed?.error ?? head.start_fen}`,
    }
  }

  // 开局那批子的身份号在这里定死（1..N，按格子行序），之后一路带着走。
  // 不用 boardMapToPieces 自己的号：那个计数器每调用一次就往前跳一段，
  // 换一个视角或重读一遍同一局都会拿到另一批号。
  const templates = boardMapToPieces(parsed.map).map((p, i) => ({ ...p, id: i + 1 }))
  const byId = new Map(templates.map((p) => [p.id, p]))
  const live = new Map(templates.map((p) => [p.id, p.square]))

  const steps: ReplayStep[] = [
    { ply: 0, pieces: templates, turn: parsed.turn, move: null, record: null },
  ]

  plies.forEach((move, k) => {
    const from = move.iccs.slice(0, 2)
    const to = move.iccs.slice(2, 4)
    const prev = steps[k].pieces
    // 落点上原来站着谁 —— 被吃那颗子的字面与颜色都从**上一帧盘面**取，
    // 而不是从存档那列简体的名（车 / 马）现编：撞飞的残影得是盘上那颗子（車 / 馬）。
    const victim = prev.find((p) => p.square === to) ?? null
    const mover = prev.find((p) => p.square === from) ?? null
    if (mover) {
      if (victim) live.delete(victim.id)
      live.set(mover.id, to)
    }

    const pieces = [...live].map(([id, sq]) => at(byId.get(id)!, sq))
    steps.push({
      ply: k + 1,
      pieces,
      turn: other(move.side),
      move,
      record: recordOf(move, victim, mover),
    })
  })

  return { head, steps, error: null }
}

/** 存档的一手 → Board 认得的棋谱行。走的那颗子与被吃的那颗都来自上一帧盘面。 */
function recordOf(move: ReplayPly, victim: PieceInfo | null, mover: PieceInfo | null): MoveRecord {
  const from = move.iccs.slice(0, 2)
  const to = move.iccs.slice(2, 4)
  return {
    ply: move.ply,
    side: move.side,
    by: move.by,
    iccs: move.iccs,
    chinese: move.chinese,
    from,
    to,
    piece: mover?.piece ?? move.piece ?? '',
    glyph: mover?.glyph ?? move.piece ?? '',
    captured: move.captured,
    captured_glyph: victim?.glyph ?? move.captured,
    check: move.gives_check,
    mate: move.mate,
    eval: move.eval_red,
    mate_in: move.mate_in,
    depth: move.depth,
    time: move.think_time,
    review: move.review,
    state: move.mate ? 'checkmate' : 'playing',
  }
}

/**
 * 某一步的「实况形状」。
 *
 * Board 只读九个字段（`engine_side` / `in_check` / `last_move` / `legal_moves` /
 * `pieces` / `ply` / `records` / `status` / `turn`），其余是那份类型要求的占位。
 * `legal_moves` 给空数组，加上 `<Board readOnly>`：回放不许走棋，可走点也就该
 * 一个都不亮 —— 亮着一圈走不到的点是撒谎。
 */
export function snapshotAt(replay: ReplayGame, index: number): GameSnapshot | null {
  const step = replay.steps[index]
  const head = replay.head
  if (!step) return null
  const engineSide = head.engine_side
  const move = step.move
  return {
    board: '',
    pieces: step.pieces,
    turn: step.turn,
    engine_side: engineSide,
    opponent_side: other(engineSide),
    engine_to_move: step.turn === engineSide,
    opponent_to_move: step.turn !== engineSide,
    ply: step.ply,
    in_check: !!move?.gives_check,
    legal_moves: [],
    last_move: move
      ? {
          from: move.iccs.slice(0, 2),
          to: move.iccs.slice(2, 4),
          iccs: move.iccs,
          by: move.by,
          captured: move.captured,
        }
      : null,
    records: replay.steps.slice(1, index + 1).map((s) => s.record!),
    status: statusAt(replay, index),
    fen: move ? head.fen_now : head.start_fen,
    halfmove: 0,
    is_start: step.ply === 0,
  }
}

/**
 * 这一步的局面算不算终局。
 *
 * 存档只证得出两件事：这一手自己写着 `mate`（那就是把棋走死了，胜方就是走这手的
 * 那一方），以及**整局**结束在哪个状态（`games.state` / `winner` / `reason` 是整局
 * 的派生列，中间某一手是不是和棋它没记）。所以中间步骤一律 `playing`：把「没记」
 * 报成「还在下」在这里不骗人，因为那副盘上本来就没有可走的子，而判分与棋谱都照常
 * 按手显示。
 */
export function statusAt(replay: ReplayGame, index: number): Status {
  const step = replay.steps[index]
  const head = replay.head
  if (step?.move?.mate) {
    return { state: 'checkmate', winner: step.move.side, reason: '将死' }
  }
  if (step && step.ply === replay.steps.length - 1 && head.state) {
    return { state: head.state, winner: head.winner, reason: head.reason }
  }
  return { state: 'playing', winner: null, reason: '' }
}

/** 列表那行要区分「下过的一局」与「排局摆出来的」，这一句只管称呼，不下判断。 */
export function describeSource(source: string): string {
  if (source === 'setup') return '排局'
  if (source === 'play') return '对局'
  return source
}

/**
 * 将基准盘面快照（`baseGame`）与多步推演序列（`steps`）转化为逐帧可平滑滑行动画的 `GameSnapshot[]`。
 *
 * 关键原理（契合 `components/Board.tsx` 动画引擎）：
 * - `frames[0]` 为初始基准局面（第 0 步：落子前）
 * - `frames[k]` 为走完第 `k` 步后的局面：
 *   1. 严格沿用 `baseGame.pieces` 的 `id`（被吃子移除，移动子仅更新 `square/file/rank/index`）；
 *   2. 相邻两帧之间严格只移动 **1 枚棋子**（`moved.length === 1`）且 `ply` 递增 `+1`；
 *   3. 完整填充 `last_move` 与 `records[].captured_glyph`，从而在 `<Board>` 上触发棋子平滑滑行、墨迹轨迹、落子水波纹与吃子撞飞残影！
 */
export function buildAnimatedFrames(
  baseGame: GameSnapshot,
  steps: AnimatedStep[],
): GameSnapshot[] {
  const frame0: GameSnapshot = {
    ...baseGame,
    pieces: baseGame.pieces.map((p) => ({ ...p })),
    records: [...baseGame.records],
    legal_moves: [],
  }
  const frames: GameSnapshot[] = [frame0]

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]
    const rawIccs = (step.iccs || step.move || '').trim().toLowerCase()
    if (rawIccs.length < 4) break

    const from = rawIccs.slice(0, 2)
    const to = rawIccs.slice(2, 4)
    const prev = frames[frames.length - 1]
    const mover = prev.pieces.find((p) => p.square === from) ?? null
    if (!mover) break

    const victim = prev.pieces.find((p) => p.square === to) ?? null
    const nextPieces: PieceInfo[] = []
    for (const p of prev.pieces) {
      if (victim && p.id === victim.id) continue
      if (p.id === mover.id) {
        nextPieces.push(at(p, to))
      } else {
        nextPieces.push(p)
      }
    }

    const nextPly = prev.ply + 1
    const moveSide: Side = mover.side
    const nextTurn: Side = other(moveSide)
    const byWho: 'engine' | 'opponent' = moveSide === baseGame.engine_side ? 'engine' : 'opponent'
    const rec: MoveRecord = {
      ply: nextPly,
      side: moveSide,
      by: byWho,
      iccs: rawIccs,
      chinese: step.chinese || rawIccs,
      from,
      to,
      piece: mover.piece,
      glyph: mover.glyph,
      captured: victim?.piece ?? step.captured ?? null,
      captured_glyph: victim?.glyph ?? null,
      check: false,
      mate: false,
      eval: null,
      depth: null,
      time: null,
      state: 'playing',
    }

    frames.push({
      ...prev,
      pieces: nextPieces,
      turn: nextTurn,
      engine_to_move: nextTurn === baseGame.engine_side,
      opponent_to_move: nextTurn !== baseGame.engine_side,
      ply: nextPly,
      in_check: false,
      legal_moves: [],
      last_move: {
        from,
        to,
        iccs: rawIccs,
        by: byWho,
        captured: victim?.piece ?? step.captured ?? null,
      },
      records: [...prev.records, rec],
      is_start: false,
    })
  }

  return frames
}

