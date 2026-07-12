// What would a target plan do to the user's current usage?
// This file previews plan switches and maps current counts through the shared threshold rules.

import {
  attachAutumnPlan,
  getAutumnCustomer,
  getOrCreateAutumnCustomer,
  isAutumnConfigured,
  listAutumnPlans,
} from "./autumnClient"
import { activeEntityCounts } from "./storageUsage"
import { normalizeBillingPlanOptions, resourceAtLimits, resourceOverages, type BillingPlanOption, type PlanAction } from "./planOptions"
import { activePlanIds } from "./subscriptionStatus"
import type { BillingOverageItem } from "./resourceThresholds"
import { reconcileAutumnResourcesAfterMutation, RESOURCE_FEATURES } from "./resourceUsage"

export type BillingPlansResponse = {
  customer_id: string
  plans: BillingPlanOption[]
}

export type BillingPlanImpact = {
  target_plan_id: string
  target_plan_name: string
  action: PlanAction
  blocking_overages: BillingOverageItem[]
  at_limit_resources: BillingOverageItem["id"][]
  will_freeze_editing: boolean
}

export type BillingPlanSwitchResponse = {
  customer_id: string
  payment_url: string | null
}

async function configuredPlans(userId: string) {
  if (!isAutumnConfigured()) return []
  await getOrCreateAutumnCustomer(userId)
  const response = await listAutumnPlans(userId)
  const active = new Set(activePlanIds(await getAutumnCustomer(userId)))
  return normalizeBillingPlanOptions(response?.list ?? [], active)
}

function targetPlan(plans: BillingPlanOption[], targetPlanId: string) {
  return plans.find((plan) => plan.id === targetPlanId) ?? null
}

export async function getBillingPlans(userId: string): Promise<BillingPlansResponse> {
  return {
    customer_id: userId,
    plans: await configuredPlans(userId),
  }
}

export async function previewBillingPlanImpact(userId: string, targetPlanId: string): Promise<BillingPlanImpact | null> {
  const plans = await configuredPlans(userId)
  const plan = targetPlan(plans, targetPlanId)
  if (!plan) return null
  const counts = await activeEntityCounts(userId)
  const blockingOverages = resourceOverages(plan, counts)
  // Exact-cap resources are not blocking on their own, but the confirm modal
  // needs them so it can explain the post-switch creation freeze alongside any
  // true overages.
  const atLimitResources = resourceAtLimits(plan, counts)
  return {
    target_plan_id: plan.id,
    target_plan_name: plan.name,
    action: plan.action,
    blocking_overages: blockingOverages,
    at_limit_resources: atLimitResources.map((item) => item.id),
    will_freeze_editing: blockingOverages.length > 0,
  }
}

export async function switchBillingPlan(userId: string, targetPlanId: string): Promise<BillingPlanSwitchResponse | null> {
  const plans = await configuredPlans(userId)
  if (!targetPlan(plans, targetPlanId)) return null
  const response = await attachAutumnPlan(userId, targetPlanId)
  if (!response) throw new Error("Autumn did not complete the plan change")
  const result = {
    customer_id: response?.customer_id ?? response?.customerId ?? userId,
    payment_url: response?.payment_url ?? response?.paymentUrl ?? response?.url ?? null,
  }
  // Checkout has not changed the active plan yet. Immediate switches can safely
  // reconcile now; checkout switches reconcile on the first post-payment usage load.
  if (!result.payment_url) await reconcileAutumnResourcesAfterMutation(userId, RESOURCE_FEATURES)
  return result
}
