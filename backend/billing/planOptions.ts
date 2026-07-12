// How do Autumn plans get normalized into the app's plan cards and copy?
// This file formats plan metadata; it should not own billing policy rules.

import type { AutumnCustomerEligibility, AutumnPlanItem, AutumnPlanResponse } from "./autumnClient"
import { autumnFeatures, type AutumnFeature } from "./features"
import { displayText, featurePriceText, normalizeMoneyText, planPriceText, rawPriceText } from "./priceDisplay"
import { evaluateResourceThresholds, type BillingOverageItem } from "./resourceThresholds"

type ResourceFeature = "canvases" | "tiles" | "thoughts"
export type PlanAction = "current" | "scheduled" | "subscribe" | "upgrade" | "downgrade" | "unavailable"
type ResourceCounts = Record<ResourceFeature, number>

type PlanFeature = {
  id: AutumnFeature
  label: string
  unit: string
  limit: number | null
  unlimited: boolean
  display: string
  cost: string | null
}

export type BillingPlanOption = {
  id: string
  name: string
  description: string | null
  cost: string
  action: PlanAction
  features: PlanFeature[]
}

const RESOURCE_FEATURES = new Set<AutumnFeature>([
  autumnFeatures.canvases,
  autumnFeatures.tiles,
  autumnFeatures.thoughts,
])

const FEATURE_LABELS = {
  [autumnFeatures.canvases]: { label: "Canvases", unit: "canvases" },
  [autumnFeatures.tiles]: { label: "Tiles", unit: "tiles" },
  [autumnFeatures.thoughts]: { label: "Thoughts", unit: "thoughts" },
  [autumnFeatures.storage]: { label: "Storage", unit: "MB" },
  [autumnFeatures.aiProcessingRequests]: { label: "AI requests", unit: "requests" },
  [autumnFeatures.transcriptionSeconds]: { label: "Transcription", unit: "seconds" },
} as const satisfies Record<AutumnFeature, { label: string; unit: string }>

function planIds() {
  return [
    process.env.AUTUMN_FREE_PLAN_ID ?? "free",
    process.env.AUTUMN_PRO_PLAN_ID ?? "pro",
    process.env.AUTUMN_UNLIMITED_PLAN_ID ?? "unlimited",
  ]
}

function itemPriceCost(item: AutumnPlanItem) {
  const text = displayText(item.price?.display)
  if (text) return normalizeMoneyText(text)

  if (typeof item.price?.amount !== "number") return null
  return rawPriceText(item.price.amount, item.price.interval, item.price.billingUnits ?? item.price.billing_units ?? 1)
}

function planCost(plan: AutumnPlanResponse) {
  const text = displayText(plan.price?.display)
  if (text) return normalizeMoneyText(text)
  if (typeof plan.price?.amount === "number") {
    return planPriceText(plan.price.amount, plan.price.interval)
  }
  if ((plan.items ?? []).some((item) => itemPriceCost(item) !== null)) return "Billed Monthly"
  return "Free"
}

function itemCost(item: AutumnPlanItem) {
  const feature = featureId(item)
  if (isTrackedFeature(feature)) {
    const price = featurePriceText(feature, item)
    if (price) return price
  }

  return itemPriceCost(item) ?? (displayText(item.display) || null)
}

function featureId(item: AutumnPlanItem) {
  return item.featureId ?? item.feature_id ?? null
}

function isTrackedFeature(value: string | null): value is AutumnFeature {
  return Object.values(autumnFeatures).some((feature) => feature === value)
}

function includedLimit(item: AutumnPlanItem) {
  if (item.unlimited === true) return null
  return typeof item.included === "number" && item.included > 0 ? item.included : 0
}

function formatLimit(item: AutumnPlanItem, id: AutumnFeature) {
  if (item.unlimited === true) return `Unlimited ${FEATURE_LABELS[id].unit}`
  const cost = itemCost(item)
  if ((item.included ?? 0) === 0 && cost) return cost
  const limit = includedLimit(item)
  return `${limit ?? 0} ${FEATURE_LABELS[id].unit}`
}

