// This file owns the history list only; startup and data warmup happen in the central coordinator.
import { useEffect, useState, useRef, useCallback } from "react"
import { useStore } from "../store"
import { SyncStatusDot } from "./SyncStatusDot"
import { syncStateColor } from "../sync/statusPresentation"
import { buildHistoryFeed } from "../utils/historyFeed"
import type { HistoryEvent } from "../types"
import type { SyncActivityRecord } from "../sync/types"

const ACTION_LABELS: Record<string, string> = {
  "tile.create": "Created tile",
  "tile.rename": "Renamed tile",
  "tile.move": "Moved tile",
  "tile.resize": "Resized tile",
  "tile.visibility": "Changed visibility",
  "tile.importance": "Changed importance",
  "tile.update": "Updated tile",
  "tile.delete": "Deleted tile",
  "canvas.create": "Created Canvas",
  "canvas.rename": "Renamed Canvas",
  "canvas.reorder": "Reordered Canvas",
  "canvas.favourite": "Changed favourite",
  "canvas.update": "Updated Canvas",
  "canvas.delete": "Deleted Canvas",
  "thought.create": "Added thought",
  "thought.update": "Edited thought",
  "thought.move": "Moved thought",
  "thought.reorder": "Reordered thought",
  "thought.tag": "Tagged thought",
  "thought.delete": "Deleted thought",
  "tag.create": "Created tag",
  "tag.rename": "Renamed tag",
  "tag.color": "Changed tag colour",
  "tag.update": "Updated tag",
  "tag.delete": "Deleted tag",
  "ai.process": "AI processed",
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  })
}

function formatTimestamp(timestamp: number) {
  return formatTime(new Date(timestamp).toISOString())
}

function historySummaryRemainder(action: string, summary: string) {
  const label = ACTION_LABELS[action] ?? action
  const trimmed = summary.trim()
  return trimmed.toLocaleLowerCase().startsWith(label.toLocaleLowerCase())
    ? trimmed.slice(label.length).trim()
    : trimmed
}

function detailRecord(event: HistoryEvent) {
  if (typeof event.detail !== "string") return event.detail
  try {
    const parsed: unknown = JSON.parse(event.detail)
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
  } catch {
    return {}
  }
}

function SyncActivityRow({ activity }: { activity: SyncActivityRecord }) {
  return (
    <div style={{ borderBottom: "1px solid #f5f5f5", padding: "8px 0" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: 11, color: "#bbb", marginBottom: 2 }}>{formatTimestamp(activity.createdAt)}</p>
          <p style={{ fontSize: 12, color: "#555", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis" }}>{activity.summary}</p>
          {activity.error && <p style={{ fontSize: 10.5, color: syncStateColor("error"), marginTop: 3, overflowWrap: "anywhere" }}>{activity.error}</p>}
        </div>
        <SyncStatusDot entities={[]} appearance="text" activity={activity} />
      </div>
    </div>
  )
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
      rows.push(`Moved from tile ${detail.old_tile_id} to tile ${detail.tile_id}`)
      if (detail.old_sort_order !== detail.sort_order) rows.push(`Order: ${detail.old_sort_order} → ${detail.sort_order}`)
    } else if (action === "thought.reorder") {
      rows.push(`Order: ${detail.old_sort_order} → ${detail.sort_order}`)
    } else if (action === "thought.tag") {
      rows.push(`Before: ${(detail.old_tags as string[] ?? []).join(", ") || "no tags"}`)
      rows.push(`After: ${(detail.tags as string[] ?? []).join(", ") || "no tags"}`)
    } else if (action === "tile.move") {
      if (detail.old_canvas_id !== detail.canvas_id) rows.push(`Canvas: ${detail.old_canvas_id ?? "none"} → ${detail.canvas_id ?? "none"}`)
      rows.push(`Position: (${detail.old_x}, ${detail.old_y}) → (${detail.x}, ${detail.y})`)
    } else if (action === "tile.resize") {
      rows.push(`Size: ${detail.old_width} × ${detail.old_height} → ${detail.width} × ${detail.height}`)
    } else if (action === "tile.rename") {
      rows.push(`Before: "${detail.old_title}"`)
      rows.push(`After: "${detail.title}"`)
    } else if (action.startsWith("tile.")) {
      rows.push(`Tile: "${detail.title}"`)
      if (Array.isArray(detail.changes) && detail.changes.length > 0) rows.push(`Changed: ${(detail.changes as string[]).join(", ")}`)
    } else if (action === "canvas.create" || action === "canvas.delete") {
      rows.push(`Canvas: "${detail.name}"`)
    } else if (action === "canvas.rename") {
      rows.push(`Before: "${detail.old_name}"`)
      rows.push(`After: "${detail.name}"`)
    } else if (action.startsWith("canvas.")) {
      rows.push(`Canvas: "${detail.name}"`)
      if (Array.isArray(detail.changes) && detail.changes.length > 0) rows.push(`Changed: ${(detail.changes as string[]).join(", ")}`)
    } else if (action === "tag.rename") {
      rows.push(`Before: "${detail.old_name}"`)
      rows.push(`After: "${detail.name}"`)
    } else if (action.startsWith("tag.")) {
      rows.push(`Tag: "${detail.name}"`)
      if (detail.old_color !== undefined && detail.old_color !== detail.color) rows.push(`Colour: ${detail.old_color} → ${detail.color}`)
    }
    if (rows.length === 0) return <pre style={{ color: "#555", whiteSpace: "pre-wrap", wordBreak: "break-word", margin: 0 }}>{JSON.stringify(detail, null, 2)}</pre>
    return <>{rows.map((r, i) => <p key={i} style={{ color: "#333", margin: i === rows.length - 1 ? 0 : "0 0 5px" }}>• {r}</p>)}</>
  }

  return (
    <div style={{ overflow: "hidden", height, transition: "height 0.2s cubic-bezier(0.4,0,0.2,1)", opacity: visible ? 1 : 0 } as React.CSSProperties}>
      <div ref={ref} style={{ paddingTop: 8 }}>
        <div style={{ background: "#fafafa", borderRadius: 6, padding: "8px 10px", fontSize: 11 }}>
          {renderDetail()}
        </div>
      </div>
    </div>
  )
}

