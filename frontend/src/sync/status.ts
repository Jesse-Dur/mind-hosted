import { syncDb } from "./localDb"
import type { OutboxRecord, SyncActivityRecord, SyncEntityStatus, SyncEntityType } from "./types"
import { activityFromOutbox } from "./activity"

const SYNCED_VISIBLE_MS = 3000
const listeners = new Set<() => void>()
const recentlySynced = new Map<string, number>()

export function syncEntityKey(entityType: SyncEntityType, clientId: string) {
  return `${entityType}:${clientId}`
}

export function subscribeSyncStatus(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function notifySyncStatusChanged() {
  for (const listener of listeners) listener()
}

export function markSyncAcknowledged(entityType: SyncEntityType, clientId: string) {
  const key = syncEntityKey(entityType, clientId)
  const expiresAt = Date.now() + SYNCED_VISIBLE_MS
  recentlySynced.set(key, expiresAt)
  notifySyncStatusChanged()
  window.setTimeout(() => {
    if (recentlySynced.get(key) !== expiresAt) return
    recentlySynced.delete(key)
    notifySyncStatusChanged()
  }, SYNCED_VISIBLE_MS)
}

function statusFromOutbox(record: OutboxRecord): SyncEntityStatus {
  const state = record.status === "error"
    ? "error"
    : record.status === "local_only"
      ? "local_only"
      : "pending"
  return {
    key: syncEntityKey(record.entityType, record.clientId),
    entityType: record.entityType,
    clientId: record.clientId,
    state,
    opId: record.opId,
    action: record.action,
    error: record.error ?? null,
    updatedAt: record.updatedAt,
  }
}

export async function readSyncStatuses() {
  const now = Date.now()
  const records = await syncDb.outbox.toArray()
  const statuses = new Map<string, SyncEntityStatus>()
  const selected = new Map<string, OutboxRecord>()
  const priority = (record: OutboxRecord) => record.status === "error" ? 3 : record.status === "local_only" ? 2 : 1
  for (const record of records) {
    const key = syncEntityKey(record.entityType, record.clientId)
    const current = selected.get(key)
    if (!current || priority(record) > priority(current) || priority(record) === priority(current) && record.createdAt < current.createdAt) selected.set(key, record)
  }
  for (const [key, record] of selected) statuses.set(key, statusFromOutbox(record))
  for (const [key, expiresAt] of recentlySynced) {
    if (expiresAt <= now) {
      recentlySynced.delete(key)
      continue
    }
    if (statuses.has(key)) continue
    const separator = key.indexOf(":")
    const entityType = key.slice(0, separator) as SyncEntityType
    const clientId = key.slice(separator + 1)
    statuses.set(key, {
      key,
      entityType,
      clientId,
      state: "synced",
      opId: null,
      action: null,
      error: null,
      updatedAt: expiresAt - SYNCED_VISIBLE_MS,
    })
  }
  return statuses
}

export async function readSyncActivity(): Promise<SyncActivityRecord[]> {
  await syncDb.transaction("rw", syncDb.outbox, syncDb.syncActivity, async () => {
    const operations = await syncDb.outbox.toArray()
    const existing = await syncDb.syncActivity.bulkGet(operations.map((operation) => operation.opId))
    const missing = operations.flatMap((operation, index) => existing[index] ? [] : [activityFromOutbox(operation)])
    if (missing.length > 0) await syncDb.syncActivity.bulkPut(missing)
  })
  const activity = await syncDb.syncActivity.orderBy("updatedAt").reverse().toArray()
  return activity.filter((record) => !record.hidden)
}
