import { sql } from "../client"
import { historyDb } from "../history"
import { createSerializedBillableResource, type ResourceQueryClient } from "../../billing/resourceUsage"
import { addStorageDelta } from "../../billing/storageUsage"
import { estimateCanvasStorage, estimateTagStorage, estimateThoughtStorage, estimateTileStorage } from "../../billing/storageEstimate"
import type { Canvas, Tag, Thought, Tile } from "../../types"
import { buildUpsertHistory } from "./historyEntry"
import { booleanValue, nullablePositiveId, numberValue, positiveId, stringArrayValue, stringValue } from "./values"
import type { SyncEntity, SyncEntityType, SyncPayload } from "./types"

async function logUpsertHistory(userId: string, entityType: SyncEntityType, before: SyncEntity | null, entity: SyncEntity, writeHistory: boolean, clientId: string | null, opId?: string, occurredAt?: string, query: ResourceQueryClient = sql) {
  if (!writeHistory) return
  const entry = buildUpsertHistory(entityType, before, entity)
  if (!entry) return
  await historyDb.log(userId, entry.action, entry.summary, entry.detail, { clientId: clientId ?? entity.client_id, opId, occurredAt, query })
}

export async function upsertCanvas(userId: string, clientId: string | null, serverId: number | null, payload: SyncPayload, writeHistory: boolean, opId?: string, occurredAt?: string) {
  const name = stringValue(payload.name, "New Canvas").trim() || "New Canvas"
  const sortOrder = numberValue(payload.sort_order, 0)
  const isFavourite = booleanValue(payload.is_favourite, false)
  const existing = serverId
    ? (await sql<Canvas[]>`SELECT * FROM canvases WHERE id = ${serverId} AND user_id = ${userId}`)[0]
    : clientId
      ? (await sql<Canvas[]>`SELECT * FROM canvases WHERE user_id = ${userId} AND client_id = ${clientId}`)[0]
      : undefined

  if (existing) {
    const canvas = await sql.begin(async (transaction) => {
      const [updated] = await transaction<Canvas[]>`
        UPDATE canvases
        SET client_id = COALESCE(client_id, ${clientId}), name = ${name}, sort_order = ${sortOrder}, is_favourite = ${isFavourite}, updated_at = NOW()
        WHERE id = ${existing.id} AND user_id = ${userId}
        RETURNING *
      `
      if (!updated) throw new Error("Canvas update did not return a row")
      await logUpsertHistory(userId, "canvas", existing, updated, writeHistory, clientId, opId, occurredAt, transaction)
      return updated
    })
    await addStorageDelta(userId, estimateCanvasStorage(canvas) - estimateCanvasStorage(existing))
    return canvas
  }

  const canvas = await createSerializedBillableResource(userId, "canvases", async (transaction) => {
    const [created] = await transaction<Canvas[]>`
      INSERT INTO canvases (user_id, client_id, name, sort_order, is_favourite)
      VALUES (${userId}, ${clientId}, ${name}, ${sortOrder}, ${isFavourite})
      RETURNING *
    `
    if (!created) throw new Error("Canvas create did not return a row")
    await logUpsertHistory(userId, "canvas", null, created, writeHistory, clientId, opId, occurredAt, transaction)
    return created
  })
  await addStorageDelta(userId, estimateCanvasStorage(canvas))
  return canvas
}

