export interface EndgameTemplate {
  name: string
  desc: string
  fen: string
}

export const ENDGAME_TEMPLATES: EndgameTemplate[] = [
  {
    name: '单车胜单缺士',
    desc: '红单车攻黑单缺士（单士双象）经典胜局',
    fen: '4k4/4a4/2b1b4/9/9/9/9/9/4R4/4K4 w - - 0 1',
  },
  {
    name: '马兵攻单士象',
    desc: '红马高兵攻黑单士象经典例胜残局',
    fen: '3k5/4a4/4b4/4P4/2N6/9/9/9/9/4K4 w - - 0 1',
  },
  {
    name: '双炮攻双士象',
    desc: '红双炮攻黑双士单象控盘巧胜残局',
    fen: '3aka3/9/4b4/9/9/9/9/2C3C2/9/4K4 w - - 0 1',
  },
  {
    name: '车双士巧胜单车双士',
    desc: '红车双士借帅力巧破黑单车双士经典残局',
    fen: '3aka3/9/1r7/9/9/9/9/4A4/4A4/3K1R3 w - - 0 1',
  },
]

export interface SetupTemplatesProps {
  fenOpen: boolean
  currentFen: string
  fenInput: string
  onFenInputChange: (val: string) => void
  onCopyFen: () => void
  onApplyFen: () => void
  onLoadTemplate: (template: EndgameTemplate) => void
}

export function SetupTemplates({
  fenOpen,
  currentFen,
  fenInput,
  onFenInputChange,
  onCopyFen,
  onApplyFen,
  onLoadTemplate,
}: SetupTemplatesProps) {
  return (
    <div className="flex flex-col gap-2">
      {/* 经典残局演练模板 (常驻展示) */}
      <div className="fen-templates-row flex flex-col gap-1.5 p-2 rounded bg-paper-2/50 border border-hairline/80">
        <span className="fen-label text-xs text-ink-mute font-medium">经典残局演练模板：</span>
        <div className="flex flex-wrap gap-1.5">
          {ENDGAME_TEMPLATES.map((tmpl) => (
            <button
              key={tmpl.name}
              type="button"
              className="btn btn-ghost btn-sm h-7 px-2.5 rounded text-xs font-medium bg-paper-0 hover:bg-paper-1 text-ink-1 border border-hairline transition-colors flex items-center justify-center cursor-pointer shadow-2xs"
              onClick={() => onLoadTemplate(tmpl)}
              title={`点击快速载入残局盘面：${tmpl.desc}`}
            >
              {tmpl.name}
            </button>
          ))}
        </div>
      </div>

      {/* FEN 抽屉 */}
      {fenOpen && (
        <div className="setup-fen-box flex flex-col gap-2 p-3 rounded-md bg-paper-2/70 border border-hairline animate-in fade-in duration-200">
          <div className="fen-row flex items-center gap-2">
            <span className="fen-label text-xs font-medium text-ink-2 min-w-[65px]">当前 FEN:</span>
            <input
              type="text"
              readOnly
              value={currentFen}
              className="fen-input flex-1 px-2.5 py-1 rounded font-num text-xs bg-paper-0 border border-hairline-strong text-ink-1 focus:border-cinnabar focus:outline-hidden"
              onClick={(e) => (e.target as HTMLInputElement).select()}
            />
            <button
              type="button"
              className="btn btn-ghost btn-sm h-7 px-3 rounded text-xs font-medium bg-paper-0 hover:bg-paper-1 text-ink-1 border border-hairline transition-colors flex items-center justify-center cursor-pointer shrink-0"
              onClick={onCopyFen}
            >
              复制
            </button>
          </div>
          <div className="fen-row flex items-center gap-2">
            <span className="fen-label text-xs font-medium text-ink-2 min-w-[65px]">导入 FEN:</span>
            <input
              type="text"
              placeholder="粘贴 FEN 字符串，如 4k4/9/9/9/9/9/9/9/9/4K4 w - - 0 1"
              value={fenInput}
              onChange={(e) => onFenInputChange(e.target.value)}
              className="fen-input flex-1 px-2.5 py-1 rounded font-num text-xs bg-paper-0 border border-hairline-strong text-ink-1 focus:border-cinnabar focus:outline-hidden"
              onKeyDown={(e) => {
                if (e.key === 'Enter') onApplyFen()
              }}
            />
            <button
              type="button"
              className="btn btn-primary btn-sm h-7 px-3 rounded text-xs font-semibold bg-cinnabar hover:bg-cinnabar-bright text-white transition-colors flex items-center justify-center cursor-pointer shrink-0 border-0 shadow-xs"
              onClick={onApplyFen}
            >
              导入
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
