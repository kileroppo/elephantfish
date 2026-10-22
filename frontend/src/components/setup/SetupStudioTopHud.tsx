import { memo, useEffect, useRef, useState } from 'react'
import { useUIContext } from '../../context/UIContext'
import { ENDGAME_TEMPLATES, type EndgameTemplate } from '../panels/SetupTemplates'

// 扩充高价值经典残局模板
const EXTENDED_TEMPLATES: EndgameTemplate[] = [
  ...ENDGAME_TEMPLATES,
  {
    name: '七星聚会',
    desc: '清代四大江湖名局之首，车卒斗勇深奥莫测',
    fen: '2b1kab2/9/9/4p4/2R1p1p2/3r5/2p1C1c2/4B4/4A4/2BAK4 w - - 0 1',
  },
  {
    name: '野马操田',
    desc: '古代江湖四大名局之一，车马兵卒十步九变',
    fen: '4k1b2/4a4/4ba3/9/9/9/9/9/4N4/4K4 w - - 0 1',
  },
  {
    name: '卧槽马绝杀',
    desc: '红马卧槽控将借帅力巧杀实战局',
    fen: '3ak4/4a4/9/9/9/9/9/9/4N4/4K4 w - - 0 1',
  },
  {
    name: '兵控九宫巧胜',
    desc: '高兵深控九宫破单士经典残局',
    fen: '3ak4/9/9/4P4/9/9/9/9/9/4K4 w - - 0 1',
  },
]

interface SetupStudioTopHudProps {
  currentFen: string
  onExit: () => void
  onImportFen: (fen: string) => boolean
  onClearBoard: () => void
  onResetStandard: () => void
  onRevertOriginal: () => void
  onToast: (text: string, tone?: 'info' | 'warn' | 'error') => void
}

/**
 * 排局工作室顶部悬浮微灵动 HUD
 * - 紧凑轻量，半透明毛玻璃材质，不占视口高度
 * - 智能嗅探剪贴板 FEN 并呈现秒载提示
 * - 集成经典残局下拉与盘面快速复位
 */