export async function upsertTile(userId: string, clientId: string | null, serverId: number | null, payload: SyncPayload, writeHistory: boolean, opId?: string, occurredAt?: string) {
  const canvasId = nullablePositiveId(payload.canvas_id)
  if (canvasId === undefined) throw new Error("Invalid canvas id")
  if (canvasId !== null) {
    const [canvas] = await sql<{ id: number }[]>`SELECT id FROM canvases WHERE id = ${canvasId} AND user_id = ${userId}`
    if (!canvas) throw new Error("Canvas not found")
  }

  const title = stringValue(payload.title, "New Tile")
  const x = numberValue(payload.x, 0)
  const y = numberValue(payload.y, 0)
  const width = numberValue(payload.width, 280)
  const height = numberValue(payload.height, 200)
  const importance = numberValue(payload.importance, 1)
  const visible = booleanValue(payload.visible, true)
  const existing = serverId
    ? (await sql<Tile[]>`SELECT * FROM tiles WHERE id = ${serverId} AND user_id = ${userId}`)[0]
    : clientId
      ? (await sql<Tile[]>`SELECT * FROM tiles WHERE user_id = ${userId} AND client_id = ${clientId}`)[0]
      : undefined

  if (existing) {
    const wasDeleted = (existing as Tile & { deleted_at?: string | null }).deleted_at !== null && (existing as Tile & { deleted_at?: string | null }).deleted_at !== undefined
    const update = async (query: ResourceQueryClient) => {
      const [updated] = await query<Tile[]>`
        UPDATE tiles
        SET client_id = COALESCE(client_id, ${clientId}), canvas_id = ${canvasId}, title = ${title}, x = ${x}, y = ${y}, width = ${width}, height = ${height},
            importance = ${importance}, visible = ${visible}, updated_at = NOW(), deleted_at = NULL
        WHERE id = ${existing.id} AND user_id = ${userId}
        RETURNING *
      `
      if (!updated) throw new Error("Tile update did not return a row")
      await logUpsertHistory(userId, "tile", existing, updated, writeHistory, clientId, opId, occurredAt, query)
      return updated
    }
    const tile = wasDeleted
      ? await createSerializedBillableResource(userId, "tiles", update)
      : await sql.begin(update)
    await addStorageDelta(userId, estimateTileStorage(tile) - (wasDeleted ? 0 : estimateTileStorage(existing)))
    return tile
  }

  const tile = await createSerializedBillableResource(userId, "tiles", async (transaction) => {
    const [created] = await transaction<Tile[]>`
      INSERT INTO tiles (user_id, client_id, canvas_id, title, x, y, width, height, importance, visible)
      VALUES (${userId}, ${clientId}, ${canvasId}, ${title}, ${x}, ${y}, ${width}, ${height}, ${importance}, ${visible})
      RETURNING *
    `
    if (!created) throw new Error("Tile create did not return a row")
    await logUpsertHistory(userId, "tile", null, created, writeHistory, clientId, opId, occurredAt, transaction)
    return created
  })
  await addStorageDelta(userId, estimateTileStorage(tile))
  return tile
}

export async function upsertThought(userId: string, clientId: string | null, serverId: number | null, payload: SyncPayload, writeHistory: boolean, opId?: string, occurredAt?: string) {
  const tileId = positiveId(payload.tile_id)
  if (tileId === null) throw new Error("Invalid tile id")
  const [tile] = await sql<{ id: number }[]>`SELECT id FROM tiles WHERE id = ${tileId} AND user_id = ${userId} AND deleted_at IS NULL`
  if (!tile) throw new Error("Tile not found")

  const content = stringValue(payload.content)
  const tags = stringArrayValue(payload.tags)
  let sortOrder = numberValue(payload.sort_order, 0)
  if (!("sort_order" in payload)) {
    const [maxRow] = await sql<{ m: number | null }[]>`SELECT MAX(sort_order) as m FROM thoughts WHERE tile_id = ${tileId} AND user_id = ${userId} AND deleted_at IS NULL`
    sortOrder = (maxRow?.m ?? -1) + 1
  }
  const existing = serverId
    ? (await sql<Thought[]>`SELECT * FROM thoughts WHERE id = ${serverId} AND user_id = ${userId}`)[0]
    : clientId
      ? (await sql<Thought[]>`SELECT * FROM thoughts WHERE user_id = ${userId} AND client_id = ${clientId}`)[0]
      : undefined

  if (existing) {
    const wasDeleted = (existing as Thought & { deleted_at?: string | null }).deleted_at !== null && (existing as Thought & { deleted_at?: string | null }).deleted_at !== undefined
    const update = async (query: ResourceQueryClient) => {
      const [updated] = await query<Thought[]>`
        UPDATE thoughts
        SET client_id = COALESCE(client_id, ${clientId}), tile_id = ${tileId}, content = ${content}, tags = ${tags}, sort_order = ${sortOrder}, updated_at = NOW(), deleted_at = NULL
        WHERE id = ${existing.id} AND user_id = ${userId}
        RETURNING *
      `
      if (!updated) throw new Error("Thought update did not return a row")
      await logUpsertHistory(userId, "thought", existing, updated, writeHistory, clientId, opId, occurredAt, query)
      return updated
    }
    const thought = wasDeleted
      ? await createSerializedBillableResource(userId, "thoughts", update)
      : await sql.begin(update)
    await addStorageDelta(userId, estimateThoughtStorage(thought) - (wasDeleted ? 0 : estimateThoughtStorage(existing)))
    return thought
  }

  const thought = await createSerializedBillableResource(userId, "thoughts", async (transaction) => {
    const [created] = await transaction<Thought[]>`
      INSERT INTO thoughts (user_id, client_id, tile_id, content, tags, sort_order)
      VALUES (${userId}, ${clientId}, ${tileId}, ${content}, ${tags}, ${sortOrder})
      RETURNING *
    `
    if (!created) throw new Error("Thought create did not return a row")
    await logUpsertHistory(userId, "thought", null, created, writeHistory, clientId, opId, occurredAt, transaction)
    return created
  })
  await addStorageDelta(userId, estimateThoughtStorage(thought))
  return thought
}

