import { useEffect, useState } from "react"
import { useAuth } from "@clerk/clerk-react"
import { useStore } from "../store"
import { HistoryPanel } from "./HistoryPanel"
import { SettingsPanel } from "./SettingsPanel"
import { TagsPanel } from "./TagsPanel"
import { UsagePanel, preloadBillingUsage } from "./UsagePanel"

type Tab = "tags" | "history" | "usage" | "settings"

const TABS: { id: Tab; label: string }[] = [
  { id: "tags", label: "Tags" },
  { id: "history", label: "History" },
]

export function Sidebar() {
  const { getToken } = useAuth()
  const { sidebarOpen, setSidebarOpen, refreshHistory } = useStore()
  const [activeTab, setActiveTab] = useState<Tab>("tags")
  const [usageRefreshKey, setUsageRefreshKey] = useState(0)

  useEffect(() => {
    if (!sidebarOpen) return
    void refreshHistory()
    void preloadBillingUsage(getToken).catch(console.error)
  }, [getToken, refreshHistory, sidebarOpen])

  function selectTab(tab: Tab) {
    setActiveTab(tab)
    if (tab === "usage") setUsageRefreshKey((key) => key + 1)
  }

  return (
    <>
      {sidebarOpen && (
        <div onClick={() => setSidebarOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 60 }} />
      )}
      <div style={{
        position: "fixed", top: 0, left: 0, width: 260, height: "100vh",
        background: "#fff", borderRight: "1px solid #e8e8e8",
        boxShadow: sidebarOpen ? "4px 0 24px rgba(0,0,0,0.08)" : "none",
        transform: sidebarOpen ? "translateX(0)" : "translateX(-100%)",
        transition: "transform 0.22s cubic-bezier(0.4,0,0.2,1), box-shadow 0.22s ease",
        zIndex: 70, display: "flex", flexDirection: "column", padding: "52px 16px 16px",
      }}>
        {/* Utility controls are pinned over the shell so they do not shift the main tabs down. */}
        <div style={{ position: "absolute", top: 8, left: 8, display: "flex", alignItems: "center", gap: 4 }}>
          <button
            onClick={() => selectTab("usage")}
            title="Usage"
            aria-label="Usage"
            style={{
              background: activeTab === "usage" ? "#1a1a1a" : "transparent",
              border: "none",
              borderRadius: 7,
              color: activeTab === "usage" ? "#fff" : "#aaa",
              cursor: "pointer",
              width: 30,
              height: 30,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 0,
              transition: "background 0.15s ease, color 0.15s ease",
            }}
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" style={{ display: "block", pointerEvents: "none" }}>
              <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.7" />
              <path d="M10 10l4-4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
              <path d="M6 14h8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
            </svg>
          </button>
          <button
            onClick={() => selectTab("settings")}
            title="Settings"
            aria-label="Settings"
            style={{
              background: activeTab === "settings" ? "#1a1a1a" : "transparent",
              border: "none",
              borderRadius: 7,
              color: activeTab === "settings" ? "#fff" : "#aaa",
              cursor: "pointer",
              width: 30,
              height: 30,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 0,
              transition: "background 0.15s ease, color 0.15s ease",
            }}
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" style={{ display: "block", pointerEvents: "none" }}>
              <path d="M8.7 2.8h2.6l.5 1.8c.4.1.7.3 1.1.5l1.7-.9 1.8 1.8-.9 1.7c.2.3.4.7.5 1.1l1.8.5v2.6l-1.8.5c-.1.4-.3.7-.5 1.1l.9 1.7-1.8 1.8-1.7-.9c-.3.2-.7.4-1.1.5l-.5 1.8H8.7l-.5-1.8c-.4-.1-.7-.3-1.1-.5l-1.7.9-1.8-1.8.9-1.7c-.2-.3-.4-.7-.5-1.1l-1.8-.5V9.3L4 8.8c.1-.4.3-.7.5-1.1l-.9-1.7 1.8-1.8 1.7.9c.3-.2.7-.4 1.1-.5l.5-1.8z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
              <circle cx="10" cy="10.6" r="2.4" stroke="currentColor" strokeWidth="1.6" />
            </svg>
          </button>
        </div>
        {/* tabs + close */}
        <div style={{ display: "flex", alignItems: "center", gap: 2, marginBottom: 16, borderBottom: "1px solid #ebebeb", paddingBottom: 10 }}>
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => selectTab(tab.id)}
              style={{
                fontSize: 12, fontWeight: 600, padding: "4px 7px", borderRadius: 6, border: "none", cursor: "pointer",
                background: activeTab === tab.id ? "#1a1a1a" : "transparent",
                color: activeTab === tab.id ? "#fff" : "#aaa",
                transition: "background 0.15s ease, color 0.15s ease",
              }}
            >
              {tab.label}
            </button>
          ))}
          <div style={{ flex: 1 }} />
          <button
            onClick={() => setSidebarOpen(false)}
            onMouseEnter={(e) => (e.currentTarget.style.background = "#ebebeb")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            style={{ background: "transparent", border: "none", cursor: "pointer", width: 24, height: 24, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", transition: "background 0.15s ease", flexShrink: 0 }}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M1 1l8 8M9 1L1 9" stroke="#bbb" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        {activeTab === "tags" && <TagsPanel />}
        {activeTab === "history" && <HistoryPanel sidebarOpen={sidebarOpen} />}
        {activeTab === "usage" && <UsagePanel refreshKey={usageRefreshKey} />}
        {activeTab === "settings" && <SettingsPanel />}
      </div>
    </>
  )
}
