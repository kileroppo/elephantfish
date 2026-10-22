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

/**
 * 苹果风格微型同心环 (Apple Micro Activity Ring)
 */
const MiniActivityRing: React.FC<{
  progress: number // 0 ~ 100
  color: string
  trackColor: string
  size?: number
  strokeWidth?: number
}> = ({ progress, color, trackColor, size = 26, strokeWidth = 3 }) => {
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (Math.min(Math.max(progress, 0), 100) / 100) * circumference

  return (
    <svg width={size} height={size} className="apple-ring-svg shrink-0">
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        className="apple-ring-track"
        stroke={trackColor}
        strokeWidth={strokeWidth}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        className="apple-ring-indicator"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeDasharray={circumference}
        strokeDashoffset={offset}
      />
    </svg>
  )
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
  const getShortCatName = (name: string) => {
    return name.replace(/^第[一二三四五]篇\s*·\s*/, '')
  }

  const accuracy = summary?.first_try_accuracy ?? 0
  const totalMastered = summary?.mastered ?? 0
  const totalCount = Math.max(puzzles.length, 1)
  const masterProgress = Math.round((totalMastered / totalCount) * 100)

  return (
    <header className="flex flex-col border-b border-hairline/80 bg-paper-0/80 backdrop-blur-2xl shrink-0 select-none transition-colors">
      {/* 顶部主工具栏：左品牌 + Apple 闭环三态指示器，右快捷操作 */}
      <div className="flex items-center justify-between px-4 sm:px-6 h-14">
        <div className="flex items-center gap-4 min-w-0">
          <div className="flex items-center gap-2.5 shrink-0">
            <span className="w-8 h-8 rounded-2xl bg-gradient-to-tr from-cinnabar via-[#e04332] to-[#ff6b57] text-white font-kai text-sm font-bold flex items-center justify-center shadow-sm shadow-cinnabar/20">
              营
            </span>
            <div className="flex flex-col">
              <h2 className="text-sm sm:text-base font-bold text-ink-0 m-0 whitespace-nowrap font-display tracking-tight flex items-center gap-1.5">
                <span>象棋实战特训营</span>
                <span className="text-[10px] font-mono tracking-widest text-cinnabar/90 uppercase px-1.5 py-0.2 bg-cinnabar/10 rounded-full font-bold">
                  PRO
                </span>
              </h2>
              <span className="text-[10px] text-ink-3 hidden sm:inline-block">
                基于国手实战与引擎法眼拆解
              </span>
            </div>
          </div>

          {/* Apple Fitness+ 风格的环形进度胶囊 */}
          {summary && (
            <div className="hidden md:flex items-center gap-3 px-3.5 py-1 rounded-2xl bg-paper-1/90 border border-hairline/70 shadow-3xs backdrop-blur-md">
              <div className="flex items-center gap-2">
                <MiniActivityRing
                  progress={masterProgress}
                  color="#10b981"
                  trackColor="rgba(16, 185, 129, 0.18)"
                  size={24}
                  strokeWidth={2.8}
                />
                <div className="flex flex-col text-[11px] leading-tight">
                  <span className="text-ink-3 text-[10px]">精通进度</span>
                  <span className="text-ink-0 font-bold font-num">
                    {totalMastered} <small className="text-ink-3 font-normal">/ {totalCount} 题</small>
                  </span>
                </div>
              </div>

              <div className="w-[1px] h-5 bg-hairline/80" />

              <div className="flex items-center gap-2">
                <MiniActivityRing
                  progress={accuracy}
                  color="#3b82f6"
                  trackColor="rgba(59, 130, 246, 0.18)"
                  size={24}
                  strokeWidth={2.8}
                />
                <div className="flex flex-col text-[11px] leading-tight">
                  <span className="text-ink-3 text-[10px]">初试精准度</span>
                  <span className="text-ink-0 font-bold font-num">{accuracy}%</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* 右侧动作按钮 */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            className="h-8 px-3 rounded-xl text-xs font-medium text-ink-1 hover:text-ink-0 bg-paper-1/90 hover:bg-paper-2 border border-hairline/80 transition cursor-pointer active:scale-95 shadow-3xs flex items-center gap-1.5"
            onClick={onFlip}
            title="翻转棋盘视角 (快捷键 F)"
          >
            <span>⇄</span>
            <span>翻转</span>
          </button>
          <button
            type="button"
            className="w-8 h-8 flex items-center justify-center text-ink-2 hover:text-ink-0 hover:bg-paper-2 rounded-full text-xs transition cursor-pointer active:scale-90 border border-hairline/60 bg-paper-1/80"
            onClick={onClose}
            aria-label="退出训练营"
            title="返回下棋主界面 (Esc)"
          >
            ✕
          </button>
        </div>
      </div>

      {/* iOS Segmented Control 风格分类切换胶囊 */}
      <div className="flex items-center px-4 sm:px-6 pb-2.5 pt-0 overflow-x-auto scrollbar-none gap-2">
        <div className="flex items-center p-1 bg-paper-1/85 backdrop-blur-xl rounded-2xl border border-hairline/80 shadow-2xs shrink-0">
          {categories.map((cat) => {
            const count = puzzles.filter((p) => p.category === cat.id).length
            const isCurrent = activeCategory === cat.id
            return (
              <button
                key={cat.id}
                type="button"
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium whitespace-nowrap transition-all duration-200 cursor-pointer border-0 ${
                  isCurrent
                    ? 'bg-paper-0 text-cinnabar font-bold shadow-xs scale-[1.02]'
                    : 'bg-transparent text-ink-3 hover:text-ink-1'
                }`}
                onClick={() => onSelectCategory(cat.id)}
              >
                <span className="text-sm">{cat.icon}</span>
                <span>{getShortCatName(cat.name)}</span>
                <span className="text-[10px] opacity-60 font-num tabular-nums px-1 py-0.2 bg-ink-0/5 rounded-full">
                  {count}
                </span>
              </button>
            )
          })}
        </div>

        {activeCategory === 'game_breakdown' && currentGameId && (
          <span
            className={`text-[11px] px-3 py-1.5 rounded-xl bg-paper-1/90 border border-hairline text-ink-2 font-medium shrink-0 ml-auto shadow-3xs flex items-center gap-1.5 ${
              onSelectGame ? 'cursor-pointer hover:bg-paper-2' : ''
            }`}
            onClick={() => onSelectGame?.(currentGameId)}
            title="点击刷新当前对局拆解"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-primary-500 animate-pulse" />
            <span>实战拆解：{currentGameId.slice(0, 10)}…</span>
          </span>
        )}
      </div>
    </header>
  )
}

