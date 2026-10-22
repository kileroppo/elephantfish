import { memo } from 'react'
import { BOARD_H, BOARD_W, type CurveTrajectory } from '../../lib/board'
import type { Side } from '../../types'

interface BoardSvgLayerProps {
  setupMode: boolean
  pvArcs: CurveTrajectory[]
  lastMoveArc: (CurveTrajectory & { moverSide: Side }) | null
  ply: number
}

/** 棋盘走子直线/曲线轨迹层与 PV 引擎主变预测分支线 */
export const BoardSvgLayer = memo(function BoardSvgLayer({
  setupMode,
  pvArcs,
  lastMoveArc,
  ply,
}: BoardSvgLayerProps) {
  return (
    <svg
      className="board-trajectories-layer absolute inset-0 w-full h-full pointer-events-none z-[13]"
      viewBox={`0 0 ${BOARD_W} ${BOARD_H}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="moveLineGradRed" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#c8382e" stopOpacity="0.4" />
          <stop offset="60%" stopColor="#d84236" stopOpacity="0.85" />
          <stop offset="100%" stopColor="#e84a3c" stopOpacity="0.95" />
        </linearGradient>
        <linearGradient id="moveLineGradBlack" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#66584d" stopOpacity="0.35" />
          <stop offset="60%" stopColor="#3c3026" stopOpacity="0.82" />
          <stop offset="100%" stopColor="#1a140e" stopOpacity="0.95" />
        </linearGradient>
        <linearGradient id="pvLineGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#c8382e" stopOpacity="0.25" />
          <stop offset="100%" stopColor="#c8382e" stopOpacity="0.65" />
        </linearGradient>
      </defs>

      {/* PV 预测分支（虚线直线） */}
      {!setupMode &&
        pvArcs.map((arc, i) => (
          <g
            key={`pv-${i}`}
            className="pv-arc-group animate-[fadeIn_300ms_cubic-bezier(0.22,0.61,0.36,1)_both]"
            opacity={0.6 - i * 0.16}
          >
            <path
              d={arc.pathD}
              fill="none"
              stroke="url(#pvLineGrad)"
              strokeWidth="2.2"
              strokeDasharray="4 4"
              strokeLinecap="round"
            />
            <circle cx={arc.startPt.x} cy={arc.startPt.y} r="2.8" fill="#c8382e" opacity="0.6" />
            <polygon points={arc.arrowPoints} fill="#c8382e" opacity="0.75" />
          </g>
        ))}

      {/* 最近一步行棋轨迹（走完消失） */}
      {!setupMode && lastMoveArc && (
        <g
          key={`last-line-${ply}`}
          className={`move-line-group is-${lastMoveArc.moverSide}`}
        >
          {/* 主轨迹直线（仅在起点与落点之间） */}
          <path
            d={lastMoveArc.pathD}
            className="move-line-path"
            fill="none"
            stroke={lastMoveArc.moverSide === 'red' ? 'url(#moveLineGradRed)' : 'url(#moveLineGradBlack)'}
            strokeWidth="2.6"
            strokeLinecap="round"
          />
          {/* 起点精致锚点珠 */}
          <circle
            cx={lastMoveArc.startPt.x}
            cy={lastMoveArc.startPt.y}
            r="3"
            fill={lastMoveArc.moverSide === 'red' ? '#c8382e' : '#28201a'}
          />
          {/* 落点方向指引箭头 */}
          <polygon
            points={lastMoveArc.arrowPoints}
            fill={lastMoveArc.moverSide === 'red' ? '#e84a3c' : '#18120c'}
          />
        </g>
      )}
    </svg>
  )
})
