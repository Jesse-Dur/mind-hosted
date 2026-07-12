import { describe, expect, test } from "bun:test"
import { Hono } from "hono"
import { normalizeBillingPlanOptions, resourceAtLimits, resourceOverages } from "../billing/planOptions"
import { evaluateResourceThresholds } from "../billing/resourceThresholds"
import type { AutumnPlanResponse } from "../billing/autumnClient"
import { assertBillingSyncAccess } from "../billing/syncAccess"
import { activePlanIds, isActiveSubscriptionRef } from "../billing/subscriptionStatus"
import { publishResourceUsageCounts } from "../billing/resourceReconciliation"
import { createBillingRoute, type BillingRouteDependencies } from "../routes/billingRouteFactory"

function feature(featureId: string, included: number | null, options: { unlimited?: boolean; amount?: number } = {}) {
  return {
    feature_id: featureId,
    included,
    unlimited: options.unlimited ?? false,
    price: typeof options.amount === "number"
      ? { amount: options.amount }
      : null,
  }
}

function plans(): AutumnPlanResponse[] {
  return [
    {
      id: "free",
      name: "Free",
      items: [
        feature("storage", 100),
        feature("canvases", 1),
        feature("tiles", 5),
        feature("thoughts", 25),
      ],
      customer_eligibility: { attach_action: "downgrade" },
    },
    {
      id: "pro",
      name: "Pro",
      price: { display: { primary_text: "$10 / month" } },
      items: [
        feature("storage", 1000),
        feature("canvases", 10),
        feature("tiles", 100),
        feature("thoughts", 500),
      ],
      customer_eligibility: { attach_action: "upgrade" },
    },
    {
      id: "unlimited",
      name: "Unlimited",
      items: [
        feature("ai_processing_requests", 0, { amount: 0.001 }),
        feature("storage", 0, { amount: 0.001 }),
        feature("transcription_seconds", 0, { amount: 0.0001 }),
        feature("canvases", null, { unlimited: true }),
        feature("thoughts", null, { unlimited: true }),
        feature("tiles", null, { unlimited: true }),
      ],
      customer_eligibility: { attach_action: "upgrade" },
    },
  ]
}

function usageFeature(id: "canvases" | "tiles" | "thoughts", used: number, limit: number | null) {
  return {
    id,
    label: id === "canvases" ? "Canvases" : id === "tiles" ? "Tiles" : "Thoughts",
    used,
    unit: "items",
    limit,
    remaining: limit === null ? null : Math.max(0, limit - used),
    unlimited: limit === null,
    reset_at: null,
    cost: null,
  }
}

function routeDependencies(overrides: Partial<BillingRouteDependencies> = {}): BillingRouteDependencies {
  return {
    authenticatedUserId: () => "billing-test-user",
    getBillingPlans: async (userId) => ({ customer_id: userId, plans: [] }),
    getBillingUsageStatus: async (userId) => ({ customer_id: userId, plans: [], features: [], overage: { is_over_limit: false, editing_frozen: false, overages: [], suspended_creation: [] } }),
    previewBillingPlanImpact: async () => null,
    switchBillingPlan: async (userId) => ({ customer_id: userId, payment_url: null }),
    ...overrides,
  }
}

function billingApp(dependencies: BillingRouteDependencies) {
  const app = new Hono()
  app.route("/billing", createBillingRoute(dependencies))
  return app
}

function downgradeImpact(options: { over?: boolean; atLimit?: boolean } = {}) {
  return {
    target_plan_id: "free",
    target_plan_name: "Free",
    action: "downgrade" as const,
    blocking_overages: options.over
      ? [{ id: "canvases" as const, label: "Canvases", used: 2, limit: 1, over_by: 1, unit: "canvases" }]
      : [],
    at_limit_resources: options.atLimit ? ["tiles" as const] : [],
    will_freeze_editing: options.over === true,
  }
}

