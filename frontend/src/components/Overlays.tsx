import { useEffect } from 'react'
import { useExitPhase } from '../hooks/useExitPhase'
import type { Toast } from '../hooks/useGame'
import { useGameContext } from '../context/GameContext'
import { useUIContext } from '../context/UIContext'

export function Toasts(props?: {
  items?: Toast[]
  onDismiss?: (id: number) => void
}) {
  const g = useGameContext()
  const items = props?.items ?? g.toasts
  const onDismiss = props?.onDismiss ?? g.dismissToast

  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {items.slice(-1).map((t) => (
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
  { keys: 'Esc', what: '清空输入 / 关闭弹层 / 退出禅境' },
  { keys: 'Ctrl + Z', what: '悔一步' },
  { keys: 'Ctrl + N', what: '开新局（保持当前执子方）' },
  { keys: 'Z', what: '开启 / 退出 禅意极简专注对弈模式' },
  { keys: 'T', what: '切换东方美学材质（宣纸 · 乌墨）' },
  { keys: 'F', what: '翻转棋盘视角' },
  { keys: 'Space', what: '引擎思考时，立即采用当前最好的一步' },
  { keys: '/', what: '聚焦到录入框' },
]

export function HelpOverlay(props?: { open?: boolean; onClose?: () => void }) {
  const ui = useUIContext()
  const open = props?.open ?? ui.help
  const onClose = props?.onClose ?? (() => ui.setHelp(false))
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
            <strong>🎯 实战陪练学棋。</strong>在左栏选择适合你的陪练段位（启蒙/棋摊/名手/宗师）执子下棋。当走出严重失先缓手时，「师傅扶手」会立即暂停并弹出棋理点拨与破绽显影，助你听劝重走、知其所以然。
          </li>
          <li>
            <strong>🏟️ 精训营闯关。</strong>点击顶栏「精训营」进入系统化杀法、功法与残局试炼。支持三选一演练试探、空间暗线透视（炮架/马腿/无根子）与镜像变式大考，直至真正精通掌握。
          </li>
          <li>
            <strong>📡 信使代打转述。</strong>在与外部大模型下棋时，可切换为「信使代打」模式：直接在盘上录入对手走法（或敲击键盘 <code>/</code> 录入），一键复制引擎最佳应手反馈给对方模型。
          </li>
          <li>
            <strong>🔍 动态胜负手复盘。</strong>每一局结束均可点击「复盘本局」或右栏错题本，系统自动直达关键胜负手，看清每一步胜势起伏与因果得失。
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
