import { Hono } from "hono"
import { getAuth } from "@clerk/hono"
import { getBillingUsageStatus } from "../billing/usageStatus"

export const billingRoute = new Hono()

billingRoute.get("/usage", async (c) => {
  const auth = getAuth(c)
  if (!auth?.userId) return c.json({ error: "Unauthorized" }, 401)
  return c.json(await getBillingUsageStatus(auth.userId))
})
