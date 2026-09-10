// This file verifies the store contracts and the startup paths that rely on them.
import { beforeEach, describe, expect, test } from "bun:test"
import {
  canvas,
  entityKey,
  entityRecord,
  resetFrontendState,
  syncDb,
  tag,
  thought,
  tile,
  useStore,
} from "../test/syncTestHarness"
import { bootstrapCriticalWorkspace, startBillingWarmupOnPlans, startSidebarWarmupOnHover, startSidebarWarmupOnOpen } from "../startup/workspaceStartup"
import { mergeVisibleEntities } from "./cacheHelpers"
import { readStoredCanvasFontSize } from "./storage"
import { writeBillingPlansCache, writeBillingUsageCache, writeHistoryCache } from "../sync/queryCache"
import { DEFAULT_CANVAS_FONT_SIZE, MAX_CANVAS_FONT_SIZE, MIN_CANVAS_FONT_SIZE } from "../utils/canvasFontSize"
import type { BillingPlans, BillingUsage } from "../types"

function requestUrl(path: string | Request) {
  return typeof path === "string" ? path : path.url
}

async function waitForRequest(requests: string[], pattern: string) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (requests.some((request) => request.includes(pattern))) return
    await Promise.resolve()
  }
}

function billingUsage(overrides: Partial<BillingUsage> = {}): BillingUsage {
  return {
    customer_id: "billing-customer",
    plans: [],
    features: [],
    overage: {
      is_over_limit: false,
      editing_frozen: false,
      overages: [],
      suspended_creation: [],
    },
    ...overrides,
  }
}

function billingPlans(overrides: Partial<BillingPlans> = {}): BillingPlans {
  return {
    customer_id: "billing-customer",
    plans: [],
    ...overrides,
  }
}

beforeEach(async () => {
  await resetFrontendState()
})

describe("canvas font size preference", () => {
  test("persists valid values and clamps values outside the supported range", () => {
    useStore.getState().setCanvasFontSize(24)
    expect(useStore.getState().canvasFontSize).toBe(24)
    expect(localStorage.getItem("canvasFontSize")).toBe("24")
    expect(readStoredCanvasFontSize()).toBe(24)

    useStore.getState().setCanvasFontSize(100)
    expect(useStore.getState().canvasFontSize).toBe(MAX_CANVAS_FONT_SIZE)

    useStore.getState().setCanvasFontSize(1)
    expect(useStore.getState().canvasFontSize).toBe(MIN_CANVAS_FONT_SIZE)
    expect(readStoredCanvasFontSize()).toBe(MIN_CANVAS_FONT_SIZE)

    localStorage.clear()
    localStorage.setItem("canvasFontSize", "not-a-size")
    expect(readStoredCanvasFontSize()).toBe(DEFAULT_CANVAS_FONT_SIZE)
  })
})

