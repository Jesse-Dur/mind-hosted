import { isThought, isTile } from "./entityPayload"
import { syncDb } from "./localDb"
import type { OutboxRecord, SyncEntityType, SyncPayload } from "./types"

async function serverIdForTemp(entityType: SyncEntityType, tempId: number) {
  const record = await syncDb.entities
    .where("[entityType+tempId]")
    .equals([entityType, tempId])
    .first()
  return record?.serverId ?? null
}

export async function resolvePayload(record: OutboxRecord) {
  const payload: SyncPayload = { ...record.payload }
  if (record.entityType === "tile" && typeof payload.canvas_id === "number" && payload.canvas_id < 0) {
    const serverId = await serverIdForTemp("canvas", payload.canvas_id)
    if (serverId === null) return null
    payload.canvas_id = serverId
  }
  if (record.entityType === "thought" && typeof payload.tile_id === "number" && payload.tile_id < 0) {
    const serverId = await serverIdForTemp("tile", payload.tile_id)
    if (serverId === null) return null
    payload.tile_id = serverId
  }
  if (record.entityType === "canvas" && typeof payload.targetCanvasId === "number" && payload.targetCanvasId < 0) {
    const serverId = await serverIdForTemp("canvas", payload.targetCanvasId)
    if (serverId === null) return null
    payload.targetCanvasId = serverId
  }
  return payload
}

export async function adoptLocalReferences(entityType: SyncEntityType, tempId: number, serverId: number) {
  if (entityType === "canvas") {
    const tileRecords = await syncDb.entities.where("entityType").equals("tile").toArray()
    await Promise.all(tileRecords.map((record) => {
      if (!isTile(record.data) || record.data.canvas_id !== tempId) return Promise.resolve()
      return syncDb.entities.put({
        ...record,
        canvasId: serverId,
        data: { ...record.data, canvas_id: serverId },
        updatedAt: Date.now(),
      })
    }))
  }

  if (entityType === "tile") {
    const thoughtRecords = await syncDb.entities.where("entityType").equals("thought").toArray()
    await Promise.all(thoughtRecords.map((record) => {
      if (!isThought(record.data) || record.data.tile_id !== tempId) return Promise.resolve()
      return syncDb.entities.put({
        ...record,
        data: { ...record.data, tile_id: serverId },
        updatedAt: Date.now(),
      })
    }))
  }

  const outbox = await syncDb.outbox.toArray()
  await Promise.all(outbox.map((record) => {
    const payload: SyncPayload = { ...record.payload }
    let changed = false
    if (entityType === "canvas" && payload.canvas_id === tempId) {
      payload.canvas_id = serverId
      changed = true
    }
    if (entityType === "canvas" && payload.targetCanvasId === tempId) {
      payload.targetCanvasId = serverId
      changed = true
    }
    if (entityType === "tile" && payload.tile_id === tempId) {
      payload.tile_id = serverId
      changed = true
    }
    return changed
      ? syncDb.outbox.put({ ...record, payload, updatedAt: Date.now() })
      : Promise.resolve()
  }))
}
