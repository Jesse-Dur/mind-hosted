import { sql } from "../client"
import type { Thought, Tile } from "../../types"
import { jsonValue } from "./values"
import type { SyncAction, SyncEntity, SyncEntityType, SyncPayload, SyncResult } from "./types"

async function canvasIdForEntity(entityType: SyncEntityType, entity: SyncEntity | null) {
  if (!entity) return null
  if (entityType === "canvas") return entity.id
  if (entityType === "tile") return (entity as Tile).canvas_id
  if (entityType === "thought") {
    const [tile] = await sql<{ canvas_id: number | null }[]>`
      SELECT canvas_id FROM tiles WHERE id = ${(entity as Thought).tile_id}
    `
    return tile?.canvas_id ?? null
  }
  return null
}

export async function logEvent(userId: string, entityType: SyncEntityType, action: SyncAction, opId: string, entity: SyncEntity | null, clientId: string | null, data: SyncPayload) {
  const canvasId = await canvasIdForEntity(entityType, entity)
  const entityId = entity?.id ?? null
  const [event] = await sql<{ revision: number | string }[]>`
    INSERT INTO sync_events (user_id, canvas_id, entity_type, entity_id, client_id, op_id, action, data)
    VALUES (${userId}, ${canvasId}, ${entityType}, ${entityId}, ${clientId}, ${opId}, ${action}, ${jsonValue(data)})
    RETURNING revision
  `
  return event ? Number(event.revision) : null
}

export async function latestRevision(userId: string) {
  const [row] = await sql<{ revision: number | string | null }[]>`
    SELECT COALESCE(MAX(revision), 0) AS revision FROM sync_events WHERE user_id = ${userId}
  `
  return Number(row?.revision ?? 0)
}

export async function getApplied(userId: string, opId: string) {
  const [row] = await sql<{ result: SyncResult }[]>`
    SELECT result FROM sync_applied_ops WHERE user_id = ${userId} AND op_id = ${opId}
  `
  return row?.result ?? null
}

export function recordApplied(userId: string, opId: string, result: SyncResult) {
  return sql`
    INSERT INTO sync_applied_ops (user_id, op_id, result)
    VALUES (${userId}, ${opId}, ${jsonValue(result)})
    ON CONFLICT(user_id, op_id) DO NOTHING
  `
}
