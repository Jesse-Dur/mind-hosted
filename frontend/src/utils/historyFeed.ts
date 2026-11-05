import type { HistoryEvent } from "../types"
import type { SyncActivityRecord, SyncActivityState } from "../sync/types"

export type HistoryFeedItem = {
  key: string
  timestamp: number
  state: SyncActivityState
} & ({
  kind: "history"
  event: HistoryEvent
  activity: SyncActivityRecord | null
} | {
  kind: "activity"
  activity: SyncActivityRecord
})

const CREATE_ENTITY: Partial<Record<string, SyncActivityRecord["entityType"]>> = {
  "canvas.create": "canvas",
  "tile.create": "tile",
  "thought.create": "thought",
  "tag.create": "tag",
}

function parseDetail(detail: HistoryEvent["detail"]): Record<string, unknown> {
  if (typeof detail !== "string") return detail
  try {
    const parsed: unknown = JSON.parse(detail)
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
  } catch {
    return {}
  }
}

function quotedActivityLabel(summary: string) {
  const start = summary.indexOf("“")
  const end = summary.lastIndexOf("”")
  return start >= 0 && end > start ? summary.slice(start + 1, end) : null
}

function historyLabel(event: HistoryEvent) {
  const detail = parseDetail(event.detail)
  const value = event.action === "canvas.create"
    ? detail.name
    : event.action === "tile.create"
      ? detail.title
      : event.action === "thought.create"
        ? detail.content
        : event.action === "tag.create"
          ? detail.name
          : null
  return typeof value === "string" ? value.trim().slice(0, 80) : null
}

function isLegacyDuplicate(event: HistoryEvent, activity: SyncActivityRecord) {
  const entityType = CREATE_ENTITY[event.action]
  if (!entityType || activity.state !== "synced" || activity.action !== "upsert" || activity.entityType !== entityType) return false
  const serverTime = new Date(event.occurred_at ?? event.created_at).getTime()
  if (!Number.isFinite(serverTime) || Math.abs(serverTime - activity.updatedAt) > 2 * 60_000) return false
  const serverLabel = historyLabel(event)
  const activityLabel = quotedActivityLabel(activity.summary)
  return serverLabel === null ? activityLabel === null : activityLabel === serverLabel
}

function eventTime(event: HistoryEvent) {
  const timestamp = new Date(event.occurred_at ?? event.created_at).getTime()
  return Number.isFinite(timestamp) ? timestamp : 0
}

export function buildHistoryFeed(events: HistoryEvent[], activities: SyncActivityRecord[], issuesOnly = false): HistoryFeedItem[] {
  const consumed = new Set<string>()
  const activityByOpId = new Map(activities.map((activity) => [activity.opId, activity]))
  const historyItems: HistoryFeedItem[] = events.map((event) => {
    let activity = event.op_id ? activityByOpId.get(event.op_id) ?? null : null
    if (!activity && !event.op_id) {
      activity = activities.find((candidate) => !consumed.has(candidate.opId) && isLegacyDuplicate(event, candidate)) ?? null
    }
    if (activity) consumed.add(activity.opId)
    return {
      kind: "history",
      key: `history:${event.id}`,
      timestamp: activity?.createdAt ?? eventTime(event),
      state: activity?.state ?? "synced",
      event,
      activity,
    }
  })

  const activityItems: HistoryFeedItem[] = activities
    .filter((activity) => !consumed.has(activity.opId))
    .map((activity) => ({
      kind: "activity" as const,
      key: `activity:${activity.opId}`,
      timestamp: activity.createdAt,
      state: activity.state,
      activity,
    }))

  return [...historyItems, ...activityItems]
    .filter((item) => !issuesOnly || item.state === "error" || item.state === "local_only")
    .sort((left, right) => right.timestamp - left.timestamp || right.key.localeCompare(left.key))
}
