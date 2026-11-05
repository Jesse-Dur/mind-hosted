import { getAuth } from "@clerk/hono"
import { Hono } from "hono"
import { sql } from "../db/client"

const DEVICE_CLASSES = new Set(["phone", "tablet", "desktop"])
const MAX_PREFERENCES_BYTES = 16_384

type PreferenceRow = {
  device_id: string
  device_class: string
  preferences: Record<string, unknown>
  updated_at: string
}

function validDeviceId(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{8,128}$/.test(value)
}

function validDeviceClass(value: unknown): value is string {
  return typeof value === "string" && DEVICE_CLASSES.has(value)
}

function validPreferences(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
    && JSON.stringify(value).length <= MAX_PREFERENCES_BYTES
}

export const preferencesRoute = new Hono()

preferencesRoute.get("/device", async (c) => {
  const userId = getAuth(c)?.userId
  if (!userId) return c.json({ error: "Unauthorized" }, 401)

  const deviceId = c.req.query("device_id")
  const deviceClass = c.req.query("device_class")
  if (!validDeviceId(deviceId) || !validDeviceClass(deviceClass)) {
    return c.json({ error: "Invalid device identity" }, 400)
  }

  const exact = await sql<PreferenceRow[]>`
    SELECT device_id, device_class, preferences, updated_at
    FROM device_preferences
    WHERE user_id = ${userId} AND device_id = ${deviceId}
    LIMIT 1
  `
  if (exact[0]) return c.json({ source: "device", ...exact[0] })

  const template = await sql<PreferenceRow[]>`
    SELECT device_id, device_class, preferences, updated_at
    FROM device_preferences
    WHERE user_id = ${userId} AND device_class = ${deviceClass}
    ORDER BY updated_at DESC
    LIMIT 1
  `
  if (template[0]) return c.json({ source: "device_class", ...template[0] })

  return c.json({ source: "defaults", device_id: deviceId, device_class: deviceClass, preferences: {}, updated_at: null })
})

preferencesRoute.put("/device", async (c) => {
  const userId = getAuth(c)?.userId
  if (!userId) return c.json({ error: "Unauthorized" }, 401)

  const body = await c.req.json().catch(() => null) as Record<string, unknown> | null
  if (!body || !validDeviceId(body.device_id) || !validDeviceClass(body.device_class) || !validPreferences(body.preferences)) {
    return c.json({ error: "Invalid device preferences" }, 400)
  }

  const rows = await sql<PreferenceRow[]>`
    INSERT INTO device_preferences (user_id, device_id, device_class, preferences, updated_at)
    VALUES (${userId}, ${body.device_id}, ${body.device_class}, ${sql.json(JSON.parse(JSON.stringify(body.preferences)))}, NOW())
    ON CONFLICT (user_id, device_id) DO UPDATE SET
      device_class = EXCLUDED.device_class,
      preferences = EXCLUDED.preferences,
      updated_at = NOW()
    RETURNING device_id, device_class, preferences, updated_at
  `
  return c.json(rows[0])
})
