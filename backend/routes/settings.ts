import { getAuth } from "@clerk/hono"
import { Hono } from "hono"
import { settingsDb, type UserSettingsUpdate } from "../db/settings"

const CANVAS_HEIGHTS = new Set([1080, 1440, 2160])

function parseCanvasHeight(value: unknown) {
  return typeof value === "number" && CANVAS_HEIGHTS.has(value) ? value : null
}

function parseSettingsUpdate(value: unknown): UserSettingsUpdate | null {
  if (typeof value !== "object" || value === null) return null
  const hasCanvasHeight = "canvas_height" in value
  const hasTabsVisible = "tabs_visible" in value
  if (!hasCanvasHeight && !hasTabsVisible) return null

  const update: UserSettingsUpdate = {}
  if (hasCanvasHeight) {
    const canvasHeight = parseCanvasHeight(value.canvas_height)
    if (canvasHeight === null) return null
    update.canvas_height = canvasHeight
  }
  if (hasTabsVisible) {
    if (typeof value.tabs_visible !== "boolean") return null
    update.tabs_visible = value.tabs_visible
  }
  return update
}

export const settingsRoute = new Hono()

settingsRoute.get("/", async (c) => {
  const auth = getAuth(c)
  if (!auth?.userId) return c.json({ error: "Unauthorized" }, 401)
  return c.json(await settingsDb.get(auth.userId))
})

settingsRoute.patch("/", async (c) => {
  const auth = getAuth(c)
  if (!auth?.userId) return c.json({ error: "Unauthorized" }, 401)

  const update = parseSettingsUpdate(await c.req.json().catch(() => null))
  if (!update) return c.json({ error: "Invalid user settings" }, 400)

  return c.json(await settingsDb.update(auth.userId, update))
})