export const SetupStudioTopHud = memo(function SetupStudioTopHud({
  currentFen,
  onExit,
  onImportFen,
  onClearBoard,
  onResetStandard,
  onRevertOriginal,
  onToast,
}: SetupStudioTopHudProps) {
  const ui = useUIContext()
  const [templateOpen, setTemplateOpen] = useState(false)
  const [fenModalOpen, setFenModalOpen] = useState(false)
  const [fenInput, setFenInput] = useState('')
  const [clipboardFen, setClipboardFen] = useState<string | null>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // 嗅探剪贴板中的 FEN 串
  const checkClipboard = async () => {
    try {
      if (typeof navigator === 'undefined' || !navigator.clipboard?.readText) return
      const text = (await navigator.clipboard.readText()).trim()
      // 简单判断象棋 FEN 特征：包含斜杠且有至少 7 行，且包含常见子力字母
      const slashCount = (text.match(/\//g) || []).length
      if (slashCount >= 8 && /[kK]/.test(text) && text !== currentFen) {
        setClipboardFen(text)
      } else {
        setClipboardFen(null)
      }
    } catch {
      // 忽略剪贴板无权限
    }
  }

  useEffect(() => {
    void checkClipboard()
    const handleFocus = () => void checkClipboard()
    window.addEventListener('focus', handleFocus)
    return () => window.removeEventListener('focus', handleFocus)
  }, [currentFen])

  // 点击外部关闭模板下拉菜单
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setTemplateOpen(false)
      }
    }
    if (templateOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [templateOpen])

  const handleCopyFen = async () => {
    try {
      await navigator.clipboard.writeText(currentFen)
      onToast('当前 FEN 已复制到剪贴板', 'info')
    } catch {
      onToast('复制失败，请手动选取', 'warn')
    }
  }

  const handleApplyFen = (fenString: string) => {
    const ok = onImportFen(fenString.trim())
    if (ok) {
      onToast('已成功载入 FEN 局面', 'info')
      setFenModalOpen(false)
      setFenInput('')
      setClipboardFen(null)
    } else {
      onToast('FEN 格式不合规，解析失败', 'error')
    }
  }

  return (
    <header className="setup-studio-top-hud relative flex items-center justify-between w-full max-w-[820px] px-4 py-2 mx-auto rounded-full bg-paper-1/85 backdrop-blur-md border border-hairline-strong shadow-md select-none z-30 transition-all">
      {/* 左侧：退出排局按钮与模式标牌 */}
      <div className="flex items-center gap-2.5">
        <button
          type="button"
          onClick={onExit}
          className="btn btn-ghost h-7.5 px-3 rounded-full text-xs font-semibold bg-paper-2 hover:bg-paper-3 text-ink-1 border border-hairline transition-all flex items-center gap-1.5 shadow-2xs hover:scale-[1.02] cursor-pointer"
          title="退出排局模式"
        >
          <span className="text-sm">←</span>
          <span>退出排局</span>
        </button>

        <span className="studio-pill px-2.5 py-0.5 rounded-full bg-cinnabar/10 text-cinnabar border border-cinnabar/25 text-[11px] font-bold tracking-wider">
          STUDIO 排局
        </span>
      </div>

      {/* 中部：智能剪贴板秒载胶囊 */}
      {clipboardFen && (
        <button
          type="button"
          onClick={() => handleApplyFen(clipboardFen)}
          className="clipboard-pill hidden sm:flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/40 text-emerald-700 text-xs font-semibold shadow-xs animate-[pulse_2s_infinite] hover:bg-emerald-500/25 transition-colors cursor-pointer"
          title={`点击一键载入：${clipboardFen}`}
        >
          <span>⚡</span>
          <span>剪贴板检测到残局 (点击秒载)</span>
        </button>
      )}

      {/* 右侧：经典残局库、FEN 导入/复制、清空重置 */}
      <div className="flex items-center gap-1.5" ref={dropdownRef}>
        {/* 经典残局下拉 */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setTemplateOpen((v) => !v)}
            className={`btn btn-ghost h-7.5 px-3 rounded-full text-xs font-semibold border transition-all flex items-center gap-1 cursor-pointer ${
              templateOpen
                ? 'bg-paper-3 border-cinnabar text-cinnabar shadow-xs'
                : 'bg-paper-0 hover:bg-paper-2 border-hairline text-ink-1'
            }`}
          >
            <span>经典残局</span>
            <span className="text-[10px] opacity-70">▾</span>
          </button>

          {templateOpen && (
            <div className="absolute right-0 top-full mt-2 w-72 p-2 rounded-[var(--r-lg)] bg-paper-1/95 backdrop-blur-lg border border-hairline-strong shadow-xl flex flex-col gap-1 z-50 animate-in fade-in zoom-in-95 duration-150">
              <div className="text-[11px] font-semibold text-ink-mute px-2 py-1">
                点击快速置入实战/名局残篇：
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {EXTENDED_TEMPLATES.map((tmpl) => (
                  <button
                    key={tmpl.name}
                    type="button"
                    onClick={() => {
                      onImportFen(tmpl.fen)
                      onToast(`已载入残局「${tmpl.name}」`, 'info')
                      setTemplateOpen(false)
                    }}
                    className="p-2 rounded-[var(--r-md)] bg-paper-0 hover:bg-cinnabar/10 hover:text-cinnabar border border-hairline hover:border-cinnabar/30 text-left transition-colors cursor-pointer"
                    title={tmpl.desc}
                  >
                    <div className="text-xs font-bold truncate">{tmpl.name}</div>
                    <div className="text-[10px] text-ink-mute truncate">{tmpl.desc}</div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* FEN 按钮 */}
        <button
          type="button"
          onClick={() => setFenModalOpen(true)}
          className="btn btn-ghost h-7.5 px-2.5 rounded-full text-xs font-medium bg-paper-0 hover:bg-paper-2 border border-hairline text-ink-1 shadow-2xs cursor-pointer"
          title="复制当前 FEN 或手动粘贴导入"
        >
          FEN
        </button>

        {/* 盘面快速操作：清空 / 开局 */}
        <button
          type="button"
          onClick={onClearBoard}
          className="btn btn-ghost h-7.5 px-2.5 rounded-full text-xs font-medium bg-paper-0 hover:bg-red-500/10 hover:text-red-600 border border-hairline text-ink-2 shadow-2xs cursor-pointer"
          title="清空盘面所有棋子"
        >
          清空
        </button>

        <button
          type="button"
          onClick={onResetStandard}
          className="btn btn-ghost h-7.5 px-2.5 rounded-full text-xs font-medium bg-paper-0 hover:bg-paper-2 border border-hairline text-ink-1 shadow-2xs cursor-pointer"
          title="恢复为标准开局 32 颗棋子"
        >
          标准
        </button>

        <button
          type="button"
          onClick={onRevertOriginal}
          className="btn btn-ghost h-7.5 px-2.5 rounded-full text-xs font-medium bg-paper-0 hover:bg-paper-2 border border-hairline text-ink-mute shadow-2xs cursor-pointer"
          title="还原为进入补棋前的局面"
        >
          还原
        </button>

        {/* 音效开关 */}
        <button
          type="button"
          onClick={ui.toggleSound}
          className="btn btn-ghost h-7.5 w-7.5 rounded-full text-xs font-medium bg-paper-0 hover:bg-paper-2 border border-hairline text-ink-2 shadow-2xs flex items-center justify-center cursor-pointer"
          title={ui.soundOn ? '静音' : '开启音效'}
        >
          {ui.soundOn ? '🔔' : '🔕'}
        </button>

        {/* 主题切换 */}
        <button
          type="button"
          onClick={ui.cycleTheme}
          className="btn btn-ghost h-7.5 w-7.5 rounded-full text-xs font-medium bg-paper-0 hover:bg-paper-2 border border-hairline text-ink-2 shadow-2xs flex items-center justify-center cursor-pointer"
          title={`切换主题（当前：${ui.theme === 'xuan' ? '宣纸' : '乌木'}）`}
        >
          {ui.theme === 'xuan' ? '☀️' : '🌙'}
        </button>
      </div>

      {/* FEN 输入/复制弹窗 */}
      {fenModalOpen && (
        <div
          className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center z-[100] animate-in fade-in duration-150"
          onClick={() => setFenModalOpen(false)}
        >
          <div
            className="w-full max-w-md p-5 rounded-[var(--r-xl)] bg-paper-1 border border-hairline-strong shadow-2xl flex flex-col gap-3.5 m-4 animate-in zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-ink-1 flex items-center gap-1.5">
                <span>FEN 局面管理</span>
              </h3>
              <button
                type="button"
                onClick={() => setFenModalOpen(false)}
                className="w-6 h-6 rounded-full hover:bg-paper-3 flex items-center justify-center text-ink-mute text-xs cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* 当前 FEN 复制 */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-ink-2">当前盘面 FEN：</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  readOnly
                  value={currentFen}
                  className="flex-1 px-3 py-1.5 rounded-md font-num text-xs bg-paper-0 border border-hairline text-ink-1 focus:outline-none"
                  onClick={(e) => (e.target as HTMLInputElement).select()}
                />
                <button
                  type="button"
                  onClick={handleCopyFen}
                  className="btn btn-primary h-8 px-3 rounded-md text-xs font-semibold bg-cinnabar hover:bg-cinnabar-bright text-white shadow-xs cursor-pointer"
                >
                  复制
                </button>
              </div>
            </div>

            {/* 导入 FEN */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-ink-2">导入自定义 FEN：</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="粘贴 FEN 字符串，如 4k4/9/9/9/9/9/9/9/9/4K4 w - - 0 1"
                  value={fenInput}
                  onChange={(e) => setFenInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleApplyFen(fenInput)
                  }}
                  className="flex-1 px-3 py-1.5 rounded-md font-num text-xs bg-paper-0 border border-hairline text-ink-1 focus:border-cinnabar focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => handleApplyFen(fenInput)}
                  className="btn btn-ghost h-8 px-3 rounded-md text-xs font-semibold bg-paper-2 hover:bg-paper-3 text-ink-1 border border-hairline shadow-2xs cursor-pointer"
                >
                  载入
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </header>
  )
})
