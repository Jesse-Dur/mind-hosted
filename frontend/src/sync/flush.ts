import { getApi } from "../store/apiAuth"
import { isApiUnauthorizedError } from "../api/errors"
import { cacheServerEntity } from "./cache"
import { adoptLocalReferences, resolvePayload } from "./dependencies"
import { entityFromPayload } from "./entityPayload"
import { getEntityRecord } from "./entities"
import { entityKey } from "./ids"
import { syncDb } from "./localDb"
import { adoptServerEntity } from "./storeBridge"
import type { LocalEntityRecord, OutboxRecord, SyncEntity, SyncPayload, SyncPushOperation } from "./types"
import { markSyncAcknowledged, notifySyncStatusChanged } from "./status"
import { markEntityWrite } from "./entityWriteFence"
import { assertSyncAccountScopeCurrent, currentSyncAccountScope, isStaleSyncAccountError, isSyncAccountScopeCurrent, runSyncAccountTask, type SyncAccountScope } from "./accountScope"

const MAX_RETRY_MS = 60000
const STALE_FLUSH_MS = 120000
const SYNC_FLUSH_LOCK = "mind-sync-flush"

type BrowserLockManager = {
  request<T>(name: string, callback: () => T | Promise<T>): Promise<T>
}

let flushTimer: number | null = null
let flushing = false
let currentFlush: Promise<void> | null = null

function browserLockManager() {
  return "locks" in navigator ? (navigator as Navigator & { locks: BrowserLockManager }).locks : null
}

function backoff(attempt: number) {
  const base = Math.min(MAX_RETRY_MS, 1000 * 2 ** Math.min(attempt, 6))
  return base + Math.floor(Math.random() * 750)
}

export function scheduleFlush(delay = 0) {
  if (flushTimer !== null) window.clearTimeout(flushTimer)
  const scope = currentSyncAccountScope()
  flushTimer = window.setTimeout(() => {
    flushTimer = null
    if (!isSyncAccountScopeCurrent(scope)) return
    flushSyncQueue().catch(console.error)
  }, delay)
}

export function cancelScheduledFlush() {
  if (flushTimer === null) return
  window.clearTimeout(flushTimer)
  flushTimer = null
}

async function newerPendingOperation(record: OutboxRecord) {
  return syncDb.outbox
    .where("clientId")
    .equals(record.clientId)
    .and((item) => item.opId !== record.opId && item.createdAt > record.createdAt)
    .first()
}

async function updatePendingServerIds(record: OutboxRecord, serverId: number) {
  const pending = await syncDb.outbox
    .where("clientId")
    .equals(record.clientId)
    .and((item) => item.opId !== record.opId)
    .toArray()
  await Promise.all(pending.map((item) => syncDb.outbox.put({ ...item, serverId, updatedAt: Date.now() })))
}

async function deleteSupersededTagRecord(record: OutboxRecord, localRecord: LocalEntityRecord | undefined, cachedRecord: LocalEntityRecord, pending: OutboxRecord | undefined) {
  if (record.entityType !== "tag" || !localRecord || pending || localRecord.key === cachedRecord.key) return
  // Tag names are unique per user, so an acknowledged create can legitimately
  // resolve to another device's client id. Drop the old optimistic row so reloads
  // do not resurrect a duplicate tag from IndexedDB.
  await syncDb.entities.delete(localRecord.key)
}

async function markRetry(record: OutboxRecord, error: unknown) {
  const attemptCount = record.attemptCount + 1
  const message = error instanceof Error ? error.message : "Sync failed"
  const retryAt = Date.now() + backoff(attemptCount)
  await syncDb.outbox.put({
    ...record,
    status: "pending",
    attemptCount,
    nextAttemptAt: retryAt,
    updatedAt: Date.now(),
    error: message,
  })
  const activity = await syncDb.syncActivity.get(record.opId)
  if (activity) await syncDb.syncActivity.put({ ...activity, state: "pending", error: message, updatedAt: Date.now() })
  notifySyncStatusChanged()
  scheduleFlush(Math.max(0, retryAt - Date.now()))
}

async function pauseForAuth(record: OutboxRecord) {
  // Auth expiry is not a data failure. Keep the operation ready so the next
  // valid Clerk session can flush it without adding retry penalty or error UI.
  await syncDb.outbox.put({
    ...record,
    status: "pending",
    nextAttemptAt: Date.now(),
    updatedAt: Date.now(),
    error: undefined,
  })
  notifySyncStatusChanged()
}