describe("frontend store optimistic updates", () => {
  test("cached workspace restore resolves without waiting for network sync", async () => {
    const globals = globalThis as unknown as {
      fetch: (path: string, init?: RequestInit) => Promise<Response>
    }
    globals.fetch = () => new Promise<Response>(() => {})
    await syncDb.entities.bulkPut([
      entityRecord({
        entityType: "canvas",
        clientId: "canvas-client",
        serverId: 10,
        tempId: null,
        canvasId: 10,
        status: "clean",
        data: canvas({ id: 10, name: "Cached" }),
      }),
      entityRecord({
        entityType: "tag",
        clientId: "tag-client",
        serverId: 40,
        tempId: null,
        canvasId: null,
        status: "clean",
        data: tag({ id: 40, name: "cached-tag" }),
      }),
      entityRecord({
        entityType: "tile",
        clientId: "tile-client",
        serverId: 20,
        tempId: null,
        canvasId: 10,
        status: "clean",
        data: tile({ id: 20, canvas_id: 10, title: "Cached tile" }),
      }),
      entityRecord({
        entityType: "thought",
        clientId: "thought-client",
        serverId: 30,
        tempId: null,
        canvasId: 10,
        status: "clean",
        data: thought({ id: 30, tile_id: 20, content: "Cached thought" }),
      }),
    ])

    const result = await useStore.getState().restoreCachedWorkspace()
    const state = useStore.getState()

    expect(result).toEqual({ activeCanvasId: 10, hasUsableCache: true })
    expect(state.canvases[0]?.name).toBe("Cached")
    expect(state.tags[0]?.name).toBe("cached-tag")
    expect(state.tiles[0]?.title).toBe("Cached tile")
    expect(state.thoughts[0]?.content).toBe("Cached thought")
  })

  test("bootstrap workspace prefers cached restore over network fetches", async () => {
    const globals = globalThis as unknown as {
      fetch: (path: string, init?: RequestInit) => Promise<Response>
    }
    globals.fetch = () => new Promise<Response>(() => {})

    await syncDb.entities.bulkPut([
      entityRecord({
        entityType: "canvas",
        clientId: "canvas-client",
        serverId: 10,
        tempId: null,
        canvasId: 10,
        status: "clean",
        data: canvas({ id: 10, name: "Cached" }),
      }),
      entityRecord({
        entityType: "tag",
        clientId: "tag-client",
        serverId: 40,
        tempId: null,
        canvasId: null,
        status: "clean",
        data: tag({ id: 40, name: "cached-tag" }),
      }),
      entityRecord({
        entityType: "tile",
        clientId: "tile-client",
        serverId: 20,
        tempId: null,
        canvasId: 10,
        status: "clean",
        data: tile({ id: 20, canvas_id: 10, title: "Cached tile" }),
      }),
      entityRecord({
        entityType: "thought",
        clientId: "thought-client",
        serverId: 30,
        tempId: null,
        canvasId: 10,
        status: "clean",
        data: thought({ id: 30, tile_id: 20, content: "Cached thought" }),
      }),
    ])

    const result = await bootstrapCriticalWorkspace()
    const state = useStore.getState()

    expect(result).toEqual({ activeCanvasId: 10, hasUsableCache: true })
    expect(state.canvases[0]?.name).toBe("Cached")
    expect(state.tags[0]?.name).toBe("cached-tag")
    expect(state.tiles[0]?.title).toBe("Cached tile")
    expect(state.thoughts[0]?.content).toBe("Cached thought")
  })

  test("sync runtime starts without waiting for network", async () => {
    const globals = globalThis as unknown as {
      fetch: (path: string, init?: RequestInit) => Promise<Response>
    }
    globals.fetch = () => new Promise<Response>(() => {})

    await useStore.getState().startSyncRuntime()

    expect(useStore.getState().syncPendingCount).toBe(0)
  })

  test("sidebar hover warmup kicks off history and usage requests", async () => {
    const globals = globalThis as unknown as {
      fetch: (path: string, init?: RequestInit) => Promise<Response>
    }
    const requests: string[] = []
    globals.fetch = async (path) => {
      const url = requestUrl(path)
      requests.push(url)
      const body = url.includes("/history?")
          ? { events: [], nextCursor: null, hasMore: false }
          : url.includes("/billing/usage")
            ? {
                plans: [],
                features: [],
                overage: { editing_frozen: false, suspended_creation: [] },
              }
            : url.includes("/billing/plans")
              ? []
              : { revision: 0, active_canvas_id: null, canvases: [], tags: [], tiles: [], thoughts: [] }

      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    }

    await startSidebarWarmupOnHover()

    expect(requests.some((request) => request.includes("/sync/snapshot"))).toBe(false)
    expect(requests.some((request) => request.includes("/history?limit=50"))).toBe(true)
    expect(requests.some((request) => request.includes("/billing/usage"))).toBe(true)
    expect(requests.some((request) => request.includes("/billing/plans"))).toBe(false)
  })

  test("sidebar open shares the hover warmup request instead of adding extra work", async () => {
    await writeHistoryCache({
      historyEvents: [
        {
          id: 2,
          action: "tile.create",
          summary: "Created tile 2",
          detail: "{}",
          created_at: "2026-06-02T00:00:00.000Z",
        },
        {
          id: 1,
          action: "tile.create",
          summary: "Created tile 1",
          detail: "{}",
          created_at: "2026-06-01T00:00:00.000Z",
        },
      ],
      historyNextCursor: "2026-06-01T00:00:00.000Z|1",
      historyHasMore: true,
    })

    const globals = globalThis as unknown as {
      fetch: (path: string, init?: RequestInit) => Promise<Response>
    }
    const requests: string[] = []
    globals.fetch = async (path) => {
      const url = requestUrl(path)
      requests.push(url)
      const body = url.includes("/history?limit=50")
        ? {
            events: [
              {
                id: 3,
                action: "tile.create",
                summary: "Created tile 3",
                detail: "{}",
                created_at: "2026-06-03T00:00:00.000Z",
              },
              {
                id: 2,
                action: "tile.create",
                summary: "Created tile 2",
                detail: "{}",
                created_at: "2026-06-02T00:00:00.000Z",
              },
              {
                id: 1,
                action: "tile.create",
                summary: "Created tile 1",
                detail: "{}",
                created_at: "2026-06-01T00:00:00.000Z",
              },
            ],
            nextCursor: "2026-06-01T00:00:00.000Z|1",
            hasMore: true,
          }
        : url.includes("/billing/usage")
          ? {
              customer_id: "fresh-customer",
              plans: [{ id: "starter", name: "Starter", cost: "$10" }],
              features: [],
              overage: { is_over_limit: false, editing_frozen: false, overages: [], suspended_creation: [] },
            }
          : {
              customer_id: "fresh-customer",
              plans: [{ id: "starter", name: "Starter", description: null, cost: "$10", action: "current", features: [] }],
            }

      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    }

    await useStore.getState().hydrateHistoryCache()
    expect(useStore.getState().historyEvents.map((event) => event.id)).toEqual([2, 1])

    const hover = startSidebarWarmupOnHover()
    const open = startSidebarWarmupOnOpen()
    await Promise.all([hover, open])

    expect(requests.filter((request) => request.includes("/history?limit=50"))).toHaveLength(1)
    expect(requests.filter((request) => request.includes("/billing/usage"))).toHaveLength(1)
    expect(requests.filter((request) => request.includes("/billing/plans"))).toHaveLength(0)

    const state = useStore.getState()
    const cached = await syncDb.queryCache.get("history")

    expect(state.historyEvents.map((event) => event.id)).toEqual([3, 2, 1])
    expect(cached?.historyEvents.map((event) => event.id)).toEqual([3, 2, 1])
    expect(state.billingUsage?.customer_id).toBe("fresh-customer")
    expect(state.billingPlans).toBeNull()
  })

  test("billing cache hydrates immediately and refreshes usage when the usage surface opens", async () => {
    await writeBillingUsageCache({
      customer_id: "cached-customer",
      plans: [{ id: "starter", name: "Starter", cost: "$10" }],
      features: [
        {
          id: "tiles",
          label: "Tiles",
          used: 4,
          unit: "tiles",
          limit: 10,
          remaining: 6,
          unlimited: false,
          reset_at: null,
          cost: "$0",
        },
      ],
      overage: {
        is_over_limit: false,
        editing_frozen: false,
        overages: [],
        suspended_creation: [],
      },
    })
    await writeBillingPlansCache({
      customer_id: "cached-customer",
      plans: [
        {
          id: "starter",
          name: "Starter",
          description: null,
          cost: "$10",
          action: "current",
          features: [],
        },
      ],
    })

    const globals = globalThis as unknown as {
      fetch: (path: string, init?: RequestInit) => Promise<Response>
    }
    const requests: string[] = []
    globals.fetch = async (path) => {
      const url = requestUrl(path)
      requests.push(url)
      const body = url.includes("/billing/usage")
        ? {
            customer_id: "fresh-customer",
            plans: [{ id: "pro", name: "Pro", cost: "$20" }],
            features: [
              {
                id: "tiles",
                label: "Tiles",
                used: 8,
                unit: "tiles",
                limit: 10,
                remaining: 2,
                unlimited: false,
                reset_at: null,
                cost: "$0",
              },
            ],
            overage: {
              is_over_limit: false,
              editing_frozen: false,
              overages: [],
              suspended_creation: [],
            },
          }
        : {
            customer_id: "fresh-customer",
            plans: [
              {
                id: "starter",
                name: "Starter",
                description: null,
                cost: "$10",
                action: "current",
                features: [],
              },
            ],
          }

      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    }

    await useStore.getState().hydrateBillingCache()

    const hydrated = useStore.getState()
    expect(hydrated.billingUsage?.customer_id).toBe("cached-customer")
    expect(hydrated.billingPlans?.customer_id).toBe("cached-customer")

    await startBillingWarmupOnPlans()

    const state = useStore.getState()
    expect(requests.some((request) => request.includes("/billing/usage"))).toBe(true)
    expect(requests.some((request) => request.includes("/billing/plans"))).toBe(false)
    expect(state.billingUsage?.customer_id).toBe("fresh-customer")
    expect(state.billingPlans?.customer_id).toBe("cached-customer")
  })

  test("billing usage requests dedupe concurrent preload and refresh", async () => {
    const globals = globalThis as unknown as {
      fetch: (path: string, init?: RequestInit) => Promise<Response>
    }
    const requests: string[] = []
    globals.fetch = async (path) => {
      const url = requestUrl(path)
      requests.push(url)
      return new Response(JSON.stringify(billingUsage({ customer_id: "fresh-usage" })), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    }

    await Promise.all([
      useStore.getState().preloadBillingUsage(),
      useStore.getState().refreshBillingUsage(),
    ])

    expect(requests.filter((request) => request.includes("/billing/usage"))).toHaveLength(1)
    expect(useStore.getState().billingUsage?.customer_id).toBe("fresh-usage")
  })

  test("billing plan requests dedupe concurrent preload and refresh", async () => {
    const globals = globalThis as unknown as {
      fetch: (path: string, init?: RequestInit) => Promise<Response>
    }
    const requests: string[] = []
    globals.fetch = async (path) => {
      const url = requestUrl(path)
      requests.push(url)
      return new Response(JSON.stringify(billingPlans({ customer_id: "fresh-plans" })), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    }

    await Promise.all([
      useStore.getState().preloadBillingPlans(),
      useStore.getState().refreshBillingPlans(),
    ])

    expect(requests.filter((request) => request.includes("/billing/plans"))).toHaveLength(1)
    expect(useStore.getState().billingPlans?.customer_id).toBe("fresh-plans")
  })

  test("billing plan switch refreshes usage and plans when no payment URL is returned", async () => {
    const globals = globalThis as unknown as {
      fetch: (path: string, init?: RequestInit) => Promise<Response>
    }
    const requests: string[] = []
    globals.fetch = async (path) => {
      const url = requestUrl(path)
      requests.push(url)
      const body = url.includes("/billing/switch-plan")
        ? { customer_id: "billing-customer", payment_url: null }
        : url.includes("/billing/usage")
          ? billingUsage({ customer_id: "after-switch-usage" })
          : billingPlans({ customer_id: "after-switch-plans" })
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    }

    await useStore.getState().switchBillingPlan("free", true)

    expect(requests.some((request) => request.includes("/billing/switch-plan"))).toBe(true)
    expect(requests.some((request) => request.includes("/billing/usage"))).toBe(true)
    expect(requests.some((request) => request.includes("/billing/plans"))).toBe(true)
    expect(useStore.getState().billingUsage?.customer_id).toBe("after-switch-usage")
    expect(useStore.getState().billingPlans?.customer_id).toBe("after-switch-plans")
  })

  test("billing plan switch with payment URL does not refresh usage and plans", async () => {
    const globals = globalThis as unknown as {
      fetch: (path: string, init?: RequestInit) => Promise<Response>
    }
    const requests: string[] = []
    globals.fetch = async (path) => {
      const url = requestUrl(path)
      requests.push(url)
      return new Response(JSON.stringify({ customer_id: "billing-customer", payment_url: "https://checkout.example" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    }

    const result = await useStore.getState().switchBillingPlan("pro")

    expect(result.payment_url).toBe("https://checkout.example")
    expect(requests.filter((request) => request.includes("/billing/switch-plan"))).toHaveLength(1)
    expect(requests.some((request) => request.includes("/billing/usage"))).toBe(false)
    expect(requests.some((request) => request.includes("/billing/plans"))).toBe(false)
  })

  test("failed billing plan switch preserves current billing state", async () => {
    const globals = globalThis as unknown as {
      fetch: (path: string, init?: RequestInit) => Promise<Response>
    }
    const requests: string[] = []
    const currentUsage = billingUsage({ customer_id: "current-usage" })
    const currentPlans = billingPlans({ customer_id: "current-plans" })
    useStore.setState({ billingUsage: currentUsage, billingPlans: currentPlans })
    globals.fetch = async (path) => {
      requests.push(requestUrl(path))
      return new Response(JSON.stringify({ error: "Unable to switch plans right now", code: "billing_provider_error" }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      })
    }

    await expect(useStore.getState().switchBillingPlan("free", true)).rejects.toThrow("Unable to switch plans right now")

    expect(useStore.getState().billingUsage).toBe(currentUsage)
    expect(useStore.getState().billingPlans).toBe(currentPlans)
    expect(requests.filter((request) => request.includes("/billing/switch-plan"))).toHaveLength(1)
    expect(requests.some((request) => request.includes("/billing/usage"))).toBe(false)
    expect(requests.some((request) => request.includes("/billing/plans"))).toBe(false)
  })

  test("billing edit freeze still blocks edits while create limits stay feature-specific", () => {
    useStore.setState({
      billingUsage: billingUsage({
        overage: {
          is_over_limit: true,
          editing_frozen: true,
          overages: [],
          suspended_creation: ["tiles"],
        },
      }),
    })

    expect(() => useStore.getState().assertBillingEditingAllowed()).toThrow("Editing is frozen")
  })

  test("billing edit freeze still allows tag deletion", async () => {
    const existingTag = tag({ id: 40, client_id: "tag-40", name: "cleanup" })
    const taggedThought = thought({ id: 30, client_id: "thought-30", tags: ["cleanup", "keep"] })
    await syncDb.entities.put(entityRecord({
      entityType: "thought",
      clientId: "thought-30",
      serverId: 30,
      tempId: null,
      canvasId: 10,
      status: "clean",
      data: taggedThought,
    }))
    useStore.setState({
      tags: [existingTag],
      thoughts: [taggedThought],
      thoughtCache: new Map([[10, [taggedThought]]]),
      billingUsage: billingUsage({
        overage: {
          is_over_limit: true,
          editing_frozen: true,
          overages: [{ id: "canvases", label: "Canvases", used: 3, limit: 2, over_by: 1, unit: "canvases" }],
          suspended_creation: ["canvases"],
        },
      }),
    })

    await useStore.getState().removeTag(existingTag.id)

    expect(useStore.getState().tags).toHaveLength(0)
    expect(useStore.getState().thoughts[0]?.tags).toEqual(["keep"])
    expect(useStore.getState().thoughtCache.get(10)?.[0]?.tags).toEqual(["keep"])
    expect((await syncDb.entities.get(entityKey("thought", "thought-30")))?.data).toMatchObject({ tags: ["keep"] })
    expect(await syncDb.outbox.where("entityType").equals("tag").toArray()).toMatchObject([
      { action: "delete", clientId: "tag-40" },
    ])
  })

  test("cleanup deletion transitions over-limit usage through exact cap to below cap", () => {
    useStore.setState({
      billingUsage: billingUsage({
        features: [{
          id: "canvases",
          label: "Canvases",
          used: 3,
          unit: "canvases",
          limit: 2,
          remaining: 0,
          unlimited: false,
          reset_at: null,
          cost: "$0",
        }],
        overage: {
          is_over_limit: true,
          editing_frozen: true,
          overages: [{ id: "canvases", label: "Canvases", used: 3, limit: 2, over_by: 1, unit: "canvases" }],
          suspended_creation: ["canvases"],
        },
      }),
    })

    useStore.getState().adjustBillingFeatureUsage("canvases", -1)
    expect(useStore.getState().billingUsage?.overage).toMatchObject({
      editing_frozen: false,
      overages: [],
      suspended_creation: ["canvases"],
    })
    expect(() => useStore.getState().assertBillingEditingAllowed()).not.toThrow()
    expect(() => useStore.getState().assertBillingCreationAllowed("canvases")).toThrow("At limit")

    useStore.getState().adjustBillingFeatureUsage("canvases", -1)
    expect(useStore.getState().billingUsage?.overage).toMatchObject({
      editing_frozen: false,
      overages: [],
      suspended_creation: [],
    })
    expect(() => useStore.getState().assertBillingCreationAllowed("canvases")).not.toThrow()
  })

  test("billing creation limits only block the matching feature at the cap", () => {
    useStore.setState({
      billingUsage: billingUsage({
        features: [
          {
            id: "canvases",
            label: "Canvases",
            used: 1,
            unit: "canvases",
            limit: 2,
            remaining: 1,
            unlimited: false,
            reset_at: null,
            cost: "$0",
          },
          {
            id: "tiles",
            label: "Tiles",
            used: 10,
            unit: "tiles",
            limit: 10,
            remaining: 0,
            unlimited: false,
            reset_at: null,
            cost: "$0",
          },
          {
            id: "thoughts",
            label: "Thoughts",
            used: 9,
            unit: "thoughts",
            limit: 10,
            remaining: 1,
            unlimited: false,
            reset_at: null,
            cost: "$0",
          },
        ],
        overage: {
          is_over_limit: false,
          editing_frozen: false,
          overages: [],
          suspended_creation: [],
        },
      }),
    })

    expect(useStore.getState().canCreateBillingFeature("canvases")).toBe(true)
    expect(useStore.getState().canCreateBillingFeature("tiles")).toBe(false)
    expect(useStore.getState().canCreateBillingFeature("thoughts")).toBe(true)
    expect(() => useStore.getState().assertBillingCreationAllowed("tiles")).toThrow("At limit")
  })

  test("store reset clears billing state and the restored active canvas", () => {
    useStore.setState({
      activeCanvasId: 10,
      billingUsage: billingUsage(),
      billingPlans: billingPlans(),
      billingUsageError: "usage failed",
      billingPlansError: "plans failed",
      billingOverageModalOpen: true,
      billingOverageDismissReady: true,
      billingOverageDismissSeconds: 0,
      billingCreationLimitNotice: { feature: "tiles", shownAt: Date.now() },
    })

    useStore.getState().resetStore()
    const state = useStore.getState()

    expect(state.activeCanvasId).toBeNull()
    expect(state.billingUsage).toBeNull()
    expect(state.billingPlans).toBeNull()
    expect(state.billingUsageError).toBeNull()
    expect(state.billingPlansError).toBeNull()
    expect(state.billingOverageModalOpen).toBe(false)
    expect(state.billingCreationLimitNotice).toBeNull()
  })

  test("canvas switching uses the activation path and serves cached data directly", async () => {
    const globals = globalThis as unknown as {
      fetch: (path: string, init?: RequestInit) => Promise<Response>
    }
    globals.fetch = () => new Promise<Response>(() => {})

    const firstTile = tile({ id: 20, canvas_id: 10, title: "First canvas tile" })
    const secondTile = tile({ id: 21, canvas_id: 11, title: "Second canvas tile" })

    useStore.setState({
      canvases: [canvas({ id: 10, name: "One" }), canvas({ id: 11, name: "Two" })],
      activeCanvasId: 10,
      tiles: [firstTile],
      thoughts: [],
      tileCache: new Map([[10, [firstTile]], [11, [secondTile]]]),
      thoughtCache: new Map([[10, []], [11, []]]),
    })

    useStore.getState().setActiveCanvas(11)

    const state = useStore.getState()
    expect(state.activeCanvasId).toBe(11)
    expect(state.tiles).toHaveLength(1)
    expect(state.tiles[0]?.title).toBe("Second canvas tile")
  })

  test("visible entity merges preserve the current order while refreshing data", () => {
    const existingTiles = [
      tile({ id: 20, title: "Front", created_at: "2026-01-01T00:00:00.000Z" }),
      tile({ id: 21, title: "Back", created_at: "2026-01-02T00:00:00.000Z" }),
    ]
    const incomingTiles = [
      tile({ id: 21, title: "Back updated", created_at: "2026-01-05T00:00:00.000Z" }),
      tile({ id: 20, title: "Front updated", created_at: "2026-01-04T00:00:00.000Z" }),
    ]

    const merged = mergeVisibleEntities(existingTiles, incomingTiles)

    expect(merged.map((item) => item.id)).toEqual([20, 21])
    expect(merged[0]?.title).toBe("Front updated")
    expect(merged[1]?.title).toBe("Back updated")
  })

  test("local tile writes do not surface as remote highlights", () => {
    useStore.setState({
      recentLocalTileChangeIds: new Map(),
      remoteChangedTileIds: new Set(),
      remoteChangedThoughtIds: new Set(),
    })

    useStore.getState().markLocalTileChange(20)
    useStore.getState().markRemoteChanges([20], [])

    expect(useStore.getState().remoteChangedTileIds.has(20)).toBe(false)
  })

  test("adding a canvas updates visible state and queues a sync operation", async () => {
    const creation = useStore.getState().addCanvas("Ideas")
    if (!creation) throw new Error("Expected canvas creation to succeed")
    await creation.persisted

    const state = useStore.getState()
    const records = await syncDb.outbox.toArray()

    expect(state.canvases).toHaveLength(1)
    expect(state.canvases[0]?.name).toBe("Ideas")
    expect(records).toHaveLength(1)
    expect(records[0]?.entityType).toBe("canvas")
  })

  test("renaming a tag updates local thought labels and queues the tag", async () => {
    useStore.setState({
      tags: [tag({ id: 40, name: "old" })],
      thoughts: [thought({ id: 30, tags: ["old"] })],
      thoughtCache: new Map([[10, [thought({ id: 30, tags: ["old"] })]]]),
    })

    await useStore.getState().updateTag(40, "new", "#abcdef")

    const state = useStore.getState()
    const records = await syncDb.outbox.toArray()

    expect(state.tags[0]?.name).toBe("new")
    expect(state.thoughts[0]?.tags).toEqual(["new"])
    expect(state.thoughtCache.get(10)?.[0]?.tags).toEqual(["new"])
    expect(records[0]?.entityType).toBe("tag")
    expect(records[0]?.payload).toMatchObject({ name: "new", color: "#abcdef" })
  })

  test("rapid canvas to tile to thought creation queues a dependency chain", async () => {
    const creation = useStore.getState().addCanvas("Sprint")
    if (!creation) throw new Error("Expected canvas creation to succeed")
    await creation.persisted
    const tempCanvasId = creation.canvas.id

    useStore.setState({
      activeCanvasId: tempCanvasId,
      tiles: [],
      thoughts: [],
      tileCache: new Map([[tempCanvasId, []]]),
      thoughtCache: new Map([[tempCanvasId, []]]),
    })

    await useStore.getState().addTile({
      client_id: null,
      canvas_id: null,
      title: "Backlog",
      x: 10,
      y: 20,
      width: 300,
      height: 220,
      importance: 1,
      visible: true,
    })
    const tempTileId = useStore.getState().tiles[0]?.id
    if (tempTileId === undefined) throw new Error("Expected optimistic tile")

    await useStore.getState().addThoughtToTile(tempTileId, "Write tests", ["work"])

    const records = await syncDb.outbox.toArray()
    const tileRecord = records.find((record) => record.entityType === "tile")
    const thoughtRecord = records.find((record) => record.entityType === "thought")

    expect(records.map((record) => record.entityType).sort()).toEqual(["canvas", "thought", "tile"])
    expect(tileRecord?.payload).toMatchObject({ canvas_id: tempCanvasId, title: "Backlog" })
    expect(thoughtRecord?.payload).toMatchObject({ tile_id: tempTileId, content: "Write tests" })
  })

  test("rapid tile create then move preserves both actions and the final canvas position", async () => {
    useStore.setState({
      canvases: [canvas({ id: 10 }), canvas({ id: 11, name: "Later" })],
      activeCanvasId: 10,
      tileCache: new Map([[10, []], [11, []]]),
      thoughtCache: new Map([[10, []], [11, []]]),
    })

    await useStore.getState().addTile({
      client_id: null,
      canvas_id: null,
      title: "Move me",
      x: 0,
      y: 0,
      width: 280,
      height: 200,
      importance: 1,
      visible: true,
    })
    const optimisticTile = useStore.getState().tiles[0]
    if (!optimisticTile) throw new Error("Expected optimistic tile")

    await useStore.getState().moveTileToCanvas(optimisticTile.id, 11, 300, 400)

    const records = await syncDb.outbox.where("clientId").equals(optimisticTile.client_id ?? "").toArray()
    const state = useStore.getState()

    const orderedRecords = [...records].sort((left, right) => left.createdAt - right.createdAt)
    expect(orderedRecords).toHaveLength(2)
    expect(orderedRecords[0]?.payload).toMatchObject({ canvas_id: 10, x: 0, y: 0 })
    expect(orderedRecords[1]?.payload).toMatchObject({ canvas_id: 11, x: 300, y: 400 })
    expect(state.tiles).toHaveLength(0)
    expect(state.tileCache.get(11)?.[0]).toMatchObject({ id: optimisticTile.id, canvas_id: 11 })
  })

  test("tile creation stops at the limit and shows a feature-specific notice", async () => {
    useStore.setState({
      canvases: [canvas({ id: 10 })],
      activeCanvasId: 10,
      tiles: [],
      thoughts: [],
      tileCache: new Map([[10, []]]),
      thoughtCache: new Map([[10, []]]),
      billingUsage: billingUsage({
        features: [
          {
            id: "tiles",
            label: "Tiles",
            used: 2,
            unit: "tiles",
            limit: 2,
            remaining: 0,
            unlimited: false,
            reset_at: null,
            cost: "$0",
          },
        ],
      }),
    })

    await useStore.getState().addTile({
      client_id: null,
      canvas_id: null,
      title: "Blocked tile",
      x: 0,
      y: 0,
      width: 240,
      height: 160,
      importance: 1,
      visible: true,
    })

    expect(useStore.getState().tiles).toHaveLength(0)
    expect(useStore.getState().billingCreationLimitNotice?.feature).toBe("tiles")
    expect(await syncDb.outbox.toArray()).toHaveLength(0)
  })

  test("a local create consumes the cap immediately so burst creates do not overshoot", async () => {
    useStore.setState({
      canvases: [canvas({ id: 10 })],
      activeCanvasId: 10,
      tiles: [],
      thoughts: [],
      tileCache: new Map([[10, []]]),
      thoughtCache: new Map([[10, []]]),
      billingUsage: billingUsage({
        features: [
          {
            id: "tiles",
            label: "Tiles",
            used: 0,
            unit: "tiles",
            limit: 1,
            remaining: 1,
            unlimited: false,
            reset_at: null,
            cost: "$0",
          },
        ],
      }),
    })

    await useStore.getState().addTile({
      client_id: null,
      canvas_id: null,
      title: "First tile",
      x: 0,
      y: 0,
      width: 240,
      height: 160,
      importance: 1,
      visible: true,
    })

    await useStore.getState().addTile({
      client_id: null,
      canvas_id: null,
      title: "Second tile",
      x: 24,
      y: 24,
      width: 240,
      height: 160,
      importance: 1,
      visible: true,
    })

    const state = useStore.getState()
    const records = await syncDb.outbox.toArray()

    expect(state.tiles).toHaveLength(1)
    expect(state.billingUsage?.features.find((feature) => feature.id === "tiles")?.used).toBe(1)
    expect(state.billingCreationLimitNotice?.feature).toBe("tiles")
    expect(records).toHaveLength(1)
  })

  test("ai rate limits surface the shared notice with a reset window", async () => {
    const globals = globalThis as unknown as {
      fetch: (path: string, init?: RequestInit) => Promise<Response>
    }
    const originalFetch = globals.fetch
    const resetAt = "2026-01-02T05:00:00.000Z"
    try {
      globals.fetch = async (path) => {
        if (String(path).includes("/ai/process")) {
          return new Response(JSON.stringify({
            code: "autumn_access_denied",
            feature_id: "ai_processing_requests",
            reset_at: resetAt,
          }), {
            status: 429,
            headers: { "Content-Type": "application/json" },
          })
        }
        return new Response(JSON.stringify({ status: "idle", latest_revision: 0 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      }

      useStore.setState({
        startAiPolling: () => {},
      })

      useStore.getState().processAiInput("Need help", "medium")
      for (let attempt = 0; attempt < 20; attempt += 1) {
        if (useStore.getState().billingCreationLimitNotice) break
        await new Promise((resolve) => setTimeout(resolve, 0))
      }

      const notice = useStore.getState().billingCreationLimitNotice
      expect(notice?.feature).toBe("ai_processing_requests")
      expect(notice?.resetAt).toBe(resetAt)
      expect(useStore.getState().aiStatus).toBe("idle")
    } finally {
      globals.fetch = originalFetch
    }
  })

  test("thought creation is blocked independently of tile limits", async () => {
    const rootCanvas = canvas({ id: 10 })
    const rootTile = tile({ id: 20, canvas_id: 10 })
    useStore.setState({
      canvases: [rootCanvas],
      activeCanvasId: 10,
      tiles: [rootTile],
      thoughts: [],
      tileCache: new Map([[10, [rootTile]]]),
      thoughtCache: new Map([[10, []]]),
      billingUsage: billingUsage({
        features: [
          {
            id: "tiles",
            label: "Tiles",
            used: 1,
            unit: "tiles",
            limit: 1,
            remaining: 0,
            unlimited: false,
            reset_at: null,
            cost: "$0",
          },
          {
            id: "thoughts",
            label: "Thoughts",
            used: 4,
            unit: "thoughts",
            limit: 4,
            remaining: 0,
            unlimited: false,
            reset_at: null,
            cost: "$0",
          },
        ],
      }),
    })

    await useStore.getState().addThoughtToTile(20, "Blocked thought", [])

    expect(useStore.getState().thoughts).toHaveLength(0)
    expect(useStore.getState().billingCreationLimitNotice?.feature).toBe("thoughts")
    expect(await syncDb.outbox.toArray()).toHaveLength(0)
  })

  test("canvas creation is blocked at the cap without freezing edits", async () => {
    useStore.setState({
      canvases: [canvas({ id: 10, name: "One" })],
      activeCanvasId: 10,
      billingUsage: billingUsage({
        features: [
          {
            id: "canvases",
            label: "Canvases",
            used: 1,
            unit: "canvases",
            limit: 1,
            remaining: 0,
            unlimited: false,
            reset_at: null,
            cost: "$0",
          },
        ],
      }),
    })

    const creation = useStore.getState().addCanvas("Blocked canvas")

    expect(creation).toBeNull()
    expect(useStore.getState().canvases).toHaveLength(1)
    expect(useStore.getState().billingCreationLimitNotice?.feature).toBe("canvases")
  })

  test("moving a tile across canvases carries its cached thoughts", async () => {
    const sourceTile = tile({ id: 20, canvas_id: 10 })
    const sourceThought = thought({ id: 30, tile_id: 20 })
    useStore.setState({
      canvases: [canvas({ id: 10 }), canvas({ id: 11, name: "Later" })],
      activeCanvasId: 10,
      tiles: [sourceTile],
      thoughts: [sourceThought],
      tileCache: new Map([[10, [sourceTile]], [11, []]]),
      thoughtCache: new Map([[10, [sourceThought]], [11, []]]),
    })

    await useStore.getState().moveTileToCanvas(20, 11, 50, 60)

    const state = useStore.getState()
    const records = await syncDb.outbox.toArray()

    expect(state.tiles).toHaveLength(0)
    expect(state.thoughts).toHaveLength(0)
    expect(state.tileCache.get(11)?.[0]).toMatchObject({ id: 20, canvas_id: 11 })
    expect(state.thoughtCache.get(11)?.[0]).toMatchObject({ id: 30, tile_id: 20 })
    expect(records[0]?.payload).toMatchObject({ canvas_id: 11, x: 50, y: 60 })
  })

  test("rapid thought reorder bursts keep final sort orders in the outbox", async () => {
    const thoughts = [
      thought({ id: 30, client_id: "thought-30", content: "A", sort_order: 0 }),
      thought({ id: 31, client_id: "thought-31", content: "B", sort_order: 1 }),
      thought({ id: 32, client_id: "thought-32", content: "C", sort_order: 2 }),
    ]
    useStore.setState({
      activeCanvasId: 10,
      tiles: [tile({ id: 20 })],
      thoughts,
      tileCache: new Map([[10, [tile({ id: 20 })]]]),
      thoughtCache: new Map([[10, thoughts]]),
    })

    await useStore.getState().moveThoughtToTile(32, 20, { targetCanvasId: 10, orderedIds: [32, 31, 30] })
    await useStore.getState().moveThoughtToTile(31, 20, { targetCanvasId: 10, orderedIds: [31, 30, 32] })

    const records = await syncDb.outbox.toArray()
    const orderByClientId = new Map([...records]
      .sort((left, right) => left.createdAt - right.createdAt)
      .map((record) => [record.clientId, record.payload.sort_order]))
    const finalOrder = [...useStore.getState().thoughts]
      .sort((left, right) => left.sort_order - right.sort_order)
      .map((item) => [item.id, item.sort_order])

    expect(finalOrder).toEqual([[31, 0], [30, 1], [32, 2]])
    expect(orderByClientId.get("thought-31")).toBe(0)
    expect(orderByClientId.get("thought-30")).toBe(1)
    expect(orderByClientId.get("thought-32")).toBe(2)
    expect((await syncDb.syncActivity.toArray()).filter((activity) => !activity.hidden)).toHaveLength(2)
  })

  test("temporary tile with temporary thoughts can be deleted before flush", async () => {
    useStore.setState({
      activeCanvasId: 10,
      tileCache: new Map([[10, []]]),
      thoughtCache: new Map([[10, []]]),
    })

    await useStore.getState().addTile({
      client_id: null,
      canvas_id: 10,
      title: "Disposable",
      x: 0,
      y: 0,
      width: 280,
      height: 200,
      importance: 1,
      visible: true,
    })
    const optimisticTile = useStore.getState().tiles[0]
    if (!optimisticTile) throw new Error("Expected optimistic tile")
    await useStore.getState().addThoughtToTile(optimisticTile.id, "Disposable thought", [])

    await useStore.getState().removeTile(optimisticTile.id)

    expect(useStore.getState().tiles).toHaveLength(0)
    expect(useStore.getState().thoughts).toHaveLength(0)
    const operations = await syncDb.outbox.toArray()
    expect(operations).toHaveLength(4)
    expect(operations.filter((operation) => operation.action === "upsert")).toHaveLength(2)
    expect(operations.filter((operation) => operation.action === "delete")).toHaveLength(2)
    expect(operations.find((operation) => operation.entityType === "thought" && operation.action === "delete")?.recordHistory).toBe(false)
    expect((await syncDb.entities.toArray()).every((record) => record.status === "deleted")).toBe(true)
  })

  test("deleting a canvas with moveContents moves known children and queues server work", async () => {
    const sourceTile = tile({ id: 20, client_id: "tile-20", canvas_id: 10 })
    const sourceThought = thought({ id: 30, client_id: "thought-30", tile_id: 20 })
    useStore.setState({
      canvases: [canvas({ id: 10 }), canvas({ id: 11, name: "Target" })],
      activeCanvasId: 10,
      tiles: [sourceTile],
      thoughts: [sourceThought],
      tileCache: new Map([[10, [sourceTile]], [11, []]]),
      thoughtCache: new Map([[10, [sourceThought]], [11, []]]),
    })

    await useStore.getState().removeCanvas(10, { mode: "moveContents", targetCanvasId: 11 })

    const state = useStore.getState()
    const records = await syncDb.outbox.toArray()
    const canvasDelete = records.find((record) => record.entityType === "canvas" && record.action === "delete")
    const tileUpsert = records.find((record) => record.entityType === "tile" && record.action === "upsert")

    expect(state.activeCanvasId).toBe(11)
    expect(state.tileCache.get(11)?.[0]).toMatchObject({ id: 20, canvas_id: 11 })
    expect(state.thoughtCache.get(11)?.[0]).toMatchObject({ id: 30, tile_id: 20 })
    expect(canvasDelete?.payload).toMatchObject({ mode: "moveContents", targetCanvasId: 11 })
    expect(tileUpsert?.payload).toMatchObject({ canvas_id: 11 })
  })

  test("refreshing history after loading more re-anchors the next cursor to the refreshed first page", async () => {
    const globals = globalThis as unknown as {
      fetch: (path: string, init?: RequestInit) => Promise<Response>
    }
    const requests: string[] = []
    let refreshed = false

    const page = (events: Array<{ id: number; created_at: string }>, nextCursor: string | null, hasMore: boolean) => ({
      events: events.map((event) => ({
        ...event,
        action: "tile.create",
        summary: `Created tile ${event.id}`,
        detail: "{}",
      })),
      nextCursor,
      hasMore,
    })

    globals.fetch = async (path) => {
      const url = new URL(String(path), "http://localhost")
      requests.push(url.toString())
      const cursor = url.searchParams.get("cursor")
      const body = cursor === null
        ? (refreshed
          ? page([
            { id: 8, created_at: "2026-06-08T00:00:00.000Z" },
            { id: 7, created_at: "2026-06-07T00:00:00.000Z" },
            { id: 6, created_at: "2026-06-06T00:00:00.000Z" },
            { id: 5, created_at: "2026-06-05T00:00:00.000Z" },
          ], "2026-06-05T00:00:00.000Z|5", true)
          : page([
            { id: 6, created_at: "2026-06-06T00:00:00.000Z" },
            { id: 5, created_at: "2026-06-05T00:00:00.000Z" },
            { id: 4, created_at: "2026-06-04T00:00:00.000Z" },
            { id: 3, created_at: "2026-06-03T00:00:00.000Z" },
          ], "2026-06-03T00:00:00.000Z|3", true))
        : page([
          { id: 2, created_at: "2026-06-02T00:00:00.000Z" },
          { id: 1, created_at: "2026-06-01T00:00:00.000Z" },
        ], null, false)

      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    }

    await useStore.getState().refreshHistory()
    await useStore.getState().loadMoreHistory()
    refreshed = true
    await useStore.getState().refreshHistory()

    const state = useStore.getState()
    expect(state.historyEvents.map((event) => event.id)).toEqual([8, 7, 6, 5, 4, 3, 2, 1])
    expect(state.historyNextCursor).toBe("2026-06-05T00:00:00.000Z|5")
    expect(state.historyHasMore).toBe(true)

    await useStore.getState().loadMoreHistory()

    expect(requests).toEqual([
      "http://localhost/api/history?limit=50",
      "http://localhost/api/history?limit=50&cursor=2026-06-03T00%3A00%3A00.000Z%7C3",
      "http://localhost/api/history?limit=50",
      "http://localhost/api/history?limit=50&cursor=2026-06-05T00%3A00%3A00.000Z%7C5",
    ])
  })
})
