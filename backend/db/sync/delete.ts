import { sql } from "../client"
import { reconcileAutumnResourcesAfterMutation } from "../../billing/resourceUsage"
import { addStorageDelta } from "../../billing/storageUsage"
import { estimateCanvasStorage, estimateTagStorage, estimateThoughtStorage, estimateTileStorage } from "../../billing/storageEstimate"
import type { Canvas, Tag, Thought, Tile } from "../../types"
import type { DeletePayload, SyncEntityType } from "./types"
import { historyDb } from "../history"
import { buildDeleteHistory } from "./historyEntry"

export async function deleteEntity(userId: string, entityType: SyncEntityType, serverId: number | null, payload: DeletePayload, writeHistory = false, opId?: string, clientId?: string | null, occurredAt?: string) {
  if (serverId === null) return null
  if (entityType === "canvas") {
    const mutation = await sql.begin(async (transaction) => {
      const [canvas] = await transaction<Canvas[]>`SELECT * FROM canvases WHERE id = ${serverId} AND user_id = ${userId}`
      if (!canvas) return null
      const childTiles = await transaction<Tile[]>`SELECT * FROM tiles WHERE canvas_id = ${serverId} AND user_id = ${userId} AND deleted_at IS NULL`
      const childThoughts = await transaction<Thought[]>`
        SELECT thoughts.* FROM thoughts
        JOIN tiles ON tiles.id = thoughts.tile_id AND tiles.user_id = ${userId}
        WHERE tiles.canvas_id = ${serverId}
          AND thoughts.user_id = ${userId}
          AND thoughts.deleted_at IS NULL
          AND tiles.deleted_at IS NULL
      `
      const mode = payload.mode ?? "deleteContents"
      const targetCanvasId = payload.targetCanvasId
      if (mode === "moveContents") {
        if (!targetCanvasId || targetCanvasId === serverId) throw new Error("Invalid target canvas")
        const [target] = await transaction<Canvas[]>`SELECT * FROM canvases WHERE id = ${targetCanvasId} AND user_id = ${userId}`
        if (!target) throw new Error("Target canvas not found")
        await transaction`UPDATE tiles SET canvas_id = ${targetCanvasId}, updated_at = NOW() WHERE canvas_id = ${serverId} AND user_id = ${userId}`
      } else {
        await transaction`UPDATE thoughts SET deleted_at = NOW(), updated_at = NOW() WHERE user_id = ${userId} AND tile_id IN (SELECT id FROM tiles WHERE canvas_id = ${serverId} AND user_id = ${userId})`
        await transaction`UPDATE tiles SET deleted_at = NOW(), updated_at = NOW() WHERE canvas_id = ${serverId} AND user_id = ${userId}`
      }
      await transaction`DELETE FROM canvases WHERE id = ${serverId} AND user_id = ${userId}`
      if (writeHistory) {
        const entry = buildDeleteHistory(entityType, canvas, payload)
        await historyDb.log(userId, entry.action, entry.summary, entry.detail, { clientId: clientId ?? canvas.client_id, opId, occurredAt, query: transaction })
      }
      return { canvas, childTiles, childThoughts, mode }
    })
    if (!mutation) return null
    const { canvas, childTiles, childThoughts, mode } = mutation
    const contentDelta = mode === "moveContents"
      ? 0
      : childTiles.reduce((total, tile) => total + estimateTileStorage(tile), 0)
        + childThoughts.reduce((total, thought) => total + estimateThoughtStorage(thought), 0)
    await addStorageDelta(userId, -(estimateCanvasStorage(canvas) + contentDelta))
    await reconcileAutumnResourcesAfterMutation(userId, ["canvases", "tiles", "thoughts"])
    return canvas
  }
  if (entityType === "tile") {
    const { tile, tileWasActive, thoughts } = await sql.begin(async (transaction) => {
      const [tile] = await transaction<Tile[]>`SELECT * FROM tiles WHERE id = ${serverId} AND user_id = ${userId}`
      const tileWasActive = tile && (tile as Tile & { deleted_at?: string | null }).deleted_at == null
      const thoughts = await transaction<Thought[]>`SELECT * FROM thoughts WHERE tile_id = ${serverId} AND user_id = ${userId} AND deleted_at IS NULL`
      await transaction`UPDATE thoughts SET deleted_at = NOW(), updated_at = NOW() WHERE tile_id = ${serverId} AND user_id = ${userId}`
      await transaction`UPDATE tiles SET deleted_at = NOW(), updated_at = NOW() WHERE id = ${serverId} AND user_id = ${userId}`
      if (writeHistory && tile) {
        const entry = buildDeleteHistory(entityType, tile, payload)
        await historyDb.log(userId, entry.action, entry.summary, entry.detail, { clientId: clientId ?? tile.client_id, opId, occurredAt, query: transaction })
      }
      return { tile, tileWasActive, thoughts }
    })
    if (tile) {
      // Canvas deletion also queues child cleanup operations on the client. Only
      // subtract the tile itself when this request performs its active-to-deleted transition.
      const tileDelta = tileWasActive ? estimateTileStorage(tile) : 0
      const thoughtDelta = thoughts.reduce((total, thought) => total + estimateThoughtStorage(thought), 0)
      await addStorageDelta(userId, -(tileDelta + thoughtDelta))
    }
    await reconcileAutumnResourcesAfterMutation(userId, ["tiles", "thoughts"])
    return tile ?? null
  }
  if (entityType === "thought") {
    const thought = await sql.begin(async (transaction) => {
      const [thought] = await transaction<Thought[]>`SELECT * FROM thoughts WHERE id = ${serverId} AND user_id = ${userId}`
      await transaction`UPDATE thoughts SET deleted_at = NOW(), updated_at = NOW() WHERE id = ${serverId} AND user_id = ${userId}`
      if (writeHistory && thought) {
        const entry = buildDeleteHistory(entityType, thought, payload)
        await historyDb.log(userId, entry.action, entry.summary, entry.detail, { clientId: clientId ?? thought.client_id, opId, occurredAt, query: transaction })
      }
      return thought
    })
    if (thought && (thought as Thought & { deleted_at?: string | null }).deleted_at === null) {
      await addStorageDelta(userId, -estimateThoughtStorage(thought))
    }
    await reconcileAutumnResourcesAfterMutation(userId, ["thoughts"])
    return thought ?? null
  }
  const [tag] = await sql<Tag[]>`SELECT * FROM tags WHERE id = ${serverId} AND user_id = ${userId}`
  if (!tag) return null
  let thoughtTagDelta = 0
  await sql.begin(async (tx) => {
    const thoughts = await tx<Thought[]>`
      SELECT * FROM thoughts WHERE user_id = ${userId} AND deleted_at IS NULL AND ${tag.name} = ANY(tags)
    `
    for (const thought of thoughts) {
      const updatedTags = thought.tags.filter((name) => name !== tag.name)
      thoughtTagDelta += estimateThoughtStorage({ content: thought.content, tags: updatedTags }) - estimateThoughtStorage(thought)
      await tx`UPDATE thoughts SET tags = ${updatedTags}, updated_at = NOW() WHERE id = ${thought.id} AND user_id = ${userId}`
    }
    // The tag and its thought references must disappear atomically so snapshots
    // can never expose a deleted definition alongside stale tag labels.
    await tx`DELETE FROM tags WHERE id = ${serverId} AND user_id = ${userId}`
    if (writeHistory) {
      const entry = buildDeleteHistory(entityType, tag, payload)
      await historyDb.log(userId, entry.action, entry.summary, entry.detail, { clientId: clientId ?? tag.client_id, opId, occurredAt, query: tx })
    }
  })
  await addStorageDelta(userId, -estimateTagStorage(tag) + thoughtTagDelta)
  return tag ?? null
}
