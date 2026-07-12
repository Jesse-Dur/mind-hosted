import { getAuth } from "@clerk/hono"
import { getBillingPlans, previewBillingPlanImpact, switchBillingPlan } from "../billing/planComparison"
import { getBillingUsageStatus } from "../billing/usageStatus"
import { createBillingRoute } from "./billingRouteFactory"

export const billingRoute = createBillingRoute({
  authenticatedUserId: (context) => getAuth(context)?.userId ?? null,
  getBillingPlans,
  previewBillingPlanImpact,
  switchBillingPlan,
  getBillingUsageStatus,
})
