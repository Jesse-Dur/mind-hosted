import { Hono } from "hono"
import { getAuth } from "@clerk/hono"
import { TileCanvasNotFoundError, tilesDb } from "../db/tiles"
import { hasOnlyKeys, isRecord, parseId } from "./parsing"
import type { TileCreate, TileUpdate } from "../db/tiles"

export const tilesRoute = new Hono()

const tileKeys = ["canvas_id", "title", "x", "y", "width", "height", "importance", "visible"] as const
const tileCreateKeys = [...tileKeys, "id", "created_at", "stableKey"] as const

function parseOptionalCanvasId(value: unknown) {
  if (value === null) return null
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value)
    return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) return undefined
  return value
}

function parseInteger(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) ? value : null
}

function parseTileCreate(value: unknown): TileCreate | null {
  if (!isRecord(value) || !hasOnlyKeys(value, tileCreateKeys)) return null

  const canvasId = "canvas_id" in value ? parseOptionalCanvasId(value.canvas_id) : null
  if (canvasId === undefined) return null

  const title = "title" in value ? value.title : "New Tile"
  const x = "x" in value ? parseInteger(value.x) : 0
  const y = "y" in value ? parseInteger(value.y) : 0
  const width = "width" in value ? parseInteger(value.width) : 280
  const height = "height" in value ? parseInteger(value.height) : 200
  const importance = "importance" in value ? parseInteger(value.importance) : 1
  const visible = "visible" in value ? value.visible : true
  if (typeof title !== "string" || x === null || y === null || width === null || height === null || importance === null || typeof visible !== "boolean") return null

  return {
    canvas_id: canvasId,
    title,
    x,
    y,
    width,
    height,
    importance,
    visible,
  }
}

function parseTileUpdate(value: unknown): TileUpdate | null {
  if (!isRecord(value) || !hasOnlyKeys(value, tileKeys)) return null

  const update: TileUpdate = {}
  if ("canvas_id" in value) {
    const canvasId = parseOptionalCanvasId(value.canvas_id)
    if (canvasId === undefined || canvasId === null) return null
    update.canvas_id = canvasId
  }
  if ("title" in value) {
    if (typeof value.title !== "string") return null
    update.title = value.title
  }
  for (const key of ["x", "y", "width", "height", "importance"] as const) {
    if (key in value) {
      const parsed = parseInteger(value[key])
      if (parsed === null) return null
      update[key] = parsed
    }
  }
  if ("visible" in value) {
    if (typeof value.visible !== "boolean") return null
    update.visible = value.visible
  }

  return Object.keys(update).length > 0 ? update : null
}

tilesRoute.get("/", async (c) => {
  const auth = getAuth(c)
  if (!auth?.userId) return c.json({ error: "Unauthorized" }, 401)
  const canvasIdParam = c.req.query("canvas_id")
  const canvasId = canvasIdParam === undefined ? undefined : parseId(canvasIdParam)
  if (canvasIdParam !== undefined && canvasId === null) return c.json({ error: "Invalid canvas id" }, 400)

  return c.json(await tilesDb.list(auth.userId, canvasId ?? undefined))
})

tilesRoute.get("/past", async (c) => {
  const auth = getAuth(c)
  if (!auth?.userId) return c.json({ error: "Unauthorized" }, 401)
  return c.json(await tilesDb.listPast(auth.userId))
})

tilesRoute.post("/", async (c) => {
  const auth = getAuth(c)
  if (!auth?.userId) return c.json({ error: "Unauthorized" }, 401)
  const rawBody = await c.req.json().catch(() => null)
  const body = parseTileCreate(rawBody)
  if (!body) return c.json({ error: "Invalid tile create request" }, 400)
  try {
    return c.json(await tilesDb.create(body, auth.userId), 201)
  } catch (error) {
    if (error instanceof TileCanvasNotFoundError) return c.json({ error: error.message }, 404)
    throw error
  }
})

tilesRoute.patch("/:id", async (c) => {
  const auth = getAuth(c)
  if (!auth?.userId) return c.json({ error: "Unauthorized" }, 401)
  const id = parseId(c.req.param("id"))
  if (id === null) return c.json({ error: "Invalid tile id" }, 400)

  const body = parseTileUpdate(await c.req.json().catch(() => null))
  if (!body) return c.json({ error: "Invalid tile update request" }, 400)
  try {
    const tile = await tilesDb.update(id, body, auth.userId)
    if (!tile) return c.json({ error: "Tile not found" }, 404)
    return c.json(tile)
  } catch (error) {
    if (error instanceof TileCanvasNotFoundError) return c.json({ error: error.message }, 404)
    throw error
  }
})

tilesRoute.delete("/:id", async (c) => {
  const auth = getAuth(c)
  if (!auth?.userId) return c.json({ error: "Unauthorized" }, 401)
  const id = parseId(c.req.param("id"))
  if (id === null) return c.json({ error: "Invalid tile id" }, 400)

  await tilesDb.remove(id, auth.userId)
  return c.body(null, 204)
})
