// How are authenticated billing requests validated and mapped to billing operations?
// Dependencies are supplied by the production route so HTTP contract tests do not initialize the database or Autumn.

import { Hono, type Context } from "hono"
import type { BillingPlanImpact, BillingPlansResponse, BillingPlanSwitchResponse } from "../billing/planComparison"
import type { BillingUsageStatus } from "../billing/usageStatus"

export type BillingRouteDependencies = {
  authenticatedUserId: (context: Context) => string | null
  getBillingPlans: (userId: string) => Promise<BillingPlansResponse>
  previewBillingPlanImpact: (userId: string, targetPlanId: string) => Promise<BillingPlanImpact | null>
  switchBillingPlan: (userId: string, targetPlanId: string) => Promise<BillingPlanSwitchResponse | null>
  getBillingUsageStatus: (userId: string) => Promise<BillingUsageStatus>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function parsePlanBody(value: unknown) {
  if (!isRecord(value) || typeof value.plan_id !== "string" || value.plan_id.length === 0) return null
  return {
    plan_id: value.plan_id,
    confirmed_over_limit: value.confirmed_over_limit === true,
  }
}

export function createBillingRoute(dependencies: BillingRouteDependencies) {
  const route = new Hono()

  route.get("/usage", async (c) => {
    const userId = dependencies.authenticatedUserId(c)
    if (!userId) return c.json({ error: "Unauthorized" }, 401)
    return c.json(await dependencies.getBillingUsageStatus(userId))
  })

  route.get("/plans", async (c) => {
    const userId = dependencies.authenticatedUserId(c)
    if (!userId) return c.json({ error: "Unauthorized" }, 401)
    return c.json(await dependencies.getBillingPlans(userId))
  })

  route.get("/plan-impact", async (c) => {
    const userId = dependencies.authenticatedUserId(c)
    if (!userId) return c.json({ error: "Unauthorized" }, 401)
    const planId = c.req.query("plan_id")
    if (!planId) return c.json({ error: "Missing plan_id" }, 400)
    const impact = await dependencies.previewBillingPlanImpact(userId, planId)
    if (!impact) return c.json({ error: "Plan not found" }, 404)
    return c.json(impact)
  })

  route.post("/switch-plan", async (c) => {
    const userId = dependencies.authenticatedUserId(c)
    if (!userId) return c.json({ error: "Unauthorized" }, 401)
    const body = parsePlanBody(await c.req.json().catch(() => null))
    if (!body) return c.json({ error: "Invalid plan switch request" }, 400)
    const impact = await dependencies.previewBillingPlanImpact(userId, body.plan_id)
    if (!impact) return c.json({ error: "Plan not found" }, 404)
    if (impact.action === "downgrade" && impact.blocking_overages.length > 0 && !body.confirmed_over_limit) {
      return c.json({ error: "Plan limits exceeded", impact }, 409)
    }
    let result: BillingPlanSwitchResponse | null
    try {
      result = await dependencies.switchBillingPlan(userId, body.plan_id)
    } catch (error) {
      // Provider details belong in server logs; the client only needs a stable,
      // actionable failure instead of a false successful switch.
      const message = error instanceof Error ? error.message : String(error)
      console.error(`[billing] plan switch failed for ${body.plan_id}: ${message}`)
      return c.json({ error: "Unable to switch plans right now", code: "billing_provider_error" }, 502)
    }
    if (!result) return c.json({ error: "Plan not found" }, 404)
    return c.json(result)
  })

  return route
}
