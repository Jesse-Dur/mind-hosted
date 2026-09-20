// This file owns durable caches for non-entity query results such as history and billing.
import type { BillingPlans, BillingUsage, HistoryEvent, Thought, Tile } from "../types"
import { syncDb } from "./localDb"
import type { PastEntitiesCacheRecord, QueryCacheRecord } from "./queryCacheTypes"
import { BILLING_PLANS_CACHE_KEY, BILLING_USAGE_CACHE_KEY, HISTORY_CACHE_KEY, PAST_ENTITIES_CACHE_KEY } from "./queryCacheTypes"

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

export async function readPastEntitiesCache() {
  const record = await readRecord(PAST_ENTITIES_CACHE_KEY)
  const live = await syncDb.entities
    .where("entityType")
    .anyOf(["tile", "thought"])
    .and((entity) => entity.status !== "deleted")
    .toArray()
  const liveIdentities = new Set(live.flatMap((entity) => entityIdentityTokens(entity.data as Tile | Thought)))
  const pastTiles = mergePastEntities(
    record?.serverPastTiles ?? record?.pastTiles ?? [],
    record?.optimisticPastTiles ?? [],
  ).filter((entity) => !hasEntityIdentity(liveIdentities, entity))
  const pastThoughts = mergePastEntities(
    record?.serverPastThoughts ?? record?.pastThoughts ?? [],
    record?.optimisticPastThoughts ?? [],
  ).filter((entity) => !hasEntityIdentity(liveIdentities, entity))
  return {
    pastTiles,
    pastThoughts,
  }
}

function entityIdentityTokens(entity: Tile | Thought) {
  return [`server:${entity.id}`, ...(entity.client_id ? [`client:${entity.client_id}`] : [])]
}

function hasEntityIdentity(identities: Set<string>, entity: Tile | Thought) {
  return entityIdentityTokens(entity).some((identity) => identities.has(identity))
}

function mergePastEntities<Entity extends Tile | Thought>(incoming: Entity[], current: Entity[]) {
  const seen = new Set<string>()
  return [...incoming, ...current].filter((entity) => {
    const identities = entityIdentityTokens(entity)
    if (identities.some((identity) => seen.has(identity))) return false
    for (const identity of identities) seen.add(identity)
    return true
  })
}

function emptyPastRecord(current: PastEntitiesCacheRecord | null): PastEntitiesCacheRecord {
  return {
    key: PAST_ENTITIES_CACHE_KEY,
    serverPastTiles: current?.serverPastTiles ?? current?.pastTiles ?? [],
    serverPastThoughts: current?.serverPastThoughts ?? current?.pastThoughts ?? [],
    optimisticPastTiles: current?.optimisticPastTiles ?? [],
    optimisticPastThoughts: current?.optimisticPastThoughts ?? [],
    updatedAt: Date.now(),
  }
}

export async function cacheOptimisticPastEntity(data: { pastTiles?: Tile[]; pastThoughts?: Thought[] }) {
  await syncDb.transaction("rw", syncDb.queryCache, async () => {
    const current = await readRecord(PAST_ENTITIES_CACHE_KEY)
    const next = emptyPastRecord(current)
    await writeRecord({
      ...next,
      optimisticPastTiles: mergePastEntities(data.pastTiles ?? [], next.optimisticPastTiles),
      optimisticPastThoughts: mergePastEntities(data.pastThoughts ?? [], next.optimisticPastThoughts),
      updatedAt: Date.now(),
    })
  })
}

export async function replaceServerPastEntitiesCache(data: { pastTiles: Tile[]; pastThoughts: Thought[] }) {
  await syncDb.transaction("rw", syncDb.queryCache, async () => {
    const current = await readRecord(PAST_ENTITIES_CACHE_KEY)
    const next = emptyPastRecord(current)
    await writeRecord({ ...next, serverPastTiles: data.pastTiles, serverPastThoughts: data.pastThoughts, updatedAt: Date.now() })
  })
}

export async function evictPastEntitiesCache(entities: Array<Tile | Thought>) {
  if (entities.length === 0) return
  await syncDb.transaction("rw", syncDb.queryCache, async () => {
    const current = await readRecord(PAST_ENTITIES_CACHE_KEY)
    if (!current) return
    const next = emptyPastRecord(current)
    const identities = new Set(entities.flatMap(entityIdentityTokens))
    await writeRecord({
      ...next,
      serverPastTiles: next.serverPastTiles.filter((candidate) => !hasEntityIdentity(identities, candidate)),
      serverPastThoughts: next.serverPastThoughts.filter((candidate) => !hasEntityIdentity(identities, candidate)),
      optimisticPastTiles: next.optimisticPastTiles.filter((candidate) => !hasEntityIdentity(identities, candidate)),
      optimisticPastThoughts: next.optimisticPastThoughts.filter((candidate) => !hasEntityIdentity(identities, candidate)),
      updatedAt: Date.now(),
    })
  })
}

export async function evictPastEntityCache(entity: Tile | Thought) {
  await evictPastEntitiesCache([entity])
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

export async function clearQueryCache() {
  await Promise.all([
    syncDb.queryCache.delete(HISTORY_CACHE_KEY),
    syncDb.queryCache.delete(BILLING_USAGE_CACHE_KEY),
    syncDb.queryCache.delete(BILLING_PLANS_CACHE_KEY),
    syncDb.queryCache.delete(PAST_ENTITIES_CACHE_KEY),
  ])
}
