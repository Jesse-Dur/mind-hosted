import { syncDb } from "./localDb"
import type { OutboxRecord, SyncActivityRecord, SyncEntityStatus, SyncEntityType } from "./types"
import { currentSyncAccountScope, isSyncAccountScopeCurrent, type SyncAccountScope } from "./accountScope"

const SYNCED_VISIBLE_MS = 3000
const listeners = new Set<() => void>()
const recentlySynced = new Map<string, number>()
let lastAcknowledged: { scope: SyncAccountScope; at: number } | null = null

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

export function lastSyncAcknowledgedAt() {
  return lastAcknowledged && lastAcknowledged.scope === currentSyncAccountScope()
    && isSyncAccountScopeCurrent(lastAcknowledged.scope) ? lastAcknowledged.at : 0
}

export function markSyncAcknowledged(entityType: SyncEntityType, clientId: string, recordHistory = true) {
  const key = syncEntityKey(entityType, clientId)
  const now = Date.now()
  const expiresAt = now + SYNCED_VISIBLE_MS
  const scope = currentSyncAccountScope()
  // Entity attention states can hide the brief synced badge. History still
  // needs to refresh for a visible acknowledgement outside its loaded pages.
  if (recordHistory && scope && isSyncAccountScopeCurrent(scope)) lastAcknowledged = { scope, at: now }
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

export const SYNC_ACTIVITY_PAGE_SIZE = 200

export async function readSyncActivityPage(limit = SYNC_ACTIVITY_PAGE_SIZE, historyOpIds: string[] = []) {
  // Hidden acknowledgement markers have no historyCreatedAt index entry. Keep
  // them durable without scanning them to fill each visible History page.
  return syncDb.transaction("r", syncDb.syncActivity, async () => {
    const [recent, unresolved, linked] = await Promise.all([
      syncDb.syncActivity.orderBy("historyCreatedAt").reverse().limit(limit + 1).toArray(),
      syncDb.syncActivity.where("state").anyOf(["pending", "error", "local_only"]).toArray(),
      syncDb.syncActivity.bulkGet(historyOpIds),
    ])
    const records = new Map<string, SyncActivityRecord>()
    for (const record of [...recent.slice(0, limit), ...unresolved, ...linked]) {
      if (record && !record.hidden) records.set(record.opId, record)
    }
    return { activity: [...records.values()], hasMore: recent.length > limit }
  })
}

export async function readSyncActivity(): Promise<SyncActivityRecord[]> {
  return (await readSyncActivityPage()).activity
}
