import {
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react'
import type { CSSProperties } from 'react'
import type { GameSnapshot, PieceInfo, Side } from '../types'
import {
  BOARD_H,
  BOARD_W,
  COLS,
  MARGIN,
  MARK_POINTS,
  RIVER_LABELS,
  ROWS,
  glideMs,
  landMs,
  squareAt,
  toPixel,
  toPercent,
  palaceDiagonals,
  parseSquare,
  pixelToSquare,
} from '../lib/board'
import { useExitPhase } from '../hooks/useExitPhase'

/** 正在被拖拽的一颗子。bx/by 是棋盘坐标系里的像素位置，
 *  渲染时直接写进 --cx/--cy，所以不需要在渲染期读 getBoundingClientRect。 */
interface DragState {
  from: string
  bx: number
  by: number
}

/** 落子反馈自身的时长。涟漪（520ms）比压实（320ms）长，两者错开收尾，
 *  所以这个类要挂满最长的那个。 */
const IMPACT_MS = 520

/** 被吃残影从挂载到卸载。CSS 里 pieceKnockback 走 220ms，这里给到 240ms 收干净。 */
const KNOCK_MS = 240

/** 可走点与选中月牙环还多活多久（见 hooks/useExitPhase）。入场有波次（240ms 加每颗
 *  18ms），退场只做「收回去」这一件事，比入场短一半 —— 拖长了就变成挡下一次点击。
 *  比 CSS 里那两条 targetOut / crescentOut 的 110ms 多出 60ms，这截留白是必需的：
 *  is-leaving 随 React 提交挂上，动画却要等下一次绘制才起步，天生晚一帧；而退场常常正好
 *  打断在入场那波动画上（落子前刚点过这颗子），同一元素换动画要多等第二帧才起步。
 *  实测 110ms 的动画在打断情形下要到 ~154ms 才播完，定时器短于它就等于把节点收在半路
 *  摘掉。--ease-exit 又把最陡的一段压在末尾，半路摘掉恰好是「啪」地没。 */
const MARK_OUT_MS = 170

/** 将军那一响在 DOM 上多留多久。CSS 里 checkAlarm 走 640ms，这里给到 700ms ——
 *  类挂上之后动画最早也要等下一次绘制才起步，摘早了就是把尾巴剪在半路（同一件事
 *  在退场那两条上踩过一次，见上面 MARK_OUT_MS 那段）。尾巴本来就散到 opacity 0 了，
 *  多留 60ms 不挡任何一次点击。 */
const CHECK_ALARM_MS = 700

/** 落点上那颗「已被服务端摘掉、画面还没让它倒」的被吃子。 */
interface Victim {
  square: string
  glyph: string
  side: Side
}

/** 同上，再加撞飞这一下需要的两个量：从哪来（决定方向），翻几个身。 */
interface KnockSeed extends Victim {
  from: string
}

/** 本地预判最多活这么久。到点服务端还没认，就判这一手落空、就地回位。
 *  这条兜底只该在「服务端拒绝了这一手」时走到（正常情况下 ply 一变就把预判撤了）。 */
const PENDING_MS = 800

interface BoardProps {
  game: GameSnapshot
  flipped: boolean
  thinking: boolean
  /** 主变（ICCS）：在盘面上淡淡地铺一条「引擎打算这么走」的虚线 */
  pv?: string[]
  /** 落子唯一的出口。走哪一步算一步由 Board 自己认，上层只收 ICCS。
   *  要回一个「收没收」：false 表示这一步没被接受，Board 得立刻把本地预判撤回来。 */
  onMove: (iccs: string) => Promise<boolean>
  /** 补棋 / 自定义排局模式 */
  setupMode?: boolean
  setupPieces?: PieceInfo[]
  selectedTrayPiece?: string | null
  pickedBoardSquare?: string | null
  onSetupSquareTap?: (square: string) => void
  onSetupPieceMove?: (from: string, to: string) => void
  onSetupPieceRemove?: (square: string) => void
  onSetupPickBoardSquare?: (square: string | null) => void
  /** 正在翻转视角（「收窄 → 换 → 展开」这一段的头尾）。见 App 里的 turnBoard。 */
  flipping?: boolean
  /**
   * 只读：复盘台用它。盘上的子一颗都不许抓、一点都不许点 —— 回放那一局不是
   * 再走一局。这道闸门写在这里而不是靠「传一副没有合法着法的快照」间接实现：
   * 后者一旦有人给快照补上 `legal_moves`，回放盘就又能动棋了，而那正是这件事
   * 最不该发生的形式。
   */
  readOnly?: boolean
}

export function Board({
  game,
  flipped,
  thinking,
  pv = [],
  onMove,
  flipping = false,
  readOnly = false,
  setupMode = false,
  setupPieces,
  selectedTrayPiece = null,
  pickedBoardSquare = null,
  onSetupSquareTap,
  onSetupPieceMove,
  onSetupPieceRemove,
  onSetupPickBoardSquare,
}: BoardProps) {
  const surfaceRef = useRef<HTMLDivElement>(null)

  // 拖拽：从「按下一颗子」到「松手」之间的全部状态都在这里。
  const [drag, setDrag] = useState<DragState | null>(null)
  const dragRef = useRef<{
    from: string | null
    sx: number
    sy: number
    id: number
    moved: boolean
  } | null>(null)

  // 本地预判位移：落子瞬间立即启动位移，不等网络往返，杜绝子回弹与闪烁。
  // 记的是**棋子身份号**而不仅是格子名 —— 预判落空要回位时，得精确知道该把
  // 「上一帧位置」这笔账还给哪颗子（见下面 PENDING_MS 那个兜底计时器）。
  const [pendingMove, setPendingMove] = useState<{
    id: number
    from: string
    to: string
  } | null>(null)

  // 每颗子「上一帧渲染在哪个格子」，键是服务端给的棋子身份号。两个用途：
  // 算出这一手的滑行距离，以及认出「哪颗子刚落下来」好给它挂一次落子反馈。
  // 摆在 ref 里而不是 state 里：它只在渲染期被读一次，更新它不该再触发一轮渲染。
  const prevVisual = useRef(new Map<number, string>())

  // 落子的序号。用来认出「这条提交回执已经过期了」—— 期间又落了一手的话，
  // 上一手的失败回执不该去动这一手的账。
  const moveSeq = useRef(0)

  // 上一次结算过的 ply。用来认出「真的往前走了一手」—— 落子反馈只该在那种时候响，
  // 悔棋（ply 回退）不算。
  const plyRef = useRef(game.ply)

  // 滑行收尾时用它强制重渲一次。--glide-dur 是写在行内样式上的、**跨帧残留**的：
  // 不主动收一次，落点之后那 200~360ms 里只要 --u 一变（开抽屉、缩放窗口），
  // 这颗子就会莫名其妙再滑一次。用法见下面那个 effect 的收尾。
  const [, forceSettle] = useReducer((n: number) => n + 1, 0)

  /** 正在滑的棋子 -> 这一段位移该走多久。**锁住，滑完才收。**
   *
   *  为什么不能按每帧的 diff 现算（这是踩过的坑，别再改回去）：
   *  过渡要能起来，时长必须和「--cx 变化」落在**同一次样式重算**里。而服务端够快时
   *  （本机往往十几毫秒），「本地预判」与「服务端确认」两次 commit 会落在同一帧内，
   *  浏览器整帧只做一次重算 —— 如果确认那一次已经把 --glide-dur 按「这一帧没换格」
   *  改回了 0ms，浏览器看到的就是「起点 → 终点、时长 0ms」：过渡根本不会开始，
   *  棋子是瞬移过去的。而且**是不是能滑起来取决于服务端响应落在哪一帧**，时好时坏。
   *  锁成同一个数之后，无论重算落在哪一次 commit 之后，时长都是它，过渡必然开始。
   *
   *  写在渲染期是刻意的：时长只有跟 --cx 一起 commit 才管用，等到 effect 里再设
   *  就晚了（那时 CSS 里元素的起点已经是终点了）。这里**只写不消费**，幂等 ——
   *  StrictMode 下渲染函数被调两遍，也只是把同一个值写两遍，没有副作用。 */
  const glideRef = useRef(new Map<number, number>())

  // 开场落盘只播一次：首渲染时全员带 is-entering（--enter-delay 按板面波次
  // 逐颗排开），挂载后立刻记下「已开过场」。ref 变化不触发重渲染，类会留到
  // 下一次渲染才摘 —— 那时动画早已播完（fill both 的终态就是正常态），无影响。
  // 之后悔棋 / 重开 / 载入整盘换位置都不再播：那些是「局面被换掉」，不是开场。
  const bootedRef = useRef(false)
  useEffect(() => {
    bootedRef.current = true
  }, [])

  // 正在播落子反馈的那颗子。**一次性**的：挂上去、到点自己摘。
  // 以前这件事靠 `.piece.is-landing` 这个**持久**类 + `.piece-face` 上 key 的变化
  // 触发 React 重挂载来重播。那等于把「什么时候播」绑死在 React 的重建上：
  // 加不出分级时序，还得每落一手白重建一次 DOM。
  const [impactId, setImpactId] = useState<number | null>(null)
  /** 落点时钟的两个计时器，都拿着「它属于哪颗子」—— 这一手被服务端拒绝时要按号撤掉
   *  （见 commitMove 的 rollBack）。都用 ref 拿着、自己管自己的命，原因见下面那个
   *  effect 顶上「故意不返回 cleanup」那段。 */
  const landTimer = useRef<{ id: number; handle: number } | null>(null)
  const settleTimer = useRef<{ id: number; handle: number } | null>(null)
  const hideImpact = useRef<number | null>(null)
  const hideKnock = useRef<number | null>(null)
  /** 排好的落点那一拍要吃掉的那颗子。在 effect 里存、落点回调里取 —— 翻滚量只能在
   *  回调里摇：Math.random 写在渲染期，StrictMode 调两遍就摇出两个数。 */
  const knockRef = useRef<KnockSeed | null>(null)
  const [knock, setKnock] = useState<(KnockSeed & { kr: number }) | null>(null)
  /** 已经响过落点的那一手 ply。落点框与替身都靠它退场（见 airborne）。 */
  const [landedPly, setLandedPly] = useState(-1)
  /** 该响「将军」那一响的那一格。**一次性**，跟涟漪排在同一拍上、到点自己摘 ——
   *  静态那圈朱砂说的是「还被将着」，这一响说的是「刚刚被将了」，两件事不能混在一个类里。 */
  const [alarmSquare, setAlarmSquare] = useState<string | null>(null)
  const hideAlarm = useRef<number | null>(null)
  /** 落点回调读的两样「现在是什么」都写在 ref 里：它排的是三百多毫秒之后，
   *  闭包里那份 state 还是排队那一帧的（那会儿服务端还没回，records 里根本没有这一手）。
   *  跟 knockRef 同一个理由 —— 时序归回调，内容归最新那一帧。 */
  const recordsRef = useRef(game.records)
  recordsRef.current = game.records

  // 选中哪一格归 Board 自己管。以前它住在上层，于是「点一下到底算选中还是落子」
  // 要绕一圈：Board 把格子报上去，上层判完再把 selected/targets 传回来。走这条
  // 环路的代价是合法性判两遍（Board 判 targets.includes，上层再 find 一次），
  // 两处一旦有一处改了就静默不一致。
  const [picked, setPicked] = useState<string | null>(null)
  const activePieces = setupMode && setupPieces ? setupPieces : game.pieces
  const effectivePicked = setupMode ? pickedBoardSquare : picked

  // 可走点：从合法着法里现算。不再由上层算好传下来 —— 传下来就意味着上层也得
  // 知道「哪一格能被选中」，那正是要收窄掉的那部分知识。
  const targets = useMemo(() => {
    if (setupMode || !effectivePicked) return []
    return game.legal_moves.filter((m) => m.from === effectivePicked).map((m) => m.to)
  }, [setupMode, effectivePicked, game.legal_moves])

  /* 落子、取消选中之后，可走点与月牙环不许一帧剪掉 —— 入场有编舞，退场也得有一程，
     不然「开」与「关」的手法不对等，手感当场掉一档（详见 hooks/useExitPhase 那段）。
     多活这一程里必须拿**最后那一组**继续画：picked 已经空了，targets 现算就是空数组，
     照现在的值渲染就是第一帧什么都不剩，退场动画播给谁看。
     冻在 ref 里、渲染期写是刻意的：换成 effect 就晚一帧，那一帧画面上点已经没了
     （同一件事在落点替身上也踩过，见 standIn）。 */
  const [dotsShown, dotsLeaving] = useExitPhase(!setupMode && targets.length > 0, MARK_OUT_MS)
  const lastDots = useRef<{ sq: string; capture: boolean }[]>([])
  const dots = targets.map((sq) => ({ sq, capture: game.pieces.some((p) => p.square === sq) }))
  if (dots.length) lastDots.current = dots

  const [crescentShown, crescentLeaving] = useExitPhase(!!effectivePicked, MARK_OUT_MS)
  const lastPicked = useRef<string | null>(null)
  if (effectivePicked) lastPicked.current = effectivePicked
  const crescentSq = effectivePicked ?? (crescentShown ? lastPicked.current : null)

  // 服务端认了这一手就把预判撤掉。**只认 ply 与 turn 这两个「确认信号」** ——
  // 原来依赖里还挂着 game.pieces，那是个陷阱：pieces 每一轮轮询都是新数组，
  // 于是预判在下一次轮询（可能只有 100ms）就被清掉，棋子当场滑回原位、等确认
  // 到了再滑过去：一步棋滑两趟。
  useEffect(() => {
    setPendingMove(null)
  }, [game.ply, game.turn])

  // 局面换了就把选中清掉。**只认这几个字段**：直接依赖 game.pieces 会在每次
  // 轮询/state 刷新时都拿到新数组，于是每一轮都把选中清掉，选子根本立不住。
  useEffect(() => {
    setPicked(null)
  }, [game.ply, game.engine_side, game.status.state])

  // 兜底：PENDING_MS 还没等到服务端点头，就判这一手落空，就地回位。
  // 回位前先把这颗子的「上一帧位置」改回原位 —— 于是这次回位是**瞬回**：
  // 既不滑（滑回去是一次假的位移），也不会再响一次落子反馈（那是第二个假的
  // 「发生了什么」）。走这条路只可能是服务端拒绝了这一手。
  useEffect(() => {
    if (!pendingMove) return
    const { id, from } = pendingMove
    const timer = window.setTimeout(() => {
      prevVisual.current.set(id, from)
      setPendingMove(null)
      cancelArrival(id) // 同上：这一手没落地，落点那几拍也不许响
    }, PENDING_MS)
    return () => window.clearTimeout(timer)
  }, [pendingMove])

  /** 这一帧真正换了格子的子，以及它从哪滑到哪。
   *
   *  分辨「这一步棋是真是假」不能只看「ply 变没变」：预判发生在服务端点头**之前**，
   *  那一帧 ply 还没动，可它确实是一步棋。所以两边都要看，判据在下面的 canGlide。
   *
   *  这里**只读** prevVisual，不写 —— 写它的活儿归下面那个 effect。渲染函数在
   *  StrictMode 下会被调两遍，在这里写会把要看的那个差值自己抹掉。 */
  const moved = useMemo(() => {
    const prev = prevVisual.current
    const out: { id: number; from: string; to: string }[] = []
    for (const p of game.pieces) {
      // 「视觉上的格子」：本地预判期间，这颗子在画面上已经在落点了
      const sq = p.id === pendingMove?.id ? pendingMove.to : p.square
      const was = prev.get(p.id)
      if (was !== undefined && was !== sq) out.push({ id: p.id, from: was, to: sq })
    }
    return out
  }, [game.pieces, pendingMove])

  /** 这一帧的位移该不该滑。
   *
   *  两个来源都算「真走了一步」：ply 往前走（服务端确认了某一手），或者本地正替它
   *  先走（预判在飞，这一帧 ply 还没动）。
   *
   *  反过来：ply 回退是悔棋、归零是重开、跳一大截是载入存档 —— 那些是「局面被整个
   *  换掉了」，不是「某颗子走了一步」。棋子该直接站到新位置上去，不滑，也不响落地。 */
  const plyDelta = game.ply - plyRef.current
  const canGlide = plyDelta > 0 || (plyDelta === 0 && pendingMove !== null)

  // 把这一手的滑行时长锁下来（为什么必须锁，见 glideRef 上面那一段）。
  // 只锁「单独一颗子」这一种：整片换格是重开 / 载入，那种满盘漂移既不像下棋也很贵。
  const solo = moved.length === 1 ? moved[0] : null
  if (solo && canGlide) glideRef.current.set(solo.id, glideMs(solo.from, solo.to))

  /** 这一手吃掉的是哪颗子（没吃子返回 null）。
   *
   *  两条来源按「服务端认了没有」分家：
   *    预判期间 —— 它还站在 game.pieces 里，照着落点找就行；
   *    确认之后 —— 服务端已经把它摘掉了（**引擎的那一手尤其如此，它根本没有预判**），
   *                只能从这一手的记录里读它的字与颜色。
   *  击退方向不在这里算：那要拿 flipped 换算，归渲染期管。 */
  const victimAt = (from: string, to: string, moverId: number): KnockSeed | null => {
    const standing = game.pieces.find((p) => p.square === to && p.id !== moverId)
    if (standing) {
      return { square: to, glyph: standing.glyph, side: standing.side, from }
    }
    const rec = game.records[game.ply - 1]
    if (rec?.captured && rec.to === to) {
      return {
        square: to,
        glyph: rec.captured_glyph || rec.captured,
        side: rec.side === 'red' ? 'black' : 'red',
        from,
      }
    }
    return null
  }

  /** 排一次落子。一整手棋的「发生了什么」都压在这一拍上：涟漪、被吃子的撞飞、
   *  落点框显形，还有 useGame 里那一声落子音 —— 它们必须是**同一个时刻**，
   *  差二十几毫秒人眼就听得出来「声音先落、子还在滑」。
   *
   *  两个时刻，各排各的（这是这一段的分工，别把它们并成一个）：
   *    landMs(from, to) —— 棋子**看着落定**的那一刻（滑行时长的 87.5%）。
   *      音效一直就排在这里；涟漪和撞飞以前排在 glideMs（100%），于是听着落子了
   *      画面还在滑，且被吃子早在两百多毫秒前就从盘上消失了（见下面 doomed 那段）。
   *    glideMs(from, to) —— 位移真正结束。这一拍只做收尾：把时长交还给 0，否则
   *      --glide-dur 残留在 DOM 上，之后 200~360ms 里只要 --u 一变（开抽屉、
   *      缩放窗口），这颗子会莫名其妙再滑一次。
   *
   *  **故意不返回 cleanup。** 这个 effect 的依赖里有 game.pieces，而它每一轮
   *  轮询都会换一个新数组 —— 一旦按惯例写 cleanup clearTimeout，那个计时器
   *  每 100 多毫秒就会被清掉一次、而重跑时又因为「没有换格」直接 return，
   *  于是类永远摘不掉。计时器都用 ref 拿着，自己管自己的命；
   *  唯一会主动撤它们的地方是「这一手被服务端拒绝」（见 cancelArrival）。
   *
   *  用的是上面渲染期算好的 moved，不在这里重算一遍 —— 否则「渲染看到的」与
   *  「effect 算出的」是两个时刻的视图，两边可能对不上（两边都以 moved 为准）。 */
  useEffect(() => {
    const next = new Map<number, string>()
    for (const p of game.pieces) {
      next.set(p.id, p.id === pendingMove?.id ? pendingMove.to : p.square)
    }
    prevVisual.current = next

    // 一次只该有一颗子换格。换了一整片说明这是重开 / 载入 / 悔棋带回来的整体位移：
    // 那不是「一步棋」，不滑行也不响反馈。
    // （以前这里按 id 一对一地认「上一帧在哪」，而服务端重开时会把 id 重新分配成
    // 1..N —— 于是满盘棋子会一起从上一局的终局位置滑到开局位置，还各响一次反馈。）
    const landed = moved.length === 1 ? moved[0] : null
    if (!landed) {
      plyRef.current = game.ply
      return
    }

    const { id, from, to } = landed
    // 时长是渲染期锁好的。悔棋那种 canGlide 为假的时候这里取不到值，wait = 0 ——
    // 于是那颗子直接站回原位，且下面那句 isPrediction/advanced 也会判成「不是落子」。
    const wait = glideRef.current.get(id) ?? 0
    // 只有「真的往前走了一手」才响落子反馈：ply 前进说明服务端认了这一手；
    // 预判这一帧 ply 还没动，但那一手正是本地替它先走的，所以也认。
    const isPrediction = pendingMove?.id === id
    const advanced = game.ply === plyRef.current + 1
    plyRef.current = game.ply
    // 落点那一拍属于**哪一手**。预判时 ply 还没走，所以它是「下一手」——
    // 替身与落点框都按这个号退场（见下面 airborne），不能直接拿闭包里的 game.ply 用。
    const targetPly = isPrediction ? game.ply + 1 : game.ply
    knockRef.current = victimAt(from, to, id)

    if (landTimer.current) window.clearTimeout(landTimer.current.handle)
    if (settleTimer.current) window.clearTimeout(settleTimer.current.handle)
    if (hideImpact.current) window.clearTimeout(hideImpact.current)
    if (hideKnock.current) window.clearTimeout(hideKnock.current)
    // 这里**不清**hideAlarm：上一响的退场定时器自己带号（回调只在「还是那一格」时才置空），
    // 取消它反而会让 is-check-alarm 在一手不将军的棋之后永久留着。

    landTimer.current = {
      id,
      handle: window.setTimeout(() => {
        landTimer.current = null
        if (!(isPrediction || advanced)) return
        setLandedPly(targetPly)
        setImpactId(id)
        hideImpact.current = window.setTimeout(
          () => setImpactId((curr) => (curr === id ? null : curr)),
          IMPACT_MS,
        )
        const seed = knockRef.current
        if (seed) {
          // 撞击的方向留给渲染期换算（要跟 flipped 走），这里只摇翻滚量
          setKnock({ ...seed, kr: (Math.random() > 0.5 ? 1 : -1) * (3 + Math.random() * 4) })
          hideKnock.current = window.setTimeout(() => setKnock(null), KNOCK_MS)
        }
        // 将军那一响排在同一拍上：这一手的记录说它把王将住了，就在棋子**看着落定**
        // 的那一刻把类挂到被将的那颗王身上 —— 与落子音（useGame 的 voiceFor 里
        // 同一个 landMs）同步。读 recordsRef 而不是闭包里的 game.records：回调跑起来
        // 已经是三百多毫秒之后，那会儿服务端的确认早到了。
        const rec = recordsRef.current.find((r) => r.ply === targetPly)
        const alarmSq = checkSquareRef.current
        if (rec?.check && alarmSq) {
          if (hideAlarm.current) window.clearTimeout(hideAlarm.current)
          setAlarmSquare(alarmSq)
          hideAlarm.current = window.setTimeout(
            () => setAlarmSquare((curr) => (curr === alarmSq ? null : curr)),
            CHECK_ALARM_MS,
          )
        }
      }, landMs(from, to)),
    }
    settleTimer.current = {
      id,
      handle: window.setTimeout(() => {
        settleTimer.current = null
        glideRef.current.delete(id)
        forceSettle()
      }, wait),
    }
  }, [moved, game.pieces, pendingMove])

  useEffect(
    () => () => {
      if (landTimer.current) window.clearTimeout(landTimer.current.handle)
      if (settleTimer.current) window.clearTimeout(settleTimer.current.handle)
      if (hideImpact.current) window.clearTimeout(hideImpact.current)
      if (hideKnock.current) window.clearTimeout(hideKnock.current)
      if (hideAlarm.current) window.clearTimeout(hideAlarm.current)
    },
    [],
  )

  // 棋盘比例锚定
  useLayoutEffect(() => {
    const el = surfaceRef.current
    if (!el) return
    const apply = () => {
      const w = el.clientWidth
      if (w > 0) el.style.setProperty('--u', String(w / BOARD_W))
    }
    apply()
    const ro = new ResizeObserver(apply)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const kingInCheck = useMemo(() => {
    if (!game.in_check) return null
    const king = game.pieces.find((p) => p.char.toLowerCase() === 'k' && p.side === game.turn)
    return king ? king.square : null
  }, [game.in_check, game.pieces, game.turn])
  /** 最新那一帧上「被将的王在哪」。落点回调在三百多毫秒之后才跑，那时服务端早就把
   *  in_check 带回来了 —— 读闭包里的 kingInCheck 拿到的是排队那一刻的 null。 */
  const checkSquareRef = useRef<string | null>(null)
  checkSquareRef.current = kingInCheck

  // 胜方的王：终局时亮起一圈朱砂余光
  const victorKing = useMemo(() => {
    if (game.status.state === 'playing' || !game.status.winner) return null
    const king = game.pieces.find(
      (p) => p.char.toLowerCase() === 'k' && p.side === game.status.winner,
    )
    return king ? king.square : null
  }, [game.status.state, game.status.winner, game.pieces])

  /* ---- 落点时钟：这一手还悬在半空中吗 ------------------------------------ //
   *
   *  「落定」那一刻之前，落点上不该出现落点框、也不该出现被撞飞的残影 —— 它们和
   *  涟漪、落子音一起排在同一拍（见上面那个 effect）。判据是：站在落点上的那颗子
   *  还在滑（glideRef 里有它），且它这一手的落点还没响过。
   *
   *  为什么非得**渲染期派生**，而不是像以前那样在 effect 里 setState 挂残影：
   *  effect 至少晚一帧，而**服务端确认那一帧**被吃的那颗子已经从 game.pieces 里没了。
   *  差的就是那一帧 —— 棋子还在半路上，落点已经空了，看着像子掉进盘里。
   *  下面 standIn 那段补的就是这一帧。 */
  const airborne = (() => {
    if (setupMode || !game.last_move) return false
    if (landedPly === game.ply) return false
    const sq = game.last_move.to
    for (const p of game.pieces) {
      const at = p.id === pendingMove?.id ? pendingMove.to : p.square
      if (at === sq) return glideRef.current.has(p.id)
    }
    return false
  })()

  /** 落点上那颗「已被服务端摘掉、但还没被撞飞」的被吃子 —— 由这一手的记录现推。
   *  预判期间它整个儿还活着（走下面 pieces 循环里的 is-doomed），两者不重叠。 */
  const standIn = (() => {
    if (!airborne) return null
    const rec = game.records[game.ply - 1]
    if (!rec?.captured || rec.ply !== game.ply) return null
    if (!game.last_move || rec.to !== game.last_move.to) return null
    return {
      square: rec.to,
      glyph: rec.captured_glyph || rec.captured,
      side: (rec.side === 'red' ? 'black' : 'red') as Side,
      from: rec.from,
    } satisfies Victim & { from: string }
  })()

  const pvSquares = useMemo(() => {
    const out: { from: string; to: string }[] = []
    pv.slice(0, 3).forEach((iccs) => {
      if (iccs.length === 4) out.push({ from: iccs.slice(0, 2), to: iccs.slice(2, 4) })
    })
    return out
  }, [pv])

  /** 棋盘像素坐标 -> 格子名；落在盘外返回 null。
   *  坐标换算只有 lib/board.ts 的 pixelToSquare 一份 —— 这里以前自己又写了一遍
   *  同样的四则运算，两份迟早会走岔。 */
  const squareFromBoard = (x: number, y: number): string | null => {
    const p = pixelToSquare(x, y, flipped)
    return p ? squareAt(p.file, p.rank) : null
  }

  const squareAtPoint = (clientX: number, clientY: number): string | null => {
    const el = surfaceRef.current
    if (!el) return null
    const rect = el.getBoundingClientRect()
    return squareFromBoard(
      ((clientX - rect.left) / rect.width) * BOARD_W,
      ((clientY - rect.top) / rect.height) * BOARD_H,
    )
  }

  const toBoardPixel = (clientX: number, clientY: number) => {
    const el = surfaceRef.current
    if (!el) return { bx: 0, by: 0 }
    const rect = el.getBoundingClientRect()
    return {
      bx: ((clientX - rect.left) / rect.width) * BOARD_W,
      by: ((clientY - rect.top) / rect.height) * BOARD_H,
    }
  }

  /** 这颗子现在能不能被拿走。轮到的、还没结束、引擎没在算 —— 三者缺一不可。 */
  const grabbable = (square: string | null): boolean => {
    if (!square) return false
    if (readOnly) return false
    if (setupMode) {
      return activePieces.some((p) => p.square === square)
    }
    if (thinking || game.status.state !== 'playing') return false
    const piece = game.pieces.find((p) => p.square === square)
    return !!piece && piece.side === game.turn
  }

  /** 现在能不能动棋。三个入口（拖、点、键盘）都过这一道。 */
  const canPlay = (): boolean => setupMode || (!thinking && game.status.state === 'playing')

  /** 撤掉排在落点那几拍。只在「这一手被服务端拒绝」时走 —— 落点时钟是提前排好的，
   *  手没落成却照样响涟漪、照样把一颗好子撞飞，画面就表演了一件没发生过的事。
   *  按**身份号**撤：期间可能已经排上了下一手的落点，别人的账不许动（同 moveSeq 那套）。 */
  const cancelArrival = (id: number) => {
    if (landTimer.current?.id === id) {
      window.clearTimeout(landTimer.current.handle)
      landTimer.current = null
      knockRef.current = null
    }
  }

  /** 落子。**合法性只在这一处判**，上层收到的永远是已经核对过的一步。 */
  const commitMove = (from: string, to: string): boolean => {
    if (!canPlay()) return false
    const mv = game.legal_moves.find((m) => m.from === from && m.to === to)
    if (!mv || mv.from === mv.to) return false
    // 认一下是哪颗子 —— 预判带着它走，落空时才知道该把位移记还给谁
    const mover = game.pieces.find((p) => p.square === from)
    if (!mover) return false
    setPendingMove({ id: mover.id, from, to }) // 先本地预判位移，不等网络往返
    setPicked(null)

    // 服务端当场说「不收」时立刻回位，不等 PENDING_MS 那个兜底。否则这最多 800ms
    // 里画面停在一步服务端根本没认的棋上 —— 连那颗被判死的敌子都一直压着颜色等死，
    // 那是在展示一个不存在的局面。
    const seq = (moveSeq.current += 1)
    const rollBack = () => {
      if (seq !== moveSeq.current) return // 期间又落了新的一手，这条回执作废
      // 把「上一帧位置」记回去，于是这次回位是**瞬回**：不滑，也不再响一次反馈
      prevVisual.current.set(mover.id, from)
      setPendingMove(null)
      cancelArrival(mover.id)
    }
    void onMove(mv.iccs).then((ok) => {
      if (!ok) rollBack()
    }, rollBack)
    return true
  }

  /** 单击一格：能落子就落子；点到自己轮到的子就选中／取消；点别处清掉选中。 */
  const tapSquare = (sq: string) => {
    if (setupMode) {
      if (selectedTrayPiece) {
        onSetupSquareTap?.(sq)
        return
      }
      const pieceOnSq = activePieces.find((p) => p.square === sq)
      if (pickedBoardSquare) {
        if (pickedBoardSquare === sq) {
          onSetupPickBoardSquare?.(null)
        } else {
          onSetupPieceMove?.(pickedBoardSquare, sq)
          onSetupPickBoardSquare?.(null)
        }
      } else if (pieceOnSq) {
        onSetupPickBoardSquare?.(sq)
      }
      return
    }
    if (!canPlay()) return
    if (picked && picked !== sq && commitMove(picked, sq)) return
    if (grabbable(sq)) setPicked((prev) => (prev === sq ? null : sq))
    else setPicked(null)
  }

  // ---- 指针：按下 / 移动 / 松开 -------------------------------------- //
  //
  // 落子有两条路，共用同一套坐标反查：
  //   拖   —— 按住子、挪过 5px 就进入拖拽，松手落在合法点就落子；
  //   点   —— 没挪动，当单击处理（选中／落子由 tapSquare 一处认）。
  // 之配置点击也画进指针事件里，是因为一个 <div> 上同时挂 onClick 和
  // pointerdown，拖拽结束时浏览器补的那次 click 会把同一步走两遍。

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (setupMode && e.button === 2) {
      const sq = squareAtPoint(e.clientX, e.clientY)
      if (sq) onSetupPieceRemove?.(sq)
      return
    }
    if (e.button !== 0) return
    setKbdOn(false) // 回到鼠标操作，键盘光标退场
    const sq = squareAtPoint(e.clientX, e.clientY)
    const canGrab = grabbable(sq)
    dragRef.current = {
      from: canGrab ? sq : null,
      sx: e.clientX,
      sy: e.clientY,
      id: e.pointerId,
      moved: false,
    }
    if (canGrab) {
      // 把后续的 pointermove/up 都收进棋盘，指针滑到盘外也不会丢事件
      e.currentTarget.setPointerCapture(e.pointerId)
    }
  }

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current
    if (!d || !d.from) return
    if (!d.moved) {
      if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 5) return
      d.moved = true
      // 一旦真的拖动起来就先把起点选中，可走点提前显形
      setPicked(d.from)
    }
    const { bx, by } = toBoardPixel(e.clientX, e.clientY)
    setDrag({ from: d.from, bx, by })
  }

  const endPointer = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current
    dragRef.current = null
    const wasDrag = d?.moved && d?.from
    const fromSq = d?.from
    setDrag(null)
    if (!d) return
    if (e.currentTarget.hasPointerCapture(d.id)) e.currentTarget.releasePointerCapture(d.id)
    const sq = squareAtPoint(e.clientX, e.clientY)
    if (wasDrag && fromSq) {
      if (setupMode) {
        if (sq && sq !== fromSq) {
          onSetupPieceMove?.(fromSq, sq)
        } else if (!sq) {
          onSetupPieceRemove?.(fromSq)
        }
        return
      }
      // 拖到哪落哪：不合法 commitMove 自己会落空，这里不必先问一遍 targets
      if (sq && sq !== fromSq) commitMove(fromSq, sq)
      return
    }
    if (sq) tapSquare(sq)
  }

  const cancelPointer = (e: React.PointerEvent<HTMLDivElement>) => {
    dragRef.current = null
    setDrag(null)
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
  }

  /** 拖拽时指针底下的那一格，用来把落点标记点亮 */
  const dragSquare = drag ? squareFromBoard(drag.bx, drag.by) : null

  // ---- 键盘：方向键移光标、回车选中/落子、Esc 取消 ---------------------- //
  //
  // 光标只在「棋盘拿到焦点且按过键盘」时显形，鼠标用户永远看不到它。
  // 上下左右说的是「视觉上」的方向，所以翻转视角后要跟着倒过来。

  const [cursor, setCursor] = useState<string | null>(null)
  const [kbdOn, setKbdOn] = useState(false)

  const initialCursor = (): string => {
    if (picked) return picked
    if (game.last_move) return game.last_move.to
    return flipped ? 'e9' : 'e0' // 执棋一方的将/帅门口
  }

  const moveCursor = (dFile: number, dRank: number) => {
    const { file, rank } = parseSquare(cursor ?? initialCursor())
    const f = Math.min(COLS - 1, Math.max(0, file + (flipped ? -dFile : dFile)))
    const r = Math.min(ROWS - 1, Math.max(0, rank + (flipped ? -dRank : dRank)))
    setCursor(squareAt(f, r))
    setKbdOn(true)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    switch (e.key) {
      case 'ArrowUp':
        e.preventDefault()
        moveCursor(0, 1)
        break
      case 'ArrowDown':
        e.preventDefault()
        moveCursor(0, -1)
        break
      case 'ArrowLeft':
        e.preventDefault()
        moveCursor(-1, 0)
        break
      case 'ArrowRight':
        e.preventDefault()
        moveCursor(1, 0)
        break
      case 'Enter':
      case ' ': {
        e.preventDefault()
        const sq = cursor ?? initialCursor()
        setCursor(sq)
        setKbdOn(true)
        tapSquare(sq)
        break
      }
      case 'Escape':
        setPicked(null)
        break
    }
  }

  /** 棋子按身份号排一遍再渲染。
   *
   *  **DOM 顺序必须与棋盘位置无关。** 服务端的 pieces 是按「先列后行」排的
   *  （见 engine/core.py 的 pieces_of），棋子一换格，它在数组里的下标就跟着变。
   *  React 对带 key 的子节点做重排用的是 insertBefore —— 对已经挂着的节点，
   *  那就是「先从父节点摘下来、再插回新位置」。而 Chrome 在这种**脱离/插回**时，
   *  会把该元素上正在跑的 CSS 过渡直接取消（transitioncancel）。
   *  于是落子那颗子的滑行**时有时无**：取决于 React 这一帧决定挪走它自己、
   *  还是挪它周围那一批。这个坑极难发现 —— 它跟时长、缓动、时长锁定都没关系，
   *  是 DOM 结构在动。
   *
   *  按 id 排就够了：id 在一局之内是稳定的，排序结果与棋子站在哪儿无关，
   *  节点顺序恒定，React 就永远不会去搬它们。 */
  const piecesInOrder = useMemo(
    () => [...activePieces].sort((a, b) => a.id - b.id),
    [activePieces],
  )

  return (
    <div className={`board ${thinking ? 'is-thinking' : ''} ${setupMode ? 'is-setup' : ''}`}>
      <div
        className={`board-surface ${drag ? 'is-dragging' : ''} ${flipping ? 'is-flipping' : ''}`}
        ref={surfaceRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerCancel={cancelPointer}
        onContextMenu={(e) => {
          if (setupMode) e.preventDefault()
        }}
        onKeyDown={onKeyDown}
        onFocus={() => setKbdOn(false)}
        tabIndex={0}
        role="application"
        aria-label="棋盘。方向键移动光标，回车选中或落子，Esc 取消选中。"
        /* 自检脚本跨的稳定契约。类名归样式所有、可以随时改名，所以断言一律
           读这些 data-*（以及 /api/state），不读 class。 */
        data-board=""
        data-flipped={flipped ? 'true' : 'false'}
        data-thinking={thinking ? 'true' : 'false'}
        /* 当前渲染的手数：脚本拿它跟服务端的 ply 比对，就知道界面追上来没有 */
        data-ply={game.ply}
        /* 正在拖的是哪一格（没在拖就不带这个属性） */
        {...(drag ? { 'data-dragging': drag.from } : {})}
      >
        <BoardArtwork />

        {/* 主变预览：引擎盘算的下一步，淡淡的，不抢戏 */}
        {!setupMode &&
          pvSquares.map((step, i) => {
            const a = toPercent(parseSquare(step.from).file, parseSquare(step.from).rank, flipped)
            const b = toPercent(parseSquare(step.to).file, parseSquare(step.to).rank, flipped)
            return (
              <div
                key={`${step.from}${step.to}${i}`}
                className="pv-trace"
                data-pv-trace=""
                style={{
                  left: `${a.x}%`,
                  top: `${a.y}%`,
                  width: `${Math.hypot(((b.x - a.x) / 100) * BOARD_W, ((b.y - a.y) / 100) * BOARD_H)}px`,
                  transform: `rotate(${Math.atan2(
                    ((b.y - a.y) / 100) * BOARD_H,
                    ((b.x - a.x) / 100) * BOARD_W,
                  )}rad)`,
                  opacity: 0.5 - i * 0.16,
                }}
              />
            )
          })}

        {/* 可走点位 */}
        {(dotsShown ? lastDots.current : []).map((d, i) => {
          const { file, rank } = parseSquare(d.sq)
          const { x, y } = toPercent(file, rank, flipped)
          return (
            <div
              key={`t${d.sq}`}
              className={[
                'target',
                d.capture ? 'target-capture' : '',
                dragSquare === d.sq ? 'is-over' : '',
                dotsLeaving ? 'is-leaving' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              /* --i：可走点出场的序号，CSS 拿它排 18ms 一档的波次 */
              style={{ left: `${x}%`, top: `${y}%`, '--i': i } as CSSProperties}
              data-target=""
              data-square={d.sq}
              data-over={dragSquare === d.sq ? 'true' : 'false'}
            />
          )
        })}

        {/* 键盘光标：只有按过方向键才出现，鼠标用户无感。
            位置跟棋子同一套（板面像素 + transform），所以连按方向键时
            它是滑过去而不是每格重排一次。 */}
        {kbdOn && cursor && (() => {
          const p = parseSquare(cursor)
          const { x, y } = toPixel(p.file, p.rank, flipped)
          return (
            <span
              className="kbd-cursor"
              data-kbd-cursor=""
              data-cursor={cursor}
              style={{ '--cx': `${x}px`, '--cy': `${y}px` } as CSSProperties}
            />
          )
        })()}

        {/* 移动轨迹（墨痕）：棋子走过后的渐隐笔锋，700ms 淡没 */}
        {game.last_move && (() => {
          const fromP = parseSquare(game.last_move.from)
          const toP = parseSquare(game.last_move.to)
          const a = toPercent(fromP.file, fromP.rank, flipped)
          const b = toPercent(toP.file, toP.rank, flipped)
          const dx = ((b.x - a.x) / 100) * BOARD_W
          const dy = ((b.y - a.y) / 100) * BOARD_H
          const len = Math.hypot(dx, dy)
          const angle = Math.atan2(dy, dx)
          // 刚走完那步的棋子颜色（turn 已经翻过了，所以反过来取）
          const moverSide = game.turn === 'red' ? 'black' : 'red'
          return (
            <div
              key={`trail-${game.ply}`}
              className={`move-trail move-trail-${moverSide}`}
              style={{
                left: `${a.x}%`,
                top: `${a.y}%`,
                width: `${len}px`,
                transform: `rotate(${angle}rad)`,
              }}
              aria-hidden="true"
            />
          )
        })()}

        {/* 选中棋子周围的清透月牙高光圆环（精准对齐图一） */}
        {crescentSq && (() => {
          const { file, rank } = parseSquare(crescentSq)
          const { x, y } = toPercent(file, rank, flipped)
          return (
            <span
              key={`selected-crescent-${crescentSq}`}
              className={`selected-crescent-ring${crescentLeaving ? ' is-leaving' : ''}`}
              style={{
                left: `${x}%`,
                top: `${y}%`,
              }}
              data-crescent=""
              aria-hidden="true"
            >
              <svg viewBox="0 0 100 100" className="crescent-svg" aria-hidden="true">
                <defs>
                  <linearGradient id="crescentGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#ffffff" stopOpacity="1" />
                    <stop offset="35%" stopColor="#ffffff" stopOpacity="0.85" />
                    <stop offset="70%" stopColor="#ffffff" stopOpacity="0.25" />
                    <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
                  </linearGradient>
                  <filter id="crescentGlow" x="-30%" y="-30%" width="160%" height="160%">
                    <feGaussianBlur stdDeviation="2.2" result="blur" />
                    <feMerge>
                      <feMergeNode in="blur" />
                      <feMergeNode in="SourceGraphic" />
                    </feMerge>
                  </filter>
                </defs>
                {/* 底部细圆环：定出中空轮廓，晶莹通透 */}
                <circle
                  cx="50"
                  cy="50"
                  r="43"
                  fill="none"
                  stroke="rgba(255, 255, 255, 0.35)"
                  strokeWidth="1.6"
                />
                {/* 顶部高亮月牙弧光：形成图一鲜明的顶光高光弧 */}
                <path
                  d="M 10 50 A 43 43 0 0 1 90 50"
                  fill="none"
                  stroke="url(#crescentGrad)"
                  strokeWidth="5"
                  strokeLinecap="round"
                  filter="url(#crescentGlow)"
                />
              </svg>
            </span>
          )
        })()}

        {/* 上一步的起点：一走就标，不必等落定 —— 它标的是「刚空出来的那一格」。 */}
        {!setupMode && game.last_move && (
          <span
            key={`from-${game.ply}-${game.last_move.from}`}
            className="last-marker last-from"
            style={{
              left: `${toPercent(parseSquare(game.last_move.from).file, parseSquare(game.last_move.from).rank, flipped).x}%`,
              top: `${toPercent(parseSquare(game.last_move.from).file, parseSquare(game.last_move.from).rank, flipped).y}%`,
            }}
          />
        )}

        {/* 落点框：**排在落点那一拍显形**（airborne 期间压住）。
            框比子先到，等于画面先宣布「这儿落了一颗子」，再回头看着它滑过来 ——
            它和涟漪、落子音、被撞飞的残影是同一拍上的事，不该各响各的。 */}
        {!setupMode && game.last_move && !airborne && (
          <span
            key={`to-${game.ply}-${game.last_move.to}`}
            className={`last-marker last-to last-to-${game.last_move.by}${
              game.last_move.captured ? ' last-to-capture' : ''
            }`}
            style={{
              left: `${toPercent(parseSquare(game.last_move.to).file, parseSquare(game.last_move.to).rank, flipped).x}%`,
              top: `${toPercent(parseSquare(game.last_move.to).file, parseSquare(game.last_move.to).rank, flipped).y}%`,
            }}
          >
            {/* 旋转交给 CSS：`.last-to-rotator` 上一条 transform 动画，整族弧环跟着转。
                原来这里是 SVG 的 <animateTransform>（8s 无限）配一个 feGaussianBlur ——
                SMIL 的旋转不走合成器，每一帧都重画一遍带高斯模糊的描边，而且从第一手
                棋起挂到终局，是整站最久的常驻开销。换成父元素的 transform 之后，弧环
                连同它的 drop-shadow 只栅格化一次，之后每帧只是把那张图转个角度。 */}
            <span className="last-to-rotator" aria-hidden="true">
              <svg className="last-to-spinner" viewBox="0 0 100 100" aria-hidden="true">
                <circle className="spinner-halo" cx="50" cy="50" r="43" />
                <circle className="spinner-arcs" cx="50" cy="50" r="43" />
              </svg>
            </span>
          </span>
        )}

        {/* 落点上那颗被吃子 —— 同一个位置、两段画面：
              替身（standIn）：服务端已经把它从 game.pieces 里摘掉，可滑行还没结束。
                由这一手的记录在**渲染期**现推一个顶着 —— 换成 effect 挂载就晚一帧，
                而那一帧画面上是「棋子还在半路、落点已经空了」。
              残影（knock）：落点那一拍起，它带着动量被撞飞，播完自己走。
            定位跟别的子同一套：只交板面像素给 --cx/--cy，不写 left/top。 */}
        {!setupMode &&
          (() => {
            const shown = knock ?? standIn
            if (!shown) return null
            const { file, rank } = parseSquare(shown.square)
            const from = parseSquare(shown.from)
            const { x, y } = toPixel(file, rank, flipped)
            const df = file - from.file
            const dr = rank - from.rank
            const dist = Math.hypot(df, dr) || 1
            return (
              <div
                key={`${knock ? 'knock' : 'stand'}-${shown.square}-${game.ply}`}
                className={`piece ${shown.side} ${knock ? 'piece-ghost-knockback' : 'is-doomed'}`}
                style={
                  {
                    '--cx': `${x}px`,
                    '--cy': `${y}px`,
                    // 屏幕坐标系：df 向右为正；dr 在非翻转下 rank 增加（向上）即 Y 变小
                    '--kx': df / dist,
                    '--ky': (flipped ? dr : -dr) / dist,
                    '--kr': `${'kr' in shown ? shown.kr : 0}deg`,
                  } as CSSProperties
                }
                aria-hidden="true"
              >
                <span className="piece-face">
                  <span className="piece-glyph">{shown.glyph}</span>
                </span>
              </div>
            )
          })()}
        {/* 棋子：纯净位移，其它棋子保持绝对静止。
            用 piecesInOrder 而不是 game.pieces —— 顺序必须是稳定的，原因见它上面那段。 */}
        {piecesInOrder.map((p) => {
          /* 被这一步吃掉的那颗子。**判据只能是「它是不是正在走的那一颗」，不能拿 side
             去跟 game.turn 比** —— 确认落地那一帧 turn 已经翻面了，走子那颗自己就满足
             「side ≠ 当前轮次」，于是连它一起被摘掉：同一颗子换了个 DOM 节点，跑到一半的
             transform 过渡当场作废，棋子直接出现在终点。整套「落子滑行」看不到，真凶就在
             这一行（.devtools/glide.mjs 文件头 (a) 记着这次翻车）。
             以前命中这条判据就直接 return null（让敌子在预判那一帧隐身），代价是这颗子
             在它**还该看得见**的整个滑行途中都不在画面上了 —— 滑行 210~360ms，而残影要到
             服务端确认才挂得上来，「被撞飞」发生在一颗两百多毫秒前就消失的子上。
             现在它留在盘上：压到走子那颗底下（.is-doomed）、点不到、颜色稍暗（死子不跟
             活子争），一路活到落点那一拍由替身接手（见上面 standIn 那段）。 */
          const doomed =
            !!pendingMove && p.id !== pendingMove.id && p.square === pendingMove.to

          const isDragging = drag?.from === p.square
          const effectiveSquare =
            pendingMove && p.id === pendingMove.id ? pendingMove.to : p.square
          const { file, rank } = parseSquare(effectiveSquare)
          /* 只交出一个「板面坐标系里的中心点」（板面 px）。换成真实像素是 CSS 的事：
             --u 就是「1 板面像素 = 多少 CSS 像素」。位移走 transform 才不碰布局 ——
             以前这里写的是 left/top 百分比，每滑一格都要重排一次（实测一次落子
             71 次布局 / 21.3ms，见 .devtools/frames.mjs）。 */
          const center = toPixel(file, rank, flipped)
          const cx = isDragging && drag ? drag.bx : center.x
          const cy = isDragging && drag ? drag.by : center.y
          /* 这一手要滑多久。没在滑的那一帧是 0ms —— 于是窗口缩放不会让棋子集体滑行。
             取的是渲染期锁好的那一份（见 glideRef），不在这里按 diff 现算：现算的话，
             服务端够快时「确认」会在同一帧里把时长改回 0，过渡根本起不来。 */
          const wait = glideRef.current.get(p.id) ?? 0

          /* 开场波次：从近端一行行向远端落（displayRow 0 = 最底行），
             行间 44ms、行内每颗 4ms —— 最后一颗的 delay 约 430ms，
             加上 CSS 里那 180ms 基础延迟与 340ms 落定，整段开场不到 1s。
             只在首渲染给值；booted 之后恒 0，重开 / 悔棋都不再编排。 */
          const displayRow = flipped ? rank : 9 - rank
          const enterDelay = bootedRef.current ? 0 : displayRow * 44 + file * 4

          const canGrab =
            setupMode || (!thinking && game.status.state === 'playing' && p.side === game.turn)

          return (
            <div
              key={p.id}
              className={[
                'piece',
                p.side,
                effectivePicked === p.square ? 'is-selected' : '',
                kingInCheck === p.square ? 'is-check' : '',
                alarmSquare === p.square ? 'is-check-alarm' : '',
                victorKing === p.square ? 'is-victor' : '',
                isDragging ? 'dragging' : '',
                canGrab ? 'is-grabbable' : '',
                doomed ? 'is-doomed' : '',
                // 正在滑的那一颗要盖过落点上的死子（两者同格，见 .is-doomed 那段）
                wait > 0 ? 'is-gliding' : '',
                impactId === p.id ? 'is-impact' : '',
                enterDelay > 0 || !bootedRef.current ? 'is-entering' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              style={
                {
                  '--cx': `${cx}px`,
                  '--cy': `${cy}px`,
                  '--glide-dur': `${wait}ms`,
                  '--enter-delay': `${enterDelay}ms`,
                } as CSSProperties
              }
              aria-label={`${p.side === 'red' ? '红' : '黑'}${p.glyph}于 ${effectiveSquare}`}
              data-piece={p.piece}
              data-side={p.side}
              data-square={effectiveSquare}
              data-selected={effectivePicked === p.square ? 'true' : 'false'}
              data-dragging={isDragging ? 'true' : 'false'}
            >
              {/* 这里以前挂着一个 `key={face-${p.id}-${effectiveSquare}}`：它唯一的
                  用途是「换格就重建这个 span」，好让挂在它上面的落子动画重播一次。
                  落子反馈已经改成由 Board 主动加 is-impact，这个 key 只剩成本，
                  所以撤掉 —— DOM 不再每走一手白重建一次。 */}
              <span className="piece-face">
                <span className="piece-glyph">{p.glyph}</span>
              </span>
            </div>
          )
        })}

        {/* 棋盘坐标：只在悬停时显形，平时不打扰 */}
        <div className="coord-layer">
          {Array.from({ length: 9 }).map((_, i) => {
            const f = flipped ? 8 - i : i
            const { x } = toPercent(f, 0, flipped)
            return (
              <span key={`f${f}`} className="coord coord-file" style={{ left: `${x}%` }}>
                {String.fromCharCode(97 + f)}
              </span>
            )
          })}
          {Array.from({ length: 10 }).map((_, i) => {
            const r = flipped ? 9 - i : i
            const { y } = toPercent(0, r, flipped)
            return (
              <span key={`r${r}`} className="coord coord-rank" style={{ top: `${y}%` }}>
                {r}
              </span>
            )
          })}
        </div>
      </div>
    </div>
  )
}

/** 棋盘线稿。纯 SVG，缩放到任何尺寸都不糊。 */
const BoardArtwork = memo(function BoardArtwork() {
  const verticals = Array.from({ length: 9 }, (_, i) => i)
  const horizontals = Array.from({ length: 10 }, (_, i) => i)
  const top = toPixel(0, 9, false).y
  const bottom = toPixel(0, 0, false).y
  const riverTop = toPixel(0, 5, false).y
  const riverBottom = toPixel(0, 4, false).y

  return (
    <svg
      className="board-svg"
      viewBox={`0 0 ${BOARD_W} ${BOARD_H}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <defs>
        {/* 板面底色：左上受光、右下渐深。
            x2 跟前文那盏灯取同一个角度 —— objectBoundingBox 里的 x2 是「相对板宽的
            比值」，而板宽 720、板高 800，所以 0.42 要换算成 0.42 × 800 / 720 ≈ 0.467。
            以前这里是 0.7（斜率 ≈ 0.63），跟板缘那道 boardSheen 不是一个角度。 */}
        <linearGradient id="boardFace" x1="0" y1="0" x2="0.467" y2="1">
          <stop offset="0%" stopColor="var(--board-face-1)" />
          <stop offset="52%" stopColor="var(--board-face-2)" />
          <stop offset="100%" stopColor="var(--board-face-3)" />
        </linearGradient>
        <radialGradient id="boardVignette" cx="50%" cy="42%" r="78%">
          <stop offset="60%" stopColor="rgba(255,255,255,0)" />
          <stop offset="100%" stopColor="var(--board-vignette)" />
        </radialGradient>
        {/* 上缘受光、下缘落影：让这块板看起来有厚度，不是一张贴纸。
            方向跟全站那盏灯一致（左上 → 右下），不是纯垂直。objectBoundingBox 里
            的 x2 是「相对板宽的比值」，而板宽 720、板高 800：要把 --light-x(0.42)
            换算到这套坐标里，得乘上 800 / 720 ≈ 0.467 —— 换算过来才是同一个角度。 */}
        <linearGradient id="boardSheen" x1="0" y1="0" x2="0.467" y2="1">
          <stop offset="0%" stopColor="rgba(255,252,244,0.6)" />
          <stop offset="13%" stopColor="rgba(255,252,244,0)" />
          <stop offset="84%" stopColor="rgba(74,52,22,0)" />
          <stop offset="100%" stopColor="rgba(74,52,22,0.18)" />
        </linearGradient>

        {/* 木纹两层：一层宽年轮带，一层细纤维。
            两条噪声都只在首帧算一次，之后浏览器缓存滤波结果；
            BoardArtwork 又用 memo 包住，轮询时的重渲染根本不会碰它。 */}
        <filter id="efWoodBand" x="0%" y="0%" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.0016 0.055" numOctaves="2" seed="7" />
          <feColorMatrix
            type="matrix"
            values="0 0 0 0 0.40
                    0 0 0 0 0.27
                    0 0 0 0 0.12
                    0 0 0 0.55 0"
          />
        </filter>
        <filter id="efWoodFibre" x="0%" y="0%" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.004 0.62" numOctaves="4" seed="23" />
          <feColorMatrix
            type="matrix"
            values="0 0 0 0 0.44
                    0 0 0 0 0.31
                    0 0 0 0 0.15
                    0 0 0 0.9 0"
          />
        </filter>
        {/* 木纹第三层：节疤 / 轮纹同心弧。type=turbulence 的团块被
            alpha 通道阈值化（0.9*(r+g+b)-0.9），只留下稀疏的暗弧，
            打破前两层的均匀噪声感。浓度压得很轻，只是「有方向」。 */}
        <filter id="efWoodKnot" x="0%" y="0%" width="100%" height="100%">
          <feTurbulence type="turbulence" baseFrequency="0.011 0.042" numOctaves="3" seed="41" />
          <feColorMatrix
            type="matrix"
            values="0 0 0 0 0.36
                    0 0 0 0 0.24
                    0 0 0 0 0.10
                    0.9 0.9 0.9 0 -0.95"
          />
        </filter>
      </defs>

      <rect x="0" y="0" width={BOARD_W} height={BOARD_H} rx="16" fill="url(#boardFace)" />
      <rect
        x="0"
        y="0"
        width={BOARD_W}
        height={BOARD_H}
        rx="16"
        filter="url(#efWoodBand)"
        style={{ mixBlendMode: 'multiply' }}
        opacity="0.5"
      />
      <rect
        x="0"
        y="0"
        width={BOARD_W}
        height={BOARD_H}
        rx="16"
        filter="url(#efWoodFibre)"
        style={{ mixBlendMode: 'multiply' }}
        opacity="0.34"
      />
      <rect
        x="0"
        y="0"
        width={BOARD_W}
        height={BOARD_H}
        rx="16"
        filter="url(#efWoodKnot)"
        style={{ mixBlendMode: 'multiply' }}
        opacity="0.2"
      />
      <rect x="0" y="0" width={BOARD_W} height={BOARD_H} rx="16" fill="url(#boardVignette)" />
      <rect x="0" y="0" width={BOARD_W} height={BOARD_H} rx="16" fill="url(#boardSheen)" />
      {/* 板边那道倒角 */}
      <rect
        x="1.25"
        y="1.25"
        width={BOARD_W - 2.5}
        height={BOARD_H - 2.5}
        rx="15"
        fill="none"
        stroke="rgba(109,80,40,0.45)"
        strokeWidth="1.5"
      />

      {/* 外框 */}
      <rect
        x={MARGIN - 22}
        y={MARGIN - 22}
        width={BOARD_W - (MARGIN - 22) * 2}
        height={BOARD_H - (MARGIN - 22) * 2}
        rx="6"
        fill="none"
        stroke="var(--board-line)"
        strokeWidth="3.5"
        opacity="0.85"
      />
      <rect
        x={MARGIN - 14}
        y={MARGIN - 14}
        width={BOARD_W - (MARGIN - 14) * 2}
        height={BOARD_H - (MARGIN - 14) * 2}
        rx="3"
        fill="none"
        stroke="var(--board-line)"
        strokeWidth="1"
        opacity="0.5"
      />

      <g stroke="var(--board-line)" strokeWidth="1.4" strokeLinecap="round">
        {horizontals.map((r) => (
          <line key={`h${r}`} x1={MARGIN} y1={toPixel(0, r, false).y} x2={BOARD_W - MARGIN} y2={toPixel(0, r, false).y} />
        ))}
        {verticals.map((f) => {
          const x = toPixel(f, 0, false).x
          if (f === 0 || f === 8) {
            return <line key={`v${f}`} x1={x} y1={top} x2={x} y2={bottom} />
          }
          return (
            <g key={`v${f}`}>
              <line x1={x} y1={top} x2={x} y2={riverTop} />
              <line x1={x} y1={riverBottom} x2={x} y2={bottom} />
            </g>
          )
        })}
      </g>

      {/* 九宫斜线 */}
      <g stroke="var(--board-line)" strokeWidth="1.2" opacity="0.75">
        {palaceDiagonals().map(([a, b], i) => (
          <line key={`d${i}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
        ))}
      </g>

      {/* 炮兵位角括号 */}
      <g stroke="var(--board-line)" strokeWidth="1.6" strokeLinecap="round" opacity="0.75" fill="none">
        {MARK_POINTS.map(({ file, rank }) => (
          <Marker key={`m${file}-${rank}`} file={file} rank={rank} />
        ))}
      </g>

      {/* 楚河汉界 */}
      <g className="river-text">
        {RIVER_LABELS.map((label, i) => {
          const step = (BOARD_W - MARGIN * 2) / (RIVER_LABELS.length + 1)
          const x = MARGIN + step * (i + 1)
          const y = (riverTop + riverBottom) / 2
          return (
            <text key={label} x={x} y={y} textAnchor="middle" dominantBaseline="central">
              {label}
            </text>
          )
        })}
      </g>
    </svg>
  )
})

function Marker({ file, rank }: { file: number; rank: number }) {
  const { x, y } = toPixel(file, rank, false)
  const gap = 7
  const len = 14
  const left = file > 0
  const right = file < 8
  const paths: string[] = []

  if (left) {
    paths.push(`M${x - gap} ${y - gap - len} L${x - gap} ${y - gap} L${x - gap - len} ${y - gap}`)
    paths.push(`M${x - gap} ${y + gap + len} L${x - gap} ${y + gap} L${x - gap - len} ${y + gap}`)
  }
  if (right) {
    paths.push(`M${x + gap} ${y - gap - len} L${x + gap} ${y - gap} L${x + gap + len} ${y - gap}`)
    paths.push(`M${x + gap} ${y + gap + len} L${x + gap} ${y + gap} L${x + gap + len} ${y + gap}`)
  }

  return (
    <>
      {paths.map((d, i) => (
        <path key={i} d={d} />
      ))}
    </>
  )
}
