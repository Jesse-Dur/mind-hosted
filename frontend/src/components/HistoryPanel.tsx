import { useState, useEffect, useRef, useCallback } from "react"
import { useStore } from "../store"

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
  return new Date(iso).toLocaleString(undefined, {
    month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  })
}

function ExpandDetail({ isAI, action, detail, visible }: { isAI: boolean; action: string; detail: Record<string, unknown>; visible: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState(0)

  useEffect(() => {
    if (ref.current) setHeight(visible ? ref.current.scrollHeight : 0)
  }, [visible])

  function renderDetail() {
    if (isAI && detail.input) {
      return (
        <>
          <p style={{ color: "#7c3aed", fontWeight: 700, marginBottom: 3, textTransform: "uppercase", letterSpacing: "0.05em", fontSize: 10 }}>You said</p>
          <p style={{ color: "#333", marginBottom: 8, fontStyle: "italic" }}>"{detail.input as string}"</p>
          <p style={{ color: "#7c3aed", fontWeight: 700, marginBottom: 3, textTransform: "uppercase", letterSpacing: "0.05em", fontSize: 10 }}>AI did</p>
          {(Array.isArray(detail.actions) ? detail.actions as string[] : []).map((a, i) => (
            <p key={i} style={{ color: "#333", marginBottom: 4 }}>• {a}</p>
          ))}
        </>
      )
    }
    const rows: string[] = []
    if (action === "thought.create") {
      rows.push(`Added "${detail.content}"`)
      if (Array.isArray(detail.tags) && (detail.tags as string[]).length > 0) rows.push(`Tags: ${(detail.tags as string[]).join(", ")}`)
    } else if (action === "thought.update") {
      if (detail.old_content) rows.push(`Before: "${detail.old_content}"`)
      rows.push(`After: "${detail.new_content}"`)
    } else if (action === "thought.delete") {
      rows.push(`Deleted: "${detail.content}"`)
    } else if (action === "thought.move") {
      rows.push(`Moved to tile ${detail.tile_id}`)
    } else if (action === "thought.tag") {
      rows.push(`Tags: ${(detail.tags as string[] ?? []).join(", ") || "none"}`)
    } else if (action === "tile.create" || action === "tile.update" || action === "tile.delete") {
      rows.push(`Tile: "${detail.title}"`)
    }
    if (rows.length === 0) return <pre style={{ color: "#555", whiteSpace: "pre-wrap", wordBreak: "break-word", margin: 0 }}>{JSON.stringify(detail, null, 2)}</pre>
    return <>{rows.map((r, i) => <p key={i} style={{ color: "#333", marginBottom: 4 }}>• {r}</p>)}</>
  }

  return (
    <div style={{ overflow: "hidden", height, transition: "height 0.2s cubic-bezier(0.4,0,0.2,1)", opacity: visible ? 1 : 0 } as React.CSSProperties}>
      <div ref={ref} style={{ background: "#fafafa", borderRadius: 6, padding: "8px 10px", fontSize: 11, marginTop: 8 }}>
        {renderDetail()}
      </div>
    </div>
  )
}

export function HistoryPanel({ sidebarOpen }: { sidebarOpen: boolean }) {
  const [expanded, setExpanded] = useState<number | null>(null)
  const observer = useRef<IntersectionObserver | null>(null)
  const {
    historyEvents: events,
    historyLoaded,
    historyRefreshing,
    historyLoadingMore,
    historyHasMore,
    historyNextCursor,
    newHistoryIds,
    refreshHistory,
    loadMoreHistory,
  } = useStore()

  useEffect(() => {
    if (sidebarOpen) {
      void refreshHistory()
    }
  }, [sidebarOpen, refreshHistory])

  const loadMoreMarker = useCallback((node: HTMLDivElement | null) => {
    observer.current?.disconnect()
    if (!node || historyLoadingMore || !historyHasMore || !historyNextCursor) return

    observer.current = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) void loadMoreHistory()
    }, { rootMargin: "120px 0px" })
    observer.current.observe(node)
  }, [historyHasMore, historyLoadingMore, historyNextCursor, loadMoreHistory])

  const loadingInitial = !historyLoaded && historyRefreshing

  return (
    <div style={{ flex: 1, overflowY: "auto" }}>
      <style>{`
        @keyframes historyNewIn {
          0% { opacity:0; transform:translateY(-8px); background:#f3e8ff; box-shadow:0 0 0 1px #e9d5ff inset; }
          70% { opacity:1; transform:translateY(0); background:#faf5ff; box-shadow:0 0 0 1px #e9d5ff inset; }
          100% { opacity:1; transform:translateY(0); background:transparent; box-shadow:none; }
        }
      `}</style>
      {loadingInitial && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {[1,2,3,4].map((i) => (
            <div key={i} style={{ borderBottom: "1px solid #f5f5f5", paddingBottom: 12 }}>
              <div style={{ height: 10, width: 80, borderRadius: 4, background: "#f0f0f0", marginBottom: 6 }} />
              <div style={{ height: 12, width: "60%", borderRadius: 4, background: "#f5f5f5" }} />
            </div>
          ))}
        </div>
      )}
      {!loadingInitial && events.length === 0 && <p style={{ fontSize: 12, color: "#ccc" }}>No history yet</p>}
      {!loadingInitial && events.map((e, i) => {
        const detail = (typeof e.detail === "string" ? JSON.parse(e.detail) : e.detail) as Record<string, unknown>
        const isExpanded = expanded === e.id
        const isAI = e.action === "ai.process"
        const markerIndex = Math.max(events.length - 25, 0)
        const isNew = newHistoryIds.has(e.id)

        return (
          <div
            key={e.id}
            ref={i === markerIndex ? loadMoreMarker : undefined}
            style={{
              borderBottom: "1px solid #f5f5f5",
              borderRadius: isNew ? 6 : 0,
              padding: "8px 0",
              animation: isNew ? "historyNewIn 0.9s ease both" : undefined,
              opacity: isNew ? 0 : 1,
            }}
          >
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
            <ExpandDetail isAI={isAI} action={e.action} detail={detail} visible={isExpanded} />
          </div>
        )
      })}
    </div>
  )
}
