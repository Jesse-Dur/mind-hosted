import type { BillingPlans, BillingUsage, HistoryEvent } from "../types"

export const HISTORY_CACHE_KEY = "history"
export const BILLING_USAGE_CACHE_KEY = "billing-usage"
export const BILLING_PLANS_CACHE_KEY = "billing-plans"

export type HistoryCacheRecord = {
  key: typeof HISTORY_CACHE_KEY
  historyEvents: HistoryEvent[]
  historyNextCursor: string | null
  historyHasMore: boolean
  updatedAt: number
}

export type BillingUsageCacheRecord = {
  key: typeof BILLING_USAGE_CACHE_KEY
  billingUsage: BillingUsage
  updatedAt: number
}

export type BillingPlansCacheRecord = {
  key: typeof BILLING_PLANS_CACHE_KEY
  billingPlans: BillingPlans
  updatedAt: number
}

export type QueryCacheRecord = HistoryCacheRecord | BillingUsageCacheRecord | BillingPlansCacheRecord
