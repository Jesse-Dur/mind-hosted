import { sql } from "./client"
import type { Tag } from "../../frontend/src/types"

export const tagsDb = {
  list: async (userId: string) =>
    sql<Tag[]>`SELECT * FROM tags WHERE user_id = ${userId} ORDER BY name`,

  upsert: async (name: string, color = "#888", userId: string) =>
    (await sql<Tag[]>`
      INSERT INTO tags (user_id, name, color) VALUES (${userId}, ${name}, ${color})
      ON CONFLICT(user_id, name) DO UPDATE SET color = excluded.color
      RETURNING *
    `)[0],

  update: async (id: number, name: string, color: string, userId: string) => {
    return sql.begin(async (tx) => {
      const [old] = await tx<{ name: string }[]>`SELECT name FROM tags WHERE id = ${id} AND user_id = ${userId}`
      const [tag] = await tx<Tag[]>`UPDATE tags SET name = ${name}, color = ${color} WHERE id = ${id} AND user_id = ${userId} RETURNING *`
      if (old && old.name !== name) {
        const thoughts = await tx<{ id: number; tags: string[] }[]>`
          SELECT id, tags FROM thoughts WHERE user_id = ${userId} AND ${old.name} = ANY(tags)
        `
        for (const t of thoughts) {
          const updated = t.tags.map((tg) => (tg === old.name ? name : tg))
          await tx`UPDATE thoughts SET tags = ${updated} WHERE id = ${t.id}`
        }
      }
      return tag
    })
  },

  remove: (id: number, userId: string) =>
    sql`DELETE FROM tags WHERE id = ${id} AND user_id = ${userId}`,
}
