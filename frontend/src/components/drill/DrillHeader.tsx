import React, { useState } from 'react'
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

/**
 * 特斯拉极简状态条 (Ultra-Slim Tesla Header - 32px)
 * 极致纯净、干掉所有大徽标与宣传废话，只保留高维元数据
 */
export const DrillHeader: React.FC<DrillHeaderProps> = ({
  categories,
  puzzles,
  activeCategory,
  onSelectCategory,
  onFlip,
  onClose,
}) => {
  const [dropdownOpen, setDropdownOpen] = useState(false)

  const activeCategoryObj = categories.find((c) => c.id === activeCategory)
  const categoryTitle = activeCategoryObj
    ? activeCategoryObj.name.replace(/^第[一二三四五]篇\s*·\s*/, '')
    : '专项特训'

  return (
    <header className="relative flex items-center justify-between px-3 h-8 bg-white border-b border-slate-100 text-slate-700 select-none font-mono text-xs z-30 shrink-0">
      {/* 1. 左侧：极简战术分类选择器 */}
      <div className="relative flex items-center">
        <button
          type="button"
          className="h-6 px-2 rounded hover:bg-slate-50 text-slate-800 flex items-center gap-1.5 transition cursor-pointer text-xs font-sans font-semibold border-0 bg-transparent"
          onClick={() => setDropdownOpen((v) => !v)}
          title="切换课程分类"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-red-600 shrink-0" />
          <span>{categoryTitle}</span>
          <span className="text-[8px] text-slate-400">▼</span>
        </button>

        {dropdownOpen && (
          <div
            className="absolute left-0 top-7 w-56 bg-white border border-slate-200 rounded-lg shadow-xl p-1.5 flex flex-col gap-0.5 z-50 animate-fadeIn"
            onMouseLeave={() => setDropdownOpen(false)}
          >
            {categories.map((cat) => {
              const isSelected = cat.id === activeCategory
              const count = puzzles.filter((p) => p.category === cat.id).length
              return (
                <button
                  key={cat.id}
                  type="button"
                  className={`px-2 py-1 rounded text-left text-xs transition cursor-pointer flex items-center justify-between font-sans ${
                    isSelected
                      ? 'bg-slate-100 text-slate-900 font-bold'
                      : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                  }`}
                  onClick={() => {
                    onSelectCategory(cat.id)
                    setDropdownOpen(false)
                  }}
                >
                  <span>{cat.name.replace(/^第[一二三四五]篇\s*·\s*/, '')}</span>
                  {count > 0 && (
                    <span className="text-[10px] font-mono text-slate-400">
                      {count} 题
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* 2. 中间：极简状态 */}
      <div className="text-[11px] font-mono text-slate-400 tracking-wider">
        CHAMBER TELEMETRY
      </div>

      {/* 3. 右侧：翻转与退出 */}
      <div className="flex items-center gap-1">
        <button
          type="button"
          className="h-6 px-2 text-xs rounded hover:bg-slate-100 text-slate-500 hover:text-slate-800 transition cursor-pointer flex items-center gap-1 border-0 bg-transparent"
          onClick={onFlip}
          title="翻转棋盘"
        >
          <span>⇄</span>
          <span className="text-[11px]">翻转</span>
        </button>

        <button
          type="button"
          className="w-6 h-6 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-700 transition cursor-pointer flex items-center justify-center text-xs border-0 bg-transparent"
          onClick={onClose}
          title="关闭"
        >
          ✕
        </button>
      </div>
    </header>
  )
}
