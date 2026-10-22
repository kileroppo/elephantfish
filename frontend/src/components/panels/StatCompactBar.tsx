import { compactNumber, seconds } from '../../lib/format'
import type { SearchProgress } from '../../types'

export interface StatCompactBarProps {
  progress?: SearchProgress | null
  depth: number
  rawTime?: number | null
}

export function StatCompactBar({ progress, depth, rawTime }: StatCompactBarProps) {
  const depthStat = {
    v: depth ? `${depth}` : '—',
    u: depth ? '层' : '',
  }
  const nodesStat = {
    v: compactNumber(progress?.nodes),
    u: '节点',
  }
  const timeStat = {
    v: seconds(rawTime ?? progress?.time),
    u: '',
  }
  const npsStat = {
    v: progress?.nps ? compactNumber(progress.nps) : '—',
    u: progress?.nps ? '/s' : '',
  }

  return (
    <div
      className="stat-compact-bar flex items-center justify-around py-1.5 px-2 rounded bg-paper-2/60 border border-hairline/80 text-xs font-num text-ink-2 tabular-nums"
      data-stat-grid=""
      aria-label="引擎指标"
    >
      <span className="stat-compact-item flex items-baseline gap-0.5" data-stat="depth" title="引擎搜索深度">
        <strong className="num font-semibold text-ink-0 text-[12px]">{depthStat.v}</strong>
        <small className="text-[10px] text-ink-mute">{depthStat.u || '层'}</small>
      </span>

      <span className="stat-compact-sep text-ink-4 select-none">·</span>

      <span className="stat-compact-item flex items-baseline gap-0.5" data-stat="nodes" title="搜索节点数">
        <strong className="num font-semibold text-ink-0 text-[12px]">{nodesStat.v}</strong>
        <small className="text-[10px] text-ink-mute">节点</small>
      </span>

      <span className="stat-compact-sep text-ink-4 select-none">·</span>

      <span className="stat-compact-item flex items-baseline gap-0.5" data-stat="time" title="思考耗时">
        <strong className="num font-semibold text-ink-0 text-[12px]">{timeStat.v}</strong>
        <small className="text-[10px] text-ink-mute">{timeStat.u}</small>
      </span>

      <span className="stat-compact-sep text-ink-4 select-none">·</span>

      <span className="stat-compact-item flex items-baseline gap-0.5" data-stat="nps" title="每秒搜索算速">
        <strong className="num font-semibold text-ink-0 text-[12px]">{npsStat.v}</strong>
        <small className="text-[10px] text-ink-mute">{npsStat.u}</small>
      </span>
    </div>
  )
}
