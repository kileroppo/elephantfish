interface StageHeadProps {
  turn: 'red' | 'black'
  turnText: string
  isPlaying: boolean
  isEngineTurn: boolean
  inCheck: boolean
  setupActive: boolean
  ply?: number
  onPillClick?: () => void
}

export function StageHead({
  turn,
  turnText,
  isPlaying,
  isEngineTurn,
  inCheck,
  setupActive,
  ply,
  onPillClick,
}: StageHeadProps) {
  const roundNo = ply !== undefined ? Math.floor(ply / 2) + 1 : 1

  return (
    <div className="stage-head flex items-center justify-center gap-2 h-8 mb-1 select-none shrink-0">
      {/* data-turn-badge：.devtools/audit.mjs「回合条净空」一节量的就是它
          （药丸是否溢出行、棋盘垫是否探进药丸），README 的定位契约表里有它。
          turn-badge：绑定 stage-header.css 的定宽防抖与 discPop 脉搏。 */}
      <span
        data-turn-badge
        onClick={onPillClick}
        title={onPillClick ? '点击展开录入栏（快捷键 /）' : undefined}
        className={`turn-badge side-${turn}${isEngineTurn ? ' is-engine' : ''}${
          !isPlaying ? ' is-over' : ''
        }${onPillClick ? ' is-clickable' : ''}`}
      >
        {/* key=turn：每易手一次圆点重新挂载，discPop 重播一次 ——
            「轮到你了」不靠颜色突变，靠这一下脉搏（stage-header.css） */}
        <span
          key={`disc-${turn}`}
          className={`turn-disc${isEngineTurn ? ' is-live' : ''}`}
          aria-hidden="true"
        />

        {!setupActive && isPlaying && (
          <span className="turn-round">第 {roundNo} 回合</span>
        )}

        <span className="turn-text">{turnText}</span>

        {/* 易手时一道极轻的纸面反光扫过药丸（只动 transform/opacity）。
            key=turn：每易手重播一次。 */}
        <span key={`glare-${turn}`} className="turn-glare" aria-hidden="true" />
      </span>

      {inCheck && isPlaying && !setupActive && (
        <span key={`chk-${ply}`} className="check-flag">
          将军！
        </span>
      )}
    </div>
  )
}
