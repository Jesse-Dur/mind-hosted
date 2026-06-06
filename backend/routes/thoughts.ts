import { Hono } from "hono"
import { getAuth } from "@clerk/hono"
import { ThoughtTileNotFoundError, thoughtsDb } from "../db/thoughts"
import { hasOnlyKeys, isRecord, parseId } from "./parsing"
import type { ThoughtCreate } from "../db/thoughts"

export const thoughtsRoute = new Hono()

const thoughtCreateKeys = ["tile_id", "content", "tags", "sort_order", "id", "created_at", "stableKey"] as const
const maxOrderedThoughtIds = 1000

function parseInteger(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) ? value : null
}

function parsePositiveId(value: unknown) {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return value
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value)
    if (Number.isInteger(parsed) && parsed > 0) return parsed
  }
  return null
}

function parseStringArray(value: unknown) {
  return Array.isArray(value) && value.every((item): item is string => typeof item === "string")
    ? value
    : null
}

function parseThoughtCreate(value: unknown): ThoughtCreate | null {
  if (!isRecord(value) || !hasOnlyKeys(value, thoughtCreateKeys)) return null

  const tileId = parsePositiveId(value.tile_id)
  const sortOrder = "sort_order" in value ? parseInteger(value.sort_order) : 0
  const tags = "tags" in value ? parseStringArray(value.tags) : []
  if (tileId === null || tileId <= 0 || typeof value.content !== "string" || tags === null || sortOrder === null) return null

  return { tile_id: tileId, content: value.content, tags, sort_order: sortOrder }
}

function parseSortOrderRequest(value: unknown) {
  if (!isRecord(value) || !hasOnlyKeys(value, ["sort_order"])) return null
  return parseInteger(value.sort_order)
}

function parseTagsRequest(value: unknown) {
  if (!isRecord(value) || !hasOnlyKeys(value, ["tags"])) return null
  return parseStringArray(value.tags)
}

function parseContentRequest(value: unknown) {
  if (!isRecord(value) || !hasOnlyKeys(value, ["content"]) || typeof value.content !== "string") return null
  return value.content
}

function parseMoveRequest(value: unknown) {
  if (!isRecord(value) || !hasOnlyKeys(value, ["tile_id", "ordered_ids"])) return null
  const tileId = parsePositiveId(value.tile_id)
  if (tileId === null) return null
  if (!("ordered_ids" in value)) return { tileId, orderedIds: undefined }
  if (!Array.isArray(value.ordered_ids) || value.ordered_ids.length > maxOrderedThoughtIds) return null

  const orderedIds = value.ordered_ids.map(parsePositiveId)
  if (orderedIds.some((id) => id === null)) return null
  return { tileId, orderedIds: orderedIds as number[] }
}

thoughtsRoute.get("/", async (c) => {
  const auth = getAuth(c)
  if (!auth?.userId) return c.json({ error: "Unauthorized" }, 401)
  const tileIdParam = c.req.query("tile_id")
  const canvasIdParam = c.req.query("canvas_id")
  const tileId = tileIdParam === undefined ? undefined : parseId(tileIdParam)
  const canvasId = canvasIdParam === undefined ? undefined : parseId(canvasIdParam)
  if (tileIdParam !== undefined && tileId === null) return c.json({ error: "Invalid tile id" }, 400)
  if (canvasIdParam !== undefined && canvasId === null) return c.json({ error: "Invalid canvas id" }, 400)

  return c.json(await thoughtsDb.list(auth.userId, {
    tileId: tileId ?? undefined,
    canvasId: canvasId ?? undefined,
  }))
})

thoughtsRoute.get("/past", async (c) => {
  const auth = getAuth(c)
  if (!auth?.userId) return c.json({ error: "Unauthorized" }, 401)
  return c.json(await thoughtsDb.listPast(auth.userId))
})

thoughtsRoute.post("/", async (c) => {
  const auth = getAuth(c)
  if (!auth?.userId) return c.json({ error: "Unauthorized" }, 401)
  const rawBody = await c.req.json().catch(() => null)
  const body = parseThoughtCreate(rawBody)
  if (!body) return c.json({ error: "Invalid thought create request" }, 400)

  try {
    return c.json(await thoughtsDb.create(body, auth.userId), 201)
  } catch (error) {
    if (error instanceof ThoughtTileNotFoundError) return c.json({ error: error.message }, 404)
    throw error
  }
})

thoughtsRoute.patch("/:id/reorder", async (c) => {
  const auth = getAuth(c)
  if (!auth?.userId) return c.json({ error: "Unauthorized" }, 401)
  const id = parseId(c.req.param("id"))
  if (id === null) return c.json({ error: "Invalid thought id" }, 400)

  const sortOrder = parseSortOrderRequest(await c.req.json().catch(() => null))
  if (sortOrder === null) return c.json({ error: "Invalid thought reorder request" }, 400)

  await thoughtsDb.reorder(id, sortOrder, auth.userId)
  return c.body(null, 204)
})

thoughtsRoute.patch("/:id/tags", async (c) => {
  const auth = getAuth(c)
  if (!auth?.userId) return c.json({ error: "Unauthorized" }, 401)
  const id = parseId(c.req.param("id"))
  if (id === null) return c.json({ error: "Invalid thought id" }, 400)

  const tags = parseTagsRequest(await c.req.json().catch(() => null))
  if (!tags) return c.json({ error: "Invalid thought tags request" }, 400)

  return c.json(await thoughtsDb.updateTags(id, tags, auth.userId))
})

thoughtsRoute.patch("/:id/content", async (c) => {
  const auth = getAuth(c)
  if (!auth?.userId) return c.json({ error: "Unauthorized" }, 401)
  const id = parseId(c.req.param("id"))
  if (id === null) return c.json({ error: "Invalid thought id" }, 400)

  const content = parseContentRequest(await c.req.json().catch(() => null))
  if (content === null) return c.json({ error: "Invalid thought content request" }, 400)

  await thoughtsDb.update(id, content, auth.userId)
  return c.body(null, 204)
})

thoughtsRoute.patch("/:id/move", async (c) => {
  const auth = getAuth(c)
  if (!auth?.userId) return c.json({ error: "Unauthorized" }, 401)
  const id = parseId(c.req.param("id"))
  if (id === null) return c.json({ error: "Invalid thought id" }, 400)

  const moveRequest = parseMoveRequest(await c.req.json().catch(() => null))
  if (moveRequest === null) return c.json({ error: "Invalid thought move request" }, 400)

  try {
    await thoughtsDb.move(id, moveRequest.tileId, auth.userId, moveRequest.orderedIds)
  } catch (error) {
    if (error instanceof ThoughtTileNotFoundError) return c.json({ error: error.message }, 404)
    throw error
  }
  return c.body(null, 204)
})

thoughtsRoute.delete("/:id", async (c) => {
  const auth = getAuth(c)
  if (!auth?.userId) return c.json({ error: "Unauthorized" }, 401)
  const id = parseId(c.req.param("id"))
  if (id === null) return c.json({ error: "Invalid thought id" }, 400)

  await thoughtsDb.remove(id, auth.userId)
  return c.body(null, 204)
})
