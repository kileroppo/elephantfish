import type { GameSnapshot, MoveTactics, SandboxReply } from '../../types'

export interface ReplayTacticsCardProps {
  sandboxSnap: GameSnapshot | null
  sandboxInfo: SandboxReply | null
  tactics?: MoveTactics | null
}

export function ReplayTacticsCard({
  sandboxSnap,
  sandboxInfo,
  tactics,
}: ReplayTacticsCardProps) {
  if (sandboxSnap) {
    return (
      <div
        className="replay-sandbox-card my-1.5 p-2.5 sm:px-3 rounded-md bg-paper-1 border border-hairline-strong text-[12.5px] leading-relaxed text-ink-1"
        role="status"
      >
        <div className="replay-sandbox-head flex items-center justify-between gap-2 flex-wrap mb-1 text-xs">
          <span className="motif-chip is-sandbox inline-block font-semibold text-emerald-800 bg-emerald-100/70 border border-emerald-300 px-2 py-0.5 rounded text-[11px]">
            🔀 分支沙盒推演中（不改原谱）
          </span>
          {sandboxInfo?.user_move && (
            <span className="text-ink-2">
              试走 <b className="text-ink-0 font-semibold">{sandboxInfo.user_move.chinese}</b>
              {sandboxInfo.engine_reply
                ? ` → 引擎应以「${sandboxInfo.engine_reply.chinese}」`
                : ''}
            </span>
          )}
        </div>
        <p className="replay-sandbox-summary m-0 text-xs text-ink-2 leading-relaxed">
          {sandboxInfo?.tactics
            ? `【#${sandboxInfo.tactics.motif_label}】${sandboxInfo.tactics.coach_summary}`
            : '请在左侧棋盘上直接点选或拖拽棋子，测试如果你当时换一种走法会如何演变。'}
        </p>
      </div>
    )
  }

  if (tactics) {
    return (
      <div
        className={`replay-tactics-card is-${tactics.severity} my-1.5 p-2.5 sm:px-3 rounded-md bg-paper-1 border border-hairline-strong text-[12.5px] leading-relaxed text-ink-1 flex items-start gap-2 flex-wrap ${
          tactics.severity === 'critical' ? 'border-[var(--cinnabar-edge)] shadow-xs' : ''
        }`}
      >
        <span className="motif-chip inline-block font-semibold text-cinnabar bg-[var(--cinnabar-wash)] border border-[var(--cinnabar-edge)] px-2 py-0.5 rounded text-[11px]">
          #{tactics.motif_label}
        </span>
        <span className="replay-tactics-text text-xs text-ink-1 leading-relaxed">
          {tactics.coach_summary}
        </span>
      </div>
    )
  }

  return null
}
