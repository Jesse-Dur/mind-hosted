import { sql } from "./client"
import { historyDb } from "./history"
import type { Tile } from "../types"

export type TileCreate = Omit<Tile, "id" | "created_at">
export type TileUpdate = Partial<Pick<Tile, "canvas_id" | "title" | "x" | "y" | "width" | "height" | "importance" | "visible">>

export class TileCanvasNotFoundError extends Error {
  constructor() {
    super("Canvas not found")
  }
}

function buildTileUpdate(data: TileUpdate): TileUpdate {
  const update: TileUpdate = {}
  if (data.canvas_id !== undefined) update.canvas_id = data.canvas_id
  if (data.title !== undefined) update.title = data.title
  if (data.x !== undefined) update.x = data.x
  if (data.y !== undefined) update.y = data.y
  if (data.width !== undefined) update.width = data.width
  if (data.height !== undefined) update.height = data.height
  if (data.importance !== undefined) update.importance = data.importance
  if (data.visible !== undefined) update.visible = data.visible
  return update
}

async function assertCanvasBelongsToUser(canvasId: number | null | undefined, userId: string) {
  if (canvasId === null || canvasId === undefined) return
  const [canvas] = await sql<{ id: number }[]>`SELECT id FROM canvases WHERE id = ${canvasId} AND user_id = ${userId}`
  if (!canvas) throw new TileCanvasNotFoundError()
}

export const tilesDb = {
  list: async (userId: string, canvasId?: number) =>
    canvasId !== undefined
      ? sql<Tile[]>`SELECT * FROM tiles WHERE user_id = ${userId} AND canvas_id = ${canvasId} AND deleted_at IS NULL ORDER BY created_at DESC`
      : sql<Tile[]>`SELECT * FROM tiles WHERE user_id = ${userId} AND deleted_at IS NULL ORDER BY created_at DESC`,

  listPast: async (userId: string) =>
    sql<Tile[]>`SELECT * FROM tiles WHERE user_id = ${userId} AND deleted_at IS NOT NULL ORDER BY deleted_at DESC`,

  get: async (id: number, userId: string) =>
    (await sql<Tile[]>`SELECT * FROM tiles WHERE id = ${id} AND user_id = ${userId}`)[0] ?? null,

  create: async (data: TileCreate, userId: string) => {
    await assertCanvasBelongsToUser(data.canvas_id, userId)

    const [tile] = await sql<Tile[]>`
      INSERT INTO tiles (user_id, canvas_id, title, x, y, width, height, importance, visible)
      VALUES (${userId}, ${data.canvas_id}, ${data.title}, ${data.x}, ${data.y}, ${data.width}, ${data.height}, ${data.importance}, ${data.visible})
      RETURNING *
    ` as unknown as [Tile]
    await historyDb.log(userId, "tile.create", `Created tile "${tile.title}"`, { tile_id: tile.id, title: tile.title })
    return tile
  },

  update: async (id: number, data: TileUpdate, userId: string) => {
    const update = buildTileUpdate(data)
    if (Object.keys(update).length === 0) throw new Error("No tile fields to update")
    if ("canvas_id" in update) await assertCanvasBelongsToUser(update.canvas_id, userId)
    const hasCanvasId = "canvas_id" in update
    const hasTitle = update.title !== undefined
    const hasX = update.x !== undefined
    const hasY = update.y !== undefined
    const hasWidth = update.width !== undefined
    const hasHeight = update.height !== undefined
    const hasImportance = update.importance !== undefined
    const hasVisible = update.visible !== undefined

    const [tile] = await sql<Tile[]>`
      UPDATE tiles
      SET
        canvas_id = CASE WHEN ${hasCanvasId} THEN ${update.canvas_id ?? null} ELSE canvas_id END,
        title = CASE WHEN ${hasTitle} THEN ${update.title ?? null} ELSE title END,
        x = CASE WHEN ${hasX} THEN ${update.x ?? null} ELSE x END,
        y = CASE WHEN ${hasY} THEN ${update.y ?? null} ELSE y END,
        width = CASE WHEN ${hasWidth} THEN ${update.width ?? null} ELSE width END,
        height = CASE WHEN ${hasHeight} THEN ${update.height ?? null} ELSE height END,
        importance = CASE WHEN ${hasImportance} THEN ${update.importance ?? null} ELSE importance END,
        visible = CASE WHEN ${hasVisible} THEN ${update.visible ?? null} ELSE visible END
      WHERE id = ${id} AND user_id = ${userId}
      RETURNING *
    ` as unknown as [Tile]
    if (update.title) {
      await historyDb.log(userId, "tile.update", `Renamed tile to "${update.title}"`, { tile_id: id, title: update.title })
    }
    return tile
  },

  remove: async (id: number, userId: string) => {
    const [tile] = await sql<{ title: string }[]>`SELECT title FROM tiles WHERE id = ${id} AND user_id = ${userId}`
    await sql`UPDATE thoughts SET deleted_at = NOW() WHERE tile_id = ${id} AND user_id = ${userId} AND deleted_at IS NULL`
    await sql`UPDATE tiles SET deleted_at = NOW() WHERE id = ${id} AND user_id = ${userId}`
    await historyDb.log(userId, "tile.delete", `Deleted tile "${tile?.title ?? id}"`, { tile_id: id })
  },
}
