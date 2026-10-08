import { getApi } from "./apiAuth"
import type { BillingCreationLimitFeature, BillingFeatureUsage, BillingLimitNotice, BillingOverage, BillingPlans, BillingUsage } from "../types"
import type { BillingSlice, StoreSlice } from "./types"
import { readBillingPlansCache, readBillingUsageCache, writeBillingPlansCache, writeBillingUsageCache } from "../sync/queryCache"
import { billingOverageFromFeatures } from "../billing/resourceThresholds"
import {
  assertSyncAccountScopeCurrent,
  currentSyncAccountScope,
  runSyncAccountTask,
  type SyncAccountScope,
} from "../sync/accountScope"

const DISMISS_DELAY_MS = 10000
const CREATE_LIMIT_MESSAGES: Record<BillingCreationLimitFeature, string> = {
  canvases: "At limit, delete a canvas before creating more.",
  tiles: "At limit, delete tiles before creating more.",
  thoughts: "At limit, delete thoughts before creating more.",
}

type ScopedRequest<T> = {
  generation: number | null
  promise: Promise<T>
}

let pendingUsage: ScopedRequest<BillingUsage> | null = null
let pendingPlans: ScopedRequest<BillingPlans> | null = null
let changedFeatureTimer: ReturnType<typeof setTimeout> | null = null

export class BillingAccessError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "BillingAccessError"
  }
}

function usageSnapshot(usage: BillingUsage | null) {
  if (!usage) return ""
  return JSON.stringify({
    plans: usage.plans.map((plan) => [plan.id, plan.name, plan.cost]),
    features: usage.features.map((feature) => [
      feature.id,
      feature.used,
      feature.limit,
      feature.remaining,
      feature.unlimited,
      feature.cost,
    ]),
  })
}

function changedFeatureIds(previous: BillingUsage | null, next: BillingUsage) {
  const previousFeatures = new Map(previous?.features.map((feature) => [feature.id, feature]))
  return new Set(next.features
    .filter((feature) => {
      const before = previousFeatures.get(feature.id)
      return !before
        || before.used !== feature.used
        || before.limit !== feature.limit
        || before.remaining !== feature.remaining
        || before.unlimited !== feature.unlimited
        || before.cost !== feature.cost
    })
    .map((feature) => feature.id))
}

function loadErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}

function creationLimitMessage(feature: BillingCreationLimitFeature) {
  return CREATE_LIMIT_MESSAGES[feature]
}

function creationLimitUsage(usage: BillingUsage | null, feature: BillingCreationLimitFeature) {
  if (!usage) return null
  return usage.features.find((item) => item.id === feature) ?? null
}

type CreationCountState = {
  billingUsage: BillingUsage | null
  canvases: { id: number }[]
  tiles: { id: number }[]
  thoughts: { id: number }[]
  tileCache: Map<number, { id: number }[]>
  thoughtCache: Map<number, { id: number }[]>
}

function localCreationCount(state: CreationCountState, feature: BillingCreationLimitFeature) {
  if (feature === "canvases") return state.canvases.length

  const ids = new Set<number>()
  const cached = feature === "tiles" ? state.tileCache.values() : state.thoughtCache.values()
  const items = feature === "tiles"
    ? [...state.tiles, ...[...cached].flat()]
    : [...state.thoughts, ...[...cached].flat()]
  for (const item of items) ids.add(item.id)
  return ids.size
}

function effectiveCreationCount(state: CreationCountState, feature: BillingCreationLimitFeature) {
  const item = creationLimitUsage(state.billingUsage, feature)
  return Math.max(item?.used ?? 0, localCreationCount(state, feature))
}

function clearChangedFeatureTimer() {
  if (changedFeatureTimer === null) return
  clearTimeout(changedFeatureTimer)
  changedFeatureTimer = null
}

function scopeGeneration(scope: SyncAccountScope | null) {
  return scope?.generation ?? null
}

function pendingForScope<T>(request: ScopedRequest<T> | null, scope: SyncAccountScope | null) {
  return request?.generation === scopeGeneration(scope) ? request.promise : null
}

function applyUsage(
  set: Parameters<StoreSlice<BillingSlice>>[0],
  previous: BillingUsage | null,
  next: BillingUsage,
) {
  const changed = usageSnapshot(previous) === usageSnapshot(next) ? new Set<BillingFeatureUsage["id"]>() : changedFeatureIds(previous, next)
  set({
    billingUsage: next,
    billingUsageError: null,
    billingChangedFeatureIds: changed,
  })
  clearChangedFeatureTimer()
  if (changed.size === 0) return
  changedFeatureTimer = setTimeout(() => {
    changedFeatureTimer = null
    set({ billingChangedFeatureIds: new Set() })
  }, 1200)
}

