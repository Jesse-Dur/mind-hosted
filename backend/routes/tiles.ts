import { Hono } from "hono"
import { getAuth } from "@clerk/hono"
import { tilesDb } from "../db/tiles"

export const tilesRoute = new Hono()

tilesRoute.get("/past", async (c) => {
  const auth = getAuth(c)
  if (!auth?.userId) return c.json({ error: "Unauthorized" }, 401)
  return c.json(await tilesDb.listPast(auth.userId))
})
