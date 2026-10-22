import { useState } from 'react'
import { AnalysisPanel } from './AnalysisPanel'
import { MoveList } from './MoveList'
import { MistakeBook } from './MistakeBook'
import { GameShelf } from './GameShelf'

export type RightRailTab = 'analysis' | 'mistakes' | 'shelf' | 'all'

export interface RightRailProps {
  open: boolean
}

export function RightRail({ open }: RightRailProps) {
  const [activeTab, setActiveTab] = useState<RightRailTab>('analysis')

  return (
    <aside
      className={`rail rail-right${open ? ' is-open' : ''}`}
      aria-label="分析与棋谱"
      aria-hidden={!open}
      {...(open ? {} : { inert: '' })}
    >
      {/* 顶部优雅 Segmented Tab 导航 */}
      <div className="w-full flex items-center justify-between px-1 pt-1 pb-0.5 select-none shrink-0">
        <div
          className="inline-flex items-center p-0.5 bg-paper-2/90 rounded-lg border border-hairline text-xs font-medium w-full"
          role="tablist"
          aria-label="右侧栏面板切换"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'analysis'}
            className={`flex-1 py-1 px-2 rounded-md text-[11.5px] tracking-wide transition-all cursor-pointer border-0 flex items-center justify-center gap-1 ${
              activeTab === 'analysis'
                ? 'bg-paper-0 text-cinnabar shadow-xs font-semibold'
                : 'bg-transparent text-ink-3 hover:text-ink-1'
            }`}
            onClick={() => setActiveTab('analysis')}
            title="实时棋谱与引擎对局分析"
          >
            <span>分析与棋谱</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'mistakes'}
            className={`flex-1 py-1 px-2 rounded-md text-[11.5px] tracking-wide transition-all cursor-pointer border-0 flex items-center justify-center gap-1 ${
              activeTab === 'mistakes'
                ? 'bg-paper-0 text-cinnabar shadow-xs font-semibold'
                : 'bg-transparent text-ink-3 hover:text-ink-1'
            }`}
            onClick={() => setActiveTab('mistakes')}
            title="查看历次实战失误沉淀与病因图谱"
          >
            <span>错题本</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'shelf'}
            className={`flex-1 py-1 px-2 rounded-md text-[11.5px] tracking-wide transition-all cursor-pointer border-0 flex items-center justify-center gap-1 ${
              activeTab === 'shelf'
                ? 'bg-paper-0 text-cinnabar shadow-xs font-semibold'
                : 'bg-transparent text-ink-3 hover:text-ink-1'
            }`}
            onClick={() => setActiveTab('shelf')}
            title="查看历史对局存档并一键复盘"
          >
            <span>对局库</span>
          </button>

          <button
            type="button"
            className={`py-1 px-1.5 rounded-md text-[10.5px] transition-all cursor-pointer border-0 ${
              activeTab === 'all'
                ? 'bg-paper-0 text-cinnabar font-semibold shadow-xs'
                : 'text-ink-4 hover:text-ink-2'
            }`}
            onClick={() => setActiveTab(activeTab === 'all' ? 'analysis' : 'all')}
            title={activeTab === 'all' ? '切换为标签聚焦模式' : '平铺展开所有模块'}
            aria-label="平铺全部面板"
          >
            {activeTab === 'all' ? '折叠' : '展开'}
          </button>
        </div>
      </div>

      {/* 面板内容容器 */}
      {activeTab === 'analysis' && (
        <>
          <AnalysisPanel />
          <MoveList />
        </>
      )}

      {activeTab === 'mistakes' && (
        <div className="w-full animate-fadeIn">
          <MistakeBook />
        </div>
      )}

      {activeTab === 'shelf' && (
        <div className="w-full animate-fadeIn">
          <GameShelf />
        </div>
      )}

      {activeTab === 'all' && (
        <>
          <AnalysisPanel />
          <MoveList />
          <MistakeBook />
          <GameShelf />
        </>
      )}
    </aside>
  )
}
