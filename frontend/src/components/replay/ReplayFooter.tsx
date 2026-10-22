import type { ReplayReply } from '../../types'
import { sideName } from '../../lib/format'

export interface ReplayFooterProps {
  summary?: ReplayReply['summary']
  head?: ReplayReply['game']
  emptyPlies: boolean
}

export function ReplayFooter({ summary, head, emptyPlies }: ReplayFooterProps) {
  return (
    <>
      {summary && (
        <p className="replay-foot shrink-0 m-0 pt-2 border-t border-dashed border-hairline text-[10.5px] leading-relaxed text-ink-3">
          这一局 {summary.plies} 手，其中 {summary.graded_plies} 手带着判分。
          {summary.unreadable > 0 ? ` 另有 ${summary.unreadable} 手的判分读不动。` : ''}
          {head?.state && head.state !== 'playing'
            ? ` 结局：${head.reason || head.state}${head.winner ? `（${sideName(head.winner)}胜）` : ''}。`
            : ''}
        </p>
      )}
      {emptyPlies && (
        <p className="hint replay-hint text-xs text-ink-3 mt-1.5">
          这一局存档里一步都没走 —— 只能看开局那个局面。
        </p>
      )}
    </>
  )
}