describe("billing plan comparison", () => {
  test("past_due subscriptions stay active until Autumn changes the status", () => {
    expect(isActiveSubscriptionRef({ status: "past_due" })).toBe(true)
    expect(isActiveSubscriptionRef({ status: "active" })).toBe(true)
    expect(isActiveSubscriptionRef({ status: "canceled" })).toBe(false)
  })

  test("active plan ids ignore inactive subscription refs", () => {
    expect(activePlanIds({
      subscriptions: [
        { planId: "pro", status: "past_due" },
        { planId: "free", status: "canceled" },
      ],
      purchases: [
        { plan_id: "addon", status: "active" },
        { plan_id: "addon", status: "active" },
      ],
    })).toEqual(["pro", "addon"])
  })

  test("storage is hidden on smaller plans and shown on the PAYG plan", () => {
    const options = normalizeBillingPlanOptions(plans())
    const free = options.find((plan) => plan.id === "free")
    const pro = options.find((plan) => plan.id === "pro")
    const unlimited = options.find((plan) => plan.id === "unlimited")

    expect(free?.features.some((item) => item.id === "storage")).toBe(false)
    expect(pro?.features.some((item) => item.id === "storage")).toBe(false)
    expect(unlimited?.features.some((item) => item.id === "storage")).toBe(true)
  })

  test("PAYG plan displays item prices instead of zero allowances", () => {
    const unlimited = normalizeBillingPlanOptions(plans()).find((plan) => plan.id === "unlimited")
    if (!unlimited) throw new Error("Expected unlimited plan")

    expect(unlimited.name).toBe("Pay as you go")
    expect(unlimited.cost).toBe("Billed Monthly")
    expect(unlimited.features.find((item) => item.id === "ai_processing_requests")?.display).toBe("$1.00 per 1000 requests")
    expect(unlimited.features.find((item) => item.id === "storage")?.display).toBe("$1.00 per GB")
    expect(unlimited.features.find((item) => item.id === "transcription_seconds")?.display).toBe("$0.10 per 1000 seconds")
    expect(unlimited.features.find((item) => item.id === "canvases")?.display).toBe("Unlimited canvases")
    expect(unlimited.features.find((item) => item.id === "tiles")?.display).toBe("Unlimited tiles")
    expect(unlimited.features.find((item) => item.id === "thoughts")?.display).toBe("Unlimited thoughts")
  })

  test("target plan overages ignore storage entirely", () => {
    const free = normalizeBillingPlanOptions(plans()).find((plan) => plan.id === "free")
    if (!free) throw new Error("Expected free plan")

    expect(resourceOverages(free, { canvases: 1, tiles: 5, thoughts: 25 })).toEqual([])
    expect(resourceOverages(free, { canvases: 2, tiles: 5, thoughts: 25 })).toEqual([
      {
        id: "canvases",
        label: "Canvases",
        used: 2,
        limit: 1,
        over_by: 1,
        unit: "canvases",
      },
    ])
  })

  test("target plan exact-cap resources are reported separately from overages", () => {
    const free = normalizeBillingPlanOptions(plans()).find((plan) => plan.id === "free")
    if (!free) throw new Error("Expected free plan")

    expect(resourceAtLimits(free, { canvases: 1, tiles: 5, thoughts: 25 })).toEqual([
      {
        id: "canvases",
        label: "Canvases",
        used: 1,
        limit: 1,
        over_by: 0,
        unit: "canvases",
      },
      {
        id: "tiles",
        label: "Tiles",
        used: 5,
        limit: 5,
        over_by: 0,
        unit: "tiles",
      },
      {
        id: "thoughts",
        label: "Thoughts",
        used: 25,
        limit: 25,
        over_by: 0,
        unit: "thoughts",
      },
    ])
    expect(resourceAtLimits(free, { canvases: 2, tiles: 6, thoughts: 26 })).toEqual([])
  })

  test("usage overage freezes editing only above the cap", () => {
    expect(evaluateResourceThresholds([usageFeature("canvases", 1, 1)])).toEqual({
      at_limit_resources: [
        {
          id: "canvases",
          label: "Canvases",
          used: 1,
          limit: 1,
          over_by: 0,
          unit: "items",
        },
      ],
      over_limit_resources: [],
      should_freeze_editing: false,
    })

    expect(evaluateResourceThresholds([usageFeature("canvases", 2, 1)])).toEqual({
      at_limit_resources: [],
      over_limit_resources: [
        {
          id: "canvases",
          label: "Canvases",
          used: 2,
          limit: 1,
          over_by: 1,
          unit: "items",
        },
      ],
      should_freeze_editing: true,
    })
  })

  test("mixed usage freezes editing while retaining exact-cap creation information", () => {
    expect(evaluateResourceThresholds([
      usageFeature("canvases", 2, 1),
      usageFeature("tiles", 20, 20),
      usageFeature("thoughts", 39, 120),
    ])).toMatchObject({
      at_limit_resources: [{ id: "tiles", over_by: 0 }],
      over_limit_resources: [{ id: "canvases", over_by: 1 }],
      should_freeze_editing: true,
    })
  })
})

