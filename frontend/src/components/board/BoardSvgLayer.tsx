import { memo } from 'react'
import { BOARD_H, BOARD_W, parseSquare, toPixel, type CurveTrajectory } from '../../lib/board'
import type { ValidationResult } from '../../lib/setup'
import type { Side } from '../../types'

interface BoardSvgLayerProps {
  setupMode: boolean
  pvArcs: CurveTrajectory[]
  lastMoveArc: (CurveTrajectory & { moverSide: Side }) | null
  ply: number
  setupValidation?: ValidationResult | null
  flipped?: boolean
}

/** 棋盘走子直线/曲线轨迹层与 PV 引擎主变预测分支线及排局就地诊断 */
export const BoardSvgLayer = memo(function BoardSvgLayer({
  setupMode,
  pvArcs,
  lastMoveArc,
  ply,
  setupValidation,
  flipped = false,
}: BoardSvgLayerProps) {
  // 将帅照面激光束坐标
  let laserLine: { x1: number; y1: number; x2: number; y2: number } | null = null
  if (
    setupMode &&
    setupValidation?.facingKings &&
    setupValidation.redKingSq &&
    setupValidation.blackKingSq
  ) {
    const p1 = parseSquare(setupValidation.redKingSq)
    const p2 = parseSquare(setupValidation.blackKingSq)
    const pt1 = toPixel(p1.file, p1.rank, flipped)
    const pt2 = toPixel(p2.file, p2.rank, flipped)
    laserLine = { x1: pt1.x, y1: pt1.y, x2: pt2.x, y2: pt2.y }
  }

  // 缺帅九宫中心点
  const redPalacePt = setupMode && setupValidation?.missingRedKing ? toPixel(4, 0, flipped) : null
  const blackPalacePt = setupMode && setupValidation?.missingBlackKing ? toPixel(4, 9, flipped) : null

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
        <linearGradient id="laserGrad" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#ef4444" stopOpacity="0.9" />
          <stop offset="50%" stopColor="#f87171" stopOpacity="1" />
          <stop offset="100%" stopColor="#ef4444" stopOpacity="0.9" />
        </linearGradient>
        <filter id="laserGlow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feComposite in="SourceGraphic" in2="blur" operator="over" />
        </filter>
      </defs>

      {/* 排局就地诊断 1：王不见王（将帅照面）激光警戒束 */}
      {setupMode && laserLine && (
        <g className="laser-facing-group">
          {/* 外晕激光束 */}
          <line
            x1={laserLine.x1}
            y1={laserLine.y1}
            x2={laserLine.x2}
            y2={laserLine.y2}
            stroke="#ef4444"
            strokeWidth="5"
            strokeOpacity="0.4"
            filter="url(#laserGlow)"
            strokeDasharray="6 4"
            className="animate-[pulse_1s_cubic-bezier(0.4,0,0.6,1)_infinite]"
          />
          {/* 核心强光细线 */}
          <line
            x1={laserLine.x1}
            y1={laserLine.y1}
            x2={laserLine.x2}
            y2={laserLine.y2}
            stroke="#ffffff"
            strokeWidth="2"
            strokeOpacity="0.95"
            strokeDasharray="8 6"
          />
        </g>
      )}

      {/* 排局就地诊断 2：缺少红帅九宫信标 */}
      {setupMode && redPalacePt && (
        <g className="beacon-missing-king red animate-[pulse_1.6s_ease-in-out_infinite]">
          <circle
            cx={redPalacePt.x}
            cy={redPalacePt.y}
            r="26"
            fill="none"
            stroke="#ef4444"
            strokeWidth="2"
            strokeDasharray="4 4"
            strokeOpacity="0.6"
          />
          <circle cx={redPalacePt.x} cy={redPalacePt.y} r="4" fill="#ef4444" fillOpacity="0.8" />
        </g>
      )}

      {/* 排局就地诊断 3：缺少黑将九宫信标 */}
      {setupMode && blackPalacePt && (
        <g className="beacon-missing-king black animate-[pulse_1.6s_ease-in-out_infinite]">
          <circle
            cx={blackPalacePt.x}
            cy={blackPalacePt.y}
            r="26"
            fill="none"
            stroke="#475569"
            strokeWidth="2"
            strokeDasharray="4 4"
            strokeOpacity="0.6"
          />
          <circle cx={blackPalacePt.x} cy={blackPalacePt.y} r="4" fill="#334155" fillOpacity="0.8" />
        </g>
      )}

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
