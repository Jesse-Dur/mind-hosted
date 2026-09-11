import Dexie, { type Table } from "dexie"
import type { LocalEntityRecord, MetadataRecord, OutboxRecord, SyncActivityRecord } from "./types"
import type { QueryCacheRecord } from "./queryCacheTypes"
import { invalidateSyncAccount, prepareSyncAccount } from "./accountScope"
import { activityFromOutbox } from "./activity"

const LEGACY_DB_NAME = "mind-sync"
const ACCOUNT_DB_PREFIX = "mind-sync-account-"
const OWNER_METADATA_KEY = "account-owner"
const LEGACY_MIGRATION_METADATA_KEY = "legacy-migration-complete"
const ACCOUNT_MIGRATION_LOCK = "mind-sync-account-migration"

export class MindSyncDb extends Dexie {
  entities!: Table<LocalEntityRecord, string>
  outbox!: Table<OutboxRecord, string>
  metadata!: Table<MetadataRecord, string>
  queryCache!: Table<QueryCacheRecord, QueryCacheRecord["key"]>
  syncActivity!: Table<SyncActivityRecord, string>

  constructor(name = LEGACY_DB_NAME) {
    super(name)
    this.version(2).stores({
      entities: "key, entityType, clientId, serverId, tempId, canvasId, status, updatedAt, [entityType+serverId], [entityType+tempId]",
      outbox: "opId, entityType, clientId, serverId, status, nextAttemptAt, updatedAt",
      metadata: "key",
      queryCache: "key, updatedAt",
    })
    this.version(3).stores({
      entities: "key, entityType, clientId, serverId, tempId, canvasId, status, syncDisposition, updatedAt, [entityType+serverId], [entityType+tempId]",
      outbox: "opId, entityType, clientId, serverId, status, nextAttemptAt, updatedAt",
      metadata: "key",
      queryCache: "key, updatedAt",
    })
    this.version(4).stores({
      entities: "key, entityType, clientId, serverId, tempId, canvasId, status, syncDisposition, updatedAt, [entityType+serverId], [entityType+tempId]",
      outbox: "opId, entityType, clientId, serverId, status, nextAttemptAt, updatedAt",
      metadata: "key",
      queryCache: "key, updatedAt",
      syncActivity: "opId, entityType, clientId, state, createdAt, updatedAt",
    })
    this.version(5).stores({
      entities: "key, entityType, clientId, serverId, tempId, canvasId, status, syncDisposition, updatedAt, [entityType+serverId], [entityType+tempId]",
      outbox: "opId, entityType, clientId, serverId, status, nextAttemptAt, updatedAt",
      metadata: "key",
      queryCache: "key, updatedAt",
      syncActivity: "opId, entityType, clientId, state, createdAt, updatedAt",
    }).upgrade(async (transaction) => {
      const outbox = transaction.table<OutboxRecord, string>("outbox")
      const activity = transaction.table<SyncActivityRecord, string>("syncActivity")
      const operations = await outbox.toArray()
      const existing = await activity.bulkGet(operations.map((operation) => operation.opId))
      const missing = operations.flatMap((operation, index) => existing[index] ? [] : [activityFromOutbox(operation)])
      if (missing.length > 0) await activity.bulkPut(missing)
    })
  }
}

type BrowserLockManager = {
  request<T>(name: string, callback: () => T | Promise<T>): Promise<T>
}

function browserLockManager() {
  if (typeof navigator === "undefined" || !("locks" in navigator)) return null
  return (navigator as Navigator & { locks: BrowserLockManager }).locks
}

function accountDbName(userId: string) {
  return `${ACCOUNT_DB_PREFIX}${encodeURIComponent(userId)}`
}

async function copyLegacyDatabase(legacy: MindSyncDb, target: MindSyncDb, userId: string) {
  const migrationComplete = await target.metadata.get(LEGACY_MIGRATION_METADATA_KEY)
  if (migrationComplete?.value === true) return

  const [entities, outbox, metadata, queryCache, syncActivity] = await Promise.all([
    legacy.entities.toArray(),
    legacy.outbox.toArray(),
    legacy.metadata.toArray(),
    legacy.queryCache.toArray(),
    legacy.syncActivity.toArray(),
  ])

  await target.transaction("rw", [target.entities, target.outbox, target.metadata, target.queryCache, target.syncActivity], async () => {
    if (entities.length > 0) await target.entities.bulkPut(entities)
    if (outbox.length > 0) await target.outbox.bulkPut(outbox)
    if (queryCache.length > 0) await target.queryCache.bulkPut(queryCache)
    if (syncActivity.length > 0) await target.syncActivity.bulkPut(syncActivity)
    if (metadata.length > 0) {
      await target.metadata.bulkPut(metadata.filter((record) => record.key !== OWNER_METADATA_KEY && record.key !== LEGACY_MIGRATION_METADATA_KEY))
    }
    await target.metadata.bulkPut([
      { key: OWNER_METADATA_KEY, value: userId },
      { key: LEGACY_MIGRATION_METADATA_KEY, value: true },
    ])
  })
}

async function configureAccountDatabaseUnlocked(userId: string) {
  const name = accountDbName(userId)
  await prepareSyncAccount(userId)
  if (syncDb.name === name && syncDb.isOpen()) return syncDb

  const target = new MindSyncDb(name)
  try {
    await target.open()
    const owner = await target.metadata.get(OWNER_METADATA_KEY)
    if (owner && owner.value !== userId) throw new Error("Local account database ownership mismatch")

    if (await Dexie.exists(LEGACY_DB_NAME)) {
      const legacy = new MindSyncDb(LEGACY_DB_NAME)
      await legacy.open()
      await copyLegacyDatabase(legacy, target, userId)
      legacy.close()
      await Dexie.delete(LEGACY_DB_NAME)
    } else if (!owner) {
      await target.metadata.bulkPut([
        { key: OWNER_METADATA_KEY, value: userId },
        { key: LEGACY_MIGRATION_METADATA_KEY, value: true },
      ])
    }

    syncDb.close()
    syncDb = target
    activeSyncUserId = userId
    return syncDb
  } catch (error) {
    target.close()
    invalidateSyncAccount()
    throw error
  }
}

let activeSyncUserId: string | null = null
export let syncDb = new MindSyncDb()

export async function configureAccountDatabase(userId: string) {
  if (!userId) throw new Error("Cannot configure local storage without an authenticated user")
  const locks = browserLockManager()
  return locks
    ? locks.request(ACCOUNT_MIGRATION_LOCK, () => configureAccountDatabaseUnlocked(userId))
    : configureAccountDatabaseUnlocked(userId)
}

export function getActiveSyncUserId() {
  return activeSyncUserId
}

export function closeAccountDatabase() {
  invalidateSyncAccount()
  syncDb.close()
  activeSyncUserId = null
}

export async function clearActiveAccountDatabase() {
  const userId = activeSyncUserId
  if (!userId) return
  const name = accountDbName(userId)
  syncDb.close()
  await Dexie.delete(name)
  syncDb = new MindSyncDb(name)
  await syncDb.open()
  await syncDb.metadata.bulkPut([
    { key: OWNER_METADATA_KEY, value: userId },
    { key: LEGACY_MIGRATION_METADATA_KEY, value: true },
  ])
}

export async function deleteAccountDatabase(userId: string) {
  const name = accountDbName(userId)
  if (syncDb.name === name) {
    invalidateSyncAccount()
    syncDb.close()
    activeSyncUserId = null
  }
  await Dexie.delete(name)
}

export const localDbNames = {
  legacy: LEGACY_DB_NAME,
  account: accountDbName,
}
