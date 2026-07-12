// What is the user's current billing usage?
// This file fetches live usage data and assembles the API payload; it does not decide billing policy.

import {
  getAutumnCustomer,
  getOrCreateAutumnCustomer,
  getAutumnPlan,
  isAutumnConfigured,
  type AutumnCustomerBalance,
  type AutumnPlanItem,
  type AutumnPlanResponse,
} from "./autumnClient"
import { emptyBillingOverageStatus, evaluateResourceThresholds, type BillingOverageStatus } from "./resourceThresholds"
import { autumnFeatures, type AutumnFeature } from "./features"
import { displayText, featurePriceText, normalizeMoneyText, planPriceText, rawPriceText } from "./priceDisplay"
import { activeEntityCounts, getStorageUsage, syncStorageUsageToAutumn } from "./storageUsage"
import { activePlanIds } from "./subscriptionStatus"
import { reconcileAutumnResourceUsage } from "./resourceUsage"

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

export type BillingUsageStatus = {
  customer_id: string
  plans: BillingUsagePlan[]
  features: BillingUsageFeature[]
  overage: BillingOverageStatus
}

type BillingUsageStatusOptions = {
  syncResources?: boolean
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

function resetAtIso(value: number | null | undefined) {
  return typeof value === "number" ? new Date(value).toISOString() : null
}

function featureId(item: AutumnPlanItem) {
  return item.featureId ?? item.feature_id ?? null
}

function isTrackedFeature(value: string | null): value is AutumnFeature {
  return Object.values(autumnFeatures).some((feature) => feature === value)
}

function hasPaygPricing(plan: AutumnPlanResponse) {
  return (plan.items ?? []).some((item) => item.price?.amount !== undefined)
}

function planCost(plan: AutumnPlanResponse) {
  const text = displayText(plan.price?.display)
  if (text) return normalizeMoneyText(text)
  if (typeof plan.price?.amount === "number") {
    return planPriceText(plan.price.amount, plan.price.interval)
  }
  if (hasPaygPricing(plan)) return "Billed Monthly"
  return "Free"
}

function itemCost(item: AutumnPlanItem) {
  const feature = featureId(item)
  if (isTrackedFeature(feature)) {
    const price = featurePriceText(feature, item)
    if (price) return price
  }

  const text = displayText(item.display) || displayText(item.price?.display)
  if (text) return normalizeMoneyText(text)

  if (typeof item.price?.amount !== "number") return null

  const units = item.price.billingUnits ?? item.price.billing_units ?? 1
  return rawPriceText(item.price.amount, item.price.interval, units)
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

function buildUsageOverageStatus(features: BillingUsageFeature[]): BillingOverageStatus {
  const threshold = evaluateResourceThresholds(features)
  const suspended_creation = [...threshold.at_limit_resources, ...threshold.over_limit_resources].map((item) => item.id)
  return {
    is_over_limit: threshold.should_freeze_editing,
    editing_frozen: threshold.should_freeze_editing,
    overages: threshold.over_limit_resources,
    suspended_creation,
  }
}

export async function getBillingUsageStatus(userId: string, options: BillingUsageStatusOptions = {}): Promise<BillingUsageStatus> {
  const syncResources = options.syncResources ?? true
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
      overage: emptyBillingOverageStatus(),
    }
  }

  await getOrCreateAutumnCustomer(userId)
  if (syncResources) {
    await reconcileAutumnResourceUsage(userId, undefined, { counts, ensureCustomer: false }).catch((error) => {
      const message = error instanceof Error ? error.message : String(error)
      console.warn(`[autumn] failed to reconcile resource usage during billing status load: ${message}`)
    })
  }
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
      name: hasPaygPricing(plan) ? "Pay as you go" : (plan.name ?? plan.id ?? "Current plan"),
      cost: planCost(plan),
    })),
    features,
    overage: buildUsageOverageStatus(features),
  }
}
