import { useCallback, useEffect, useRef } from 'react'
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

  // 全量渲染：状态层已保证最多 3 条（useGame.pushToast 的 slice(-3)），
  // 这里再 slice(-1) 是把堆叠容器、间距与退场动画一并废掉 —— 连续两条
  // 提示时后一条会瞬杀前一条，用户永远看不到前因（F5）。
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

// 快捷键分四组，与三个 keydown handler 单一事实源逐条对齐：
// App.tsx:121-198（全局）、ReplayDesk.tsx:265-301（复盘台）、
// DrillDesk.tsx:803-841（特训营）、App.tsx:147-153（排局台）。
// 不存在的承诺一律删（曾经的「Tab 采纳第一个候选走法」无任何 handler 支撑）；
// 语境切换写明在组标题里（特训营内 T = 威胁动画，不是切主题）。
const SHORTCUT_GROUPS: { title: string; items: { keys: string; what: string }[] }[] = [
  {
    title: '全局 · 主台对弈',
    items: [
      { keys: '方向键', what: '在棋盘上移动光标（Tab 聚焦或点一下棋盘）' },
      { keys: 'Enter / 空格', what: '棋盘上：选中 / 落子；录入框内：回车提交走法' },
      { keys: '空格', what: '引擎思考时，立即落下当前最佳一手' },
      { keys: 'Esc', what: '关闭最上层的弹层（帮助 / 复盘 / 特训），或退出禅境' },
      { keys: '⌘/Ctrl + Z', what: '悔棋' },
      { keys: '⌘/Ctrl + N', what: '开新局（保持当前执子方）' },
      { keys: 'Z', what: '禅意极简专注对弈模式' },
      { keys: 'T', what: '切换美学材质（宣纸 · 乌墨）' },
      { keys: 'F / X', what: '翻转棋盘视角' },
      { keys: ']', what: '展开 / 收起右侧分析栏（或 ⌘/Ctrl + B）' },
      { keys: '/', what: '展开并聚焦走法录入栏' },
      { keys: '?', what: '打开本帮助（或 Shift + /）' },
    ],
  },
  {
    title: '复盘台 · 打开复盘后生效',
    items: [
      { keys: '← / →', what: '上一手 / 下一手' },
      { keys: '↑ / ↓', what: '跳到上一个 / 下一个评分关键手' },
      { keys: 'Home / End', what: '回到开局 / 跳到终局' },
      { keys: '空格', what: '自动播放 开 / 关' },
      { keys: 'Esc', what: '退出复盘台' },
    ],
  },
  {
    title: '特训营 · 打开后接管以上全局键',
    items: [
      { keys: 'F', what: '翻转棋盘' },
      { keys: 'Z', what: '撤销一步' },
      { keys: 'R', what: '重置本题' },
      { keys: 'H', what: '请求提示' },
      { keys: 'N', what: '下一题' },
      { keys: 'T', what: '播放威胁暗线动画' },
      { keys: 'Esc', what: '退出特训营' },
    ],
  },
  {
    title: '排局台 · 打开排局后生效',
    items: [
      { keys: 'Delete / ⌫', what: '移除选中的棋子' },
      { keys: 'Esc', what: '清除当前选择（退出排局：左上角「← 退出排局」）' },
    ],
  },
]

