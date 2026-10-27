import type { GameSnapshot, ReplayReply, SandboxReply } from '../../types'
import { cleanCoachText, gradeDetail, scoreText, sideName, type causalBreakdown } from '../../lib/format'

export interface ReplayCoachCabinProps {
  current: ReplayReply['plies'][number] | null
  grade: { tone: string; text: string } | null
  why?: string | null
  turningCount: number
  hasVisualClues: boolean
  showClues: boolean
  sandboxSnap: GameSnapshot | null
  sandboxInfo: SandboxReply | null
  sandboxBusy: boolean
  canRetrySandbox: boolean
  causal: ReturnType<typeof causalBreakdown> | null
  pvMode: 'none' | 'best' | 'refute'
  onTogglePvMode: (mode: 'best' | 'refute') => void
  onContinueGame: () => void
  onNextTurningPly: () => void
  onDrillSpecificGame?: () => void
  onToggleClues: () => void
  onEnterSandbox: () => void
  onRetrySandbox: () => void
  onExitSandbox: () => void
}

/**
 * 名师精读诊断主舱 (Master Coach Diagnosis Cabin)
 * 遵循极简与降噪原则：将当前着法、病因诊断、正解点播与核心行动融为一体，
 * 消除机器坐标码，去除过度包装，降低认知负荷。
 */
