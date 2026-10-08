import { getApi } from "../store/apiAuth"
import { cacheServerEntity, confirmDeletedContents, metadataNumber, moveLocalCanvasContents, removeLocalThoughtTag, renameCachedThoughtTags } from "./cache"
import { entityFromPayload, positiveIntegerField } from "./entityPayload"
import { getEntityRecord, payloadForEntity } from "./entities"
import { entityKey, serverClientId } from "./ids"
import { syncDb } from "./localDb"
import { GLOBAL_REVISION_KEY, canvasRevisionKey } from "./revisions"
import { createRemoteStoreBatch, type RemoteStoreChange } from "./storeBridge"
import type { SyncEntity, SyncEntityType, SyncPullEvent } from "./types"
import { cachePastEntity } from "./pastCache"
import { assertSyncAccountScopeCurrent, runSyncAccountTask } from "./accountScope"
import { advanceRevision, readEntityRevision, writeEntityRevision } from "./entityRevision"
import { markEntityWrite } from "./entityWriteFence"

async function localClientIdForEvent(entityType: SyncEntityType, clientId: string | null, serverId: number | null) {
  if (clientId) return clientId
  if (serverId === null) return null
  const record = await syncDb.entities
    .where("[entityType+serverId]")
    .equals([entityType, serverId])
    .first()
  return record?.clientId ?? null
}

async function hasPendingLocal(entityType: SyncEntityType, clientId: string | null, serverId: number | null) {
  const localClientId = await localClientIdForEvent(entityType, clientId, serverId)
  if (!localClientId) return false
  return Boolean(await syncDb.outbox.where("clientId").equals(localClientId).first())
}

async function localRecordForRemoteEntity(entityType: SyncEntityType, entity: SyncEntity) {
  const clientId = entity.client_id ?? null
  if (clientId) {
    const record = await getEntityRecord(entityType, clientId)
    if (record) return record
  }
  return syncDb.entities
    .where("[entityType+serverId]")
    .equals([entityType, entity.id])
    .first()
}

async function shouldAnimateRemoteEntity(entityType: SyncEntityType, entity: SyncEntity) {
  if (entityType !== "tile" && entityType !== "thought") return false
  const existing = await localRecordForRemoteEntity(entityType, entity)
  if (!existing) return true
  // If this device already has the final payload, the pull is just confirming
  // its own optimistic write and should stay visually snappy.
  return JSON.stringify(payloadForEntity(entityType, existing.data)) !== JSON.stringify(payloadForEntity(entityType, entity))
}

async function wasAcknowledgedByThisDevice(event: SyncPullEvent) {
  if (!event.op_id) return false
  return (await syncDb.syncActivity.get(event.op_id))?.state === "synced"
}

async function deleteLocalEntity(entityType: SyncEntityType, clientId: string | null, serverId: number | null) {
  const localClientId = await localClientIdForEvent(entityType, clientId, serverId)
    ?? (serverId === null ? null : serverClientId(entityType, serverId))
  if (!localClientId) return
  // Keep a fence after the record is gone so an older snapshot cannot restore it.
  markEntityWrite(entityType, localClientId)
  const key = entityKey(entityType, localClientId)
  const record = await syncDb.entities.get(key)
  if (record) await cachePastEntity(entityType, record.data)
  await syncDb.entities.delete(key)
  return localClientId
}

async function applyPullEvent(event: SyncPullEvent, changes: RemoteStoreChange[]) {
  if (event.revision <= await readEntityRevision(event.entity_type, event.entity_id)) return
  if (event.action === "delete") {
    if (event.entity_type === "canvas") {
      const target = positiveIntegerField(event.data.targetCanvasId)
      if (target !== null) await moveLocalCanvasContents(event.entity_id, target)
      else await confirmDeletedContents("canvas", event.entity_id)
    }
    if (event.entity_type === "tile") await confirmDeletedContents("tile", event.entity_id)
    if (event.entity_type === "tag" && typeof event.data.name === "string") await removeLocalThoughtTag(event.data.name, true)
  }
  const pending = await hasPendingLocal(event.entity_type, event.client_id, event.entity_id)
  if (pending) {
    const clientId = await localClientIdForEvent(event.entity_type, event.client_id, event.entity_id)
    const record = clientId ? await getEntityRecord(event.entity_type, clientId) : undefined
    if (record) {
      markEntityWrite(event.entity_type, record.clientId)
      const confirmedData = event.action === "delete" ? null : entityFromPayload(event.entity_type, event.data)
      if (event.entity_type === "tag" && record.confirmedData && "name" in record.confirmedData && confirmedData && "name" in confirmedData) {
        await renameCachedThoughtTags(record.confirmedData.name, confirmedData.name, undefined, true)
      }
      await syncDb.entities.put({ ...record, confirmedData, lastSyncedAt: Date.now() })
    }
    await writeEntityRevision(event.entity_type, event.entity_id, event.revision)
    return
  }
  if (event.action === "delete") {
    const clientId = await deleteLocalEntity(event.entity_type, event.client_id, event.entity_id)
    if (event.entity_id !== null) changes.push({ entityType: event.entity_type, id: event.entity_id, payload: event.data, clientId: clientId ?? serverClientId(event.entity_type, event.entity_id), revision: event.revision })
    await writeEntityRevision(event.entity_type, event.entity_id, event.revision)
    return
  }
  const entity = entityFromPayload(event.entity_type, event.data)
  if (!entity) return
  const animate = !await wasAcknowledgedByThisDevice(event) && await shouldAnimateRemoteEntity(event.entity_type, entity)
  await cacheServerEntity(event.entity_type, entity)
  changes.push({ entityType: event.entity_type, id: entity.id, entity, animate, clientId: entity.client_id ?? serverClientId(event.entity_type, entity.id), revision: event.revision })
  await writeEntityRevision(event.entity_type, event.entity_id, event.revision)
}

export async function pullSync(canvasId?: number, batch?: ReturnType<typeof createRemoteStoreBatch>) {
  return runSyncAccountTask(async (scope) => {
    const target = batch ?? createRemoteStoreBatch()
    const changes: RemoteStoreChange[] = []
    const key = canvasId === undefined ? GLOBAL_REVISION_KEY : canvasRevisionKey(canvasId)
    const since = await metadataNumber(key)
    assertSyncAccountScopeCurrent(scope)
    const response = await getApi(scope).sync.pull(since, canvasId)
    assertSyncAccountScopeCurrent(scope)
    await syncDb.transaction("rw", syncDb.tables, async () => {
      assertSyncAccountScopeCurrent(scope)
      // Upgrade acknowledgement markers written before revision tracking. Seed
      // the whole batch first so an older remote event cannot undo a local ack.
      const legacy = new Map<string, SyncPullEvent>()
      for (const event of response.events) {
        if (await readEntityRevision(event.entity_type, event.entity_id) || !await wasAcknowledgedByThisDevice(event)) continue
        const identity = `${event.entity_type}:${event.entity_id}`
        if ((legacy.get(identity)?.revision ?? 0) < event.revision) legacy.set(identity, event)
      }
      for (const event of legacy.values()) await writeEntityRevision(event.entity_type, event.entity_id, event.revision)
      for (const event of response.events) await applyPullEvent(event, changes)
      await advanceRevision(key, response.latest_revision)
      assertSyncAccountScopeCurrent(scope)
    })
    assertSyncAccountScopeCurrent(scope)
    target.append(changes)
    if (!batch) await target.publish()
  })
}
