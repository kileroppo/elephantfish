interface RailTabsProps {
  railL: boolean
  railR: boolean
  onToggleL: () => void
  onToggleR: () => void
}

export function RailTabs({ railL, onToggleL }: RailTabsProps) {
  return (
    <button
      type="button"
      className={`rail-tab rail-tab-left !hidden md:!inline-flex fixed top-1/2 -translate-y-1/2 z-40 items-center gap-1.5 py-2.5 px-1.5 rounded-full bg-paper-0/95 hover:bg-paper-0 border border-hairline-strong shadow-md text-ink-3 hover:text-ink-0 text-xs transition-all duration-300 select-none cursor-pointer ${
        railL ? 'is-open left-[calc(var(--rail-l,262px)+8px)]' : 'left-3'
      }`}
      onClick={onToggleL}
      aria-label={railL ? '收起对局控制与设置' : '展开对局控制与设置'}
      aria-expanded={railL}
      title={railL ? '收起左侧面板' : '展开左侧面板 (段位/设置/操作)'}
    >
      <span className="text-[9px] transform transition-transform duration-200 opacity-70">
        {railL ? '◀' : '▶'}
      </span>
      <span className="writing-vertical text-[11px] font-medium leading-none tracking-widest my-0.5">
        {railL ? '收起' : '设置'}
      </span>
    </button>
  )
}
