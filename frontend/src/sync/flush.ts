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

const MAX_RETRY_MS = 60000
const STALE_FLUSH_MS = 120000
const SYNC_FLUSH_LOCK = "mind-sync-flush"

type BrowserLockManager = {
  request<T>(name: string, callback: () => T | Promise<T>): Promise<T>
}

let flushTimer: number | null = null
let flushing = false

function browserLockManager() {
  return "locks" in navigator ? (navigator as Navigator & { locks: BrowserLockManager }).locks : null
}

function backoff(attempt: number) {
  const base = Math.min(MAX_RETRY_MS, 1000 * 2 ** Math.min(attempt, 6))
  return base + Math.floor(Math.random() * 750)
}

export function scheduleFlush(delay = 0) {
  if (flushTimer !== null) window.clearTimeout(flushTimer)
  flushTimer = window.setTimeout(() => {
    flushTimer = null
    flushSyncQueue().catch(console.error)
  }, delay)
}

async function newerPendingOperation(record: OutboxRecord) {
  return syncDb.outbox
    .where("clientId")
    .equals(record.clientId)
    .and((item) => item.opId !== record.opId && item.status !== "error")
    .first()
}

async function updatePendingServerIds(record: OutboxRecord, serverId: number) {
  const pending = await syncDb.outbox
    .where("clientId")
    .equals(record.clientId)
    .and((item) => item.opId !== record.opId && item.status !== "error")
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
  await syncDb.outbox.put({
    ...record,
    status: "pending",
    attemptCount,
    nextAttemptAt: Date.now() + backoff(attemptCount),
    updatedAt: Date.now(),
    error: message,
  })
}

async function pauseForAuth(record: OutboxRecord) {
  // Auth expiry is not a data failure. Keep the operation ready so the next
  // valid Clerk session can flush it without adding retry penalty or error UI.
  await syncDb.outbox.put({
    ...record,
    status: "pending",
    nextAttemptAt: Date.now(),
    updatedAt: Date.now(),
  })
}

async function applyPushResult(record: OutboxRecord, resultEntity: SyncEntity | undefined, serverId: number | null) {
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
    await syncDb.entities.put({ ...localRecord, serverId, tempId: null, status: "clean", updatedAt: Date.now() })
    await updatePendingServerIds(record, serverId)
  }
  await syncDb.outbox.delete(record.opId)
}

async function flushRecord(record: OutboxRecord) {
  const payload = await resolvePayload(record)
  if (payload === null) return
  const operation: SyncPushOperation = {
    op_id: record.opId,
    entity_type: record.entityType,
    action: record.action,
    client_id: record.clientId,
    server_id: record.serverId,
    payload,
  }
  await syncDb.outbox.put({ ...record, status: "flushing", updatedAt: Date.now() })
  const response = await getApi().sync.push([operation])
  const result = response.results[0]
  if (!result) throw new Error("Missing sync result")
  if (!result.ok) {
    const resource = result.code === "billing_editing_frozen"
      ? result.error ?? "Sync rejected"
      : result.code === "autumn_access_denied" && result.feature_id
      ? `${result.error ?? "Sync rejected"} (${result.feature_id})`
      : result.error ?? "Sync rejected"
    await syncDb.outbox.put({ ...record, status: "error", error: resource, updatedAt: Date.now() })
    return
  }
  const entity = result.entity ? entityFromPayload(record.entityType, result.entity as unknown as SyncPayload) : undefined
  await applyPushResult(record, entity ?? undefined, result.server_id)
  scheduleFlush()
}

async function runFlushSyncQueue() {
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
        await flushRecord(record)
      } catch (error) {
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

export async function flushSyncQueue() {
  const locks = browserLockManager()
  // The outbox lives in IndexedDB, so multiple app tabs can see it. A browser
  // lock keeps one tab responsible for pushing at a time when the API exists.
  if (locks) {
    await locks.request(SYNC_FLUSH_LOCK, runFlushSyncQueue)
    return
  }
  await runFlushSyncQueue()
}
