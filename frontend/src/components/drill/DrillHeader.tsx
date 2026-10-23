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
 * 现代冷精密一体化遥测带 (Precision Light Telemetry Strip 42px)
 * 冷白与浅石板灰基调，极细线框，高科技与工整秩序感
 */
export const DrillHeader: React.FC<DrillHeaderProps> = ({
  summary,
  categories,
  puzzles,
  activeCategory,
  onSelectCategory,
  onFlip,
  onClose,
}) => {
  const [dropdownOpen, setDropdownOpen] = useState(false)

  const accuracy = summary?.first_try_accuracy ?? 0
  const totalMastered = summary?.mastered ?? 0
  const totalCount = Math.max(puzzles.length, 1)
  const masterProgress = Math.round((totalMastered / totalCount) * 100)

  const activeCategoryObj = categories.find((c) => c.id === activeCategory)
  const categoryTitle = activeCategoryObj
    ? activeCategoryObj.name.replace(/^第[一二三四五]篇\s*·\s*/, '')
    : '专项题库'

  return (
    <header className="relative flex items-center justify-between px-3 sm:px-4 h-[42px] bg-white/95 backdrop-blur-md border-b border-slate-200/90 text-slate-700 select-none font-mono text-xs z-30 shrink-0">
      {/* 1. 左侧：品牌与战术分类快速选择器 */}
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex items-center gap-2 shrink-0">
          <span className="w-5.5 h-5.5 rounded bg-red-600 text-white font-kai text-xs font-bold flex items-center justify-center shadow-xs">
            营
          </span>
          <span className="font-bold text-slate-900 tracking-tight hidden sm:inline-block font-sans">
            象棋实战特训营
          </span>
          <span className="text-[10px] tracking-wider text-red-600 bg-red-50 px-1.5 py-0.2 rounded border border-red-200 uppercase font-bold">
            PRO
          </span>
        </div>

        <div className="h-3.5 w-px bg-slate-200 hidden sm:block" />

        {/* 分类下拉切换器 (Precision Switcher) */}
        <div className="relative">
          <button
            type="button"
            className="h-7 px-2.5 rounded bg-slate-100 hover:bg-slate-200/80 border border-slate-200 text-slate-800 flex items-center gap-1.5 transition cursor-pointer text-xs font-sans font-medium"
            onClick={() => setDropdownOpen((v) => !v)}
            title="切换课程分类"
          >
            <span className="text-amber-500">❖</span>
            <span>{categoryTitle}</span>
            <span className="text-[9px] text-slate-400">▼</span>
          </button>

          {/* 下拉浮层 */}
          {dropdownOpen && (
            <div
              className="absolute left-0 top-8.5 w-60 bg-white border border-slate-200 rounded-lg shadow-xl p-1.5 flex flex-col gap-1 z-50 animate-fadeIn"
              onMouseLeave={() => setDropdownOpen(false)}
            >
              <div className="text-[10px] text-slate-400 px-2 py-1 font-mono uppercase border-b border-slate-100">
                SELECT CATEGORY
              </div>
              {categories.map((cat) => {
                const isSelected = cat.id === activeCategory
                const count = puzzles.filter((p) => p.category === cat.id).length
                return (
                  <button
                    key={cat.id}
                    type="button"
                    className={`px-2.5 py-1.5 rounded text-left text-xs transition cursor-pointer flex items-center justify-between font-sans ${
                      isSelected
                        ? 'bg-sky-50 text-sky-700 font-semibold border border-sky-200'
                        : 'text-slate-700 hover:bg-slate-50 hover:text-slate-900'
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
      </div>

      {/* 2. 中间：高科技微型遥测指标 (Micro Telemetry Indicators) */}
      <div className="hidden md:flex items-center gap-4 text-xs font-mono">
        <div className="flex items-center gap-1.5">
          <span className="text-slate-400">MASTERED:</span>
          <span className="text-emerald-600 font-bold">{totalMastered} / {totalCount}</span>
          <div className="w-14 h-1.5 bg-slate-100 rounded-full overflow-hidden border border-slate-200">
            <div
              className="h-full bg-emerald-500 rounded-full transition-all duration-300"
              style={{ width: `${masterProgress}%` }}
            />
          </div>
          <span className="text-slate-400 text-[10px]">({masterProgress}%)</span>
        </div>

        <div className="h-3.5 w-px bg-slate-200" />

        <div className="flex items-center gap-1.5">
          <span className="text-slate-400">FIRST-TRY ACC:</span>
          <span className="text-sky-600 font-bold">{accuracy}%</span>
        </div>
      </div>

      {/* 3. 右侧：翻转盘面与退出 (Controls) */}
      <div className="flex items-center gap-1.5 font-sans">
        <button
          type="button"
          className="h-7 px-2.5 text-xs rounded bg-slate-100 hover:bg-slate-200/80 text-slate-700 hover:text-slate-900 border border-slate-200 transition cursor-pointer flex items-center gap-1 active:scale-95"
          onClick={onFlip}
          title="翻转棋盘红黑视角"
        >
          <span>⇄</span>
          <span className="hidden sm:inline font-mono">翻转</span>
        </button>

        <button
          type="button"
          className="w-7 h-7 rounded bg-slate-100 hover:bg-rose-50 hover:text-rose-600 text-slate-500 border border-slate-200 hover:border-rose-200 transition cursor-pointer flex items-center justify-center text-xs active:scale-95"
          onClick={onClose}
          title="关闭特训营"
        >
          ✕
        </button>
      </div>
    </header>
  )
}
