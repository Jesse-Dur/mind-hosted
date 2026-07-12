import { clientIdOf, markEntityDeleted, payloadForEntity, upsertEntityRecord } from "./entities"
import { scheduleFlush } from "./flush"
import { createOperationId, entityKey } from "./ids"
import { syncDb } from "./localDb"
import type { OutboxRecord, SyncEntity, SyncEntityType, SyncPayload } from "./types"

async function saveOutbox(record: Omit<OutboxRecord, "status" | "attemptCount" | "nextAttemptAt" | "createdAt" | "updatedAt">) {
  const existing = await syncDb.outbox
    .where("clientId")
    .equals(record.clientId)
    .and((item) => item.action === record.action && item.status !== "error" && item.status !== "flushing")
    .first()
  const now = Date.now()
  const next: OutboxRecord = {
    ...record,
    opId: existing?.opId ?? record.opId,
    status: "pending",
    attemptCount: existing?.attemptCount ?? 0,
    nextAttemptAt: 0,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }
  await syncDb.outbox.put(next)
}

export async function enqueueUpsert(entityType: SyncEntityType, entity: SyncEntity) {
  const record = await upsertEntityRecord(entityType, entity, "dirty")
  await saveOutbox({
    opId: createOperationId(entityType, record.clientId, "upsert"),
    entityType,
    action: "upsert",
    clientId: record.clientId,
    serverId: record.serverId,
    payload: payloadForEntity(entityType, record.data),
  })
  scheduleFlush()
}

export async function enqueueDelete(entityType: SyncEntityType, entity: SyncEntity, payload: SyncPayload = {}) {
  const clientId = clientIdOf(entityType, entity)
  const existing = await markEntityDeleted(entityType, entity)
  const pendingUpserts = await syncDb.outbox.where("clientId").equals(clientId).and((record) => record.action === "upsert").toArray()
  const hasFlushingUpsert = pendingUpserts.some((record) => record.status === "flushing")
  await Promise.all(pendingUpserts
    .filter((record) => record.status !== "flushing")
    .map((record) => syncDb.outbox.delete(record.opId)))
  if (!existing?.serverId && entity.id < 0 && !hasFlushingUpsert) {
    await syncDb.entities.delete(entityKey(entityType, clientId))
    return
  }
  await saveOutbox({
    opId: createOperationId(entityType, clientId, "delete"),
    entityType,
    action: "delete",
    clientId,
    serverId: existing?.serverId ?? (entity.id > 0 ? entity.id : null),
    payload,
  })
  scheduleFlush()
}
