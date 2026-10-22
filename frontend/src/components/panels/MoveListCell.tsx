import type { MoveRecord } from '../../types'
import { gradeDetail, gradeLabel, scoreText } from '../../lib/format'
import { useUIContext } from '../../context/UIContext'
import { api } from '../../api'

export interface MoveListCellProps {
  rec: MoveRecord | null
  isLast: boolean
  gameId?: string
}

function getToneClasses(tone: string): string {
  switch (tone) {
    case 'good':
      return 'bg-emerald-50 text-emerald-800 border-emerald-300/80'
    case 'soft':
      return 'bg-amber-50 text-amber-800 border-amber-300/80'
    case 'warn':
      return 'bg-orange-50 text-orange-800 border-orange-300/80'
    case 'bad':
    case 'mate':
      return 'bg-rose-50 text-rose-800 border-rose-400 font-semibold shadow-xs'
    default:
      return 'bg-paper-2 text-ink-mute border-hairline'
  }
}

export function MoveListCell({ rec, isLast, gameId }: MoveListCellProps) {
  const ui = useUIContext()

  if (!rec) {
    return <span className="move-placeholder inline-block w-full h-4" />
  }

  // 判分只给人的步。引擎那一步的分是它自己搜出来的，旁边再挂一枚「第 2 名」
  // 只会把更可信的读数盖掉，所以引擎行留空
  const grade = rec.by === 'engine' ? null : gradeLabel(rec.review)
  const isRed = rec.side === 'red'

  return (
    <span
      className={`move-cell by-${rec.by} side-${rec.side} ${isLast ? 'is-last' : ''} group relative flex items-baseline flex-wrap gap-1.5 px-2 py-1 rounded transition-colors text-[12.5px] cursor-pointer ${
        isLast
          ? 'bg-cinnabar/10 text-cinnabar ring-1 ring-cinnabar/30 font-medium'
          : 'hover:bg-paper-2/70 text-ink-1'
      }`}
      title="悬停预览落子位置 · 点击进入复盘台查看此手"
      onMouseEnter={() => {
        ui.handlePreviewBoard(null, [rec.iccs], null)
      }}
      onMouseLeave={() => {
        ui.handlePreviewBoard(null, [], null)
      }}
      onClick={async () => {
        if (gameId) {
          ui.openReplayAt(gameId, rec.ply)
        } else {
          try {
            const res = await api.games(1)
            if (res.games && res.games.length > 0) {
              ui.openReplayAt(res.games[0].game_id, rec.ply)
            }
          } catch {
            // ignore
          }
        }
      }}
    >
      <span
        className={`move-glyph font-kai font-bold text-[13px] leading-none ${
          isRed ? 'text-piece-red' : 'text-piece-black'
        }`}
      >
        {rec.glyph}
      </span>
      <span className="move-cn font-medium tracking-tight">{rec.chinese}</span>

      <span className="move-tags inline-flex items-center gap-1">
        {rec.captured_glyph && (
          <em className="tag tag-capture not-italic px-1 py-0.2 rounded text-[10px] font-medium bg-amber-100/80 text-amber-900 border border-amber-300/60 leading-tight">
            吃{rec.captured_glyph}
          </em>
        )}
        {rec.check && (
          <em className="tag tag-check not-italic px-1 py-0.2 rounded text-[10px] font-medium bg-rose-100 text-rose-800 border border-rose-300/70 leading-tight">
            将
          </em>
        )}
        {rec.mate && (
          <em className="tag tag-mate not-italic px-1 py-0.2 rounded text-[10px] font-medium bg-cinnabar text-white leading-tight">
            杀
          </em>
        )}
      </span>

      {grade ? (
        <em
          key={`g${grade.text}`}
          className={`grade-chip tone-${grade.tone} not-italic px-1.5 py-0.5 rounded text-[10.5px] border leading-none transition-all ${getToneClasses(
            grade.tone,
          )}`}
          title={gradeDetail(rec.review)}
        >
          {grade.text}
        </em>
      ) : (
        rec.by === 'opponent' && (
          <em
            className="grade-chip tone-mute not-italic px-1.5 py-0.5 rounded text-[10px] bg-paper-2 text-ink-mute border border-hairline leading-none"
            title="轮到你的时候引擎才在空档里算前几名；关掉判分、引擎正忙、或这一步还在搜索里时都不会有判分"
          >
            未判分
          </em>
        )
      )}

      {rec.eval !== null && rec.by === 'engine' && (
        <span
          className="move-eval ml-auto font-num text-[11px] text-ink-3 tabular-nums"
          title={
            rec.mate_in !== null && rec.mate_in !== undefined
              ? '引擎算到这一步已经是杀棋'
              : '引擎落这一手时的评估，一个兵算 1.0'
          }
        >
          {scoreText(rec.eval, rec.mate_in ?? null)}
        </span>
      )}
    </span>
  )
}
