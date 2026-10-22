interface RailTabsProps {
  railL: boolean
  railR: boolean
  onToggleL: () => void
  onToggleR: () => void
}

export function RailTabs(_props: RailTabsProps) {
  // 第一性原理：砍掉一切多余部件。紧凑对弈控制岛高度仅 ~170px，常驻且不遮挡任何内容，不再需要折叠把手与浮层
  return null
}
