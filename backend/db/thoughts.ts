import { sql } from "./client"
import { historyDb } from "./history"
import type { Thought } from "../types"

export const thoughtsDb = {
  list: async (userId: string, tileId?: number) =>
    tileId
      ? sql<Thought[]>`SELECT * FROM thoughts WHERE user_id = ${userId} AND tile_id = ${tileId} AND deleted_at IS NULL ORDER BY sort_order ASC, created_at ASC`
      : sql<Thought[]>`SELECT * FROM thoughts WHERE user_id = ${userId} AND deleted_at IS NULL ORDER BY sort_order ASC, created_at ASC`,

  listPast: async (userId: string) =>
    sql<Thought[]>`SELECT * FROM thoughts WHERE user_id = ${userId} AND deleted_at IS NOT NULL ORDER BY deleted_at DESC`,

  create: async (data: Omit<Thought, "id" | "created_at">, userId: string, silent = false) => {
    const [maxRow] = await sql<{ m: number | null }[]>`SELECT MAX(sort_order) as m FROM thoughts WHERE tile_id = ${data.tile_id} AND user_id = ${userId}`
    const sort_order = (maxRow?.m ?? -1) + 1
    const [thought] = await sql<Thought[]>`
      INSERT INTO thoughts (user_id, tile_id, content, tags, sort_order)
      VALUES (${userId}, ${data.tile_id}, ${data.content}, ${data.tags}, ${sort_order})
      RETURNING *
    ` as unknown as [Thought]
    if (!silent) {
      const [tile] = await sql<{ title: string }[]>`SELECT title FROM tiles WHERE id = ${data.tile_id} AND user_id = ${userId}`
      const tagStr = data.tags.length ? ` tagged [${data.tags.join(", ")}]` : ""
      await historyDb.log(userId, "thought.create", `Added thought${tagStr} in "${tile?.title ?? data.tile_id}"`, { thought_id: thought.id, tile_id: data.tile_id, content: data.content, tags: data.tags })
    }
    return thought
  },

  reorder: (id: number, sort_order: number, userId: string) =>
    sql`UPDATE thoughts SET sort_order = ${sort_order} WHERE id = ${id} AND user_id = ${userId}`,

  updateTags: async (id: number, tags: string[], userId: string) => {
    const [row] = await sql<Thought[]>`UPDATE thoughts SET tags = ${tags} WHERE id = ${id} AND user_id = ${userId} RETURNING *` as unknown as [Thought]
    const tagStr = tags.length ? tags.join(", ") : "none"
    await historyDb.log(userId, "thought.tag", `Tagged thought [${tagStr}]`, { thought_id: id, tags })
    return row
  },

  update: async (id: number, content: string, userId: string, tags?: string[]) => {
    const [old] = await sql<{ content: string }[]>`SELECT content FROM thoughts WHERE id = ${id} AND user_id = ${userId}`
    if (tags !== undefined) {
      await sql`UPDATE thoughts SET content = ${content}, tags = ${tags} WHERE id = ${id} AND user_id = ${userId}`
    } else {
      await sql`UPDATE thoughts SET content = ${content} WHERE id = ${id} AND user_id = ${userId}`
    }
    await historyDb.log(userId, "thought.update", `Updated thought "${old?.content?.slice(0, 40) ?? id}" → "${content.slice(0, 40)}"`, { thought_id: id, old_content: old?.content, new_content: content })
  },

  move: async (id: number, tile_id: number, userId: string) => {
    await sql`UPDATE thoughts SET tile_id = ${tile_id} WHERE id = ${id} AND user_id = ${userId}`
    const [tile] = await sql<{ title: string }[]>`SELECT title FROM tiles WHERE id = ${tile_id} AND user_id = ${userId}`
    await historyDb.log(userId, "thought.move", `Moved thought to "${tile?.title ?? tile_id}"`, { thought_id: id, tile_id })
  },

  remove: async (id: number, userId: string) => {
    const [row] = await sql<{ content: string }[]>`SELECT content FROM thoughts WHERE id = ${id} AND user_id = ${userId}`
    await sql`UPDATE thoughts SET deleted_at = NOW() WHERE id = ${id} AND user_id = ${userId}`
    await historyDb.log(userId, "thought.delete", `Deleted thought "${row?.content?.slice(0, 40) ?? id}"`, { thought_id: id })
  },
}
