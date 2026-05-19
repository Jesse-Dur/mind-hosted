import { useState } from "react"
import { useStore } from "../store"
import { TagsPanel } from "./TagsPanel"
import { HistoryPanel } from "./HistoryPanel"
import { SettingsPanel } from "./SettingsPanel"

type Tab = "tags" | "history" | "settings"

const TABS: { id: Tab; label: string }[] = [
  { id: "tags", label: "Tags" },
  { id: "history", label: "History" },
  { id: "settings", label: "Settings" },
]

export function Sidebar() {
  const { sidebarOpen, setSidebarOpen } = useStore()
  const [activeTab, setActiveTab] = useState<Tab>("tags")

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
        {/* tabs + close */}
        <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 16, borderBottom: "1px solid #ebebeb", paddingBottom: 10 }}>
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                fontSize: 12, fontWeight: 600, padding: "4px 10px", borderRadius: 6, border: "none", cursor: "pointer",
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
        {activeTab === "history" && <HistoryPanel active={activeTab === "history"} sidebarOpen={sidebarOpen} />}
        {activeTab === "settings" && <SettingsPanel />}
      </div>
    </>
  )
}
