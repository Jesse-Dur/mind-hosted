import { useState } from "react"
import { HistoryPanel } from "./HistoryPanel"
import { SettingsContent } from "./SettingsPanel"
import { SignOutSection } from "./SignOutSection"
import { TagsPanel } from "./TagsPanel"
import { UsagePanel } from "./UsagePanel"

export type UtilityTab = "tags" | "history" | "usage" | "settings" | "profile"

const MAIN_TABS: Array<{ id: UtilityTab; label: string }> = [
  { id: "tags", label: "Tags" },
  { id: "history", label: "History" },
]

export function UtilityContent({ initialTab = "tags", onClose }: { initialTab?: UtilityTab; onClose?: () => void }) {
  const [activeTab, setActiveTab] = useState<UtilityTab>(initialTab)
  const utilityButtonStyle = (tab: UtilityTab) => ({
    background: activeTab === tab ? "#1a1a1a" : "transparent",
    border: "none",
    borderRadius: 7,
    color: activeTab === tab ? "#fff" : "#aaa",
    cursor: "pointer",
    width: 30,
    height: 30,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 0,
    transition: "background 0.15s ease, color 0.15s ease",
    userSelect: "none",
    WebkitUserSelect: "none",
  } as const)

  return (
    <div style={{ minHeight: 0, height: "100%", display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
        <button onClick={() => setActiveTab("usage")} title="Plans and usage" aria-label="Plans and usage" style={utilityButtonStyle("usage")}>
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" style={{ display: "block", pointerEvents: "none" }}>
            <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.7" />
            <path d="M10 10l4-4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
            <path d="M6 14h8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
          </svg>
        </button>
        <button onClick={() => setActiveTab("settings")} title="Settings" aria-label="Settings" style={utilityButtonStyle("settings")}>
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" style={{ display: "block", pointerEvents: "none" }}>
            <path d="M8.7 2.8h2.6l.5 1.8c.4.1.7.3 1.1.5l1.7-.9 1.8 1.8-.9 1.7c.2.3.4.7.5 1.1l1.8.5v2.6l-1.8.5c-.1.4-.3.7-.5 1.1l.9 1.7-1.8 1.8-1.7-.9c-.3.2-.7.4-1.1.5l-.5 1.8H8.7l-.5-1.8c-.4-.1-.7-.3-1.1-.5l-1.7.9-1.8-1.8.9-1.7c-.2-.3-.4-.7-.5-1.1l-1.8-.5V9.3L4 8.8c.1-.4.3-.7.5-1.1l-.9-1.7 1.8-1.8 1.7.9c.3-.2.7-.4 1.1-.5l.5-1.8z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
            <circle cx="10" cy="10.6" r="2.4" stroke="currentColor" strokeWidth="1.6" />
          </svg>
        </button>
        <button onClick={() => setActiveTab("profile")} title="Profile" aria-label="Profile" style={utilityButtonStyle("profile")}>
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true" style={{ display: "block", pointerEvents: "none", userSelect: "none" }}>
            <circle cx="10" cy="6.4" r="3.1" stroke="currentColor" strokeWidth="1.6" />
            <path d="M4.2 16.5c.5-3.2 2.5-4.8 5.8-4.8s5.3 1.6 5.8 4.8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 2, marginTop: 14, marginBottom: 16, borderBottom: "1px solid #ebebeb", paddingBottom: 10, flexShrink: 0 }}>
        {MAIN_TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{ fontSize: 12, fontWeight: 600, padding: "4px 7px", borderRadius: 6, border: "none", cursor: "pointer", background: activeTab === tab.id ? "#1a1a1a" : "transparent", color: activeTab === tab.id ? "#fff" : "#aaa", transition: "background 0.15s ease, color 0.15s ease" }}
          >{tab.label}</button>
        ))}
        <div style={{ flex: 1 }} />
        {onClose && (
          <button onClick={onClose} aria-label="Close" style={{ background: "transparent", border: "none", cursor: "pointer", width: 24, height: 24, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", transition: "background 0.15s ease", flexShrink: 0 }}>
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M1 1l8 8M9 1L1 9" stroke="#bbb" strokeWidth="1.5" strokeLinecap="round" /></svg>
          </button>
        )}
      </div>
      <div style={{ minHeight: 0, flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", paddingBottom: "max(16px, env(safe-area-inset-bottom))" }}>
        {activeTab === "tags" ? <TagsPanel /> : (
          <div style={{ minHeight: 0, flex: 1, overflowY: "auto" }}>
            {activeTab === "history" && <HistoryPanel />}
            {activeTab === "usage" && <UsagePanel />}
            {activeTab === "settings" && <SettingsContent />}
            {activeTab === "profile" && <SignOutSection />}
          </div>
        )}
      </div>
    </div>
  )
}
