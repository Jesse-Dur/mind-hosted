import { useEffect, useState } from "react"
import { useStore } from "../../store"
import { Canvas } from "../../components/Canvas"
import { Sidebar } from "../../components/Sidebar"
import { TabBar } from "../../components/TabBar"
import { Tooltip } from "../../components/Tooltip"
import { AiStatusPill } from "../../components/AiStatusPill"
import { startSidebarWarmupOnHover } from "../../startup/workspaceStartup"

export default function DesktopWorkspace() {
  const { sidebarOpen, setSidebarOpen, tabsVisible } = useStore()
  const [tabBarVisible, setTabBarVisible] = useState(tabsVisible)
  const [tabBarAnimating, setTabBarAnimating] = useState(false)

  useEffect(() => {
    if (tabsVisible) {
      setTabBarVisible(true)
      setTabBarAnimating(false)
      return
    }
    setTabBarAnimating(true)
    const timer = setTimeout(() => { setTabBarVisible(false); setTabBarAnimating(false) }, 180)
    return () => clearTimeout(timer)
  }, [tabsVisible])

  return (
    <>
      <Sidebar />
      {tabBarVisible && <TabBar slidingOut={tabBarAnimating} />}
      {!tabsVisible && (
        <div style={{ position: "fixed", top: 12, left: 12, zIndex: 50, display: "flex", alignItems: "center", gap: 6 }}>
          <Tooltip label="Sidebar" placement="bottom" align="start">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              onMouseEnter={(event) => {
                event.currentTarget.style.background = "#ebebeb"
                startSidebarWarmupOnHover()
              }}
              onFocus={startSidebarWarmupOnHover}
              onMouseLeave={(event) => (event.currentTarget.style.background = "none")}
              style={{ background: "none", border: "none", cursor: "pointer", width: 32, height: 32, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", transition: "background 0.15s ease", color: "#aaa" }}
              aria-label="Sidebar"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M2 4h12M2 8h8M2 12h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
            </button>
          </Tooltip>
          <AiStatusPill />
        </div>
      )}
      <Canvas tabBarVisible={tabsVisible} />
    </>
  )
}
