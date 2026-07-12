import type { Canvas, Tag, Thought, Tile } from "../types"
import type { SyncEntity, SyncEntityType, SyncPayload } from "./types"

function numberField(value: unknown, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) return Number(value)
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return fallback
}

export function positiveIntegerField(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null
}

function stringField(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback
}

function booleanField(value: unknown, fallback = false) {
  return typeof value === "boolean" ? value : fallback
}

function optionalClientId(value: unknown) {
  return typeof value === "string" ? value : null
}

function stringArrayField(value: unknown) {
  return Array.isArray(value) && value.every((item): item is string => typeof item === "string")
    ? value
    : []
}

export function isTile(entity: SyncEntity): entity is Tile {
  return "canvas_id" in entity && "width" in entity
}

export function isThought(entity: SyncEntity): entity is Thought {
  return "tile_id" in entity && "content" in entity
}

export function entityFromPayload(entityType: SyncEntityType, data: SyncPayload): SyncEntity | null {
  const id = numberField(data.id, 0)
  if (id === 0) return null
  const client_id = optionalClientId(data.client_id)
  const created_at = stringField(data.created_at, new Date().toISOString())
  const updated_at = stringField(data.updated_at, created_at)

  if (entityType === "canvas") {
    return {
      id,
      client_id,
      name: stringField(data.name, "New Canvas"),
      sort_order: numberField(data.sort_order, 0),
      is_favourite: booleanField(data.is_favourite, false),
      created_at,
      updated_at,
      stableKey: client_id ? `canvas-${client_id}` : undefined,
    } satisfies Canvas
  }

  if (entityType === "tile") {
    const rawCanvasId = data.canvas_id
    return {
      id,
      client_id,
      canvas_id: rawCanvasId === null ? null : numberField(rawCanvasId, 0),
      title: stringField(data.title, "New Tile"),
      x: numberField(data.x, 0),
      y: numberField(data.y, 0),
      width: numberField(data.width, 280),
      height: numberField(data.height, 200),
      importance: numberField(data.importance, 1),
      visible: booleanField(data.visible, true),
      created_at,
      updated_at,
      stableKey: client_id ? `tile-${client_id}` : undefined,
    } satisfies Tile
  }

  if (entityType === "thought") {
    return {
      id,
      client_id,
      tile_id: numberField(data.tile_id, 0),
      content: stringField(data.content),
      tags: stringArrayField(data.tags),
      sort_order: numberField(data.sort_order, 0),
      created_at,
      updated_at,
      stableKey: client_id ? `thought-${client_id}` : undefined,
    } satisfies Thought
  }

  return {
    id,
    client_id,
    name: stringField(data.name),
    color: stringField(data.color, "#888"),
    updated_at,
  } satisfies Tag
}
