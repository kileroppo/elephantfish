import React from 'react'
import type { PuzzleCategory, TrainingPuzzle, TrainingSummary } from '../../types'

export interface DrillHeaderProps {
  summary: TrainingSummary | null
  categories: PuzzleCategory[]
  puzzles: TrainingPuzzle[]
  activeCategory: string
  currentGameId?: string | null
  onSelectCategory: (categoryId: string) => void
  onSelectGame?: (gameId: string) => void
  onGoTodayTask: () => void
  onFlip: () => void
  onClose: () => void
}

export const DrillHeader: React.FC<DrillHeaderProps> = ({
  summary,
  categories,
  puzzles,
  activeCategory,
  currentGameId,
  onSelectCategory,
  onSelectGame,
  onFlip,
  onClose,
}) => {
  // 简短化分类名称（去除“第一篇·”等噪音）
  const getShortCatName = (name: string) => {
    return name.replace(/^第[一二三四五]篇\s*·\s*/, '')
  }

  return (
    <header className="flex flex-col border-b border-hairline/80 bg-paper-0/95 backdrop-blur-xl shrink-0 select-none">
      {/* 顶部主工具栏：左品牌与战报胶囊，右视角翻转与关闭 */}
      <div className="flex items-center justify-between px-4 sm:px-6 h-13">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex items-center gap-2.5 shrink-0">
            <span className="w-7 h-7 rounded-xl bg-gradient-to-br from-cinnabar to-[#c83726] text-white font-kai text-xs font-bold flex items-center justify-center shadow-xs">
              营
            </span>
            <h2 className="text-sm sm:text-base font-bold text-ink-0 m-0 whitespace-nowrap font-display tracking-wide">
              象棋实战特训营
            </h2>
          </div>

          {summary && (
            <span className="hidden md:inline-flex items-center gap-1.5 text-[11px] text-ink-2 bg-paper-1/80 px-3 py-1 rounded-full border border-hairline/80 whitespace-nowrap shadow-3xs">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <span>已掌握 <b className="text-ink-0 font-bold font-num">{summary.mastered}</b> 题</span>
              <span className="text-ink-4">·</span>
              <span>正确率 <b className="text-ink-0 font-bold font-num">{summary.first_try_accuracy}%</b></span>
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            className="h-7.5 px-3 rounded-xl text-xs font-semibold text-ink-2 hover:text-ink-0 bg-paper-1 hover:bg-paper-2 border border-hairline/80 transition cursor-pointer active:scale-95 shadow-3xs"
            onClick={onFlip}
            title="翻转棋盘视角 (快捷键 F)"
          >
            ⇄ 翻转
          </button>
          <button
            type="button"
            className="w-7.5 h-7.5 flex items-center justify-center text-ink-3 hover:text-ink-0 hover:bg-paper-2 rounded-full text-xs transition cursor-pointer active:scale-90 shadow-3xs border border-transparent hover:border-hairline"
            onClick={onClose}
            aria-label="退出训练营"
            title="返回下棋界面 (Esc)"
          >
            ✕
          </button>
        </div>
      </div>

      {/* 优雅单行分类分段控制器 (iOS Segmented Control 风格) */}
      <div className="flex items-center px-4 sm:px-6 pb-2.5 pt-0 overflow-x-auto scrollbar-none gap-2">
        <div className="flex items-center p-1 bg-paper-1/80 backdrop-blur-md rounded-2xl border border-hairline/80 shadow-2xs shrink-0">
          {categories.map((cat) => {
            const count = puzzles.filter((p) => p.category === cat.id).length
            const isCurrent = activeCategory === cat.id
            return (
              <button
                key={cat.id}
                type="button"
                className={`flex items-center gap-1.5 px-3 py-1 rounded-xl text-xs font-medium whitespace-nowrap transition-all duration-200 cursor-pointer border-0 ${
                  isCurrent
                    ? 'bg-paper-0 text-cinnabar font-bold shadow-xs'
                    : 'bg-transparent text-ink-3 hover:text-ink-1'
                }`}
                onClick={() => onSelectCategory(cat.id)}
              >
                <span>{cat.icon}</span>
                <span>{getShortCatName(cat.name)}</span>
                <span className="text-[10.5px] opacity-60 font-num tabular-nums">({count})</span>
              </button>
            )
          })}
        </div>

        {activeCategory === 'game_breakdown' && currentGameId && (
          <span
            className={`text-[11px] px-3 py-1 rounded-xl bg-paper-1/80 border border-hairline text-ink-2 font-medium shrink-0 ml-auto shadow-3xs ${
              onSelectGame ? 'cursor-pointer hover:bg-paper-2' : ''
            }`}
            onClick={() => onSelectGame?.(currentGameId)}
            title="点击刷新当前对局拆解"
          >
            本局拆解：{currentGameId.slice(0, 10)}…
          </span>
        )}
      </div>
    </header>
  )
}
