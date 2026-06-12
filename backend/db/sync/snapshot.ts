import { sql } from "../client"
import type { Canvas, Tag, Thought, Tile } from "../../types"
import { latestRevision } from "./events"
import type { SyncSnapshot } from "./types"

async function ensureDefaultCanvas(userId: string) {
  const [existing] = await sql<Canvas[]>`SELECT * FROM canvases WHERE user_id = ${userId} ORDER BY sort_order ASC, created_at ASC LIMIT 1`
  let canvas = existing
  if (!canvas) {
    ;[canvas] = await sql<Canvas[]>`
      INSERT INTO canvases (user_id, name, sort_order)
      VALUES (${userId}, 'Home', 0)
      RETURNING *
    ` as unknown as [Canvas]
  }
  await sql`UPDATE tiles SET canvas_id = ${canvas.id}, updated_at = NOW() WHERE user_id = ${userId} AND canvas_id IS NULL AND deleted_at IS NULL`
  return canvas
}

export async function syncSnapshot(userId: string, requestedCanvasId?: number): Promise<SyncSnapshot> {
  await ensureDefaultCanvas(userId)
  const canvases = await sql<Canvas[]>`
    SELECT * FROM canvases
    WHERE user_id = ${userId}
    ORDER BY is_favourite DESC, sort_order ASC, created_at ASC
  `
  const requestedCanvas = requestedCanvasId === undefined
    ? undefined
    : canvases.find((canvas) => Number(canvas.id) === requestedCanvasId)
  const activeCanvas = requestedCanvas ?? canvases[0] ?? null
  const activeCanvasId = activeCanvas ? Number(activeCanvas.id) : null
  const [tags, tiles, thoughts, revision] = await Promise.all([
    sql<Tag[]>`SELECT * FROM tags WHERE user_id = ${userId} ORDER BY name ASC`,
    activeCanvasId === null
      ? Promise.resolve([] satisfies Tile[])
      : sql<Tile[]>`
          SELECT * FROM tiles
          WHERE user_id = ${userId}
            AND canvas_id = ${activeCanvasId}
            AND deleted_at IS NULL
          ORDER BY created_at DESC
        `,
    activeCanvasId === null
      ? Promise.resolve([] satisfies Thought[])
      : sql<Thought[]>`
          SELECT thoughts.* FROM thoughts
          JOIN tiles ON tiles.id = thoughts.tile_id AND tiles.user_id = ${userId}
          WHERE thoughts.user_id = ${userId}
            AND tiles.canvas_id = ${activeCanvasId}
            AND thoughts.deleted_at IS NULL
            AND tiles.deleted_at IS NULL
          ORDER BY thoughts.sort_order ASC, thoughts.created_at ASC
        `,
    latestRevision(userId),
  ])
  return {
    revision,
    active_canvas_id: activeCanvasId,
    canvases,
    tags,
    tiles,
    thoughts,
  }
}