describe("billing enforcement", () => {
  test("frozen sync blocks upserts but preserves every delete", () => {
    expect(() => assertBillingSyncAccess("canvas", "upsert", true)).toThrow("Editing is frozen")
    expect(() => assertBillingSyncAccess("tile", "upsert", true)).toThrow("Editing is frozen")
    expect(() => assertBillingSyncAccess("thought", "upsert", true)).toThrow("Editing is frozen")
    expect(() => assertBillingSyncAccess("tag", "upsert", true)).toThrow("Editing is frozen")
    expect(() => assertBillingSyncAccess("canvas", "delete", true)).not.toThrow()
    expect(() => assertBillingSyncAccess("tile", "delete", true)).not.toThrow()
    expect(() => assertBillingSyncAccess("thought", "delete", true)).not.toThrow()
    expect(() => assertBillingSyncAccess("tag", "delete", true)).not.toThrow()
  })

  test("absolute resource reconciliation is idempotent", async () => {
    const updates: Array<{ feature: string; usage: number }> = []
    const publish = () => publishResourceUsageCounts(
      "billing-test-user",
      { canvases: 2, tiles: 20, thoughts: 39 },
      ["canvases", "tiles", "thoughts"],
      async (_userId, feature, usage) => { updates.push({ feature, usage }) },
    )

    await publish()
    await publish()

    expect(updates).toEqual([
      { feature: "canvases", usage: 2 },
      { feature: "tiles", usage: 20 },
      { feature: "thoughts", usage: 39 },
      { feature: "canvases", usage: 2 },
      { feature: "tiles", usage: 20 },
      { feature: "thoughts", usage: 39 },
    ])
  })

  test("unconfirmed over-limit downgrade returns 409 without switching plans", async () => {
    let switchCalls = 0
    const impact = downgradeImpact({ over: true, atLimit: true })
    const dependencies = routeDependencies({
      previewBillingPlanImpact: async () => impact,
      switchBillingPlan: async (userId) => {
        switchCalls += 1
        return { customer_id: userId, payment_url: null }
      },
    })
    const app = billingApp(dependencies)

    const response = await app.request("/billing/switch-plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan_id: "free" }),
    })

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: "Plan limits exceeded", impact })
    expect(switchCalls).toBe(0)
  })

  test("exact-cap downgrade is allowed without claiming editing will freeze", async () => {
    let switchCalls = 0
    const impact = downgradeImpact({ atLimit: true })
    const app = billingApp(routeDependencies({
      previewBillingPlanImpact: async () => impact,
      switchBillingPlan: async (userId) => {
        switchCalls += 1
        return { customer_id: userId, payment_url: null }
      },
    }))

    const response = await app.request("/billing/switch-plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan_id: "free" }),
    })

    expect(response.status).toBe(200)
    expect(impact.will_freeze_editing).toBe(false)
    expect(switchCalls).toBe(1)
  })

  test("confirmed over-limit downgrade switches exactly once", async () => {
    let switchCalls = 0
    const app = billingApp(routeDependencies({
      previewBillingPlanImpact: async () => downgradeImpact({ over: true }),
      switchBillingPlan: async (userId) => {
        switchCalls += 1
        return { customer_id: userId, payment_url: null }
      },
    }))

    const response = await app.request("/billing/switch-plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan_id: "free", confirmed_over_limit: true }),
    })

    expect(response.status).toBe(200)
    expect(switchCalls).toBe(1)
  })

  test("provider failure returns an error instead of a false plan switch", async () => {
    const originalConsoleError = console.error
    console.error = () => {}
    try {
      const app = billingApp(routeDependencies({
        previewBillingPlanImpact: async () => downgradeImpact(),
        switchBillingPlan: async () => { throw new Error("missing Stripe product") },
      }))

      const response = await app.request("/billing/switch-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan_id: "free" }),
      })

      expect(response.status).toBe(502)
      expect(await response.json()).toEqual({
        error: "Unable to switch plans right now",
        code: "billing_provider_error",
      })
    } finally {
      console.error = originalConsoleError
    }
  })
})
