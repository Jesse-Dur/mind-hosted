import { sql } from "../client"
import { syncAutumnResourcesAfterDelete } from "../../billing/resourceUsage"
import { addStorageDelta } from "../../billing/storageUsage"
import { estimateCanvasStorage, estimateTagStorage, estimateThoughtStorage, estimateTileStorage } from "../../billing/storageEstimate"
import type { Canvas, Tag, Thought, Tile } from "../../types"
import type { DeletePayload, SyncEntityType } from "./types"

export async function deleteEntity(userId: string, entityType: SyncEntityType, serverId: number | null, payload: DeletePayload) {
  if (serverId === null) return null
  if (entityType === "canvas") {
    const [canvas] = await sql<Canvas[]>`SELECT * FROM canvases WHERE id = ${serverId} AND user_id = ${userId}`
    if (!canvas) return null
    const childTiles = await sql<Tile[]>`SELECT * FROM tiles WHERE canvas_id = ${serverId} AND user_id = ${userId} AND deleted_at IS NULL`
    const childThoughts = await sql<Thought[]>`
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
      const [target] = await sql<Canvas[]>`SELECT * FROM canvases WHERE id = ${targetCanvasId} AND user_id = ${userId}`
      if (!target) throw new Error("Target canvas not found")
      await sql`UPDATE tiles SET canvas_id = ${targetCanvasId}, updated_at = NOW() WHERE canvas_id = ${serverId} AND user_id = ${userId}`
    } else {
      await sql`UPDATE thoughts SET deleted_at = NOW(), updated_at = NOW() WHERE user_id = ${userId} AND tile_id IN (SELECT id FROM tiles WHERE canvas_id = ${serverId} AND user_id = ${userId})`
      await sql`UPDATE tiles SET deleted_at = NOW(), updated_at = NOW() WHERE canvas_id = ${serverId} AND user_id = ${userId}`
    }
    await sql`DELETE FROM canvases WHERE id = ${serverId} AND user_id = ${userId}`
    const contentDelta = mode === "moveContents"
      ? 0
      : childTiles.reduce((total, tile) => total + estimateTileStorage(tile), 0)
        + childThoughts.reduce((total, thought) => total + estimateThoughtStorage(thought), 0)
    await addStorageDelta(userId, -(estimateCanvasStorage(canvas) + contentDelta))
    await syncAutumnResourcesAfterDelete(userId, ["canvases", "tiles", "thoughts"])
    return canvas
  }
  if (entityType === "tile") {
    const [tile] = await sql<Tile[]>`SELECT * FROM tiles WHERE id = ${serverId} AND user_id = ${userId}`
    const thoughts = await sql<Thought[]>`SELECT * FROM thoughts WHERE tile_id = ${serverId} AND user_id = ${userId} AND deleted_at IS NULL`
    await sql`UPDATE thoughts SET deleted_at = NOW(), updated_at = NOW() WHERE tile_id = ${serverId} AND user_id = ${userId}`
    await sql`UPDATE tiles SET deleted_at = NOW(), updated_at = NOW() WHERE id = ${serverId} AND user_id = ${userId}`
    if (tile) {
      const contentDelta = thoughts.reduce((total, thought) => total + estimateThoughtStorage(thought), 0)
      await addStorageDelta(userId, -(estimateTileStorage(tile) + contentDelta))
    }
    await syncAutumnResourcesAfterDelete(userId, ["tiles", "thoughts"])
    return tile ?? null
  }
  if (entityType === "thought") {
    const [thought] = await sql<Thought[]>`SELECT * FROM thoughts WHERE id = ${serverId} AND user_id = ${userId}`
    await sql`UPDATE thoughts SET deleted_at = NOW(), updated_at = NOW() WHERE id = ${serverId} AND user_id = ${userId}`
    if (thought && (thought as Thought & { deleted_at?: string | null }).deleted_at === null) {
      await addStorageDelta(userId, -estimateThoughtStorage(thought))
    }
    await syncAutumnResourcesAfterDelete(userId, ["thoughts"])
    return thought ?? null
  }
  const [tag] = await sql<Tag[]>`SELECT * FROM tags WHERE id = ${serverId} AND user_id = ${userId}`
  await sql`DELETE FROM tags WHERE id = ${serverId} AND user_id = ${userId}`
  if (tag) await addStorageDelta(userId, -estimateTagStorage(tag))
  return tag ?? null
}
