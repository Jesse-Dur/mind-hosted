import { Hono } from "hono"
import { getAuth } from "@hono/clerk-auth"
import { tilesDb } from "../db/tiles"

export const tilesRoute = new Hono()

tilesRoute.get("/", async (c) => {
  const auth = getAuth(c)
  if (!auth?.userId) return c.json({ error: "Unauthorized" }, 401)
  return c.json(await tilesDb.list(auth.userId))
})

tilesRoute.get("/past", async (c) => {
  const auth = getAuth(c)
  if (!auth?.userId) return c.json({ error: "Unauthorized" }, 401)
  return c.json(await tilesDb.listPast(auth.userId))
})

tilesRoute.post("/", async (c) => {
  const auth = getAuth(c)
  if (!auth?.userId) return c.json({ error: "Unauthorized" }, 401)
  const body = await c.req.json()
  return c.json(await tilesDb.create(body, auth.userId), 201)
})

tilesRoute.patch("/:id", async (c) => {
  const auth = getAuth(c)
  if (!auth?.userId) return c.json({ error: "Unauthorized" }, 401)
  const body = await c.req.json()
  return c.json(await tilesDb.update(Number(c.req.param("id")), body, auth.userId))
})

tilesRoute.delete("/:id", async (c) => {
  const auth = getAuth(c)
  if (!auth?.userId) return c.json({ error: "Unauthorized" }, 401)
  await tilesDb.remove(Number(c.req.param("id")), auth.userId)
  return c.body(null, 204)
})
