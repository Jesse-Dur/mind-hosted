import { sql } from "./client"
import type { Tag } from "../types"

export const tagsDb = {
  list: async (userId: string) =>
    sql<Tag[]>`SELECT * FROM tags WHERE user_id = ${userId} ORDER BY name`,
}
