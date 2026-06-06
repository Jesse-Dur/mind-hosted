import { Hono } from "hono"
import { getAuth } from "@hono/clerk-auth"
import { historyDb } from "../db/history"

export const historyRoute = new Hono()

historyRoute.get("/", async (c) => {
  const auth = getAuth(c)
  if (!auth?.userId) return c.json({ error: "Unauthorized" }, 401)
  const rawLimit = c.req.query("limit")
  const cursor = c.req.query("cursor") ?? null

  if (rawLimit) {
    const limit = Number(rawLimit)
    if (!Number.isInteger(limit) || limit < 1) {
      return c.json({ error: "Invalid limit" }, 400)
    }
    return c.json(await historyDb.list(auth.userId, { limit, cursor }))
  }

  return c.json(await historyDb.list(auth.userId, { cursor }))
})
