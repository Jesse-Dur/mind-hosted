import { Hono } from "hono"
import { getAuth } from "@clerk/hono"
import { tagsDb } from "../db/tags"

export const tagsRoute = new Hono()

tagsRoute.get("/", async (c) => {
  const auth = getAuth(c)
  if (!auth?.userId) return c.json({ error: "Unauthorized" }, 401)
  return c.json(await tagsDb.list(auth.userId))
})

tagsRoute.post("/", async (c) => {
  const auth = getAuth(c)
  if (!auth?.userId) return c.json({ error: "Unauthorized" }, 401)
  const { name, color } = await c.req.json() as { name: string; color: string }
  return c.json(await tagsDb.upsert(name.slice(0, 16), color, auth.userId), 201)
})

tagsRoute.patch("/:id", async (c) => {
  const auth = getAuth(c)
  if (!auth?.userId) return c.json({ error: "Unauthorized" }, 401)
  const { name, color } = await c.req.json() as { name: string; color: string }
  return c.json(await tagsDb.update(Number(c.req.param("id")), name.slice(0, 16), color, auth.userId))
})

tagsRoute.delete("/:id", async (c) => {
  const auth = getAuth(c)
  if (!auth?.userId) return c.json({ error: "Unauthorized" }, 401)
  await tagsDb.remove(Number(c.req.param("id")), auth.userId)
  return c.body(null, 204)
})
