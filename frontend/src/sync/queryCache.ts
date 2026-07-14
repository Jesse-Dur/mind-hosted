// This file owns durable caches for non-entity query results such as history and billing.
import type { BillingPlans, BillingUsage, HistoryEvent } from "../types"
import { syncDb } from "./localDb"
import type { QueryCacheRecord } from "./queryCacheTypes"
import { BILLING_PLANS_CACHE_KEY, BILLING_USAGE_CACHE_KEY, HISTORY_CACHE_KEY } from "./queryCacheTypes"

async function readRecord<Key extends QueryCacheRecord["key"]>(key: Key): Promise<Extract<QueryCacheRecord, { key: Key }> | null> {
  return await syncDb.queryCache.get(key) as Extract<QueryCacheRecord, { key: Key }> | null
}

async function writeRecord(record: QueryCacheRecord) {
  await syncDb.queryCache.put(record)
}

export async function readHistoryCache() {
  const record = await readRecord(HISTORY_CACHE_KEY)
  if (!record) return null
  return {
    historyEvents: record.historyEvents,
    historyNextCursor: record.historyNextCursor,
    historyHasMore: record.historyHasMore,
  }
}

export async function writeHistoryCache(data: { historyEvents: HistoryEvent[]; historyNextCursor: string | null; historyHasMore: boolean }) {
  await writeRecord({
    key: HISTORY_CACHE_KEY,
    historyEvents: data.historyEvents,
    historyNextCursor: data.historyNextCursor,
    historyHasMore: data.historyHasMore,
    updatedAt: Date.now(),
  })
}

export async function readBillingUsageCache() {
  const record = await readRecord(BILLING_USAGE_CACHE_KEY)
  return record?.billingUsage ?? null
}

export async function writeBillingUsageCache(billingUsage: BillingUsage) {
  await writeRecord({
    key: BILLING_USAGE_CACHE_KEY,
    billingUsage,
    updatedAt: Date.now(),
  })
}

export async function readBillingPlansCache() {
  const record = await readRecord(BILLING_PLANS_CACHE_KEY)
  return record?.billingPlans ?? null
}

export async function writeBillingPlansCache(billingPlans: BillingPlans) {
  await writeRecord({
    key: BILLING_PLANS_CACHE_KEY,
    billingPlans,
    updatedAt: Date.now(),
  })
}
