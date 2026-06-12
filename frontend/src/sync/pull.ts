import { getApi } from "../store/apiAuth"
import { cacheServerEntity, metadataNumber, setMetadataNumber } from "./cache"
import { entityFromPayload, isTile, positiveIntegerField } from "./entityPayload"
import { getEntityRecord, payloadForEntity } from "./entities"
import { entityKey } from "./ids"
import { syncDb } from "./localDb"
import { GLOBAL_REVISION_KEY, canvasRevisionKey } from "./revisions"
import { applyRemoteEntity, removeRemoteEntity } from "./storeBridge"
import type { SyncEntity, SyncEntityType, SyncPullEvent } from "./types"

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

async function deleteLocalEntity(entityType: SyncEntityType, clientId: string | null, serverId: number | null) {
  const localClientId = await localClientIdForEvent(entityType, clientId, serverId)
  if (!localClientId) return
  await syncDb.entities.delete(entityKey(entityType, localClientId))
}

async function moveLocalCanvasContents(sourceCanvasId: number | null, targetCanvasId: number | null) {
  if (sourceCanvasId === null || targetCanvasId === null || sourceCanvasId === targetCanvasId) return
  const tileRecords = await syncDb.entities.where("entityType").equals("tile").toArray()
  await Promise.all(tileRecords.map(async (record) => {
    if (!isTile(record.data) || record.data.canvas_id !== sourceCanvasId) return
    // Remote pulls should not rewrite a tile that already has unsynced local work.
    const pending = await syncDb.outbox.where("clientId").equals(record.clientId).first()
    if (pending) return
    await syncDb.entities.put({
      ...record,
      canvasId: targetCanvasId,
      data: { ...record.data, canvas_id: targetCanvasId },
      updatedAt: Date.now(),
    })
  }))
}

async function applyPullEvent(event: SyncPullEvent) {
  if (event.action === "delete") {
    if (await hasPendingLocal(event.entity_type, event.client_id, event.entity_id)) return
    if (event.entity_type === "canvas") {
      await moveLocalCanvasContents(event.entity_id, positiveIntegerField(event.data.targetCanvasId))
    }
    await deleteLocalEntity(event.entity_type, event.client_id, event.entity_id)
    removeRemoteEntity(event.entity_type, event.entity_id, event.data)
    return
  }
  const entity = entityFromPayload(event.entity_type, event.data)
  if (!entity) return
  if (await hasPendingLocal(event.entity_type, entity.client_id ?? null, entity.id)) return
  const animate = await shouldAnimateRemoteEntity(event.entity_type, entity)
  await cacheServerEntity(event.entity_type, entity)
  applyRemoteEntity(event.entity_type, entity, { animate })
}

export async function pullSync(canvasId?: number) {
  const key = canvasId === undefined ? GLOBAL_REVISION_KEY : canvasRevisionKey(canvasId)
  const since = await metadataNumber(key)
  const response = await getApi().sync.pull(since, canvasId)
  for (const event of response.events) await applyPullEvent(event)
  await setMetadataNumber(key, response.latest_revision)
}
