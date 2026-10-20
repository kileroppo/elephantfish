import { useEffect } from 'react'
import { useExitPhase } from '../hooks/useExitPhase'
import type { Toast } from '../hooks/useGame'

export function Toasts({
  items,
  onDismiss,
}: {
  items: Toast[]
  onDismiss: (id: number) => void
}) {
  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {items.map((t) => (
        <button
          key={t.id}
          type="button"
          className={`toast toast-${t.tone}${t.leaving ? ' is-leaving' : ''}`}
          onClick={() => onDismiss(t.id)}
        >
          <span className="toast-dot" />
          {t.text}
        </button>
      ))}
    </div>
  )
}

const SHORTCUTS: { keys: string; what: string }[] = [
  { keys: '方向键 + 回车', what: '在棋盘上移动光标、选中 / 落子（先点一下棋盘或 Tab 聚焦）' },
  { keys: 'Enter', what: '提交输入框里的走法' },
  { keys: 'Tab', what: '采纳第一个候选走法' },
  { keys: 'Esc', what: '清空输入 / 关闭弹层' },
  { keys: 'Ctrl + Z', what: '悔一步' },
  { keys: 'Ctrl + N', what: '开新局（保持当前执子方）' },
  { keys: 'F', what: '翻转棋盘视角' },
  { keys: 'Space', what: '引擎思考时，立即采用当前最好的一步' },
  { keys: '/', what: '聚焦到录入框' },
]

export function HelpOverlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [mounted, leaving] = useExitPhase(open)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!mounted) return null

  return (
    <div className={`overlay${leaving ? ' is-leaving' : ''}`} onClick={onClose}>
      <div
        className={`sheet${leaving ? ' is-leaving' : ''}`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <header className="sheet-head">
          <h2>这台软件怎么用</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="关闭">
            ✕
          </button>
        </header>

        <ol className="howto">
          <li>
            <strong>选边。</strong>在左栏选引擎执红还是执黑——那是「我方」。
          </li>
          <li>
            <strong>看对方。</strong>在你和那台大模型下棋的界面里，看它走了什么。
          </li>
          <li>
            <strong>录进来。</strong>最快的办法是<b>在棋盘上点那颗子、再点落点</b>，或者按住它
            拖过去 —— 轮到的子会有抓手光标，可以走的点会亮起来。也可以敲坐标{' '}
            <code>h2e2</code> 或中文记谱 <code>炮二平五</code>。搞错了就按悔棋。
          </li>
          <li>
            <strong>取应手。</strong>引擎会立刻算，②里给出它的一步棋。点一下复制，
            再把这步棋喂回给对方模型。
          </li>
          <li>
            <strong>循环到赢。</strong>右栏能实时看到引擎的深度、评分和它算到的后续，
            心里有底。
          </li>
        </ol>

        <h3>快捷键</h3>
        <ul className="shortcuts">
          {SHORTCUTS.map((s) => (
            <li key={s.keys}>
              <kbd>{s.keys}</kbd>
              <span>{s.what}</span>
            </li>
          ))}
        </ul>

        <h3>关于 AI 引擎</h3>
        <p className="hint">
          XQ-Coach 象棋教练支持双引擎自由切换：可使用顶尖开源引擎 <strong>皮卡鱼 Pikafish (NNUE)</strong> 进行深度评估与顽强防守，也可选用纯 Python 内置引擎进行轻量对弈与算法实验。
        </p>
      </div>
    </div>
  )
}
