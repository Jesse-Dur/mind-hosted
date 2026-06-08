import { sql } from "./client"
import { historyDb } from "./history"
import type { Thought } from "../types"

export type ThoughtCreate = Omit<Thought, "id" | "created_at">

export class ThoughtTileNotFoundError extends Error {
  constructor() {
    super("Tile not found")
  }
}

type IdRow = { id: number | string }

async function assertTileBelongsToUser(tileId: number, userId: string) {
  const [tile] = await sql<{ id: number }[]>`SELECT id FROM tiles WHERE id = ${tileId} AND user_id = ${userId} AND deleted_at IS NULL`
  if (!tile) throw new ThoughtTileNotFoundError()
}

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

  create: async (data: ThoughtCreate, userId: string, silent = false) => {
    await assertTileBelongsToUser(data.tile_id, userId)

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

  update: async (id: number, content: string, userId: string, tags?: string[], silent = false) => {
    const [old] = await sql<{ content: string }[]>`SELECT content FROM thoughts WHERE id = ${id} AND user_id = ${userId}`
    if (tags !== undefined) {
      await sql`UPDATE thoughts SET content = ${content}, tags = ${tags} WHERE id = ${id} AND user_id = ${userId}`
    } else {
      await sql`UPDATE thoughts SET content = ${content} WHERE id = ${id} AND user_id = ${userId}`
    }
    if (!silent) await historyDb.log(userId, "thought.update", `Updated thought "${old?.content?.slice(0, 40) ?? id}" → "${content.slice(0, 40)}"`, { thought_id: id, old_content: old?.content, new_content: content })
  },

  move: async (id: number, tile_id: number, userId: string, orderedIds?: number[], silent = false) => {
    await assertTileBelongsToUser(tile_id, userId)

    const [old] = await sql<{ tile_id: number | string }[]>`SELECT tile_id FROM thoughts WHERE id = ${id} AND user_id = ${userId} AND deleted_at IS NULL`
    if (!old) return
    await sql.begin(async (tx) => {
      if (orderedIds && orderedIds.length > 0) {
        await tx`UPDATE thoughts SET tile_id = ${tile_id} WHERE id = ${id} AND user_id = ${userId} AND deleted_at IS NULL`
        const rows = await tx<IdRow[]>`SELECT id FROM thoughts WHERE tile_id = ${tile_id} AND user_id = ${userId} AND deleted_at IS NULL ORDER BY sort_order ASC, created_at ASC`
        const actualIds = rows.map((row) => Number(row.id))
        if (!actualIds.includes(id)) return

        const actualIdSet = new Set(actualIds)
        const finalIds: number[] = []
        for (const thoughtId of orderedIds) {
          if (!actualIdSet.has(thoughtId) || finalIds.includes(thoughtId)) continue
          finalIds.push(thoughtId)
        }
        if (!finalIds.includes(id)) finalIds.push(id)
        for (const thoughtId of actualIds) if (!finalIds.includes(thoughtId)) finalIds.push(thoughtId)

        await Promise.all(finalIds.map((thoughtId, sortOrder) =>
          tx`UPDATE thoughts SET sort_order = ${sortOrder} WHERE id = ${thoughtId} AND user_id = ${userId}`
        ))
        return
      }

      const [maxRow] = await tx<{ m: number | null }[]>`SELECT MAX(sort_order) as m FROM thoughts WHERE tile_id = ${tile_id} AND user_id = ${userId} AND deleted_at IS NULL`
      const sort_order = (maxRow?.m ?? -1) + 1
      await tx`UPDATE thoughts SET tile_id = ${tile_id}, sort_order = ${sort_order} WHERE id = ${id} AND user_id = ${userId} AND deleted_at IS NULL`
    })
    const [tile] = await sql<{ title: string }[]>`SELECT title FROM tiles WHERE id = ${tile_id} AND user_id = ${userId}`
    if (!silent && Number(old?.tile_id) !== tile_id) {
      await historyDb.log(userId, "thought.move", `Moved thought to "${tile?.title ?? tile_id}"`, { thought_id: id, tile_id })
    }
  },

  remove: async (id: number, userId: string, silent = false) => {
    const [row] = await sql<{ content: string }[]>`SELECT content FROM thoughts WHERE id = ${id} AND user_id = ${userId}`
    if (!row) return // already deleted
    await sql`UPDATE thoughts SET deleted_at = NOW() WHERE id = ${id} AND user_id = ${userId}`
    if (!silent) await historyDb.log(userId, "thought.delete", `Deleted thought "${row.content?.slice(0, 40) ?? id}"`, { thought_id: id, content: row.content })
  },
}
