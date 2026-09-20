// The shell is desktop-only; UtilityContent is shared with the mobile sheet.
import { useEffect } from "react"
import { useStore } from "../store"
import { startSidebarWarmupOnOpen } from "../startup/workspaceStartup"
import { UtilityContent } from "./UtilityContent"

export function Sidebar() {
  const { sidebarOpen, setSidebarOpen } = useStore()

  useEffect(() => {
    if (sidebarOpen) void startSidebarWarmupOnOpen()
  }, [sidebarOpen])

  return (
    <>
      {sidebarOpen && <div onClick={() => setSidebarOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 60 }} />}
      <aside style={{ position: "fixed", top: 0, left: 0, width: 260, maxWidth: "85vw", height: "100dvh", boxSizing: "border-box", background: "#fff", borderRight: "1px solid #e8e8e8", boxShadow: sidebarOpen ? "4px 0 24px rgba(0,0,0,0.08)" : "none", transform: sidebarOpen ? "translateX(0)" : "translateX(-100%)", transition: "transform 0.22s cubic-bezier(0.4,0,0.2,1), box-shadow 0.22s ease", zIndex: 70, padding: "8px 16px 16px" }}>
        <UtilityContent onClose={() => setSidebarOpen(false)} />
      </aside>
    </>
  )
}
