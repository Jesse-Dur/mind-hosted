// What does the user's current resource usage mean for billing limits?
// This file classifies resource-backed usage into exact-cap and above-cap states.

type ResourceFeatureId = "canvases" | "tiles" | "thoughts"

export type BillingOverageItem = {
  id: ResourceFeatureId
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

export type ResourceThresholdInput = {
  id: string
  label: string
  used: number
  limit: number | null
  unit: string
}

export type ResourceThresholdResult = {
  at_limit_resources: BillingOverageItem[]
  over_limit_resources: BillingOverageItem[]
  should_freeze_editing: boolean
}

const RESOURCE_FEATURES = new Set<ResourceFeatureId>(["canvases", "tiles", "thoughts"])

function isResourceFeature(id: string): id is ResourceFeatureId {
  return RESOURCE_FEATURES.has(id as ResourceFeatureId)
}

export function emptyBillingOverageStatus(): BillingOverageStatus {
  return {
    is_over_limit: false,
    editing_frozen: false,
    overages: [],
    suspended_creation: [],
  }
}

export function evaluateResourceThresholds(features: readonly ResourceThresholdInput[]): ResourceThresholdResult {
  const atLimitResources = features
    .filter((feature): feature is ResourceThresholdInput & { id: ResourceFeatureId; limit: number } => {
      return isResourceFeature(feature.id) && feature.limit !== null && feature.used === feature.limit
    })
    .map((feature) => ({
      id: feature.id,
      label: feature.label,
      used: feature.used,
      limit: feature.limit,
      over_by: 0,
      unit: feature.unit,
    }))

  const overLimitResources = features
    .filter((feature): feature is ResourceThresholdInput & { id: ResourceFeatureId; limit: number } => {
      return isResourceFeature(feature.id) && feature.limit !== null && feature.used > feature.limit
    })
    .map((feature) => ({
      id: feature.id,
      label: feature.label,
      used: feature.used,
      limit: feature.limit,
      over_by: feature.used - feature.limit,
      unit: feature.unit,
    }))

  return {
    at_limit_resources: atLimitResources,
    over_limit_resources: overLimitResources,
    should_freeze_editing: overLimitResources.length > 0,
  }
}
