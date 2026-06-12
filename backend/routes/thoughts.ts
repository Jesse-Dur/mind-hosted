import { Hono } from "hono"
import { getAuth } from "@clerk/hono"
import { thoughtsDb } from "../db/thoughts"

export const thoughtsRoute = new Hono()

thoughtsRoute.get("/past", async (c) => {
  const auth = getAuth(c)
  if (!auth?.userId) return c.json({ error: "Unauthorized" }, 401)
  return c.json(await thoughtsDb.listPast(auth.userId))
})
