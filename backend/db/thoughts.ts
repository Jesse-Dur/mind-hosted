import { sql } from "./client"
import type { Thought } from "../types"

export const thoughtsDb = {
  list: async (userId: string, scope: { tileId?: number; canvasId?: number } = {}) => {
    if (scope.tileId !== undefined) {
      return sql<Thought[]>`SELECT * FROM thoughts WHERE user_id = ${userId} AND tile_id = ${scope.tileId} AND deleted_at IS NULL ORDER BY sort_order ASC, created_at ASC`
    }
    if (scope.canvasId !== undefined) {
      return sql<Thought[]>`
        SELECT thoughts.* FROM thoughts
        JOIN tiles ON tiles.id = thoughts.tile_id AND tiles.user_id = ${userId}
        WHERE thoughts.user_id = ${userId}
          AND tiles.canvas_id = ${scope.canvasId}
          AND thoughts.deleted_at IS NULL
          AND tiles.deleted_at IS NULL
        ORDER BY thoughts.sort_order ASC, thoughts.created_at ASC
      `
    }
    return sql<Thought[]>`SELECT * FROM thoughts WHERE user_id = ${userId} AND deleted_at IS NULL ORDER BY sort_order ASC, created_at ASC`
  },

  listPast: async (userId: string) =>
    sql<Thought[]>`SELECT * FROM thoughts WHERE user_id = ${userId} AND deleted_at IS NOT NULL ORDER BY deleted_at DESC`,
}
