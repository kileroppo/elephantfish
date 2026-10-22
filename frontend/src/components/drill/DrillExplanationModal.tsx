import React from 'react'
import type { AnimatedStep, ProsConsAnalysis, ThinkingGuide, TrainingPuzzle } from '../../types'

export interface DrillExplanationModalProps {
  activeTab: 'pros_cons' | 'thinking' | 'breakdown' | 'catalog'
  onTabChange: (tab: 'pros_cons' | 'thinking' | 'breakdown' | 'catalog') => void
  // Tab 1 props
  animMode: 'none' | 'bad' | 'good' | 'threat'
  animStep: number
  animPlaying: boolean
  inRebuttal: boolean
  activeSteps: AnimatedStep[]
  prosCons: ProsConsAnalysis | null
  badStepsCount: number
  goodStepsCount: number
  hints: string[]
  hintLevel: number
  solved: boolean
  stage: 'demo' | 'drill' | 'exam' | 'mirror'
  onResetAnimStep: () => void
  onPrevAnimStep: () => void
  onTogglePlayAnim: () => void
  onNextAnimStep: () => void
  onSelectAnimStep: (stepIndex: number) => void
  onStartBadAnim: () => void
  onStartGoodAnim: () => void
  onRequestHint: () => void
  // Tab 2 props
  thinkingGuide: ThinkingGuide | null
  threatStepsCount: number
  onStartThreatAnim: () => void
  onFocusWeakness: (square: string) => void
  // Tab Breakdown props
  gameBreakdown?: any
  onSelectBreakdownPly?: (ply: number) => void
  // Tab 3 props
  categoryPuzzles: TrainingPuzzle[]
  currentPuzzleId?: string
  onSelectPuzzle: (puzzleId: string) => void
}