export async function upsertTag(userId: string, clientId: string | null, serverId: number | null, payload: SyncPayload, writeHistory: boolean, opId?: string, occurredAt?: string) {
  const name = stringValue(payload.name).trim().slice(0, 16)
  if (!name) throw new Error("Invalid tag name")
  const color = stringValue(payload.color, "#888")
  const existing = serverId
    ? (await sql<Tag[]>`SELECT * FROM tags WHERE id = ${serverId} AND user_id = ${userId}`)[0]
    : clientId
      ? (await sql<Tag[]>`SELECT * FROM tags WHERE user_id = ${userId} AND client_id = ${clientId}`)[0]
      : undefined

  if (existing) {
    let thoughtTagDelta = 0
    const updated = await sql.begin(async (tx) => {
      await tx`UPDATE tags SET client_id = COALESCE(client_id, ${clientId}), name = ${name}, color = ${color}, updated_at = NOW() WHERE id = ${existing.id} AND user_id = ${userId}`
      if (existing.name !== name) {
        const thoughts = await tx<{ id: number; content: string; tags: string[] }[]>`
          SELECT id, content, tags FROM thoughts WHERE user_id = ${userId} AND deleted_at IS NULL AND ${existing.name} = ANY(tags)
        `
        for (const thought of thoughts) {
          const updatedTags = thought.tags.map((tag) => tag === existing.name ? name : tag)
          thoughtTagDelta += estimateThoughtStorage({ content: thought.content, tags: updatedTags }) - estimateThoughtStorage({ content: thought.content, tags: thought.tags })
          await tx`UPDATE thoughts SET tags = ${updatedTags}, updated_at = NOW() WHERE id = ${thought.id} AND user_id = ${userId}`
        }
      }
      const current = (await tx<Tag[]>`SELECT * FROM tags WHERE id = ${existing.id} AND user_id = ${userId}`)[0]
      if (!current) throw new Error("Tag update did not return a row")
      await logUpsertHistory(userId, "tag", existing, current, writeHistory, clientId, opId, occurredAt, tx)
      return current
    })
    await addStorageDelta(userId, estimateTagStorage(updated) - estimateTagStorage(existing) + thoughtTagDelta)
    return updated
  }

  const { tag, beforeConflict } = await sql.begin(async (transaction) => {
    const before = (await transaction<Tag[]>`SELECT * FROM tags WHERE user_id = ${userId} AND name = ${name}`)[0] ?? null
    const [created] = await transaction<Tag[]>`
      INSERT INTO tags (user_id, client_id, name, color)
      VALUES (${userId}, ${clientId}, ${name}, ${color})
      ON CONFLICT(user_id, name) DO UPDATE SET client_id = COALESCE(tags.client_id, excluded.client_id), color = excluded.color, updated_at = NOW()
      RETURNING *
    `
    if (!created) throw new Error("Tag create did not return a row")
    await logUpsertHistory(userId, "tag", before, created, writeHistory, clientId, opId, occurredAt, transaction)
    return { tag: created, beforeConflict: before }
  })
  const oldStorage = beforeConflict ? estimateTagStorage(beforeConflict) : 0
  await addStorageDelta(userId, estimateTagStorage(tag) - oldStorage)
  return tag
}