export function initialBillingState() {
  return {
    billingUsage: null,
    billingPlans: null,
    billingUsageLoading: false,
    billingPlansLoading: false,
    billingUsageError: null,
    billingPlansError: null,
    billingChangedFeatureIds: new Set<BillingFeatureUsage["id"]>(),
    billingOverageModalOpen: false,
    billingOverageDismissReady: false,
    billingOverageDismissSeconds: 0,
    billingCreationLimitNotice: null,
  }
}

export const createBillingSlice: StoreSlice<BillingSlice> = (set, get) => ({
  ...initialBillingState(),

  hydrateBillingCache: () => runSyncAccountTask(async (scope) => {
    const [billingUsage, billingPlans] = await Promise.all([
      get().billingUsage ? Promise.resolve(get().billingUsage) : readBillingUsageCache(),
      get().billingPlans ? Promise.resolve(get().billingPlans) : readBillingPlansCache(),
    ])
    assertSyncAccountScopeCurrent(scope)
    const nextState: Partial<BillingSlice> = {}
    if (billingUsage && get().billingUsage === null) nextState.billingUsage = billingUsage
    if (billingPlans && get().billingPlans === null) nextState.billingPlans = billingPlans
    if (Object.keys(nextState).length > 0) {
      set({
        ...nextState,
        billingUsageLoading: false,
        billingPlansLoading: false,
        billingUsageError: null,
        billingPlansError: null,
      })
    }
  }),

  preloadBillingUsage: async () => {
    const cached = get().billingUsage
    if (cached) return cached
    const scope = currentSyncAccountScope()
    const existingRequest = pendingForScope(pendingUsage, scope)
    if (existingRequest) return existingRequest

    const request = runSyncAccountTask(async (taskScope) => {
      const persisted = await readBillingUsageCache()
      assertSyncAccountScopeCurrent(taskScope)
      if (persisted) {
        set({ billingUsage: persisted, billingUsageError: null, billingUsageLoading: false })
        return persisted
      }

      set({ billingUsageLoading: true, billingUsageError: null })
      try {
        const usage = await getApi(taskScope).billing.usage()
        assertSyncAccountScopeCurrent(taskScope)
        applyUsage(set, get().billingUsage, usage)
        await writeBillingUsageCache(usage)
        return usage
      } catch (error) {
        assertSyncAccountScopeCurrent(taskScope)
        set({ billingUsageError: loadErrorMessage(error, "Unable to load usage") })
        throw error
      } finally {
        if (taskScope?.signal.aborted !== true) set({ billingUsageLoading: false })
      }
    })
    const scopedRequest: ScopedRequest<BillingUsage> = { generation: scopeGeneration(scope), promise: request }
    pendingUsage = scopedRequest
    void request.finally(() => {
      if (pendingUsage === scopedRequest) pendingUsage = null
    }).catch(() => undefined)
    return request
  },

  refreshBillingUsage: async () => {
    const scope = currentSyncAccountScope()
    const existingRequest = pendingForScope(pendingUsage, scope)
    if (existingRequest) return existingRequest

    set({ billingUsageLoading: get().billingUsage === null, billingUsageError: null })
    const previous = get().billingUsage
    const request = runSyncAccountTask(async (taskScope) => {
      try {
        const usage = await getApi(taskScope).billing.usage()
        assertSyncAccountScopeCurrent(taskScope)
        applyUsage(set, previous, usage)
        await writeBillingUsageCache(usage)
        return usage
      } catch (error) {
        assertSyncAccountScopeCurrent(taskScope)
        set({ billingUsageError: loadErrorMessage(error, "Unable to load usage") })
        throw error
      } finally {
        if (taskScope?.signal.aborted !== true) set({ billingUsageLoading: false })
      }
    })
    const scopedRequest: ScopedRequest<BillingUsage> = { generation: scopeGeneration(scope), promise: request }
    pendingUsage = scopedRequest
    void request.finally(() => {
      if (pendingUsage === scopedRequest) pendingUsage = null
    }).catch(() => undefined)
    return request
  },

  preloadBillingPlans: async () => {
    const cached = get().billingPlans
    if (cached) return cached
    const scope = currentSyncAccountScope()
    const existingRequest = pendingForScope(pendingPlans, scope)
    if (existingRequest) return existingRequest

    const request = runSyncAccountTask(async (taskScope) => {
      const persisted = await readBillingPlansCache()
      assertSyncAccountScopeCurrent(taskScope)
      if (persisted) {
        set({ billingPlans: persisted, billingPlansError: null, billingPlansLoading: false })
        return persisted
      }

      set({ billingPlansLoading: true, billingPlansError: null })
      try {
        const plans = await getApi(taskScope).billing.plans()
        assertSyncAccountScopeCurrent(taskScope)
        set({ billingPlans: plans, billingPlansError: null })
        await writeBillingPlansCache(plans)
        return plans
      } catch (error) {
        assertSyncAccountScopeCurrent(taskScope)
        set({ billingPlansError: loadErrorMessage(error, "Unable to load plans") })
        throw error
      } finally {
        if (taskScope?.signal.aborted !== true) set({ billingPlansLoading: false })
      }
    })
    const scopedRequest: ScopedRequest<BillingPlans> = { generation: scopeGeneration(scope), promise: request }
    pendingPlans = scopedRequest
    void request.finally(() => {
      if (pendingPlans === scopedRequest) pendingPlans = null
    }).catch(() => undefined)
    return request
  },

  refreshBillingPlans: async () => {
    const scope = currentSyncAccountScope()
    const existingRequest = pendingForScope(pendingPlans, scope)
    if (existingRequest) return existingRequest

    set({ billingPlansLoading: get().billingPlans === null, billingPlansError: null })
    const request = runSyncAccountTask(async (taskScope) => {
      try {
        const plans = await getApi(taskScope).billing.plans()
        assertSyncAccountScopeCurrent(taskScope)
        set({ billingPlans: plans, billingPlansError: null })
        await writeBillingPlansCache(plans)
        return plans
      } catch (error) {
        assertSyncAccountScopeCurrent(taskScope)
        set({ billingPlansError: loadErrorMessage(error, "Unable to load plans") })
        throw error
      } finally {
        if (taskScope?.signal.aborted !== true) set({ billingPlansLoading: false })
      }
    })
    const scopedRequest: ScopedRequest<BillingPlans> = { generation: scopeGeneration(scope), promise: request }
    pendingPlans = scopedRequest
    void request.finally(() => {
      if (pendingPlans === scopedRequest) pendingPlans = null
    }).catch(() => undefined)
    return request
  },

  previewBillingPlanImpact: (planId) => runSyncAccountTask((scope) => getApi(scope).billing.planImpact(planId)),

  switchBillingPlan: async (planId, confirmedOverLimit = false) => {
    const result = await runSyncAccountTask((scope) => getApi(scope).billing.switchPlan(planId, confirmedOverLimit))
    if (!result.payment_url) {
      await Promise.all([
        get().refreshBillingUsage(),
        get().refreshBillingPlans(),
      ])
    }
    return result
  },

  canCreateBillingFeature: (feature) => {
    const state = get() as CreationCountState
    const item = creationLimitUsage(state.billingUsage, feature)
    if (!item || item.limit === null || item.unlimited) return true
    return effectiveCreationCount(state, feature) < item.limit
  },

  adjustBillingFeatureUsage: (feature, delta) => {
    const usage = get().billingUsage
    if (!usage) return
    const nextFeatures = usage.features.map((item) => {
      if (item.id !== feature) return item
      if (item.limit === null || item.unlimited) return item
      const used = Math.max(0, item.used + delta)
      return {
        ...item,
        used,
        remaining: Math.max(0, item.limit - used),
      }
    })
    set({
      billingUsage: {
        ...usage,
        features: nextFeatures,
        overage: billingOverageFromFeatures(nextFeatures),
      },
    })
  },

  showBillingCreationLimitNotice: (feature, options) => {
    const notice: BillingLimitNotice = { feature, shownAt: Date.now(), resetAt: options?.resetAt ?? null }
    set({ billingCreationLimitNotice: notice })
  },

  dismissBillingCreationLimitNotice: () => {
    set({ billingCreationLimitNotice: null })
  },

  openBillingOverageModal: (options) => {
    set({
      billingOverageModalOpen: true,
      billingOverageDismissReady: Boolean(options?.immediateDismiss),
      billingOverageDismissSeconds: options?.immediateDismiss ? 0 : Math.ceil(DISMISS_DELAY_MS / 1000),
    })
  },

  closeBillingOverageModal: () => {
    if (!get().billingOverageDismissReady) return
    set({ billingOverageModalOpen: false })
  },

  setBillingOverageDismissState: ({ ready, seconds }) => {
    set({ billingOverageDismissReady: ready, billingOverageDismissSeconds: seconds })
  },

  assertBillingEditingAllowed: () => {
    if (get().billingUsage?.overage.editing_frozen) {
      throw new BillingAccessError("Editing is frozen while this account is above plan limits")
    }
  },

  assertBillingCreationAllowed: (feature: BillingOverage["suspended_creation"][number]) => {
    if (!get().canCreateBillingFeature(feature)) {
      throw new BillingAccessError(creationLimitMessage(feature))
    }
  },

  resetBillingState: () => {
    pendingUsage = null
    pendingPlans = null
    clearChangedFeatureTimer()
    set(initialBillingState())
  },
})