export const DrillExplanationModal: React.FC<DrillExplanationModalProps> = ({
  activeTab,
  onTabChange,
  animMode,
  animStep,
  animPlaying,
  inRebuttal,
  activeSteps,
  prosCons,
  badStepsCount,
  goodStepsCount,
  hints,
  hintLevel,
  solved,
  stage,
  onResetAnimStep,
  onPrevAnimStep,
  onTogglePlayAnim,
  onNextAnimStep,
  onSelectAnimStep,
  onStartBadAnim,
  onStartGoodAnim,
  onRequestHint,
  thinkingGuide,
  threatStepsCount,
  onStartThreatAnim,
  onFocusWeakness,
  gameBreakdown,
  onSelectBreakdownPly,
  categoryPuzzles,
  currentPuzzleId,
  onSelectPuzzle,
}) => {
  return (
    <div className="flex flex-col gap-3">
      {/* 右侧分栏 Tab 导航 */}
      <div className="flex items-center gap-1 border-b-1.5 border-hairline pb-0.5" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'pros_cons'}
          className={`px-3 py-1.5 text-xs font-semibold rounded-t border-b-2 cursor-pointer transition-all ${
            activeTab === 'pros_cons'
              ? 'text-ink-0 border-ink-0 font-bold bg-black/5'
              : 'text-ink-2 border-transparent hover:text-ink-0'
          }`}
          onClick={() => onTabChange('pros_cons')}
        >
          📊 优劣动画与对比
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'thinking'}
          className={`px-3 py-1.5 text-xs font-semibold rounded-t border-b-2 cursor-pointer transition-all ${
            activeTab === 'thinking'
              ? 'text-ink-0 border-ink-0 font-bold bg-black/5'
              : 'text-ink-2 border-transparent hover:text-ink-0'
          }`}
          onClick={() => onTabChange('thinking')}
        >
          🧠 逆向算路三问
        </button>
        {gameBreakdown && (
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'breakdown'}
            className={`px-3 py-1.5 text-xs font-semibold rounded-t border-b-2 cursor-pointer transition-all ${
              activeTab === 'breakdown'
                ? 'text-ink-0 border-ink-0 font-bold bg-black/5'
                : 'text-ink-2 border-transparent hover:text-ink-0'
            }`}
            onClick={() => onTabChange('breakdown')}
          >
            ⚔️ 本局全盘拆解 ({gameBreakdown.turning_points?.length || 0})
          </button>
        )}
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'catalog'}
          className={`px-3 py-1.5 text-xs font-semibold rounded-t border-b-2 cursor-pointer transition-all ${
            activeTab === 'catalog'
              ? 'text-ink-0 border-ink-0 font-bold bg-black/5'
              : 'text-ink-2 border-transparent hover:text-ink-0'
          }`}
          onClick={() => onTabChange('catalog')}
        >
          🗂️ 题库列表 ({categoryPuzzles.length})
        </button>
      </div>

      {/* Tab 1: 📊 优劣动画与对比 */}
      {activeTab === 'pros_cons' && (
        <div className="flex flex-col gap-3">
          {/* 🎬 分步动画推演剧场 */}
          {(animMode !== 'none' || inRebuttal) && activeSteps.length > 0 && (
            <div
              className={`p-3 rounded-lg border-1.5 flex flex-col gap-2.5 transition-all ${
                animMode === 'bad'
                  ? 'border-cinnabar/40 bg-gradient-to-b from-cinnabar/5 to-paper-1'
                  : animMode === 'good'
                    ? 'border-emerald-600/40 bg-gradient-to-b from-emerald-600/5 to-paper-1'
                    : 'border-amber-600/40 bg-gradient-to-b from-amber-500/10 to-paper-1'
              }`}
              aria-label="分步动画时间轴"
            >
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="text-xs font-bold text-ink-0">
                  {animMode === 'bad'
                    ? '🎬 走错会怎样（多步连锁亏损动画）'
                    : animMode === 'good'
                      ? '🎬 走对会怎样（最佳正着分步动画）'
                      : '🎬 对手想干嘛（不设防时对手杀招动画）'}
                </div>
                <div className="flex items-center gap-1 flex-wrap">
                  <button
                    type="button"
                    className="px-2 py-0.5 text-xs font-medium rounded border border-hairline text-ink-2 hover:text-ink-0 bg-transparent hover:bg-black/5 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                    onClick={onResetAnimStep}
                    disabled={animStep === 0}
                    title="回到走棋前的初始局面"
                  >
                    ⏮ 走前
                  </button>
                  <button
                    type="button"
                    className="px-2 py-0.5 text-xs font-medium rounded border border-hairline text-ink-2 hover:text-ink-0 bg-transparent hover:bg-black/5 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                    onClick={onPrevAnimStep}
                    disabled={animStep <= 0}
                  >
                    ◀ 上一步
                  </button>
                  <button
                    type="button"
                    className="px-2.5 py-0.5 text-xs font-semibold rounded bg-cinnabar hover:bg-cinnabar-bright text-white transition-colors cursor-pointer shadow-xs"
                    onClick={onTogglePlayAnim}
                  >
                    {animPlaying ? '⏸ 暂停' : '▶ 自动连播'}
                  </button>
                  <button
                    type="button"
                    className="px-2 py-0.5 text-xs font-medium rounded border border-hairline text-ink-2 hover:text-ink-0 bg-transparent hover:bg-black/5 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                    onClick={onNextAnimStep}
                    disabled={animStep >= activeSteps.length}
                  >
                    下一步 ▶
                  </button>
                </div>
              </div>

              {/* 分步卡片列表 */}
              <div className="flex flex-col gap-1.5">
                {activeSteps.map((st, idx) => {
                  const stepIndex = idx + 1
                  const isCurrent = animStep === stepIndex
                  return (
                    <button
                      key={st.step}
                      type="button"
                      className={`w-full text-left p-2 rounded-md border transition-all cursor-pointer ${
                        isCurrent
                          ? 'border-cinnabar bg-cinnabar/10 shadow-xs'
                          : 'bg-paper-0 border-hairline hover:border-hairline-strong'
                      }`}
                      onClick={() => onSelectAnimStep(stepIndex)}
                    >
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="text-[11.5px] font-bold text-ink-1">
                          {st.tag || `第 ${st.step} 步`}
                        </span>
                        <span className="font-display text-xs font-bold text-cinnabar">
                          {st.chinese}
                        </span>
                      </div>
                      <div className="text-xs leading-relaxed text-ink-1">
                        {st.plain || st.comment}
                      </div>
                      {((st.gains && st.gains.length > 0) || (st.losses && st.losses.length > 0)) && (
                        <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
                          {st.gains?.map((g, gi) => (
                            <span
                              key={`g-${gi}`}
                              className="text-[10.5px] px-1.5 py-0.5 rounded-full font-semibold text-emerald-800 bg-emerald-100"
                            >
                              + {g}
                            </span>
                          ))}
                          {st.losses?.map((l, li) => (
                            <span
                              key={`l-${li}`}
                              className="text-[10.5px] px-1.5 py-0.5 rounded-full font-semibold text-rose-800 bg-rose-100"
                            >
                              - {l}
                            </span>
                          ))}
                        </div>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* 📊 优劣势直观对比卡 */}
          {prosCons && (
            <div className="p-3 rounded-lg bg-paper-1 border border-hairline-strong flex flex-col gap-2" aria-label="优劣势直观对比">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <h4 className="m-0 text-xs font-bold text-ink-0">📊 走错失去什么 vs 走对赢得什么</h4>
                {prosCons.pawn_drop > 0 && (
                  <span className="text-[11px] font-bold px-2 py-0.5 rounded-full text-cinnabar bg-cinnabar/10 border border-cinnabar/30">
                    走错亏约 {prosCons.pawn_drop} 个兵
                  </span>
                )}
              </div>
              <p className="m-0 text-xs font-semibold text-ink-1 leading-relaxed">
                {prosCons.verdict_headline}
              </p>

              {/* 关键位置几何透视解析卡片 */}
              {prosCons.key_square_info && (
                <div className="p-2.5 rounded-md bg-blue-50/80 border border-blue-200 text-xs text-blue-950 flex flex-col gap-1 shadow-2xs">
                  <div className="flex items-center justify-between gap-1.5 flex-wrap">
                    <span className="font-bold flex items-center gap-1">
                      <span>📍 为什么「{prosCons.best_chinese || prosCons.best_iccs}」是关键位置？</span>
                      <span className="text-[11px] font-semibold px-1.5 py-0.2 rounded bg-blue-200/80 text-blue-900">
                        {prosCons.key_square_info.zone_name}（{prosCons.key_square_info.dest_square}）
                      </span>
                    </span>
                    <div className="flex items-center gap-1">
                      {prosCons.key_square_info.tactical_tags.map((tag, ti) => (
                        <span key={ti} className="text-[10.5px] px-1.5 py-0.5 rounded-full bg-blue-100 border border-blue-300 font-medium">
                          #{tag}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="text-[11.5px] leading-relaxed text-blue-900 mt-0.5">
                    👉 <b>棋理依据</b>：{prosCons.key_square_info.why_key}
                  </div>
                  {(prosCons.key_square_info.controlled_targets.length > 0 || prosCons.key_square_info.protected_targets.length > 0) && (
                    <div className="flex items-center gap-2 flex-wrap text-[11px] text-blue-800 pt-1 border-t border-blue-200/60 mt-0.5">
                      {prosCons.key_square_info.controlled_targets.length > 0 && (
                        <span>🎯 瞄准控制：<b>{prosCons.key_square_info.controlled_targets.join('、')}</b></span>
                      )}
                      {prosCons.key_square_info.protected_targets.length > 0 && (
                        <span>🛡️ 稳固生根：<b>{prosCons.key_square_info.protected_targets.join('、')}</b></span>
                      )}
                    </div>
                  )}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-1">
                {/* 左列：走错会失去什么 */}
                <div className="p-2.5 rounded bg-paper-0 border border-hairline border-t-2.5 border-t-cinnabar flex flex-col gap-1.5">
                  <div className="flex items-center justify-between gap-1.5 flex-wrap">
                    <span className="text-xs font-bold text-ink-0">
                      ❌ 走错{prosCons.wrong_chinese ? `「${prosCons.wrong_chinese}」` : ''}的劣势
                    </span>
                    {badStepsCount > 0 && (
                      <button
                        type="button"
                        className="px-2 py-0.5 text-[11px] rounded border border-hairline text-ink-2 hover:text-ink-0 bg-transparent hover:bg-black/5 transition-colors cursor-pointer"
                        onClick={onStartBadAnim}
                      >
                        ▶ 看动画({badStepsCount}步)
                      </button>
                    )}
                  </div>
                  <ul className="m-0 pl-4 text-xs leading-relaxed text-ink-1 flex flex-col gap-1">
                    {prosCons.wrong_losses.map((item, i) => (
                      <li key={i}>{item}</li>
                    ))}
                  </ul>
                </div>

                {/* 右列：走对能赢得什么 */}
                <div className="p-2.5 rounded bg-paper-0 border border-hairline border-t-2.5 border-t-emerald-600 flex flex-col gap-1.5">
                  <div className="flex items-center justify-between gap-1.5 flex-wrap">
                    <span className="text-xs font-bold text-ink-0">
                      ✅ 走对{prosCons.best_chinese ? `「${prosCons.best_chinese}」` : ''}的优势
                    </span>
                    {goodStepsCount > 0 && (
                      <button
                        type="button"
                        className="px-2 py-0.5 text-[11px] rounded border border-hairline text-ink-2 hover:text-ink-0 bg-transparent hover:bg-black/5 transition-colors cursor-pointer"
                        onClick={onStartGoodAnim}
                      >
                        ▶ 看动画({goodStepsCount}步)
                      </button>
                    )}
                  </div>
                  <ul className="m-0 pl-4 text-xs leading-relaxed text-ink-1 flex flex-col gap-1">
                    {prosCons.best_gains.map((item, i) => (
                      <li key={i}>{item}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          )}

          {/* 💡 分步提示区 */}
          <div className="p-3 bg-paper-0 rounded-lg border border-hairline flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <h4 className="m-0 text-xs font-bold text-ink-0">
                💡 实在想不出？看分步提示 ({hints.length}/3)
              </h4>
              <button
                type="button"
                className="px-2 py-0.5 text-xs font-medium rounded border border-hairline text-ink-2 hover:text-ink-0 bg-transparent hover:bg-black/5 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                onClick={onRequestHint}
                disabled={hintLevel >= 3 || solved || stage === 'exam'}
              >
                {stage === 'exam'
                  ? '实战检验中已关闭提示'
                  : hintLevel >= 3
                    ? '已显示全部 3 步提示'
                    : `点我看第 ${hintLevel + 1} 步提示`}
              </button>
            </div>
            <div className="flex flex-col gap-2">
              {stage === 'exam' ? (
                <p className="m-0 text-xs text-cinnabar">
                  当前为无提示实战检验模式，不开启提示一次走对即可标记为「★ 已掌握」。
                </p>
              ) : hints.length === 0 ? (
                <p className="m-0 text-xs text-ink-3">
                  点击右上角按钮可依次查看：① 对手破绽在哪一格 → ② 我方该动哪颗主力子 → ③ 具体走哪一步。
                </p>
              ) : (
                hints.map((h, i) => (
                  <div
                    key={i}
                    className="bg-amber-50 border border-amber-200 p-2 rounded-md text-xs text-amber-900 flex items-start gap-2 leading-relaxed"
                  >
                    <span className="font-bold text-[10.5px] bg-amber-200 px-1.5 py-0.5 rounded text-amber-950 shrink-0">
                      {i === 0 ? '提示① 看破绽' : i === 1 ? '提示② 选主力' : '提示③ 走正着'}
                    </span>
                    <span>{h}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Tab 2: 🧠 逆向算路三问 */}
      {activeTab === 'thinking' && thinkingGuide && (
        <div className="p-3 rounded-lg bg-paper-1 border border-hairline-strong flex flex-col gap-2.5" aria-label="第一性原理与逆向思维算路助手">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h4 className="m-0 text-xs font-bold text-ink-0">🧠 脑子想不明白接下来的走向？用这 3 步算路法</h4>
            {threatStepsCount > 0 && (
              <button
                type="button"
                className="px-2 py-0.5 text-xs font-medium rounded border border-hairline text-ink-2 hover:text-ink-0 bg-transparent hover:bg-black/5 transition-colors cursor-pointer"
                onClick={onStartThreatAnim}
              >
                👁️ 动画看对手企图
              </button>
            )}
          </div>

          <div className="p-2 rounded bg-paper-0 border border-hairline">
            <div className="text-[11.5px] font-bold text-blue-700 mb-1">
              ① 第一性原理（只抓盘面 3 件本质，不瞎算）
            </div>
            <ul className="m-0 pl-4 text-xs leading-relaxed text-ink-1 flex flex-col gap-1">
              {thinkingGuide.first_principles.map((fp, idx) => (
                <li key={idx}>{fp}</li>
              ))}
            </ul>
          </div>

          <div className="p-2 rounded bg-paper-0 border border-hairline">
            <div className="text-[11.5px] font-bold text-emerald-700 mb-1">
              ② 逆向思维（从 3 步后的结果倒推现在第 1 步）
            </div>
            <p className="m-0 text-xs leading-relaxed text-ink-1">{thinkingGuide.inversion_tip}</p>
          </div>

          <div className="p-2 rounded bg-paper-0 border border-hairline">
            <div className="text-[11.5px] font-bold text-cinnabar mb-1">
              ③ 对抗式提问（落子前站到对手角度问自己 3 句话）
            </div>
            <div className="flex flex-col gap-1.5">
              {thinkingGuide.adversarial_qa.map((item, idx) => (
                <div
                  key={idx}
                  className="p-1.5 rounded bg-paper-1 hover:bg-paper-2 cursor-pointer transition-colors"
                  onClick={() => {
                    if (item.focus) {
                      onFocusWeakness(item.focus)
                    }
                  }}
                  title={item.focus ? `点击在棋盘高亮格：${item.focus}` : undefined}
                >
                  <div className="text-xs font-semibold text-ink-0">{item.q}</div>
                  <div className="text-[11.5px] leading-relaxed text-ink-2 mt-0.5">👉 {item.a}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Tab Breakdown: ⚔️ 特定对局全盘拆解 */}
      {activeTab === 'breakdown' && gameBreakdown && (
        <div className="flex flex-col gap-3">
          {/* 三阶段概览卡 */}
          <div className="p-3 rounded-lg bg-paper-1 border border-hairline-strong flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span className="text-xs font-bold text-ink-0">
                对局 {gameBreakdown.game_id} · 三阶段胜负手拆解
              </span>
              <span className="text-[11.5px] text-ink-2">
                共 {gameBreakdown.ply_count} 手 · 发现 {gameBreakdown.turning_points?.length || 0} 处关键胜负手
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-1">
              {(['opening', 'midgame', 'endgame'] as const).map((phaseKey) => {
                const pInfo = gameBreakdown.phases?.[phaseKey]
                if (!pInfo) return null
                return (
                  <div key={phaseKey} className="p-2 rounded bg-paper-0 border border-hairline flex flex-col gap-1">
                    <div className="flex items-center justify-between">
                      <span className="text-[11.5px] font-bold text-ink-1">{pInfo.name}</span>
                      <span className={`text-[10.5px] font-semibold px-1.5 py-0.2 rounded ${
                        pInfo.accuracy >= 80
                          ? 'bg-emerald-100 text-emerald-800'
                          : pInfo.accuracy >= 60
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-rose-100 text-rose-800'
                      }`}>
                        准确率 {pInfo.accuracy}%
                      </span>
                    </div>
                    <div className="text-[11px] text-ink-3">
                      {pInfo.verdict}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* 转折点列表 */}
          <div className="bg-paper-0 rounded-lg border border-hairline p-2.5 flex flex-col gap-2">
            <h4 className="m-0 text-xs font-bold text-ink-0">
              📌 本局关键转折点（点击直接加载到棋盘重练）
            </h4>
            <div className="flex flex-col gap-1.5 overflow-y-auto max-h-[300px]">
              {gameBreakdown.turning_points?.map((tp: any, idx: number) => {
                const isCurrent = currentPuzzleId === tp.puzzle_id
                return (
                  <button
                    key={idx}
                    type="button"
                    className={`w-full text-left p-2.5 rounded-md border transition-all cursor-pointer ${
                      isCurrent
                        ? 'bg-rose-50 border-cinnabar shadow-xs'
                        : 'bg-paper-1 border-hairline hover:border-hairline-strong'
                    }`}
                    onClick={() => {
                      if (onSelectBreakdownPly) {
                        onSelectBreakdownPly(tp.ply)
                      }
                      if (onSelectPuzzle) {
                        onSelectPuzzle(tp.puzzle_id)
                      }
                    }}
                  >
                    <div className="flex items-center justify-between gap-1.5 mb-1">
                      <span className="font-bold text-xs text-ink-0">
                        第 {tp.ply} 手 · {tp.phase_name}
                      </span>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10.5px] font-semibold px-1.5 py-0.5 rounded bg-rose-100 text-rose-800">
                          #{tp.motif_label} (-{tp.loss_pawn}兵)
                        </span>
                        <span className="font-display text-xs font-bold text-cinnabar">
                          错走 {tp.played_chinese} → 正着 {tp.best_chinese}
                        </span>
                      </div>
                    </div>
                    <div className="text-[11.5px] text-ink-2 leading-relaxed">
                      {tp.coach_summary}
                    </div>
                    {tp.key_square_info && (
                      <div className="mt-1 text-[11px] text-blue-900 bg-blue-50/70 p-1.5 rounded border border-blue-200">
                        📍 <b>为什么当时该占 {tp.key_square_info.dest_square}（{tp.key_square_info.zone_name}）</b>：{tp.key_square_info.why_key}
                      </div>
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* Tab 3: 🗂️ 题库列表 */}
      {activeTab === 'catalog' && (
        <div className="bg-paper-0 rounded-lg border border-hairline p-2.5 flex flex-col min-h-[140px]">
          <div className="mb-2">
            <h4 className="m-0 text-xs font-bold text-ink-1">
              本类训练题列表 ({categoryPuzzles.length})
            </h4>
          </div>
          <div className="flex flex-col gap-1 overflow-y-auto max-h-[260px]">
            {categoryPuzzles.map((pz, idx) => {
              const isCurrent = currentPuzzleId === pz.id
              return (
                <button
                  key={pz.id}
                  type="button"
                  className={`flex items-center justify-between px-2.5 py-1.5 rounded text-xs transition-colors cursor-pointer border ${
                    isCurrent
                      ? 'bg-rose-50 border-cinnabar font-semibold text-cinnabar'
                      : 'bg-paper-1 border-transparent hover:bg-paper-2 text-ink-1'
                  }`}
                  onClick={() => onSelectPuzzle(pz.id)}
                >
                  <span className="font-num text-[11px] opacity-60 mr-1.5">#{idx + 1}</span>
                  <span className="flex-1 truncate text-left">{pz.title}</span>
                  <span className="ml-1.5 text-xs">
                    {pz.status === 'mastered'
                      ? '★'
                      : pz.status === 'solved_with_hints'
                        ? '✓'
                        : pz.status === 'in_progress'
                          ? '⏳'
                          : '○'}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