function shouldShowFeature(plan: AutumnPlanResponse, feature: AutumnFeature) {
  // Storage is only shown on PAYG plans because it is billed as metered usage
  // there; smaller plans should compare resource limits, not storage caps.
  if (feature !== autumnFeatures.storage) return true
  return plan.id === (process.env.AUTUMN_UNLIMITED_PLAN_ID ?? "unlimited")
}

function normalizeEligibility(plan: AutumnPlanResponse): AutumnCustomerEligibility | null {
  return plan.customerEligibility ?? plan.customer_eligibility ?? null
}

function planAction(plan: AutumnPlanResponse): PlanAction {
  const eligibility = normalizeEligibility(plan)
  const status = eligibility?.status?.toLowerCase()
  if (eligibility?.attachAction === "none" || eligibility?.attach_action === "none") {
    return status === "scheduled" ? "scheduled" : "current"
  }

  const action = eligibility?.attachAction ?? eligibility?.attach_action
  if (action === "activate" || action === "purchase") return "subscribe"
  if (action === "upgrade" || action === "downgrade") return action
  return "subscribe"
}

function normalizePlan(plan: AutumnPlanResponse): BillingPlanOption | null {
  const id = plan.id
  if (!id) return null
  const features: PlanFeature[] = []
  const hasPaygPricing = (plan.items ?? []).some((item) => itemPriceCost(item) !== null)

  for (const item of plan.items ?? []) {
    const feature = featureId(item)
    if (!isTrackedFeature(feature)) continue
    if (!shouldShowFeature(plan, feature)) continue
    const unlimited = item.unlimited === true
    features.push({
      id: feature,
      label: FEATURE_LABELS[feature].label,
      unit: FEATURE_LABELS[feature].unit,
      limit: unlimited ? null : includedLimit(item),
      unlimited,
      display: formatLimit(item, feature),
      cost: itemCost(item),
    })
  }

  return {
    id,
    name: hasPaygPricing ? "Pay as you go" : (plan.name ?? id),
    description: plan.description ?? null,
    cost: planCost(plan),
    action: planAction(plan),
    features,
  }
}

function resourceUsage(counts: ResourceCounts, feature: ResourceFeature) {
  return counts[feature]
}

function resourceThresholds(plan: BillingPlanOption, counts: ResourceCounts) {
  const items = plan.features
    .filter((feature): feature is PlanFeature & { id: ResourceFeature; limit: number } => RESOURCE_FEATURES.has(feature.id) && feature.limit !== null)
    .map((feature) => ({
      id: feature.id,
      label: feature.label,
      used: resourceUsage(counts, feature.id),
      limit: feature.limit,
      unit: feature.unit,
    }))
  return evaluateResourceThresholds(items)
}

export function normalizeBillingPlanOptions(list: AutumnPlanResponse[], active: Set<string> = new Set()) {
  const plans = new Map(list.filter((plan): plan is AutumnPlanResponse & { id: string } => typeof plan.id === "string").map((plan) => [plan.id, plan]))

  return planIds().map((id) => {
    const plan = plans.get(id)
    if (!plan) return null
    const normalized = normalizePlan(plan)
    if (!normalized) return null
    // Autumn eligibility is preferred, but active-plan data covers older customers
    // or API responses that omit customerEligibility.
    return active.has(id) ? { ...normalized, action: "current" as const } : normalized
  }).filter((plan): plan is BillingPlanOption => plan !== null)
}

export function resourceOverages(plan: BillingPlanOption, counts: ResourceCounts): BillingOverageItem[] {
  return resourceThresholds(plan, counts).over_limit_resources
}

export function resourceAtLimits(plan: BillingPlanOption, counts: ResourceCounts): BillingOverageItem[] {
  return resourceThresholds(plan, counts).at_limit_resources
}
