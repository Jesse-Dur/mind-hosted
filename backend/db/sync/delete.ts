import { sql } from "../client"
import type { Canvas, Tag, Thought, Tile } from "../../types"
import type { DeletePayload, SyncEntityType } from "./types"

export async function deleteEntity(userId: string, entityType: SyncEntityType, serverId: number | null, payload: DeletePayload) {
  if (serverId === null) return null
  if (entityType === "canvas") {
    const [canvas] = await sql<Canvas[]>`SELECT * FROM canvases WHERE id = ${serverId} AND user_id = ${userId}`
    if (!canvas) return null
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
    return canvas
  }
  if (entityType === "tile") {
    const [tile] = await sql<Tile[]>`SELECT * FROM tiles WHERE id = ${serverId} AND user_id = ${userId}`
    await sql`UPDATE thoughts SET deleted_at = NOW(), updated_at = NOW() WHERE tile_id = ${serverId} AND user_id = ${userId}`
    await sql`UPDATE tiles SET deleted_at = NOW(), updated_at = NOW() WHERE id = ${serverId} AND user_id = ${userId}`
    return tile ?? null
  }
  if (entityType === "thought") {
    const [thought] = await sql<Thought[]>`SELECT * FROM thoughts WHERE id = ${serverId} AND user_id = ${userId}`
    await sql`UPDATE thoughts SET deleted_at = NOW(), updated_at = NOW() WHERE id = ${serverId} AND user_id = ${userId}`
    return thought ?? null
  }
  const [tag] = await sql<Tag[]>`SELECT * FROM tags WHERE id = ${serverId} AND user_id = ${userId}`
  await sql`DELETE FROM tags WHERE id = ${serverId} AND user_id = ${userId}`
  return tag ?? null
}
