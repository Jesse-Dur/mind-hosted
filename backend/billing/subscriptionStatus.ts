import type { AutumnCustomerPlanRef, AutumnCustomerResponse } from "./autumnClient"

function normalizeStatus(ref: AutumnCustomerPlanRef) {
  return ref.status?.toLowerCase()
}

// Autumn keeps `past_due` subscriptions in a recoverable state while payment retry is in flight.
// We treat that status as active access until Autumn moves it to a different terminal state.
export function isActiveSubscriptionRef(ref: AutumnCustomerPlanRef) {
  const status = normalizeStatus(ref)
  return status === undefined || status === "active" || status === "past_due"
}

export function activePlanIds(customer: AutumnCustomerResponse | null | undefined) {
  const refs = [...(customer?.subscriptions ?? []), ...(customer?.purchases ?? [])]
  return [...new Set(
    refs
      .filter(isActiveSubscriptionRef)
      .map((ref) => ref.planId ?? ref.plan_id ?? null)
      .filter((id): id is string => typeof id === "string" && id.length > 0),
  )]
}
