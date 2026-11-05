import { describe, expect, test } from "bun:test"
import { buildDeleteHistory, buildUpsertHistory } from "../db/sync/historyEntry"
import type { Canvas, Tag, Thought, Tile } from "../types"

const canvas: Canvas = { id: 1, client_id: "canvas-client", name: "Home", sort_order: 0, is_favourite: false, created_at: "2026-01-01T00:00:00.000Z" }
const tile: Tile = { id: 2, client_id: "tile-client", canvas_id: 1, title: "Tasks", x: 0, y: 0, width: 280, height: 200, importance: 1, visible: true, created_at: "2026-01-01T00:00:00.000Z" }
const thought: Thought = { id: 3, client_id: "thought-client", tile_id: 2, content: "Buy milk", tags: [], sort_order: 0, created_at: "2026-01-01T00:00:00.000Z" }
const tag: Tag = { id: 4, client_id: "tag-client", name: "Errands", color: "#7c3aed" }

describe("sync history event classification", () => {
  test("records every entity creation", () => {
    expect(buildUpsertHistory("canvas", null, canvas)?.action).toBe("canvas.create")
    expect(buildUpsertHistory("tile", null, tile)?.action).toBe("tile.create")
    expect(buildUpsertHistory("thought", null, thought)?.action).toBe("thought.create")
    expect(buildUpsertHistory("tag", null, tag)?.action).toBe("tag.create")
  })

  test("distinguishes tile movement, resizing, renaming, and combined updates", () => {
    expect(buildUpsertHistory("tile", tile, { ...tile, x: 24, y: 48 })?.action).toBe("tile.move")
    expect(buildUpsertHistory("tile", tile, { ...tile, canvas_id: 9, x: 24 })?.action).toBe("tile.move")
    expect(buildUpsertHistory("tile", tile, { ...tile, width: 320, height: 240 })?.action).toBe("tile.resize")
    expect(buildUpsertHistory("tile", tile, { ...tile, x: 24, y: 24, width: 320, height: 240 })?.action).toBe("tile.resize")
    expect(buildUpsertHistory("tile", tile, { ...tile, title: "Today" })?.action).toBe("tile.rename")
    expect(buildUpsertHistory("tile", tile, { ...tile, title: "Today", width: 320 })?.action).toBe("tile.update")
  })

  test("distinguishes thought movement, reordering, content, and tag edits", () => {
    expect(buildUpsertHistory("thought", thought, { ...thought, tile_id: 8, sort_order: 2 })?.action).toBe("thought.move")
    expect(buildUpsertHistory("thought", thought, { ...thought, sort_order: 2 })?.action).toBe("thought.reorder")
    expect(buildUpsertHistory("thought", thought, { ...thought, content: "Buy oat milk" })?.action).toBe("thought.update")
    expect(buildUpsertHistory("thought", thought, { ...thought, tags: ["Errands"] })?.action).toBe("thought.tag")
  })

  test("records canvas and tag changes", () => {
    expect(buildUpsertHistory("canvas", canvas, { ...canvas, name: "Personal" })?.action).toBe("canvas.rename")
    expect(buildUpsertHistory("canvas", canvas, { ...canvas, sort_order: 2 })?.action).toBe("canvas.reorder")
    expect(buildUpsertHistory("canvas", canvas, { ...canvas, is_favourite: true })?.action).toBe("canvas.favourite")
    expect(buildUpsertHistory("tag", tag, { ...tag, name: "Shopping" })?.action).toBe("tag.rename")
    expect(buildUpsertHistory("tag", tag, { ...tag, color: "#123456" })?.action).toBe("tag.color")
  })

  test("does not invent history for a no-op sync", () => {
    expect(buildUpsertHistory("canvas", canvas, { ...canvas })).toBeNull()
    expect(buildUpsertHistory("tile", tile, { ...tile })).toBeNull()
    expect(buildUpsertHistory("thought", thought, { ...thought })).toBeNull()
    expect(buildUpsertHistory("tag", tag, { ...tag })).toBeNull()
  })

  test("records deletion for every entity and preserves canvas deletion mode", () => {
    expect(buildDeleteHistory("canvas", canvas, { mode: "moveContents", targetCanvasId: 9 })).toMatchObject({ action: "canvas.delete", detail: { mode: "moveContents", target_canvas_id: 9 } })
    expect(buildDeleteHistory("tile", tile, {}).action).toBe("tile.delete")
    expect(buildDeleteHistory("thought", thought, {}).action).toBe("thought.delete")
    expect(buildDeleteHistory("tag", tag, {}).action).toBe("tag.delete")
  })
})
