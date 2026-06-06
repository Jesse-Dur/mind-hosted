import { Hono } from "hono"
import { getAuth } from "@hono/clerk-auth"
import { canvasesDb } from "../db/canvases"
import { hasOnlyKeys, isRecord, parseId } from "./parsing"
import type { CanvasDeleteMode, CanvasUpdate } from "../db/canvases"

export const canvasesRoute = new Hono()

type CanvasDeleteRequest =
  | { mode: "deleteContents" }
  | { mode: "moveContents"; targetCanvasId: number }

const canvasUpdateKeys = ["name", "sort_order", "is_favourite"] as const

function parseTargetCanvasId(value: unknown) {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return value
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value)
    if (Number.isInteger(parsed) && parsed > 0) return parsed
  }
  return null
}

function parseDeleteRequest(value: unknown): CanvasDeleteRequest | null {
  if (!isRecord(value)) return null
  const body = value
  if (body.mode === "deleteContents") return { mode: "deleteContents" }
  const targetCanvasId = parseTargetCanvasId(body.targetCanvasId)
  if (body.mode === "moveContents" && targetCanvasId !== null) {
    return { mode: "moveContents", targetCanvasId }
  }
  return null
}

function parseDeleteQuery(mode: string | undefined, targetCanvasId: string | undefined): CanvasDeleteRequest | null {
  if (mode === "deleteContents") return { mode: "deleteContents" }
  const parsedTargetCanvasId = parseTargetCanvasId(targetCanvasId)
  if (mode === "moveContents" && parsedTargetCanvasId !== null) {
    return { mode: "moveContents", targetCanvasId: parsedTargetCanvasId }
  }
  return null
}

function parseCanvasUpdate(value: unknown): CanvasUpdate | null {
  if (!isRecord(value) || !hasOnlyKeys(value, canvasUpdateKeys)) return null
  const body = value
  const update: CanvasUpdate = {}

  if ("name" in body) {
    if (typeof body.name !== "string" || body.name.trim() === "") return null
    update.name = body.name.trim()
  }

  if ("sort_order" in body) {
    if (typeof body.sort_order !== "number" || !Number.isInteger(body.sort_order)) return null
    update.sort_order = body.sort_order
  }

  if ("is_favourite" in body) {
    if (typeof body.is_favourite !== "boolean") return null
    update.is_favourite = body.is_favourite
  }

  return Object.keys(update).length > 0 ? update : null
}

canvasesRoute.get("/", async (c) => {
  const auth = getAuth(c)
  if (!auth?.userId) return c.json({ error: "Unauthorized" }, 401)
  // Ensure default canvas exists and orphaned tiles are assigned to it
  await canvasesDb.ensureDefault(auth.userId)
  return c.json(await canvasesDb.list(auth.userId))
})

canvasesRoute.post("/", async (c) => {
  const auth = getAuth(c)
  if (!auth?.userId) return c.json({ error: "Unauthorized" }, 401)
  const { name, sort_order } = await c.req.json()
  return c.json(await canvasesDb.create(auth.userId, name ?? "New Canvas", sort_order ?? 0), 201)
})

canvasesRoute.patch("/reorder", async (c) => {
  const auth = getAuth(c)
  if (!auth?.userId) return c.json({ error: "Unauthorized" }, 401)
  const { updates } = await c.req.json() as {
    updates: { id: number; sort_order: number; is_favourite: boolean }[]
  }
  await canvasesDb.reorder(auth.userId, updates)
  return c.body(null, 204)
})

canvasesRoute.patch("/:id", async (c) => {
  const auth = getAuth(c)
  if (!auth?.userId) return c.json({ error: "Unauthorized" }, 401)
  const id = parseId(c.req.param("id"))
  if (id === null) return c.json({ error: "Invalid canvas id" }, 400)

  const body = parseCanvasUpdate(await c.req.json().catch(() => null))
  if (!body) return c.json({ error: "Invalid canvas update request" }, 400)
  const canvas = await canvasesDb.update(id, auth.userId, body)
  if (!canvas) return c.json({ error: "Canvas not found" }, 404)
  return c.json(canvas)
})

canvasesRoute.delete("/:id", async (c) => {
  const auth = getAuth(c)
  if (!auth?.userId) return c.json({ error: "Unauthorized" }, 401)
  const id = parseId(c.req.param("id"))
  if (id === null) return c.json({ error: "Invalid canvas id" }, 400)

  const body = parseDeleteRequest(await c.req.json().catch(() => null))
    ?? parseDeleteQuery(c.req.query("mode"), c.req.query("targetCanvasId"))
  if (!body) return c.json({ error: "Invalid canvas delete request" }, 400)

  const mode: CanvasDeleteMode = body.mode
  const targetCanvasId = body.mode === "moveContents" ? body.targetCanvasId : null
  try {
    await canvasesDb.remove(id, auth.userId, mode, targetCanvasId ?? undefined)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not delete canvas"
    return c.json({ error: message }, 400)
  }
  return c.json({ targetCanvasId })
})