export function HistoryPanel() {
  const [expanded, setExpanded] = useState<number | null>(null)
  const [issuesOnly, setIssuesOnly] = useState(false)
  const observer = useRef<IntersectionObserver | null>(null)
  const {
    historyEvents: events,
    historyLoadingMore,
    historyHasMore,
    historyNextCursor,
    loadMoreHistory,
    refreshHistory,
    syncActivity,
  } = useStore()
  const syncIssues = syncActivity.filter((activity) => activity.state === "error" || activity.state === "local_only")
  const hasSyncIssues = syncIssues.length > 0
  const showingIssues = issuesOnly && hasSyncIssues
  const feed = buildHistoryFeed(events, syncActivity, showingIssues)
  const loadMoreEventId = events[Math.max(events.length - 25, 0)]?.id
  const latestSyncedAt = syncActivity.reduce((latest, activity) => activity.state === "synced" ? Math.max(latest, activity.updatedAt) : latest, 0)
  const lastHistoryRefresh = useRef(latestSyncedAt)

  useEffect(() => {
    if (!hasSyncIssues && issuesOnly) setIssuesOnly(false)
  }, [hasSyncIssues, issuesOnly])

  useEffect(() => {
    if (latestSyncedAt <= lastHistoryRefresh.current) return
    lastHistoryRefresh.current = latestSyncedAt
    void refreshHistory()
  }, [latestSyncedAt, refreshHistory])

  const loadMoreMarker = useCallback((node: HTMLDivElement | null) => {
    observer.current?.disconnect()
    if (!node || historyLoadingMore || !historyHasMore || !historyNextCursor) return

    observer.current = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) void loadMoreHistory()
    }, { rootMargin: "120px 0px" })
    observer.current.observe(node)
  }, [historyHasMore, historyLoadingMore, historyNextCursor, loadMoreHistory])

  return (
    <div style={{ flex: 1, overflowY: "auto" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, paddingBottom: 8, borderBottom: "1px solid #eee" }}>
        <p style={{ fontSize: 11, fontWeight: 700, color: "#aaa", letterSpacing: "0.06em", textTransform: "uppercase" }}>History</p>
        {hasSyncIssues && <button type="button" onClick={() => setIssuesOnly((value) => !value)} style={{ border: "1px solid #e0e0e0", background: showingIssues ? "#1a1a1a" : "#fff", color: showingIssues ? "#fff" : "#777", borderRadius: 99, padding: "4px 8px", fontSize: 10.5, cursor: "pointer" }}>Sync issues</button>}
      </div>
      {feed.length === 0 && <p style={{ fontSize: 12, color: "#ccc", paddingTop: 10 }}>{showingIssues ? "No sync issues" : "No history yet"}</p>}
      {feed.map((item) => {
        if (item.kind === "activity") return <SyncActivityRow key={item.key} activity={item.activity} />
        const e = item.event
        const detail = detailRecord(e)
        const isExpanded = expanded === e.id
        const isAI = e.action === "ai.process"
        const actionLabel = ACTION_LABELS[e.action] ?? e.action
        const summary = historySummaryRemainder(e.action, e.summary)

        return (
          <div
            key={item.key}
            ref={!showingIssues && e.id === loadMoreEventId ? loadMoreMarker : undefined}
            style={{
              borderBottom: "1px solid #f5f5f5",
              padding: "8px 0",
            }}
          >
            <div style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
              <div style={{ flex: 1 }}>
                <p style={{ fontSize: 11, color: "#bbb", marginBottom: 2 }}>{formatTimestamp(item.timestamp)}</p>
                <p style={{ fontSize: 12, color: "#555", fontWeight: 500 }}>
                  <span style={{
                    fontSize: 10, borderRadius: 4, padding: "1px 5px", marginRight: 5,
                    background: isAI ? "#f3e8ff" : "#f0f0f0",
                    color: isAI ? "#7c3aed" : "#888",
                  }}>
                    {actionLabel}
                  </span>
                  {summary}
                </p>
              </div>
              {item.activity
                ? <SyncStatusDot entities={[]} appearance="text" activity={item.activity} />
                : <span style={{ color: syncStateColor("synced"), fontSize: 10, lineHeight: 1.2, fontWeight: 550, flexShrink: 0, paddingTop: 2 }}>Synced</span>}
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
