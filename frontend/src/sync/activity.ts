import type { Canvas, Tag, Thought, Tile } from "../types"
import type { OutboxRecord, SyncActivityRecord, SyncEntity } from "./types"

function entityLabel(record: Pick<OutboxRecord, "entityType" | "payload">) {
  const value = record.entityType === "canvas"
    ? record.payload.name
    : record.entityType === "tile"
      ? record.payload.title
      : record.entityType === "thought"
        ? record.payload.content
        : record.payload.name
  return typeof value === "string" && value.trim() ? ` “${value.trim().slice(0, 80)}”` : ""
}

function upsertVerb(record: Pick<OutboxRecord, "entityType" | "payload" | "beforeData">) {
  if (!record.beforeData) return record.entityType === "thought" ? "Add" : "Create"
  if (record.entityType === "canvas") {
    const before = record.beforeData as Canvas
    if (before.name !== record.payload.name) return "Rename"
    if (before.sort_order !== record.payload.sort_order) return "Reorder"
    return "Update"
  }
  if (record.entityType === "tile") {
    const before = record.beforeData as Tile
    if (before.width !== record.payload.width || before.height !== record.payload.height) return "Resize"
    if (before.canvas_id !== record.payload.canvas_id || before.x !== record.payload.x || before.y !== record.payload.y) return "Move"
    if (before.title !== record.payload.title) return "Rename"
    return "Update"
  }
  if (record.entityType === "thought") {
    const before = record.beforeData as Thought
    if (before.tile_id !== record.payload.tile_id) return "Move"
    if (before.sort_order !== record.payload.sort_order) return "Reorder"
    if (JSON.stringify(before.tags) !== JSON.stringify(record.payload.tags)) return "Change tags on"
    return "Edit"
  }
  const before = record.beforeData as Tag
  if (before.name !== record.payload.name) return "Rename"
  if (before.color !== record.payload.color) return "Change colour of"
  return "Update"
}

export function syncActivityState(record: OutboxRecord): SyncActivityRecord["state"] {
  return record.status === "error"
    ? "error"
    : record.status === "local_only"
      ? "local_only"
      : "pending"
}

export function syncActivitySummary(record: Pick<OutboxRecord, "entityType" | "action" | "payload" | "beforeData">) {
  const verb = record.action === "delete" ? "Delete" : upsertVerb(record)
  return `${verb} ${record.entityType}${entityLabel(record)}`
}

export function activityFromOutbox(record: OutboxRecord, existing?: SyncActivityRecord | null): SyncActivityRecord {
  return {
    opId: record.opId,
    entityType: record.entityType,
    clientId: record.clientId,
    action: record.action,
    state: syncActivityState(record),
    summary: syncActivitySummary(record),
    error: record.error ?? null,
    createdAt: existing?.createdAt ?? record.createdAt,
    updatedAt: record.updatedAt,
    hidden: record.recordHistory === false,
  }
}

export function withOperationIdentity(entity: SyncEntity, record: Pick<OutboxRecord, "clientId" | "serverId">) {
  return { ...entity, id: record.serverId ?? entity.id, client_id: record.clientId }
}
