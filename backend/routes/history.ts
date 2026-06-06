import { Hono } from "hono"
import { getAuth } from "@clerk/hono"
import { historyDb } from "../db/history"

export const historyRoute = new Hono()

historyRoute.get("/", async (c) => {
  const auth = getAuth(c)
  if (!auth?.userId) return c.json({ error: "Unauthorized" }, 401)
  return c.json(await historyDb.list(auth.userId))
})
