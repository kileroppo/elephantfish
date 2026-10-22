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
  onGoTodayTask,
  onFlip,
  onClose,
}) => {
  return (
    <>
      {/* 顶部标题栏 */}
      <header className="flex items-center justify-between px-5 py-3 border-b border-hairline bg-paper-1 shrink-0">
        <div className="flex items-center gap-2.5 flex-wrap">
          <span className="inline-block px-2 py-0.5 bg-cinnabar text-white rounded text-[11px] font-bold tracking-wider select-none">
            实战训练营
          </span>
          <h2 className="text-base font-bold text-ink-0 m-0">象棋优劣势推演 · 算路实验室</h2>
          {summary && (
            <span className="text-xs text-ink-2 bg-ink-0/5 px-2.5 py-0.5 rounded-full border border-hairline">
              已掌握 {summary.mastered} 题 · 一次走对率 {summary.first_try_accuracy}%
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="px-2.5 py-1 text-xs font-medium text-ink-2 hover:text-ink-0 bg-transparent hover:bg-black/5 rounded border border-hairline transition-colors cursor-pointer"
            onClick={onFlip}
            title="翻转棋盘视角 (F)"
          >
            ⇄ 翻转棋盘
          </button>
          <button
            type="button"
            className="w-7 h-7 flex items-center justify-center text-ink-3 hover:text-ink-0 hover:bg-black/5 rounded-full text-base transition-colors cursor-pointer"
            onClick={onClose}
            aria-label="退出训练营"
            title="返回下棋界面 (Esc)"
          >
            ✕
          </button>
        </div>
      </header>

      {/* 顶部薄弱项建议横幅 */}
      {summary?.diagnosis && (
        <aside
          className="flex items-center justify-between gap-3 px-5 py-2 bg-gradient-to-r from-cinnabar/10 via-amber-500/10 to-transparent border-b border-hairline text-xs shrink-0 flex-wrap"
          aria-label="练棋建议"
        >
          <div className="flex items-center gap-2">
            <span className="font-bold text-cinnabar whitespace-nowrap">💡 练棋建议</span>
            <span className="text-ink-1 italic">{summary.diagnosis}</span>
          </div>
          <button
            type="button"
            className="px-2.5 py-1 rounded bg-cinnabar hover:bg-cinnabar-bright text-white text-[11px] font-semibold transition-colors shrink-0 shadow-xs cursor-pointer"
            onClick={onGoTodayTask}
          >
            开始推荐练习
          </button>
        </aside>
      )}

      {/* 专题分类导航条 */}
      <nav className="flex items-center gap-2 px-5 py-2 bg-paper-2 border-b border-hairline overflow-x-auto shrink-0 scrollbar-none" aria-label="题库分类">
        {categories.map((cat) => {
          const count = puzzles.filter((p) => p.category === cat.id).length
          const isCurrent = activeCategory === cat.id
          return (
            <button
              key={cat.id}
              type="button"
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-all border cursor-pointer ${
                isCurrent
                  ? 'bg-paper-0 text-cinnabar font-bold shadow-xs border-hairline'
                  : 'text-ink-2 hover:bg-black/5 hover:text-ink-0 border-transparent'
              }`}
              onClick={() => onSelectCategory(cat.id)}
            >
              <span>{cat.icon}</span>
              <span>{cat.name}</span>
              <span className="text-[11px] opacity-70">({count})</span>
            </button>
          )
        })}

        {activeCategory === 'game_breakdown' && currentGameId && (
          <span
            className={`text-[11px] px-2 py-0.5 rounded bg-blue-100 text-blue-900 border border-blue-300 font-semibold shrink-0 ml-auto ${
              onSelectGame ? 'cursor-pointer hover:bg-blue-200' : ''
            }`}
            onClick={() => onSelectGame?.(currentGameId)}
            title="点击刷新当前对局拆解"
          >
            当前拆解对局：{currentGameId}
          </span>
        )}
      </nav>
    </>
  )
}