async function applyPushResult(record: OutboxRecord, resultEntity: SyncEntity | undefined, serverId: number | null) {
  // A push acknowledgement is newer than any snapshot that was already in
  // flight, even after this operation's outbox row has been removed.
  markEntityWrite(record.entityType, record.clientId)
  const localRecord = await getEntityRecord(record.entityType, record.clientId)
  const pending = await newerPendingOperation(record)
  if (resultEntity) {
    const acknowledgedEntity = { ...resultEntity, client_id: resultEntity.client_id ?? record.clientId }
    if (localRecord?.tempId !== null && localRecord?.tempId !== undefined) {
      await adoptLocalReferences(record.entityType, localRecord.tempId, acknowledgedEntity.id)
    }
    if (pending && localRecord) {
      const localEntity = { ...localRecord.data, id: acknowledgedEntity.id, client_id: record.clientId }
      await syncDb.entities.put({
        ...localRecord,
        serverId: acknowledgedEntity.id,
        data: localEntity,
        updatedAt: Date.now(),
      })
      await updatePendingServerIds(record, acknowledgedEntity.id)
      if (localRecord.status !== "deleted") adoptServerEntity(record.entityType, localRecord, localEntity)
    } else {
      const cached = await cacheServerEntity(record.entityType, acknowledgedEntity, false)
      await deleteSupersededTagRecord(record, localRecord, cached, pending)
      adoptServerEntity(record.entityType, localRecord, cached.data)
    }
  } else if (record.action === "delete") {
    await syncDb.entities.delete(entityKey(record.entityType, record.clientId))
  } else if (serverId !== null && localRecord) {
    await syncDb.entities.put({
      ...localRecord,
      serverId,
      tempId: null,
      status: "clean",
      confirmedData: localRecord.data,
      syncDisposition: "normal",
      lastSyncedAt: Date.now(),
      updatedAt: Date.now(),
    })
    await updatePendingServerIds(record, serverId)
  }
  await syncDb.outbox.delete(record.opId)
  const activity = await syncDb.syncActivity.get(record.opId)
  if (activity) await syncDb.syncActivity.put({ ...activity, state: "synced", error: null, updatedAt: Date.now() })
  markSyncAcknowledged(record.entityType, record.clientId)
}

async function flushRecord(record: OutboxRecord, scope: SyncAccountScope | null) {
  const payload = await resolvePayload(record)
  if (payload === null) return
  const operation: SyncPushOperation = {
    op_id: record.opId,
    entity_type: record.entityType,
    action: record.action,
    client_id: record.clientId,
    server_id: record.serverId,
    payload,
    write_history: record.recordHistory !== false,
    occurred_at: new Date(record.createdAt).toISOString(),
  }
  await syncDb.outbox.put({ ...record, status: "flushing", updatedAt: Date.now() })
  assertSyncAccountScopeCurrent(scope)
  const response = await getApi(scope).sync.push([operation])
  assertSyncAccountScopeCurrent(scope)
  const result = response.results[0]
  if (!result) throw new Error("Missing sync result")
  if (!result.ok) {
    const resource = result.code === "billing_editing_frozen"
      ? result.error ?? "Sync rejected"
      : result.code === "autumn_access_denied" && result.feature_id
      ? `${result.error ?? "Sync rejected"} (${result.feature_id})`
      : result.error ?? "Sync rejected"
    await syncDb.outbox.put({ ...record, status: "error", error: resource, updatedAt: Date.now() })
    const activity = await syncDb.syncActivity.get(record.opId)
    if (activity) await syncDb.syncActivity.put({ ...activity, state: "error", error: resource, updatedAt: Date.now() })
    notifySyncStatusChanged()
    return
  }
  const entity = result.entity ? entityFromPayload(record.entityType, result.entity as unknown as SyncPayload) : undefined
  await applyPushResult(record, entity ?? undefined, result.server_id)
  scheduleFlush()
}

async function hasEarlierOperation(record: OutboxRecord) {
  return Boolean(await syncDb.outbox
    .where("clientId")
    .equals(record.clientId)
    .and((item) => item.opId !== record.opId && item.createdAt < record.createdAt)
    .first())
}

async function runFlushSyncQueue(scope: SyncAccountScope | null) {
  if (flushing) return
  flushing = true
  try {
    const now = Date.now()
    const staleFlushingBefore = now - STALE_FLUSH_MS
    const records = await syncDb.outbox
      .where("status")
      .anyOf(["pending", "flushing"])
      .and((record) => record.nextAttemptAt <= now && (record.status === "pending" || record.updatedAt < staleFlushingBefore))
      .sortBy("createdAt")
    for (const record of records) {
      try {
        const current = await syncDb.outbox.get(record.opId)
        if (!current || await hasEarlierOperation(current)) continue
        await flushRecord(current, scope)
      } catch (error) {
        if (isStaleSyncAccountError(error)) return
        if (isApiUnauthorizedError(error)) {
          await pauseForAuth(record)
          return
        }
        await markRetry(record, error)
      }
    }
  } finally {
    flushing = false
  }
}

export function flushSyncQueue() {
  if (currentFlush) return currentFlush
  currentFlush = runSyncAccountTask(async (scope) => {
    const locks = browserLockManager()
    // The outbox lives in IndexedDB, so multiple app tabs can see it. A browser
    // lock keeps one tab responsible for pushing at a time when the API exists.
    const lockName = scope ? `${SYNC_FLUSH_LOCK}:${scope.userId}` : SYNC_FLUSH_LOCK
    if (locks) await locks.request(lockName, () => runFlushSyncQueue(scope))
    else await runFlushSyncQueue(scope)
  }).finally(() => { currentFlush = null })
  return currentFlush
}

export async function waitForSyncIdle() {
  if (currentFlush) await currentFlush
}
