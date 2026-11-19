/**
 * 排局台键盘过场登记表
 * --------------------------------------------------------------------------
 * 排局台里 Esc 的职责是有层次的（F4 修复）：
 *   1. 本地浮层开着（FEN 弹窗 / 残局下拉 / 异常气泡）→ 收拢最上面那层；
 *   2. 有选中（托盘棋子 / 盘上格子）→ 清选择；
 *   3. 什么都没有 → 退出排局。
 *
 * 第 1 层没法由 SetupStudio 单方面判断 —— 浮层的开合状态住在各自的组件里。
 * 于是浮层打开时往这里登记一个「Esc 来了就关我」的回调，SetupStudio 的
 * 捕获相 handler 只问最上面那位。关一个消一个登记，栈空时 Esc 顺延到下一层。
 *
 * 为什么值得单独一个模块：SetupStudio 与三个浮层组件互相 import 会成环，
 * 登记表是它们之间唯一的共享信道，也顺带成了「排局台有几个浮层开着」的单一事实源。
 */

type EscConsumer = () => void

const escConsumers: EscConsumer[] = []

/** 登记一个 Esc 消费者；返回的注销函数进 useEffect 的清理即可 */
export function registerEscConsumer(consume: EscConsumer): () => void {
  escConsumers.push(consume)
  return () => {
    const idx = escConsumers.indexOf(consume)
    if (idx >= 0) escConsumers.splice(idx, 1)
  }
}

/** 有浮层在就关掉最上面那个并返回 true；没有则返回 false（Esc 顺延） */
export function consumeEsc(): boolean {
  const top = escConsumers[escConsumers.length - 1]
  if (!top) return false
  top()
  return true
}