export function ReplayCoachCabin({
  current,
  grade,
  why,
  turningCount,
  hasVisualClues,
  showClues,
  sandboxSnap,
  sandboxInfo,
  sandboxBusy,
  canRetrySandbox,
  causal,
  pvMode,
  onTogglePvMode,
  onContinueGame,
  onNextTurningPly,
  onDrillSpecificGame,
  onToggleClues,
  onEnterSandbox,
  onRetrySandbox,
  onExitSandbox,
}: ReplayCoachCabinProps) {
  const tactics = current?.review?.tactics

  return (
    <div className="coach-cabin flex flex-col p-3 rounded-2xl bg-paper-1/90 border border-hairline shadow-2xs text-ink-1 select-none shrink-0 transition-all duration-200">
      {/* 1. 顶部：着法标识与轻量微操工具（保证单行平铺不折行） */}
      <div className="flex items-center justify-between gap-1.5 pb-2 border-b border-hairline/60 overflow-x-auto no-scrollbar">
        {/* 左侧：手数、着法、执子与判分 */}
        <div className="flex items-center gap-1.5 shrink-0">
          {current ? (
            <>
              <span className="font-num text-[11px] font-bold px-1.5 py-0.5 rounded bg-paper-2 text-ink-3">
                #{current.ply}
              </span>
              <b className="font-display text-base font-bold text-ink-0 tracking-wide leading-none">
                {current.chinese || current.iccs}
              </b>
              <span
                className={`text-[10.5px] font-semibold px-1.5 py-0.5 rounded-full ${
                  current.side === 'red'
                    ? 'text-piece-red bg-red-500/10'
                    : 'text-piece-black bg-slate-500/10'
                }`}
              >
                {sideName(current.side)}
                {current.by === 'engine' ? '·引擎' : '·录入'}
              </span>

              {grade && (
                <span
                  className={`grade-chip tone-${grade.tone} text-[11px] px-2 py-0.5 rounded-full font-semibold shadow-3xs`}
                  title={gradeDetail(current.review)}
                >
                  {grade.text}
                </span>
              )}

              {current.eval_red !== null && (
                <span
                  className="replay-eval text-[11px] font-num font-semibold text-ink-2 px-1.5 py-0.5 rounded bg-paper-2"
                  title="走完这一手之后的评估（红方视角）"
                >
                  {scoreText(current.eval_red, current.mate_in)}
                </span>
              )}
            </>
          ) : (
            <span className="text-xs font-medium text-ink-3">
              开局局面（第 0 手未落子）
            </span>
          )}
        </div>

        {/* 右侧：单行工具胶囊（胜负手 / 法眼 / 试走） */}
        <div className="flex items-center gap-1 shrink-0 ml-auto">
          {turningCount > 0 && (
            <button
              type="button"
              className="h-6.5 px-2 rounded-lg text-xs font-medium bg-amber-500/10 hover:bg-amber-500/20 text-amber-900 border border-amber-300/60 transition cursor-pointer flex items-center gap-1 shadow-3xs"
              onClick={onNextTurningPly}
              title="跳转到对局关键胜负手/漏着"
            >
              <span>🔥</span>
              <span>胜负手</span>
              <span className="text-[10px] px-1 rounded-full bg-amber-500/25 font-bold font-num">
                {turningCount}
              </span>
            </button>
          )}

          {!sandboxSnap && (
            <button
              type="button"
              disabled={!hasVisualClues}
              className={`h-6.5 px-2 rounded-lg text-xs font-medium transition flex items-center gap-1 border shadow-3xs ${
                !hasVisualClues
                  ? 'opacity-30 cursor-not-allowed text-ink-3 border-hairline'
                  : showClues
                  ? 'bg-cinnabar text-white border-cinnabar font-semibold cursor-pointer'
                  : 'bg-paper-2/80 hover:bg-paper-2 text-ink-2 border-hairline cursor-pointer'
              }`}
              onClick={hasVisualClues ? onToggleClues : undefined}
              title={
                hasVisualClues
                  ? '在棋盘上标出当前薄弱格与正解路线'
                  : '当前手无特殊战术弱点'
              }
            >
              <span>👁️</span>
              <span>{showClues ? '收起法眼' : '法眼'}</span>
            </button>
          )}

          {!sandboxSnap ? (
            <button
              type="button"
              className="h-6.5 px-2 rounded-lg text-xs font-medium bg-paper-2/80 hover:bg-paper-2 text-ink-2 border border-hairline transition cursor-pointer disabled:opacity-40 flex items-center gap-1 shadow-3xs"
              disabled={sandboxBusy}
              onClick={onEnterSandbox}
              title="在此局面上直接落子测试分支"
            >
              <span>🔀</span>
              <span>试走</span>
            </button>
          ) : (
            <div className="flex items-center gap-1">
              <button
                type="button"
                className="h-6.5 px-2 rounded-lg text-xs font-medium bg-paper-2 hover:bg-paper-3 text-ink-2 border border-hairline transition cursor-pointer disabled:opacity-40"
                disabled={sandboxBusy || !canRetrySandbox}
                onClick={onRetrySandbox}
              >
                ↺ 重试
              </button>
              <button
                type="button"
                className="h-6.5 px-2 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white transition cursor-pointer border-0 shadow-xs"
                onClick={onExitSandbox}
              >
                ✕ 退出
              </button>
            </div>
          )}
        </div>
      </div>

      {/* 2. 中部：名师评语与交互式双轨点播演示 */}
      <div className="flex flex-col gap-2 py-2.5">
        {sandboxSnap ? (
          <div className="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-300/80 text-xs text-emerald-950 flex flex-col gap-1">
            <div className="flex items-center justify-between font-semibold">
              <span className="flex items-center gap-1">
                <span>🔀</span>
                <span>自由试走推演中</span>
              </span>
              {sandboxInfo?.user_move && (
                <span>
                  试走 <b>{sandboxInfo.user_move.chinese}</b>
                  {sandboxInfo.engine_reply ? ` → 引擎应以「${sandboxInfo.engine_reply.chinese}」` : ''}
                </span>
              )}
            </div>
            <p className="m-0 text-emerald-900/90 leading-relaxed text-[11.5px]">
              {cleanCoachText(sandboxInfo?.tactics?.coach_summary) ||
                '请在棋盘上自由走子，探索其他应对方案。随时点击右上角「退出」回到原谱。'}
            </p>
          </div>
        ) : (
          <>
            {/* 战术病因概览 */}
            {tactics && (
              <div className="flex items-start gap-1.5 text-xs">
                {tactics.motif_label && (
                  <span className="font-semibold text-cinnabar bg-cinnabar/10 border border-cinnabar/30 px-1.5 py-0.5 rounded shrink-0">
                    #{tactics.motif_label}
                  </span>
                )}
                <span className="text-ink-1 font-medium leading-relaxed">
                  {cleanCoachText(tactics.coach_summary)}
                </span>
              </div>
            )}

            {/* 正误演练小药丸（内联点播，无多余大框） */}
            {causal && (causal.bestMove || causal.punishMove) && (
              <div className="flex flex-col gap-1.5 pt-0.5">
                <div className="flex items-center gap-1.5 flex-wrap text-xs">
                  {causal.bestMove && (
                    <button
                      type="button"
                      className={`h-6.5 px-2.5 rounded-full text-xs font-medium cursor-pointer transition flex items-center gap-1 border shadow-3xs ${
                        pvMode === 'best'
                          ? 'bg-emerald-600 text-white border-emerald-700 shadow-xs'
                          : 'bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-900 border-emerald-300'
                      }`}
                      onClick={() => onTogglePvMode('best')}
                      title="在棋盘上动态演练正解攻杀路线"
                    >
                      <span>✅ 正招当走</span>
                      <b className="font-display font-semibold">
                        {causal.bestMove.chinese || causal.bestMove.iccs}
                      </b>
                      <span className="text-[10px] opacity-75">
                        {pvMode === 'best' ? '收起' : '▶ 演练'}
                      </span>
                    </button>
                  )}

                  {causal.punishMove && (
                    <button
                      type="button"
                      className={`h-6.5 px-2.5 rounded-full text-xs font-medium cursor-pointer transition flex items-center gap-1 border shadow-3xs ${
                        pvMode === 'refute'
                          ? 'bg-rose-600 text-white border-rose-700 shadow-xs'
                          : 'bg-rose-500/10 hover:bg-rose-500/20 text-rose-900 border-rose-300'
                      }`}
                      onClick={() => onTogglePvMode('refute')}
                      title="在棋盘上演练走错后对方的反击手段"
                    >
                      <span>⚠️ 遭反扑</span>
                      <b className="font-display font-semibold">
                        {causal.punishMove.chinese && causal.punishMove.chinese !== causal.punishMove.iccs
                          ? causal.punishMove.chinese
                          : '强势反扑'}
                      </b>
                      <span className="text-[10px] opacity-75">
                        {pvMode === 'refute' ? '收起' : '▶ 演练'}
                      </span>
                    </button>
                  )}
                </div>

                {/* 演练步数预览胶囊 */}
                {pvMode === 'best' && causal.bestPv.length > 0 && (
                  <div className="flex items-center gap-1 flex-wrap text-[11px] animate-fadeIn">
                    <span className="text-[10.5px] text-emerald-800 font-bold">正解路线:</span>
                    {causal.bestPv.slice(0, 5).map((st, i) => (
                      <span
                        key={i}
                        className="px-1.5 py-0.2 rounded bg-paper-2 border border-hairline font-medium text-ink-2 text-[10.5px]"
                      >
                        {st.chinese || st.iccs}
                      </span>
                    ))}
                  </div>
                )}

                {pvMode === 'refute' && causal.refutePv.length > 0 && (
                  <div className="flex items-center gap-1 flex-wrap text-[11px] animate-fadeIn">
                    <span className="text-[10.5px] text-rose-800 font-bold">反击路线:</span>
                    {causal.refutePv.slice(0, 5).map((st, i) => (
                      <span
                        key={i}
                        className="px-1.5 py-0.2 rounded bg-paper-2 border border-hairline font-medium text-ink-2 text-[10.5px]"
                      >
                        {st.chinese || st.iccs}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* 子力因果原因 */}
            {why && (
              <div className="flex items-start gap-1 p-1.5 rounded-lg bg-paper-2/60 border border-hairline/60 text-[11.5px] text-ink-2 leading-relaxed">
                <span className="shrink-0 text-amber-600 font-bold">💡</span>
                <span>{cleanCoachText(why)}</span>
              </div>
            )}

            {!tactics && !why && (!causal || (!causal.bestMove && !causal.punishMove)) && current && (
              <p className="m-0 text-xs text-ink-3 leading-relaxed">
                {current.by === 'engine'
                  ? '引擎执子走步 · 局势平稳推进。'
                  : '此步平稳推进，无明显失先或战术破绽。可继续前推复盘。'}
              </p>
            )}
          </>
        )}
      </div>

      {/* 3. 底部：轻量行动条（入营特训 vs 从此接下） */}
      <div className="grid grid-cols-2 gap-2 pt-2 border-t border-hairline/60">
        {onDrillSpecificGame ? (
          <button
            type="button"
            className="h-7.5 px-2.5 rounded-lg text-xs font-semibold bg-paper-2 hover:bg-paper-3 text-ink-0 border border-hairline transition-all cursor-pointer flex items-center justify-center gap-1 active:scale-[0.98]"
            onClick={onDrillSpecificGame}
            title="将整局棋谱载入名师特训营，进行深度拆解"
          >
            <span>🎯</span>
            <span className="whitespace-nowrap">入营拆解本局</span>
          </button>
        ) : (
          <div />
        )}

        <button
          type="button"
          className="h-7.5 px-2.5 rounded-lg text-xs font-semibold bg-paper-2 hover:bg-paper-3 text-ink-0 border border-hairline transition-all cursor-pointer flex items-center justify-center gap-1 active:scale-[0.98]"
          onClick={onContinueGame}
          title="从此局面开始，进入实战对局与引擎对练"
        >
          <span>⚔️</span>
          <span className="whitespace-nowrap">从此局面接着下</span>
        </button>
      </div>
    </div>
  )
}
