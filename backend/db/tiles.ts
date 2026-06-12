import { sql } from "./client"
import type { Tile } from "../types"

export const tilesDb = {
  list: async (userId: string, canvasId?: number) =>
    canvasId !== undefined
      ? sql<Tile[]>`SELECT * FROM tiles WHERE user_id = ${userId} AND canvas_id = ${canvasId} AND deleted_at IS NULL ORDER BY created_at DESC`
      : sql<Tile[]>`SELECT * FROM tiles WHERE user_id = ${userId} AND deleted_at IS NULL ORDER BY created_at DESC`,

  listPast: async (userId: string) =>
    sql<Tile[]>`SELECT * FROM tiles WHERE user_id = ${userId} AND deleted_at IS NOT NULL ORDER BY deleted_at DESC`,
}
