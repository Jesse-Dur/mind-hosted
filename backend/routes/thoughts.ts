import { Hono } from "hono"
import { getAuth } from "@clerk/hono"
import { thoughtsDb } from "../db/thoughts"

export const thoughtsRoute = new Hono()

thoughtsRoute.get("/", async (c) => {
  const auth = getAuth(c)
  if (!auth?.userId) return c.json({ error: "Unauthorized" }, 401)
  const tileId = c.req.query("tile_id")
  return c.json(await thoughtsDb.list(auth.userId, tileId ? Number(tileId) : undefined))
})

thoughtsRoute.get("/past", async (c) => {
  const auth = getAuth(c)
  if (!auth?.userId) return c.json({ error: "Unauthorized" }, 401)
  return c.json(await thoughtsDb.listPast(auth.userId))
})

thoughtsRoute.post("/", async (c) => {
  const auth = getAuth(c)
  if (!auth?.userId) return c.json({ error: "Unauthorized" }, 401)
  const body = await c.req.json()
  return c.json(await thoughtsDb.create(body, auth.userId), 201)
})

thoughtsRoute.patch("/:id/reorder", async (c) => {
  const auth = getAuth(c)
  if (!auth?.userId) return c.json({ error: "Unauthorized" }, 401)
  const { sort_order } = await c.req.json() as { sort_order: number }
  await thoughtsDb.reorder(Number(c.req.param("id")), sort_order, auth.userId)
  return c.body(null, 204)
})

thoughtsRoute.patch("/:id/tags", async (c) => {
  const auth = getAuth(c)
  if (!auth?.userId) return c.json({ error: "Unauthorized" }, 401)
  const { tags } = await c.req.json() as { tags: string[] }
  return c.json(await thoughtsDb.updateTags(Number(c.req.param("id")), tags, auth.userId))
})

thoughtsRoute.patch("/:id/content", async (c) => {
  const auth = getAuth(c)
  if (!auth?.userId) return c.json({ error: "Unauthorized" }, 401)
  const { content } = await c.req.json() as { content: string }
  const id = Number(c.req.param("id"))
  await thoughtsDb.update(id, content, auth.userId)
  return c.body(null, 204)
})

thoughtsRoute.patch("/:id/move", async (c) => {
  const auth = getAuth(c)
  if (!auth?.userId) return c.json({ error: "Unauthorized" }, 401)
  const { tile_id } = await c.req.json() as { tile_id: number }
  await thoughtsDb.move(Number(c.req.param("id")), tile_id, auth.userId)
  return c.body(null, 204)
})

thoughtsRoute.delete("/:id", async (c) => {
  const auth = getAuth(c)
  if (!auth?.userId) return c.json({ error: "Unauthorized" }, 401)
  await thoughtsDb.remove(Number(c.req.param("id")), auth.userId)
  return c.body(null, 204)
})
