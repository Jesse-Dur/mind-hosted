import { sql } from "./client"
import { historyDb } from "./history"
import type { Tile } from "../../frontend/src/types"

export const tilesDb = {
  list: async (userId: string) =>
    sql<Tile[]>`SELECT * FROM tiles WHERE user_id = ${userId} AND deleted_at IS NULL ORDER BY created_at DESC`,

  listPast: async (userId: string) =>
    sql<Tile[]>`SELECT * FROM tiles WHERE user_id = ${userId} AND deleted_at IS NOT NULL ORDER BY deleted_at DESC`,

  get: async (id: number, userId: string) =>
    (await sql<Tile[]>`SELECT * FROM tiles WHERE id = ${id} AND user_id = ${userId}`)[0] ?? null,

  create: async (data: Omit<Tile, "id" | "created_at">, userId: string) => {
    const [tile] = await sql<Tile[]>`
      INSERT INTO tiles (user_id, title, x, y, width, height, importance, visible)
      VALUES (${userId}, ${data.title}, ${data.x}, ${data.y}, ${data.width}, ${data.height}, ${data.importance}, ${data.visible})
      RETURNING *
    ` as unknown as [Tile]
    await historyDb.log(userId, "tile.create", `Created tile "${tile.title}"`, { tile_id: tile.id, title: tile.title })
    return tile
  },

  update: async (id: number, data: Partial<Omit<Tile, "id" | "created_at">>, userId: string) => {
    const [tile] = await sql<Tile[]>`
      UPDATE tiles SET ${sql(data)} WHERE id = ${id} AND user_id = ${userId} RETURNING *
    ` as unknown as [Tile]
    if (data.title) {
      console.log(`[tile.update] "${data.title.replace(/[\r\n]/g, " ")}" (id: ${id})`)
      await historyDb.log(userId, "tile.update", `Renamed tile to "${data.title}"`, { tile_id: id, title: data.title })
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
