import React, { useEffect, useRef, useState } from 'react'
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
 * 特训营状态条（32px）
 * 纸墨体系：只保留高维元数据 —— 分类选择器、真实掌握进度、翻转与退出。
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
  const dropdownRef = useRef<HTMLDivElement>(null)

  // 下拉：点击外部 / Esc 关闭（Esc 在此消费，不再冒泡到特训营的退出逻辑）
  useEffect(() => {
    if (!dropdownOpen) return
    const onDocMouseDown = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false)
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        setDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocMouseDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [dropdownOpen])

  const activeCategoryObj = categories.find((c) => c.id === activeCategory)
  const categoryTitle = activeCategoryObj
    ? activeCategoryObj.name.replace(/^第[一二三四五]篇\s*·\s*/, '')
    : '专项特训'

  const masteredTotal = summary ? summary.total_attempted : 0
  const masteredCount = summary ? summary.mastered : 0

  return (
    <header className="relative flex items-center justify-between px-3 h-8 bg-paper-0 border-b border-hairline text-ink-2 select-none font-num text-xs z-30 shrink-0">
      {/* 1. 左侧：战术分类选择器 */}
      <div className="relative flex items-center" ref={dropdownRef}>
        <button
          type="button"
          className="h-6 px-2 rounded hover:bg-paper-2 text-ink-1 flex items-center gap-1.5 transition cursor-pointer text-xs font-ui font-semibold border-0 bg-transparent focus:outline-none focus-visible:ring-2 focus-visible:ring-cinnabar"
          onClick={() => setDropdownOpen((v) => !v)}
          title="切换课程分类"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-cinnabar shrink-0" />
          <span>{categoryTitle}</span>
          <span className="text-[10px] text-ink-3">▼</span>
        </button>

        {dropdownOpen && (
          <div
            className="absolute left-0 top-7 w-56 bg-paper-0 border border-hairline-strong rounded-lg shadow-xl p-1.5 flex flex-col gap-0.5 z-50 animate-fadeIn max-h-[60vh] overflow-y-auto"
          >
            {categories.map((cat) => {
              const isSelected = cat.id === activeCategory
              const count = puzzles.filter((p) => p.category === cat.id).length
              return (
                <button
                  key={cat.id}
                  type="button"
                  className={`px-2 py-1 rounded text-left text-xs transition cursor-pointer flex items-center justify-between font-ui border-0 bg-transparent focus:outline-none focus-visible:ring-2 focus-visible:ring-cinnabar ${
                    isSelected
                      ? 'bg-paper-2 text-ink-0 font-bold'
                      : 'text-ink-2 hover:bg-paper-1 hover:text-ink-0'
                  }`}
                  onClick={() => {
                    onSelectCategory(cat.id)
                    setDropdownOpen(false)
                  }}
                >
                  <span>{cat.name.replace(/^第[一二三四五]篇\s*·\s*/, '')}</span>
                  {count > 0 && (
                    <span className="text-[10px] font-num text-ink-3">
                      {count} 题
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* 2. 中间：真实掌握进度 */}
      <div className="text-[11px] font-num text-ink-3 tracking-wider">
        {masteredTotal > 0 ? (
          <span>
            已掌握 <b className="text-jade font-bold">{masteredCount}</b>/{masteredTotal}
          </span>
        ) : (
          '特训营'
        )}
      </div>

      {/* 3. 右侧：翻转与退出 */}
      <div className="flex items-center gap-1">
        <button
          type="button"
          className="h-6 px-2 text-xs rounded hover:bg-paper-2 text-ink-2 hover:text-ink-0 transition cursor-pointer flex items-center gap-1 border-0 bg-transparent focus:outline-none focus-visible:ring-2 focus-visible:ring-cinnabar"
          onClick={onFlip}
          title="翻转棋盘 (F)"
        >
          <span>⇄</span>
          <span className="text-[11px]">翻转</span>
        </button>

        <button
          type="button"
          className="w-6 h-6 rounded hover:bg-paper-2 text-ink-3 hover:text-ink-0 transition cursor-pointer flex items-center justify-center text-xs border-0 bg-transparent focus:outline-none focus-visible:ring-2 focus-visible:ring-cinnabar"
          onClick={onClose}
          title="关闭 (Esc)"
        >
          ✕
        </button>
      </div>
    </header>
  )
}