export function HelpOverlay(props?: { open?: boolean; onClose?: () => void }) {
  const ui = useUIContext()
  const open = props?.open ?? ui.help
  const onCloseProp = props?.onClose
  const onClose = useCallback(
    () => (onCloseProp ? onCloseProp() : ui.setHelp(false)),
    [onCloseProp, ui.setHelp],
  )
  const [mounted, leaving] = useExitPhase(open)
  const sheetRef = useRef<HTMLDivElement>(null)
  const restoreFocusRef = useRef<HTMLElement | null>(null)

  // ---- Esc 契约：帮助层永远是视觉最上层，Esc 只该关掉它 ----
  // 捕获阶段监听先于一切注册在 window 上的冒泡监听（App 全局键、
  // 复盘台、特训营各自的 keydown），stopImmediatePropagation 让它们
  // 这一轮不出声 —— 否则帮助叠在复盘台 / 特训营上时，按一次 Esc
  // 会「一键关两层」，禅境也会被顺带退出。
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopImmediatePropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, onClose])

  // ---- 焦点管理：打开时记住焦点去向，关闭时还回去 ----
  useEffect(() => {
    if (!open) return
    restoreFocusRef.current = document.activeElement as HTMLElement | null
  }, [open])

  useEffect(() => {
    if (open && mounted) sheetRef.current?.focus()
  }, [open, mounted])

  useEffect(() => {
    if (open) return
    const prev = restoreFocusRef.current
    restoreFocusRef.current = null
    // 焦点目标可能已随界面卸载（如顶栏按钮），isConnected 兜底
    if (prev?.isConnected) prev.focus()
  }, [open])

  // Tab 圈定在弹层内：aria-modal 的对话，焦点不该走到背后的台面去
  const onSheetKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab') return
    const sheet = sheetRef.current
    if (!sheet) return
    const focusables = sheet.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    )
    if (focusables.length === 0) return
    const first = focusables[0]
    const last = focusables[focusables.length - 1]
    const active = document.activeElement
    if (e.shiftKey && (active === first || active === sheet)) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && active === last) {
      e.preventDefault()
      first.focus()
    }
  }

  if (!mounted) return null

  return (
    <div className={`overlay${leaving ? ' is-leaving' : ''}`} onClick={onClose}>
      <div
        ref={sheetRef}
        className={`sheet${leaving ? ' is-leaving' : ''}`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-title"
        tabIndex={-1}
        onKeyDown={onSheetKeyDown}
      >
        <header className="sheet-head">
          <h2 id="help-title">这台软件怎么用</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="关闭">
            ✕
          </button>
        </header>

        <ol className="howto">
          <li>
            <strong>🎯 实战陪练学棋。</strong>在左栏选择适合你的陪练段位（启蒙/棋摊/名手/宗师）执子下棋。当走出严重失先缓手时，「师傅扶手」会立即暂停并弹出棋理点拨与破绽显影，助你听劝重走、知其所以然。
          </li>
          <li>
            <strong>🏟️ 特训营闯关。</strong>点击顶栏「特训营」进入系统化杀法、功法与残局试炼。支持三选一演练试探、空间暗线透视（炮架/马腿/无根子）与镜像变式大考，直至真正精通掌握。
          </li>
          <li>
            <strong>📡 信使代下转述。</strong>在与外部大模型下棋时，可切换为「信使代下」模式：直接在盘上录入对手走法（或敲击键盘 <code>/</code> 展开录入栏），一键复制引擎最佳应手反馈给对方模型。
          </li>
          <li>
            <strong>🔍 动态胜负手复盘。</strong>每一局结束均可点击「复盘本局」或右栏错题本，系统自动直达关键胜负手，看清每一步胜势起伏与因果得失。
          </li>
          <li>
            <strong>♟️ 自由排局。</strong>从左栏进入排局台：双翼棋架取子布阵，或载入经典残局与 FEN 局面；摆好先后手，即可「从此局面开练」。Delete / Backspace 可移除选中的棋子。
          </li>
        </ol>

        <h3>快捷键</h3>
        {SHORTCUT_GROUPS.map((group) => (
          <section key={group.title}>
            <h4>{group.title}</h4>
            <ul className="shortcuts">
              {group.items.map((s) => (
                <li key={s.keys}>
                  <kbd>{s.keys}</kbd>
                  <span>{s.what}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}

        <h3>关于 AI 引擎</h3>
        <p className="hint">
          XQ-Coach 象棋教练由顶尖开源象棋引擎 <strong>皮卡鱼 Pikafish (NNUE)</strong> 统一驱动全段位对弈实训与全局深度复盘，兼具拟人对弈呼吸感与大师级棋局评测。
        </p>
      </div>
    </div>
  )
}
