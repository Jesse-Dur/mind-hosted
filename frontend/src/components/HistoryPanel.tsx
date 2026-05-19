import { useState, useEffect, useRef } from "react"
import { historyApi } from "../api/client"
import type { HistoryEvent } from "../types"

const ACTION_LABELS: Record<string, string> = {
  "tile.create": "Created tile",
  "tile.rename": "Renamed tile",
  "tile.delete": "Deleted tile",
  "thought.create": "Added thought",
  "thought.update": "Edited thought",
  "thought.tag": "Tagged thought",
  "thought.delete": "Deleted thought",
  "ai.process": "AI processed",
}

function formatTime(iso: string) {
  return new Date(iso + "Z").toLocaleString(undefined, {
    month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  })
}

function ExpandDetail({ isAI, detail, visible }: { isAI: boolean; detail: Record<string, unknown>; visible: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState(0)

  useEffect(() => {
    if (ref.current) setHeight(visible ? ref.current.scrollHeight : 0)
  }, [visible])

  return (
    <div style={{ overflow: "hidden", height, transition: "height 0.2s cubic-bezier(0.4,0,0.2,1)", opacity: visible ? 1 : 0, transition2: "opacity 0.15s ease" } as React.CSSProperties}>
      <div ref={ref} style={{ background: "#fafafa", borderRadius: 6, padding: "8px 10px", fontSize: 11, marginTop: 8 }}>
        {isAI && detail.input ? (
          <>
            <p style={{ color: "#7c3aed", fontWeight: 700, marginBottom: 3, textTransform: "uppercase", letterSpacing: "0.05em", fontSize: 10 }}>You said</p>
            <p style={{ color: "#333", marginBottom: 8, fontStyle: "italic" }}>"{detail.input as string}"</p>
            <p style={{ color: "#7c3aed", fontWeight: 700, marginBottom: 3, textTransform: "uppercase", letterSpacing: "0.05em", fontSize: 10 }}>AI did</p>
            {Array.isArray(detail.actions)
              ? (detail.actions as string[]).map((a, i) => (
                  <p key={i} style={{ color: "#333", marginBottom: 4 }}>• {a}</p>
                ))
              : Array.isArray(detail.thoughts)
                ? (detail.thoughts as { content: string; tags: string[]; tile_title: string }[]).map((t, i) => (
                    <p key={i} style={{ color: "#333", marginBottom: 4 }}>
                      • "{t.content}"
                      {t.tags?.length > 0 && ` tagged [${t.tags.join(", ")}]`}
                      {t.tile_title && ` in "${t.tile_title}"`}
                    </p>
                  ))
                : <p style={{ color: "#333" }}>Created thought "{detail.content as string}"</p>
            }
          </>
        ) : (
          <pre style={{ color: "#555", whiteSpace: "pre-wrap", wordBreak: "break-word", margin: 0 }}>
            {JSON.stringify(detail, null, 2)}
          </pre>
        )}
      </div>
    </div>
  )
}

export function HistoryPanel({ active, sidebarOpen }: { active: boolean; sidebarOpen: boolean }) {
  const [events, setEvents] = useState<HistoryEvent[]>([])
  const [expanded, setExpanded] = useState<number | null>(null)

  useEffect(() => {
    if (active && sidebarOpen) historyApi.list().then(setEvents)
  }, [active, sidebarOpen])

  return (
    <div style={{ flex: 1, overflowY: "auto" }}>
      <style>{`@keyframes historyIn { from { opacity:0; transform:translateY(4px) } to { opacity:1; transform:translateY(0) } }`}</style>
      {events.length === 0 && <p style={{ fontSize: 12, color: "#ccc" }}>No history yet</p>}
      {events.map((e, i) => {
        const detail = JSON.parse(e.detail) as Record<string, unknown>
        const isExpanded = expanded === e.id
        const isAI = e.action === "ai.process"

        return (
          <div key={e.id} style={{ borderBottom: "1px solid #f5f5f5", padding: "8px 0", animation: `historyIn 0.25s ease ${i * 0.02}s both`, opacity: 0 }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
              <div style={{ flex: 1 }}>
                <p style={{ fontSize: 11, color: "#bbb", marginBottom: 2 }}>{formatTime(e.created_at)}</p>
                <p style={{ fontSize: 12, color: "#555", fontWeight: 500 }}>
                  <span style={{
                    fontSize: 10, borderRadius: 4, padding: "1px 5px", marginRight: 5,
                    background: isAI ? "#f3e8ff" : "#f0f0f0",
                    color: isAI ? "#7c3aed" : "#888",
                  }}>
                    {ACTION_LABELS[e.action] ?? e.action}
                  </span>
                  {e.summary}
                </p>
              </div>
              <button
                onClick={() => setExpanded(isExpanded ? null : e.id)}
                style={{ fontSize: 10, color: "#aaa", background: "none", border: "none", cursor: "pointer", flexShrink: 0, padding: "2px 0", transition: "color 0.15s ease" }}
                onMouseEnter={(e) => (e.currentTarget.style.color = "#555")}
                onMouseLeave={(e) => (e.currentTarget.style.color = "#aaa")}
              >
                {isExpanded ? "hide" : "expand"}
              </button>
            </div>
            <ExpandDetail isAI={isAI} detail={detail} visible={isExpanded} />
          </div>
        )
      })}
    </div>
  )
}
