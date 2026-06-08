import { sql } from "./client"
import { historyDb } from "./history"
import type { Canvas } from "../types"

type CanvasOrderUpdate = Pick<Canvas, "id" | "sort_order" | "is_favourite">
export type CanvasUpdate = Partial<Pick<Canvas, "name" | "sort_order" | "is_favourite">>
export type CanvasDeleteMode = "deleteContents" | "moveContents"

function buildCanvasUpdate(data: CanvasUpdate): CanvasUpdate {
  const update: CanvasUpdate = {}
  if (data.name !== undefined) update.name = data.name
  if (data.sort_order !== undefined) update.sort_order = data.sort_order
  if (data.is_favourite !== undefined) update.is_favourite = data.is_favourite
  return update
}

export const canvasesDb = {
  list: async (userId: string) =>
    sql<Canvas[]>`SELECT * FROM canvases WHERE user_id = ${userId} ORDER BY is_favourite DESC, sort_order ASC, created_at ASC`,

  create: async (userId: string, name: string, sortOrder: number) => {
    const [canvas] = await sql<Canvas[]>`
      INSERT INTO canvases (user_id, name, sort_order)
      VALUES (${userId}, ${name}, ${sortOrder})
      RETURNING *
    ` as unknown as [Canvas]
    await historyDb.log(userId, "canvas.create", `Created canvas "${canvas.name}"`, { canvas_id: canvas.id, name: canvas.name })
    return canvas
  },

  update: async (id: number, userId: string, data: CanvasUpdate) => {
    const update = buildCanvasUpdate(data)
    if (Object.keys(update).length === 0) throw new Error("No canvas fields to update")
    const hasName = update.name !== undefined
    const hasSortOrder = update.sort_order !== undefined
    const hasIsFavourite = update.is_favourite !== undefined

    const [before] = await sql<Canvas[]>`SELECT * FROM canvases WHERE id = ${id} AND user_id = ${userId}`
    const [canvas] = await sql<Canvas[]>`
      UPDATE canvases
      SET
        name = CASE WHEN ${hasName} THEN ${update.name ?? null} ELSE name END,
        sort_order = CASE WHEN ${hasSortOrder} THEN ${update.sort_order ?? null} ELSE sort_order END,
        is_favourite = CASE WHEN ${hasIsFavourite} THEN ${update.is_favourite ?? null} ELSE is_favourite END
      WHERE id = ${id} AND user_id = ${userId}
      RETURNING *
    ` as unknown as [Canvas]
    if (before && canvas && update.name !== undefined && update.name !== before.name) {
      await historyDb.log(userId, "canvas.rename", `Renamed canvas "${before.name}" to "${canvas.name}"`, { canvas_id: canvas.id, old_name: before.name, name: canvas.name })
    }
    return canvas
  },

  reorder: async (userId: string, updates: CanvasOrderUpdate[]) => {
    await sql.begin(async (tx) => {
      for (const update of updates) {
        await tx`
          UPDATE canvases
          SET sort_order = ${update.sort_order}, is_favourite = ${update.is_favourite}
          WHERE id = ${update.id} AND user_id = ${userId}
        `
      }
    })
  },

  // Returns the first canvas that isn't the one being deleted, creating a default if needed
  getOrCreateDefault: async (userId: string, excludeId: number) => {
    const [existing] = await sql<Canvas[]>`
      SELECT * FROM canvases WHERE user_id = ${userId} AND id != ${excludeId} ORDER BY sort_order ASC LIMIT 1
    `
    if (existing) return existing
    const [canvas] = await sql<Canvas[]>`
      INSERT INTO canvases (user_id, name, sort_order) VALUES (${userId}, 'Home', 0) RETURNING *
    ` as unknown as [Canvas]
    return canvas
  },

  // Ensures a default canvas exists and assigns any orphaned tiles (canvas_id IS NULL) to it
  ensureDefault: async (userId: string) => {
    const [existing] = await sql<Canvas[]>`SELECT * FROM canvases WHERE user_id = ${userId} ORDER BY sort_order ASC LIMIT 1`
    const canvas = existing ?? (await sql<Canvas[]>`
      INSERT INTO canvases (user_id, name, sort_order) VALUES (${userId}, 'Home', 0) RETURNING *
    ` as unknown as [Canvas])[0]
    // Reassign any tiles that predate canvas support
    await sql`UPDATE tiles SET canvas_id = ${canvas.id} WHERE user_id = ${userId} AND canvas_id IS NULL AND deleted_at IS NULL`
    return canvas
  },

  remove: async (id: number, userId: string, mode: CanvasDeleteMode, targetCanvasId?: number) => {
    const removedCanvas = await sql.begin(async (tx) => {
      const [canvas] = await tx<Canvas[]>`SELECT * FROM canvases WHERE id = ${id} AND user_id = ${userId}`
      if (!canvas) throw new Error("Canvas not found")

      const [remaining] = await tx<{ count: number }[]>`
        SELECT COUNT(*)::int AS count FROM canvases WHERE user_id = ${userId} AND id != ${id}
      `
      if ((remaining?.count ?? 0) === 0) throw new Error("Cannot delete the only canvas")

      if (mode === "moveContents") {
        if (targetCanvasId === undefined || targetCanvasId === id) throw new Error("Invalid target canvas")
        const [target] = await tx<Canvas[]>`SELECT * FROM canvases WHERE id = ${targetCanvasId} AND user_id = ${userId}`
        if (!target) throw new Error("Target canvas not found")

        // Tiles own their thoughts, so moving tiles carries the canvas thoughts with them.
        await tx`UPDATE tiles SET canvas_id = ${targetCanvasId} WHERE canvas_id = ${id} AND user_id = ${userId}`
      } else {
        await tx`
          UPDATE thoughts
          SET deleted_at = NOW()
          WHERE user_id = ${userId}
            AND deleted_at IS NULL
            AND tile_id IN (
              SELECT id FROM tiles
              WHERE canvas_id = ${id}
                AND user_id = ${userId}
                AND deleted_at IS NULL
            )
        `
        await tx`
          UPDATE tiles
          SET deleted_at = NOW()
          WHERE canvas_id = ${id}
            AND user_id = ${userId}
            AND deleted_at IS NULL
        `
      }

      await tx`DELETE FROM canvases WHERE id = ${id} AND user_id = ${userId}`
      return canvas
    })
    await historyDb.log(userId, "canvas.delete", `Deleted canvas "${removedCanvas.name}"`, { canvas_id: removedCanvas.id, name: removedCanvas.name, mode, target_canvas_id: targetCanvasId ?? null })
  },
}
