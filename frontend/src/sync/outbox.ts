import { clientIdOf, markEntityDeleted, payloadForEntity, upsertEntityRecord } from "./entities"
import { scheduleFlush } from "./flush"
import { createOperationId } from "./ids"
import { syncDb } from "./localDb"
import type { OutboxRecord, SyncEntity, SyncEntityType, SyncPayload } from "./types"
import { notifySyncStatusChanged } from "./status"
import { cachePastEntity } from "./pastCache"
import { markEntityWrite } from "./entityWriteFence"
import { activityFromOutbox } from "./activity"
import { assertSyncAccountScopeCurrent, runSyncAccountTask } from "./accountScope"

async function saveOutbox(record: Omit<OutboxRecord, "status" | "attemptCount" | "nextAttemptAt" | "createdAt" | "updatedAt">) {
  await syncDb.transaction("rw", syncDb.outbox, syncDb.syncActivity, async () => {
    const existing = await syncDb.outbox.where("clientId").equals(record.clientId).toArray()
    const previous = [...existing].sort((left, right) => right.createdAt - left.createdAt)[0]
    const now = Math.max(Date.now(), ...existing.map((operation) => operation.createdAt + 1))
    const inheritedStatus = previous?.status === "local_only"
      ? "local_only"
      : previous?.status === "error"
        ? "error"
        : "pending"
    const next: OutboxRecord = {
      ...record,
      status: inheritedStatus,
      attemptCount: 0,
      nextAttemptAt: 0,
      createdAt: now,
      updatedAt: now,
      error: inheritedStatus === "error" ? previous?.error : undefined,
    }
    await syncDb.outbox.put(next)
    // Hidden rows are lightweight acknowledgement markers for grouped sibling
    // writes. They keep our own pull events from replaying stale intermediate
    // geometry without adding internal implementation work to History.
    await syncDb.syncActivity.put(activityFromOutbox(next))
  })
  notifySyncStatusChanged()
}

export function enqueueUpsert(entityType: SyncEntityType, entity: SyncEntity, options: { recordHistory?: boolean } = {}) {
  // This must happen before the first IndexedDB await. It prevents a snapshot
  // that was already in flight from briefly replacing the optimistic edit.
  markEntityWrite(entityType, clientIdOf(entityType, entity))
  return runSyncAccountTask(async (scope) => {
    const { record, beforeData } = await upsertEntityRecord(entityType, entity, "dirty")
    assertSyncAccountScopeCurrent(scope)
    await saveOutbox({
      opId: createOperationId(entityType, record.clientId, "upsert"),
      entityType,
      action: "upsert",
      clientId: record.clientId,
      serverId: record.serverId,
      payload: payloadForEntity(entityType, record.data),
      beforeData,
      recordHistory: options.recordHistory,
    })
    assertSyncAccountScopeCurrent(scope)
    scheduleFlush()
  })
}

export function enqueueDelete(entityType: SyncEntityType, entity: SyncEntity, payload: SyncPayload = {}, options: { recordHistory?: boolean } = {}) {
  const clientId = clientIdOf(entityType, entity)
  markEntityWrite(entityType, clientId)
  return runSyncAccountTask(async (scope) => {
    const existing = await markEntityDeleted(entityType, entity)
    assertSyncAccountScopeCurrent(scope)
    await cachePastEntity(entityType, existing?.data ?? entity)
    assertSyncAccountScopeCurrent(scope)
    await saveOutbox({
      opId: createOperationId(entityType, clientId, "delete"),
      entityType,
      action: "delete",
      clientId,
      serverId: existing?.serverId ?? (entity.id > 0 ? entity.id : null),
      payload,
      beforeData: existing?.data ?? entity,
      recordHistory: options.recordHistory,
    })
    assertSyncAccountScopeCurrent(scope)
    scheduleFlush()
  })
}
