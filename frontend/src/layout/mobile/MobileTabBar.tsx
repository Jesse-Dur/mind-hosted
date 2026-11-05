import { TabBar } from "../../components/TabBar"

export function MobileTabBar({ onOpenUtilities }: { onOpenUtilities: () => void }) {
  return (
    <>
      <div aria-hidden style={{ height: "calc(34px + env(safe-area-inset-top))", flexShrink: 0, background: "#fff" }} />
      <div aria-hidden style={{ position: "fixed", top: 0, left: 0, right: 0, height: "env(safe-area-inset-top)", zIndex: 39, background: "#ede9fe" }} />
      <TabBar topOffset="env(safe-area-inset-top)" onOpenMenu={onOpenUtilities} leftAccessory={null} />
    </>
  )
}
