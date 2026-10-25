import { useState } from 'react'
import { AnalysisPanel } from './AnalysisPanel'
import { MoveList } from './MoveList'
import { MistakeBook } from './MistakeBook'
import { GameShelf } from './GameShelf'
import { CoachLiveCard } from './relay/CoachLiveCard'
import { useUIContext } from '../context/UIContext'

export type RightRailTab = 'analysis' | 'mistakes' | 'shelf' | 'all'

export interface RightRailProps {
  open: boolean
}

export function RightRail({ open }: RightRailProps) {
  const ui = useUIContext()
  const { coachLive } = ui
  const [activeTab, setActiveTab] = useState<RightRailTab>('analysis')

  return (
    <aside
      className={`rail rail-right${open ? ' is-open' : ''} select-none`}
      aria-label="分析与棋谱"
      aria-hidden={!open}
      {...(open ? {} : { inert: '' })}
    >
      {/* 顶部 iOS Segmented Tab 导航与收起按钮 */}
      <div className="w-full flex items-center justify-between gap-1.5 px-2 pt-2 pb-1.5 shrink-0">
        <div
          className="inline-flex items-center p-1 bg-paper-2/80 backdrop-blur-md rounded-2xl border border-hairline/80 shadow-2xs text-xs font-medium flex-1 min-w-0"
          role="tablist"
          aria-label="右侧栏面板切换"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'analysis'}
            className={`flex-1 py-1.5 px-2 rounded-xl text-[11.5px] tracking-wide transition-all duration-200 cursor-pointer border-0 flex items-center justify-center gap-1 ${
              activeTab === 'analysis'
                ? 'bg-paper-0 text-cinnabar shadow-xs font-bold'
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
            className={`flex-1 py-1.5 px-2 rounded-xl text-[11.5px] tracking-wide transition-all duration-200 cursor-pointer border-0 flex items-center justify-center gap-1 ${
              activeTab === 'mistakes'
                ? 'bg-paper-0 text-cinnabar shadow-xs font-bold'
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
            className={`flex-1 py-1.5 px-2 rounded-xl text-[11.5px] tracking-wide transition-all duration-200 cursor-pointer border-0 flex items-center justify-center gap-1 ${
              activeTab === 'shelf'
                ? 'bg-paper-0 text-cinnabar shadow-xs font-bold'
                : 'bg-transparent text-ink-3 hover:text-ink-1'
            }`}
            onClick={() => setActiveTab('shelf')}
            title="查看历史对局存档并一键复盘"
          >
            <span>对局库</span>
          </button>

          <button
            type="button"
            className={`py-1.5 px-2 rounded-xl text-[11px] transition-all duration-200 cursor-pointer border-0 ${
              activeTab === 'all'
                ? 'bg-paper-0 text-cinnabar font-bold shadow-xs'
                : 'text-ink-4 hover:text-ink-2'
            }`}
            onClick={() => setActiveTab(activeTab === 'all' ? 'analysis' : 'all')}
            title={activeTab === 'all' ? '切换为标签聚焦模式' : '平铺展开所有模块'}
            aria-label="平铺全部面板"
          >
            {activeTab === 'all' ? '折叠' : '展开'}
          </button>
        </div>

        {/* 侧边栏收起圆形按钮 */}
        <button
          type="button"
          className="hidden md:flex h-8 w-8 rounded-full bg-paper-2/80 hover:bg-paper-3 border border-hairline/80 text-ink-3 hover:text-ink-0 items-center justify-center text-xs transition cursor-pointer shrink-0 active:scale-95 shadow-2xs"
          onClick={() => {
            ui.closeCoachLive()
            ui.setRailR(false)
          }}
          title="收起右侧栏 (快捷键 ])"
          aria-label="收起侧边栏"
        >
          ⇥
        </button>
      </div>

      {/* 实时教练推演卡片：置顶于右侧栏，绝不遮挡中央棋盘 */}
      {coachLive.open && (
        <div className="w-full px-2 pt-1 pb-2">
          <CoachLiveCard
            mode={coachLive.mode}
            loading={coachLive.loading}
            opponentThreat={coachLive.opponentThreat}
            thinkingGuide={coachLive.thinkingGuide}
            activeSteps={coachLive.activeSteps}
            animStep={coachLive.animStep}
            animPlaying={coachLive.animPlaying}
            prosCons={coachLive.prosCons}
            onStepClick={ui.setCoachLiveAnimStep}
            onPrevStep={ui.prevCoachLiveStep}
            onNextStep={ui.nextCoachLiveStep}
            onTogglePlay={ui.toggleCoachLivePlay}
            onClose={() => {
              ui.closeCoachLive()
              ui.setRailR(false)
            }}
            onSwitchMode={(m) => void ui.openCoachLive(m)}
          />
        </div>
      )}

      {/* 面板内容容器 */}
      {activeTab === 'analysis' && (
        <div className="w-full flex flex-col gap-2.5 px-2 pb-3">
          <AnalysisPanel />
          <MoveList />
        </div>
      )}

      {activeTab === 'mistakes' && (
        <div className="w-full px-2 pb-3 animate-fadeIn">
          <MistakeBook />
        </div>
      )}

      {activeTab === 'shelf' && (
        <div className="w-full px-2 pb-3 animate-fadeIn">
          <GameShelf />
        </div>
      )}

      {activeTab === 'all' && (
        <div className="w-full flex flex-col gap-2.5 px-2 pb-3">
          <AnalysisPanel />
          <MoveList />
          <MistakeBook />
          <GameShelf />
        </div>
      )}
    </aside>
  )
}
