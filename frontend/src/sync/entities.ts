import type { Canvas, Tag, Thought, Tile } from "../types"
import { entityKey, serverClientId } from "./ids"
import { syncDb } from "./localDb"
import type { LocalEntityRecord, SyncEntity, SyncEntityType, SyncPayload } from "./types"

export function clientIdOf(entityType: SyncEntityType, entity: SyncEntity) {
  return entity.client_id ?? serverClientId(entityType, entity.id)
}

export function canvasIdOf(entityType: SyncEntityType, entity: SyncEntity) {
  if (entityType === "canvas") return entity.id
  if (entityType === "tile") return (entity as Tile).canvas_id
  return null
}

export function payloadForEntity(entityType: SyncEntityType, entity: SyncEntity): SyncPayload {
  if (entityType === "canvas") {
    const canvas = entity as Canvas
    return {
      name: canvas.name,
      sort_order: canvas.sort_order,
      is_favourite: canvas.is_favourite,
    }
  }
  if (entityType === "tile") {
    const tile = entity as Tile
    return {
      canvas_id: tile.canvas_id,
      title: tile.title,
      x: tile.x,
      y: tile.y,
      width: tile.width,
      height: tile.height,
      importance: tile.importance,
      visible: tile.visible,
    }
  }
  if (entityType === "thought") {
    const thought = entity as Thought
    return {
      tile_id: thought.tile_id,
      content: thought.content,
      tags: thought.tags,
      sort_order: thought.sort_order,
    }
  }
  const tag = entity as Tag
  return {
    name: tag.name,
    color: tag.color,
  }
}

export async function getEntityRecord(entityType: SyncEntityType, clientId: string) {
  return syncDb.entities.get(entityKey(entityType, clientId))
}

export async function upsertEntityRecord(entityType: SyncEntityType, entity: SyncEntity, status: LocalEntityRecord["status"]) {
  const clientId = clientIdOf(entityType, entity)
  const existing = await getEntityRecord(entityType, clientId)
  const record: LocalEntityRecord = {
    key: entityKey(entityType, clientId),
    entityType,
    clientId,
    serverId: entity.id > 0 ? entity.id : existing?.serverId ?? null,
    tempId: entity.id < 0 ? entity.id : existing?.tempId ?? null,
    canvasId: canvasIdOf(entityType, entity),
    status,
    data: { ...entity, client_id: clientId },
    updatedAt: Date.now(),
  }
  await syncDb.entities.put(record)
  return record
}

export async function markEntityDeleted(entityType: SyncEntityType, entity: SyncEntity) {
  const clientId = clientIdOf(entityType, entity)
  const existing = await getEntityRecord(entityType, clientId)
  if (!existing) return null
  await syncDb.entities.put({ ...existing, status: "deleted", updatedAt: Date.now() })
  return existing
}
