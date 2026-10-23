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
  animPlaying: _animPlaying,
  inRebuttal,
  activeSteps,
  prosCons,
  badStepsCount,
  goodStepsCount,
  hints: _hints,
  hintLevel: _hintLevel,
  solved,
  stage,
  onResetAnimStep: _onResetAnimStep,
  onPrevAnimStep: _onPrevAnimStep,
  onTogglePlayAnim: _onTogglePlayAnim,
  onNextAnimStep: _onNextAnimStep,
  onSelectAnimStep,
  onStartBadAnim,
  onStartGoodAnim,
  onRequestHint: _onRequestHint,
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
  // 是否可以展示答案级的优劣势完整对比（避免在用户思考实训时剧透正解）
  const showFullProsCons = solved || stage === 'demo' || inRebuttal || animMode !== 'none'

  return (
    <div className="flex flex-col gap-3 select-none">
      {/* 右侧分栏 Precision Segmented Control */}
      <div
        className="flex items-center p-1 bg-slate-100 rounded-lg border border-slate-200/90 shadow-3xs shrink-0"
        role="tablist"
      >
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'pros_cons'}
          className={`flex-1 py-1 px-2 text-xs font-semibold rounded-md text-center transition-all cursor-pointer border-0 ${
            activeTab === 'pros_cons'
              ? 'bg-white text-slate-900 font-bold shadow-xs'
              : 'bg-transparent text-slate-500 hover:text-slate-800'
          }`}
          onClick={() => onTabChange('pros_cons')}
        >
          📊 得失详析
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'thinking'}
          className={`flex-1 py-1 px-2 text-xs font-semibold rounded-md text-center transition-all cursor-pointer border-0 ${
            activeTab === 'thinking'
              ? 'bg-white text-slate-900 font-bold shadow-xs'
              : 'bg-transparent text-slate-500 hover:text-slate-800'
          }`}
          onClick={() => onTabChange('thinking')}
        >
          🧠 算路三问
        </button>
        {gameBreakdown && (
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'breakdown'}
            className={`flex-1 py-1 px-2 text-xs font-semibold rounded-md text-center transition-all cursor-pointer border-0 ${
              activeTab === 'breakdown'
                ? 'bg-white text-slate-900 font-bold shadow-xs'
                : 'bg-transparent text-slate-500 hover:text-slate-800'
            }`}
            onClick={() => onTabChange('breakdown')}
          >
            ⚔️ 实战拆解
          </button>
        )}
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'catalog'}
          className={`flex-1 py-1 px-2 text-xs font-semibold rounded-md text-center transition-all cursor-pointer border-0 ${
            activeTab === 'catalog'
              ? 'bg-white text-slate-900 font-bold shadow-xs'
              : 'bg-transparent text-slate-500 hover:text-slate-800'
          }`}
          onClick={() => onTabChange('catalog')}
        >
          🗂️ 题库 ({categoryPuzzles.length})
        </button>
      </div>

      {/* Tab 1: 📊 优劣动画与对比 */}
      {activeTab === 'pros_cons' && (
        <div className="flex flex-col gap-3">
          {/* 🎬 分步动画推演剧场（动画激活时展示） */}
          {(animMode !== 'none' || inRebuttal) && activeSteps.length > 0 && (
            <div
              className={`p-3 rounded-2xl border flex flex-col gap-2.5 transition-all shadow-xs ${
                animMode === 'bad'
                  ? 'border-cinnabar/30 bg-cinnabar/5'
                  : animMode === 'good'
                    ? 'border-emerald-600/30 bg-emerald-600/5'
                    : 'border-amber-500/30 bg-amber-500/5'
              }`}
              aria-label="分步动画时间轴"
            >
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="text-xs font-bold text-ink-0 flex items-center gap-1">
                  <span>🎬</span>
                  <span>
                    {animMode === 'bad'
                      ? '走错会怎样（连锁亏损推演）'
                      : animMode === 'good'
                        ? '走对会怎样（最佳正着推演）'
                        : '对手企图（未设防杀招推演）'}
                  </span>
                </span>
                <span className="text-[11px] text-ink-3 font-num">
                  第 {animStep} / {activeSteps.length} 动
                </span>
              </div>

              {/* 分步卡片列表 */}
              <div className="flex flex-col gap-1.5 max-h-[220px] overflow-y-auto">
                {activeSteps.map((st, idx) => {
                  const stepIndex = idx + 1
                  const isCurrent = animStep === stepIndex
                  return (
                    <button
                      key={st.step}
                      type="button"
                      className={`w-full text-left p-2 rounded-xl border transition-all cursor-pointer ${
                        isCurrent
                          ? 'border-cinnabar bg-paper-0 shadow-xs'
                          : 'bg-paper-0/70 border-hairline hover:bg-paper-0'
                      }`}
                      onClick={() => onSelectAnimStep(stepIndex)}
                    >
                      <div className="flex items-center justify-between gap-2 mb-0.5">
                        <span className="text-[11px] font-bold text-ink-2">
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
                        <div className="flex items-center gap-1.5 flex-wrap mt-1">
                          {st.gains?.map((g, gi) => (
                            <span
                              key={`g-${gi}`}
                              className="text-[10px] px-1.5 py-0.2 rounded-full font-semibold text-emerald-800 bg-emerald-100"
                            >
                              + {g}
                            </span>
                          ))}
                          {st.losses?.map((l, li) => (
                            <span
                              key={`l-${li}`}
                              className="text-[10px] px-1.5 py-0.2 rounded-full font-semibold text-rose-800 bg-rose-100"
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
            <div className="p-3.5 rounded-2xl bg-paper-0/95 border border-hairline shadow-xs flex flex-col gap-2.5">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <h4 className="m-0 text-xs font-bold text-ink-0">📊 走错失去什么 vs 走对赢得什么</h4>
                {showFullProsCons && prosCons.pawn_drop > 0 && (
                  <span className="text-[11px] font-bold px-2 py-0.5 rounded-full text-cinnabar bg-cinnabar/10 border border-cinnabar/30">
                    走错亏约 {prosCons.pawn_drop} 个兵
                  </span>
                )}
              </div>

              {!showFullProsCons ? (
                /* 用户独立思考实训中：避免直接泄密答案 */
                <div className="p-3 rounded-xl bg-paper-1/80 border border-hairline text-ink-2 text-xs flex flex-col gap-2">
                  <p className="m-0 leading-relaxed">
                    💡 <b>独立思考中</b>：请先在棋盘上尝试走出你认为的最佳走法。
                  </p>
                  <p className="m-0 text-[11.5px] text-ink-3">
                    若走出正解，此处将自动解锁本题的深层算路依据与得失拆解；或点击右上角「正着演示」直接观摩。
                  </p>
                </div>
              ) : (
                <>
                  <p className="m-0 text-xs font-semibold text-ink-1 leading-relaxed">
                    {prosCons.verdict_headline}
                  </p>

                  {/* 关键位置几何透视解析卡片 */}
                  {prosCons.key_square_info && (
                    <div className="p-2.5 rounded-xl bg-blue-500/10 border border-blue-500/25 text-xs text-blue-950 flex flex-col gap-1">
                      <div className="flex items-center justify-between gap-1.5 flex-wrap">
                        <span className="font-bold flex items-center gap-1">
                          <span>📍 为什么「{prosCons.best_chinese || prosCons.best_iccs}」是关键位置？</span>
                          <span className="text-[11px] font-semibold px-1.5 py-0.2 rounded bg-blue-200/80 text-blue-900">
                            {prosCons.key_square_info.zone_name}（{prosCons.key_square_info.dest_square}）
                          </span>
                        </span>
                        <div className="flex items-center gap-1">
                          {prosCons.key_square_info.tactical_tags.map((tag, ti) => (
                            <span key={ti} className="text-[10px] px-1.5 py-0.2 rounded-full bg-blue-100 border border-blue-300 font-medium">
                              #{tag}
                            </span>
                          ))}
                        </div>
                      </div>
                      <div className="text-[11.5px] leading-relaxed text-blue-900 mt-0.5">
                        👉 <b>棋理依据</b>：{prosCons.key_square_info.why_key}
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-0.5">
                    {/* 左列：走错会失去什么 */}
                    <div className="p-2.5 rounded-xl bg-paper-1 border border-hairline border-t-2 border-t-cinnabar flex flex-col gap-1.5">
                      <div className="flex items-center justify-between gap-1.5">
                        <span className="text-xs font-bold text-ink-0">
                          ❌ 走错{prosCons.wrong_chinese ? `「${prosCons.wrong_chinese}」` : ''}
                        </span>
                        {badStepsCount > 0 && (
                          <button
                            type="button"
                            className="px-2 py-0.5 text-[10.5px] rounded-lg border border-hairline text-ink-2 hover:text-ink-0 bg-paper-0 transition cursor-pointer"
                            onClick={onStartBadAnim}
                          >
                            ▶ 看动画
                          </button>
                        )}
                      </div>
                      <ul className="m-0 pl-4 text-[11.5px] leading-relaxed text-ink-2 flex flex-col gap-1">
                        {prosCons.wrong_losses.map((item, i) => (
                          <li key={i}>{item}</li>
                        ))}
                      </ul>
                    </div>

                    {/* 右列：走对能赢得什么 */}
                    <div className="p-2.5 rounded-xl bg-paper-1 border border-hairline border-t-2 border-t-emerald-600 flex flex-col gap-1.5">
                      <div className="flex items-center justify-between gap-1.5">
                        <span className="text-xs font-bold text-ink-0">
                          ✅ 走对{prosCons.best_chinese ? `「${prosCons.best_chinese}」` : ''}
                        </span>
                        {goodStepsCount > 0 && (
                          <button
                            type="button"
                            className="px-2 py-0.5 text-[10.5px] rounded-lg border border-hairline text-ink-2 hover:text-ink-0 bg-paper-0 transition cursor-pointer"
                            onClick={onStartGoodAnim}
                          >
                            ▶ 看动画
                          </button>
                        )}
                      </div>
                      <ul className="m-0 pl-4 text-[11.5px] leading-relaxed text-ink-2 flex flex-col gap-1">
                        {prosCons.best_gains.map((item, i) => (
                          <li key={i}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* Tab 2: 🧠 逆向算路三问 */}
      {activeTab === 'thinking' && thinkingGuide && (
        <div className="p-3.5 rounded-2xl bg-paper-0/95 border border-hairline shadow-xs flex flex-col gap-2.5" aria-label="第一性原理与逆向思维算路助手">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h4 className="m-0 text-xs font-bold text-ink-0">🧠 脑子想不明白接下来的走向？用这 3 步算路法</h4>
            {threatStepsCount > 0 && (
              <button
                type="button"
                className="h-6.5 px-2.5 text-xs font-medium rounded-lg border border-hairline text-ink-2 hover:text-ink-0 bg-paper-1 hover:bg-paper-2 transition cursor-pointer"
                onClick={onStartThreatAnim}
              >
                👁️ 看对手企图动画
              </button>
            )}
          </div>

          <div className="p-2.5 rounded-xl bg-paper-1 border border-hairline">
            <div className="text-[11.5px] font-bold text-blue-700 mb-1">
              ① 第一性原理（只抓盘面 3 件本质，不瞎算）
            </div>
            <ul className="m-0 pl-4 text-xs leading-relaxed text-ink-2 flex flex-col gap-1">
              {thinkingGuide.first_principles.map((fp, idx) => (
                <li key={idx}>{fp}</li>
              ))}
            </ul>
          </div>

          <div className="p-2.5 rounded-xl bg-paper-1 border border-hairline">
            <div className="text-[11.5px] font-bold text-emerald-700 mb-1">
              ② 逆向思维（从 3 步后的结果倒推现在第 1 步）
            </div>
            <p className="m-0 text-xs leading-relaxed text-ink-2">{thinkingGuide.inversion_tip}</p>
          </div>

          <div className="p-2.5 rounded-xl bg-paper-1 border border-hairline">
            <div className="text-[11.5px] font-bold text-cinnabar mb-1">
              ③ 对抗式提问（落子前站到对手角度问自己 3 句话）
            </div>
            <div className="flex flex-col gap-1.5">
              {thinkingGuide.adversarial_qa.map((item, idx) => (
                <div
                  key={idx}
                  className="p-2 rounded-lg bg-paper-0 hover:bg-paper-2 cursor-pointer transition border border-hairline"
                  onClick={() => {
                    if (item.focus) {
                      onFocusWeakness(item.focus)
                    }
                  }}
                  title={item.focus ? `点击在棋盘高亮格：${item.focus}` : undefined}
                >
                  <div className="text-xs font-bold text-ink-0">{item.q}</div>
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
          <div className="p-3.5 rounded-2xl bg-paper-0/95 border border-hairline shadow-xs flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span className="text-xs font-bold text-ink-0">
                对局胜负手拆解 · 共 {gameBreakdown.ply_count} 手
              </span>
              <span className="text-[11px] text-ink-3">
                发现 {gameBreakdown.turning_points?.length || 0} 处关键转折
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-1">
              {(['opening', 'midgame', 'endgame'] as const).map((phaseKey) => {
                const pInfo = gameBreakdown.phases?.[phaseKey]
                if (!pInfo) return null
                return (
                  <div key={phaseKey} className="p-2 rounded-xl bg-paper-1 border border-hairline flex flex-col gap-1">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold text-ink-1">{pInfo.name}</span>
                      <span className={`text-[10px] font-semibold px-1.5 py-0.2 rounded ${
                        pInfo.accuracy >= 80
                          ? 'bg-emerald-100 text-emerald-800'
                          : pInfo.accuracy >= 60
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-rose-100 text-rose-800'
                      }`}>
                        {pInfo.accuracy}%
                      </span>
                    </div>
                    <div className="text-[10.5px] text-ink-3 truncate">
                      {pInfo.verdict}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* 转折点列表 */}
          <div className="bg-paper-0/95 rounded-2xl border border-hairline p-3 flex flex-col gap-2 shadow-xs">
            <h4 className="m-0 text-xs font-bold text-ink-0">
              📌 本局关键转折点（点击加载重练）
            </h4>
            <div className="flex flex-col gap-1.5 overflow-y-auto max-h-[280px]">
              {gameBreakdown.turning_points?.map((tp: any, idx: number) => {
                const isCurrent = currentPuzzleId === tp.puzzle_id
                return (
                  <button
                    key={idx}
                    type="button"
                    className={`w-full text-left p-2.5 rounded-xl border transition-all cursor-pointer ${
                      isCurrent
                        ? 'bg-rose-50 border-cinnabar shadow-xs'
                        : 'bg-paper-1 border-hairline hover:bg-paper-2'
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
                      <span className="text-[10.5px] font-semibold px-1.5 py-0.2 rounded bg-rose-100 text-rose-800">
                        #{tp.motif_label} (-{tp.loss_pawn}兵)
                      </span>
                    </div>
                    <div className="text-[11.5px] text-ink-2 leading-relaxed">
                      {tp.coach_summary}
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* Tab 3: 🗂️ 题库列表 */}
      {activeTab === 'catalog' && (
        <div className="bg-paper-0/95 rounded-2xl border border-hairline p-3 flex flex-col shadow-xs min-h-[160px]">
          <div className="mb-2">
            <h4 className="m-0 text-xs font-bold text-ink-1">
              本类精训题库 ({categoryPuzzles.length})
            </h4>
          </div>
          <div className="flex flex-col gap-1 overflow-y-auto max-h-[300px]">
            {categoryPuzzles.map((pz, idx) => {
              const isCurrent = currentPuzzleId === pz.id
              return (
                <button
                  key={pz.id}
                  type="button"
                  className={`flex items-center justify-between px-3 py-2 rounded-xl text-xs transition cursor-pointer border ${
                    isCurrent
                      ? 'bg-cinnabar/10 border-cinnabar font-bold text-cinnabar shadow-2xs'
                      : 'bg-paper-1 border-transparent hover:bg-paper-2 text-ink-1'
                  }`}
                  onClick={() => onSelectPuzzle(pz.id)}
                >
                  <span className="font-num text-[11px] opacity-50 mr-2">#{idx + 1}</span>
                  <span className="flex-1 truncate text-left">{pz.title}</span>
                  <span className="ml-2 text-xs">
                    {pz.status === 'mastered' ? (
                      <span className="text-emerald-600 font-bold">★ 已掌握</span>
                    ) : pz.status === 'solved_with_hints' ? (
                      <span className="text-blue-600">✓ 已通关</span>
                    ) : pz.status === 'in_progress' ? (
                      <span className="text-amber-600">⏳ 练过</span>
                    ) : (
                      <span className="text-ink-4">○ 待挑战</span>
                    )}
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
