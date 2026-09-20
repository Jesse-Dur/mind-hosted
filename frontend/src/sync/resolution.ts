import { cacheServerEntity } from "./cache"
import { entityKey } from "./ids"
import { syncDb } from "./localDb"
import { applyRemoteEntity, removeRemoteEntity } from "./storeBridge"
import { notifySyncStatusChanged } from "./status"
import { entityFromPayload } from "./entityPayload"
import type { LocalEntityRecord, OutboxRecord, SyncEntity } from "./types"
import { evictPastEntity } from "./pastCache"
import { assertSyncAccountScopeCurrent, runSyncAccountTask } from "./accountScope"

function entityForOperation(record: LocalEntityRecord, operation: OutboxRecord): SyncEntity | null {
  const base = record.confirmedData ?? record.data
  return entityFromPayload(operation.entityType, {
    ...base,
    ...operation.payload,
    id: record.serverId ?? record.tempId ?? base.id,
    client_id: operation.clientId,
    created_at: "created_at" in base ? base.created_at : undefined,
  })
}

async function applyRemainingLocalState(record: LocalEntityRecord, remaining: OutboxRecord[]) {
  const latest = remaining[remaining.length - 1]
  if (!latest) return null
  const localOnly = remaining.some((operation) => operation.status === "local_only")
  if (latest.action === "delete") {
    await syncDb.entities.put({ ...record, status: "deleted", syncDisposition: localOnly ? "local_only" : "normal", updatedAt: Date.now() })
    removeRemoteEntity(record.entityType, record.data.id)
    return record.data
  }
  const entity = entityForOperation(record, latest)
  if (!entity) return null
  const next: LocalEntityRecord = {
    ...record,
    canvasId: latest.entityType === "canvas" ? entity.id : latest.entityType === "tile" && "canvas_id" in entity ? entity.canvas_id : record.canvasId,
    status: "dirty",
    syncDisposition: localOnly ? "local_only" : "normal",
    data: entity,
    updatedAt: Date.now(),
  }
  await syncDb.entities.put(next)
  await evictPastEntity(record.entityType, entity)
  applyRemoteEntity(record.entityType, entity)
  return entity
}

export function retrySyncOperation(opId: string) {
  return runSyncAccountTask(async (scope) => {
  const operation = await syncDb.outbox.get(opId)
  if (!operation) return
  const entity = await syncDb.entities.get(entityKey(operation.entityType, operation.clientId))
  const otherOperations = await syncDb.outbox.where("clientId").equals(operation.clientId).toArray()
  const remainsLocalOnly = otherOperations.some((candidate) => candidate.opId !== opId && candidate.status === "local_only")
  const latestOperation = [...otherOperations].sort((left, right) => right.createdAt - left.createdAt)[0] ?? operation
  await Promise.all([
    syncDb.outbox.put({
      ...operation,
      status: "pending",
      error: undefined,
      nextAttemptAt: 0,
      updatedAt: Date.now(),
    }),
    entity
      ? syncDb.entities.put({ ...entity, syncDisposition: remainsLocalOnly ? "local_only" : "normal", status: latestOperation.action === "delete" ? "deleted" : "dirty", updatedAt: Date.now() })
      : Promise.resolve(),
  ])
  const activity = await syncDb.syncActivity.get(opId)
  if (activity) await syncDb.syncActivity.put({ ...activity, state: "pending", error: null, updatedAt: Date.now() })
  assertSyncAccountScopeCurrent(scope)
  notifySyncStatusChanged()
  })
}

export function keepSyncOperationLocal(opId: string) {
  return runSyncAccountTask(async (scope) => {
  const operation = await syncDb.outbox.get(opId)
  if (!operation) return
  const entity = await syncDb.entities.get(entityKey(operation.entityType, operation.clientId))
  await Promise.all([
    syncDb.outbox.put({ ...operation, status: "local_only", error: undefined, updatedAt: Date.now() }),
    entity
      ? syncDb.entities.put({ ...entity, syncDisposition: "local_only", updatedAt: Date.now() })
      : Promise.resolve(),
  ])
  const activity = await syncDb.syncActivity.get(opId)
  if (activity) await syncDb.syncActivity.put({ ...activity, state: "local_only", error: null, updatedAt: Date.now() })
  assertSyncAccountScopeCurrent(scope)
  notifySyncStatusChanged()
  })
}

export function discardSyncOperation(opId: string) {
  return runSyncAccountTask(async (scope) => {
  const operation = await syncDb.outbox.get(opId)
  if (!operation) return
  const key = entityKey(operation.entityType, operation.clientId)
  const record = await syncDb.entities.get(key)
  const remaining = (await syncDb.outbox.where("clientId").equals(operation.clientId).sortBy("createdAt"))
    .filter((candidate) => candidate.opId !== opId)
  await syncDb.outbox.delete(opId)
  const activity = await syncDb.syncActivity.get(opId)
  if (activity) await syncDb.syncActivity.put({ ...activity, state: "discarded", error: null, updatedAt: Date.now() })

  if (!record) {
    notifySyncStatusChanged()
    return
  }
  if (remaining.length > 0) {
    await applyRemainingLocalState(record, remaining)
  } else if (record.confirmedData) {
    const cached = await cacheServerEntity(operation.entityType, record.confirmedData, false)
    applyRemoteEntity(operation.entityType, cached.data)
  } else {
    await syncDb.entities.delete(key)
    removeRemoteEntity(operation.entityType, record.data.id)
  }
  assertSyncAccountScopeCurrent(scope)
  notifySyncStatusChanged()
  })
}
