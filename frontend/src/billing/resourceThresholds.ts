// How should optimistic local counts affect billing controls before server reconciliation finishes?
// The backend remains authoritative; this mirror keeps delete-based recovery responsive in the UI.

import type { BillingFeatureUsage, BillingOverage, BillingOverageItem } from "../types"

const RESOURCE_IDS = new Set<BillingOverageItem["id"]>(["canvases", "tiles", "thoughts"])

function isResourceFeature(feature: BillingFeatureUsage): feature is BillingFeatureUsage & { id: BillingOverageItem["id"]; limit: number } {
  return RESOURCE_IDS.has(feature.id as BillingOverageItem["id"]) && feature.limit !== null && !feature.unlimited
}

export function billingOverageFromFeatures(features: BillingFeatureUsage[]): BillingOverage {
  const resources = features.filter(isResourceFeature)
  const overages = resources
    .filter((feature) => feature.used > feature.limit)
    .map((feature) => ({
      id: feature.id,
      label: feature.label,
      used: feature.used,
      limit: feature.limit,
      over_by: feature.used - feature.limit,
      unit: feature.unit,
    }))
  const suspendedCreation = resources
    .filter((feature) => feature.used >= feature.limit)
    .map((feature) => feature.id)

  return {
    is_over_limit: overages.length > 0,
    editing_frozen: overages.length > 0,
    overages,
    suspended_creation: suspendedCreation,
  }
}
