import { sql } from "../client"
import { historyDb } from "../history"
import { assertCanCreateAutumnResource, syncAutumnResourceUsage } from "../../billing/resourceUsage"
import { addStorageDelta } from "../../billing/storageUsage"
import { estimateCanvasStorage, estimateTagStorage, estimateThoughtStorage, estimateTileStorage } from "../../billing/storageEstimate"
import type { Canvas, Tag, Thought, Tile } from "../../types"
import { booleanValue, nullablePositiveId, numberValue, positiveId, stringArrayValue, stringValue } from "./values"
import type { SyncPayload } from "./types"

export async function upsertCanvas(userId: string, clientId: string | null, serverId: number | null, payload: SyncPayload, writeHistory: boolean) {
  const name = stringValue(payload.name, "New Canvas").trim() || "New Canvas"
  const sortOrder = numberValue(payload.sort_order, 0)
  const isFavourite = booleanValue(payload.is_favourite, false)
  const existing = serverId
    ? (await sql<Canvas[]>`SELECT * FROM canvases WHERE id = ${serverId} AND user_id = ${userId}`)[0]
    : clientId
      ? (await sql<Canvas[]>`SELECT * FROM canvases WHERE user_id = ${userId} AND client_id = ${clientId}`)[0]
      : undefined

  if (existing) {
    const [canvas] = await sql<Canvas[]>`
      UPDATE canvases
      SET client_id = COALESCE(client_id, ${clientId}), name = ${name}, sort_order = ${sortOrder}, is_favourite = ${isFavourite}, updated_at = NOW()
      WHERE id = ${existing.id} AND user_id = ${userId}
      RETURNING *
    ` as unknown as [Canvas]
    await addStorageDelta(userId, estimateCanvasStorage(canvas) - estimateCanvasStorage(existing))
    return canvas
  }

  await assertCanCreateAutumnResource(userId, "canvases")
  const [canvas] = await sql<Canvas[]>`
    INSERT INTO canvases (user_id, client_id, name, sort_order, is_favourite)
    VALUES (${userId}, ${clientId}, ${name}, ${sortOrder}, ${isFavourite})
    RETURNING *
  ` as unknown as [Canvas]
  await syncAutumnResourceUsage(userId, "canvases").catch((error) => {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`[autumn] failed to sync canvas usage after create: ${message}`)
  })
  await addStorageDelta(userId, estimateCanvasStorage(canvas))
  if (writeHistory) await historyDb.log(userId, "canvas.create", `Created canvas "${canvas.name}"`, { canvas_id: canvas.id, name: canvas.name })
  return canvas
}

export async function upsertTile(userId: string, clientId: string | null, serverId: number | null, payload: SyncPayload, writeHistory: boolean) {
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
    const [tile] = await sql<Tile[]>`
      UPDATE tiles
      SET client_id = COALESCE(client_id, ${clientId}), canvas_id = ${canvasId}, title = ${title}, x = ${x}, y = ${y}, width = ${width}, height = ${height},
          importance = ${importance}, visible = ${visible}, updated_at = NOW(), deleted_at = NULL
      WHERE id = ${existing.id} AND user_id = ${userId}
      RETURNING *
    ` as unknown as [Tile]
    const wasDeleted = (existing as Tile & { deleted_at?: string | null }).deleted_at !== null && (existing as Tile & { deleted_at?: string | null }).deleted_at !== undefined
    await addStorageDelta(userId, estimateTileStorage(tile) - (wasDeleted ? 0 : estimateTileStorage(existing)))
    return tile
  }

  await assertCanCreateAutumnResource(userId, "tiles")
  const [tile] = await sql<Tile[]>`
    INSERT INTO tiles (user_id, client_id, canvas_id, title, x, y, width, height, importance, visible)
    VALUES (${userId}, ${clientId}, ${canvasId}, ${title}, ${x}, ${y}, ${width}, ${height}, ${importance}, ${visible})
    RETURNING *
  ` as unknown as [Tile]
  await syncAutumnResourceUsage(userId, "tiles").catch((error) => {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`[autumn] failed to sync tile usage after create: ${message}`)
  })
  await addStorageDelta(userId, estimateTileStorage(tile))
  if (writeHistory) await historyDb.log(userId, "tile.create", `Created tile "${tile.title}"`, { tile_id: tile.id, title: tile.title })
  return tile
}

export async function upsertThought(userId: string, clientId: string | null, serverId: number | null, payload: SyncPayload, writeHistory: boolean) {
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
    const [thought] = await sql<Thought[]>`
      UPDATE thoughts
      SET client_id = COALESCE(client_id, ${clientId}), tile_id = ${tileId}, content = ${content}, tags = ${tags}, sort_order = ${sortOrder}, updated_at = NOW(), deleted_at = NULL
      WHERE id = ${existing.id} AND user_id = ${userId}
      RETURNING *
    ` as unknown as [Thought]
    const wasDeleted = (existing as Thought & { deleted_at?: string | null }).deleted_at !== null && (existing as Thought & { deleted_at?: string | null }).deleted_at !== undefined
    await addStorageDelta(userId, estimateThoughtStorage(thought) - (wasDeleted ? 0 : estimateThoughtStorage(existing)))
    return thought
  }

  await assertCanCreateAutumnResource(userId, "thoughts")
  const [thought] = await sql<Thought[]>`
    INSERT INTO thoughts (user_id, client_id, tile_id, content, tags, sort_order)
    VALUES (${userId}, ${clientId}, ${tileId}, ${content}, ${tags}, ${sortOrder})
    RETURNING *
  ` as unknown as [Thought]
  await syncAutumnResourceUsage(userId, "thoughts").catch((error) => {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`[autumn] failed to sync thought usage after create: ${message}`)
  })
  await addStorageDelta(userId, estimateThoughtStorage(thought))
  if (writeHistory) await historyDb.log(userId, "thought.create", "Added thought", { thought_id: thought.id, tile_id: tileId, content, tags })
  return thought
}

export async function upsertTag(userId: string, clientId: string | null, serverId: number | null, payload: SyncPayload) {
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
    await sql.begin(async (tx) => {
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
    })
    const updated = (await sql<Tag[]>`SELECT * FROM tags WHERE id = ${existing.id} AND user_id = ${userId}`)[0]!
    await addStorageDelta(userId, estimateTagStorage(updated) - estimateTagStorage(existing) + thoughtTagDelta)
    return updated
  }

  const beforeConflict = await sql<Tag[]>`SELECT * FROM tags WHERE user_id = ${userId} AND name = ${name}`
  const [tag] = await sql<Tag[]>`
    INSERT INTO tags (user_id, client_id, name, color)
    VALUES (${userId}, ${clientId}, ${name}, ${color})
    ON CONFLICT(user_id, name) DO UPDATE SET client_id = COALESCE(tags.client_id, excluded.client_id), color = excluded.color, updated_at = NOW()
    RETURNING *
  ` as unknown as [Tag]
  const oldStorage = beforeConflict[0] ? estimateTagStorage(beforeConflict[0]) : 0
  await addStorageDelta(userId, estimateTagStorage(tag) - oldStorage)
  return tag
}
