import {
  getAutumnCustomer,
  getOrCreateAutumnCustomer,
  getAutumnPlan,
  isAutumnConfigured,
  type AutumnCustomerBalance,
  type AutumnPlanItem,
  type AutumnPlanResponse,
} from "./autumnClient"
import { autumnFeatures, type AutumnFeature } from "./features"
import { activeEntityCounts, getStorageUsage, syncStorageUsageToAutumn } from "./storageUsage"

const RESOURCE_FEATURES = new Set<AutumnFeature>([
  autumnFeatures.canvases,
  autumnFeatures.tiles,
  autumnFeatures.thoughts,
])

type LocalUsage = {
  counts: Awaited<ReturnType<typeof activeEntityCounts>>
  storageUsage: Awaited<ReturnType<typeof getStorageUsage>>
}

export type BillingUsageFeature = {
  id: AutumnFeature
  label: string
  used: number
  unit: string
  limit: number | null
  remaining: number | null
  unlimited: boolean
  reset_at: string | null
  cost: string | null
}

export type BillingUsagePlan = {
  id: string
  name: string
  cost: string
}

export type BillingOverageItem = {
  id: "canvases" | "tiles" | "thoughts"
  label: string
  used: number
  limit: number
  over_by: number
  unit: string
}

export type BillingOverageStatus = {
  is_over_limit: boolean
  editing_frozen: boolean
  overages: BillingOverageItem[]
  suspended_creation: BillingOverageItem["id"][]
}

export type BillingUsageStatus = {
  customer_id: string
  plans: BillingUsagePlan[]
  features: BillingUsageFeature[]
  overage: BillingOverageStatus
}

type BillingUsageStatusOptions = {
  syncStorage?: boolean
}

const FEATURE_LABELS = {
  [autumnFeatures.canvases]: { label: "Canvases", unit: "canvases" },
  [autumnFeatures.tiles]: { label: "Tiles", unit: "tiles" },
  [autumnFeatures.thoughts]: { label: "Thoughts", unit: "thoughts" },
  [autumnFeatures.storage]: { label: "Storage", unit: "MB" },
  [autumnFeatures.aiProcessingRequests]: { label: "AI requests", unit: "requests" },
  [autumnFeatures.transcriptionSeconds]: { label: "Transcription", unit: "seconds" },
} as const satisfies Record<AutumnFeature, { label: string; unit: string }>

function emptyOverage(): BillingOverageStatus {
  return {
    is_over_limit: false,
    editing_frozen: false,
    overages: [],
    suspended_creation: [],
  }
}

function resetAtIso(value: number | null | undefined) {
  return typeof value === "number" ? new Date(value).toISOString() : null
}

function planId(planRef: { planId?: string; plan_id?: string }) {
  return planRef.planId ?? planRef.plan_id ?? null
}

function featureId(item: AutumnPlanItem) {
  return item.featureId ?? item.feature_id ?? null
}

function isTrackedFeature(value: string | null): value is AutumnFeature {
  return Object.values(autumnFeatures).some((feature) => feature === value)
}

function displayText(display: { primaryText?: string; primary_text?: string; secondaryText?: string; secondary_text?: string } | null | undefined) {
  const primary = display?.primaryText ?? display?.primary_text ?? null
  const secondary = display?.secondaryText ?? display?.secondary_text ?? null
  return [primary, secondary].filter((part): part is string => typeof part === "string" && part.length > 0).join(" ")
}

function planCost(plan: AutumnPlanResponse) {
  const text = displayText(plan.price?.display)
  if (text) return text
  if (typeof plan.price?.amount === "number") {
    return `$${plan.price.amount}${plan.price.interval ? ` / ${plan.price.interval}` : ""}`
  }
  return "Free"
}

function itemCost(item: AutumnPlanItem) {
  const text = displayText(item.display) || displayText(item.price?.display)
  if (text) return text

  if (typeof item.price?.amount !== "number") return null
  const units = item.price.billingUnits ?? item.price.billing_units ?? 1
  const interval = item.price.interval ? ` / ${item.price.interval}` : ""
  return `$${item.price.amount} per ${units}${interval}`
}

function localUsed(feature: AutumnFeature, localUsage: LocalUsage) {
  switch (feature) {
    case autumnFeatures.canvases:
      return localUsage.counts.canvases
    case autumnFeatures.tiles:
      return localUsage.counts.tiles
    case autumnFeatures.thoughts:
      return localUsage.counts.thoughts
    case autumnFeatures.storage:
      return localUsage.storageUsage.storageMegabytes
    case autumnFeatures.aiProcessingRequests:
    case autumnFeatures.transcriptionSeconds:
      return null
  }
}

function balanceUsed(balance: AutumnCustomerBalance | undefined, feature: AutumnFeature, localUsage: LocalUsage) {
  const local = localUsed(feature, localUsage)
  if (local !== null) return local
  return typeof balance?.usage === "number" ? balance.usage : 0
}

function buildFeature(item: AutumnPlanItem, balance: AutumnCustomerBalance | undefined, localUsage: LocalUsage): BillingUsageFeature | null {
  const id = featureId(item)
  if (!isTrackedFeature(id)) return null

  const used = balanceUsed(balance, id, localUsage)
  const unlimited = item.unlimited === true || balance?.unlimited === true
  const granted = typeof balance?.granted === "number" ? balance.granted : item.included ?? null
  const limit = unlimited ? null : granted

  return {
    id,
    label: FEATURE_LABELS[id].label,
    unit: FEATURE_LABELS[id].unit,
    used,
    limit: typeof limit === "number" && limit > 0 ? limit : null,
    remaining: typeof balance?.remaining === "number" ? balance.remaining : null,
    unlimited,
    reset_at: resetAtIso(balance?.nextResetAt ?? balance?.next_reset_at),
    cost: itemCost(item),
  }
}

function activePlanIds(customer: Awaited<ReturnType<typeof getAutumnCustomer>>) {
  const refs = [...(customer?.subscriptions ?? []), ...(customer?.purchases ?? [])]
  const activeIds = refs
    .filter((ref) => {
      const status = ref.status?.toLowerCase()
      return status === undefined || status === "active" || status === "past_due"
    })
    .map(planId)
    .filter((id): id is string => typeof id === "string" && id.length > 0)
  return [...new Set(activeIds)]
}

function buildOverage(features: BillingUsageFeature[]): BillingOverageStatus {
  const overages = features
    .filter((feature) => RESOURCE_FEATURES.has(feature.id) && feature.limit !== null && feature.used > feature.limit)
    .map((feature) => ({
      id: feature.id as BillingOverageItem["id"],
      label: feature.label,
      used: feature.used,
      limit: feature.limit!,
      over_by: feature.used - feature.limit!,
      unit: feature.unit,
    }))

  if (overages.length === 0) return emptyOverage()

  return {
    is_over_limit: true,
    editing_frozen: true,
    overages,
    suspended_creation: overages.map((overage) => overage.id),
  }
}

export async function getBillingUsageStatus(userId: string, options: BillingUsageStatusOptions = {}): Promise<BillingUsageStatus> {
  const syncStorage = options.syncStorage ?? true
  const [counts, storageUsage] = await Promise.all([
    activeEntityCounts(userId),
    (syncStorage ? syncStorageUsageToAutumn(userId) : getStorageUsage(userId)).catch(async (error) => {
      const message = error instanceof Error ? error.message : String(error)
      console.warn(`[autumn] failed to ${syncStorage ? "sync" : "read"} storage usage during billing status load: ${message}`)
      return getStorageUsage(userId)
    }),
  ])

  if (!isAutumnConfigured()) {
    return {
      customer_id: userId,
      plans: [],
      features: [],
      overage: emptyOverage(),
    }
  }

  await getOrCreateAutumnCustomer(userId)
  const customer = await getAutumnCustomer(userId)
  const plans = await Promise.all(activePlanIds(customer).map((id) => getAutumnPlan(id)))
  const localUsage = { counts, storageUsage }
  const seenFeatures = new Set<AutumnFeature>()
  const features: BillingUsageFeature[] = []

  for (const plan of plans) {
    for (const item of plan?.items ?? []) {
      const id = featureId(item)
      if (!isTrackedFeature(id) || seenFeatures.has(id)) continue
      const feature = buildFeature(item, customer?.balances?.[id], localUsage)
      if (!feature) continue
      seenFeatures.add(id)
      features.push(feature)
    }
  }

  return {
    customer_id: userId,
    plans: plans.filter((plan): plan is AutumnPlanResponse => plan !== null).map((plan) => ({
      id: plan.id ?? "unknown",
      name: plan.name ?? plan.id ?? "Current plan",
      cost: planCost(plan),
    })),
    features,
    overage: buildOverage(features),
  }
}
