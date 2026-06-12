import type { Canvas, Tag, Thought, Tile } from "../types"
import { payloadForEntity } from "./entities"
import { entityKey, serverClientId } from "./ids"
import { syncDb } from "./localDb"
import type { LocalEntityRecord, SyncEntity, SyncEntityType, SyncSnapshotResponse } from "./types"

export type SnapshotChangeIds = {
  tileIds: number[]
  thoughtIds: number[]
}

function isCanvas(entity: SyncEntity): entity is Canvas {
  return "is_favourite" in entity
}

function isTile(entity: SyncEntity): entity is Tile {
  return "width" in entity && "height" in entity
}

function isThought(entity: SyncEntity): entity is Thought {
  return "tile_id" in entity
}

function isTag(entity: SyncEntity): entity is Tag {
  return "color" in entity && !("content" in entity)
}

function canvasIdForRecord(record: LocalEntityRecord) {
  if (record.entityType === "canvas") return record.data.id
  if (record.entityType === "tile" && isTile(record.data)) return record.data.canvas_id
  return record.canvasId
}

async function pendingOutboxFor(clientId: string) {
  return syncDb.outbox.where("clientId").equals(clientId).and((record) => record.status !== "error").first()
}

async function findLocalServerRecord(entityType: SyncEntityType, serverId: number) {
  return syncDb.entities
    .where("[entityType+serverId]")
    .equals([entityType, serverId])
    .first()
}

async function findLocalIncomingRecord(entityType: SyncEntityType, entity: SyncEntity) {
  const clientId = entity.client_id ?? serverClientId(entityType, entity.id)
  return syncDb.entities.get(entityKey(entityType, clientId)) ?? findLocalServerRecord(entityType, entity.id)
}

function payloadChanged(entityType: SyncEntityType, existing: SyncEntity, incoming: SyncEntity) {
  return JSON.stringify(payloadForEntity(entityType, existing)) !== JSON.stringify(payloadForEntity(entityType, incoming))
}

async function changedIdsForSnapshotEntities(entityType: "tile", entities: Tile[]): Promise<number[]>
async function changedIdsForSnapshotEntities(entityType: "thought", entities: Thought[]): Promise<number[]>
async function changedIdsForSnapshotEntities(entityType: "tile" | "thought", entities: Array<Tile | Thought>) {
  const changedIds: number[] = []
  for (const entity of entities) {
    const existing = await findLocalIncomingRecord(entityType, entity)
    if (!existing) {
      changedIds.push(entity.id)
      continue
    }
    if (await pendingOutboxFor(existing.clientId)) continue
    if (payloadChanged(entityType, existing.data, entity)) changedIds.push(entity.id)
  }
  return changedIds
}

async function snapshotChangeIds(snapshot: SyncSnapshotResponse): Promise<SnapshotChangeIds> {
  const [tileIds, thoughtIds] = await Promise.all([
    changedIdsForSnapshotEntities("tile", snapshot.tiles),
    changedIdsForSnapshotEntities("thought", snapshot.thoughts),
  ])
  return { tileIds, thoughtIds }
}

async function renameCachedThoughtTags(oldName: string, newName: string) {
  if (oldName === newName) return
  const thoughtRecords = await syncDb.entities.where("entityType").equals("thought").toArray()
  await Promise.all(thoughtRecords.map((record) => {
    if (!isThought(record.data) || !record.data.tags.includes(oldName)) return Promise.resolve()
    return syncDb.entities.put({
      ...record,
      data: { ...record.data, tags: record.data.tags.map((tag) => tag === oldName ? newName : tag) },
      updatedAt: Date.now(),
    })
  }))
}

export async function cacheServerEntity(entityType: SyncEntityType, entity: SyncEntity, preserveDirty = true) {
  const serverClient = serverClientId(entityType, entity.id)
  const clientId = entity.client_id ?? serverClient
  const key = entityKey(entityType, clientId)
  const existing = await syncDb.entities.get(key) ?? await findLocalServerRecord(entityType, entity.id)
  const dirty = existing ? await pendingOutboxFor(existing.clientId) : null
  const data = preserveDirty && dirty && existing ? existing.data : { ...entity, client_id: clientId }
  if (entityType === "tag" && !dirty && existing && isTag(existing.data) && isTag(entity)) {
    await renameCachedThoughtTags(existing.data.name, entity.name)
  }
  const record: LocalEntityRecord = {
    key,
    entityType,
    clientId,
    serverId: entity.id,
    tempId: existing?.tempId ?? null,
    canvasId: canvasIdForRecord({
      key,
      entityType,
      clientId,
      serverId: entity.id,
      tempId: existing?.tempId ?? null,
      canvasId: existing?.canvasId ?? null,
      status: "clean",
      data,
      updatedAt: Date.now(),
    }),
    status: preserveDirty && dirty ? "dirty" : "clean",
    data,
    updatedAt: Date.now(),
  }
  if (existing && existing.key !== key) await syncDb.entities.delete(existing.key)
  await syncDb.entities.put(record)
  return record
}

export async function cacheServerEntities(entityType: SyncEntityType, entities: SyncEntity[]) {
  await Promise.all(entities.map((entity) => cacheServerEntity(entityType, entity)))
}

async function deleteCleanMissingRecords(entityType: SyncEntityType, presentServerIds: Set<number>, includeRecord: (record: LocalEntityRecord) => boolean) {
  const records = await syncDb.entities.where("entityType").equals(entityType).toArray()
  await Promise.all(records.map(async (record) => {
    if (!includeRecord(record) || record.serverId === null || presentServerIds.has(record.serverId)) return
    if (await pendingOutboxFor(record.clientId)) return
    await syncDb.entities.delete(record.key)
  }))
}

async function reconcileSnapshot(snapshot: SyncSnapshotResponse) {
  const serverCanvasIds = new Set(snapshot.canvases.map((canvas) => Number(canvas.id)))
  const serverTagIds = new Set(snapshot.tags.map((tag) => Number(tag.id)))
  await Promise.all([
    deleteCleanMissingRecords("canvas", serverCanvasIds, () => true),
    deleteCleanMissingRecords("tag", serverTagIds, () => true),
  ])

  const canvasId = snapshot.active_canvas_id
  if (canvasId === null) return
  const serverTileIds = new Set(snapshot.tiles.map((tile) => Number(tile.id)))
  const serverThoughtIds = new Set(snapshot.thoughts.map((thought) => Number(thought.id)))
  const localTileRecords = await syncDb.entities.where("entityType").equals("tile").toArray()
  const localCanvasTileIds = new Set(localTileRecords
    .map((record) => record.data)
    .filter(isTile)
    .filter((tile) => tile.canvas_id === canvasId)
    .map((tile) => tile.id))

  await Promise.all([
    deleteCleanMissingRecords("tile", serverTileIds, (record) => isTile(record.data) && record.data.canvas_id === canvasId),
    deleteCleanMissingRecords("thought", serverThoughtIds, (record) => isThought(record.data) && localCanvasTileIds.has(record.data.tile_id)),
  ])
}

export async function cacheSyncSnapshot(snapshot: SyncSnapshotResponse): Promise<SnapshotChangeIds> {
  const changedIds = await snapshotChangeIds(snapshot)
  await reconcileSnapshot(snapshot)
  await Promise.all([
    cacheServerEntities("canvas", snapshot.canvases),
    cacheServerEntities("tag", snapshot.tags),
    cacheServerEntities("tile", snapshot.tiles),
    cacheServerEntities("thought", snapshot.thoughts),
  ])
  return changedIds
}

export async function cachedCanvases() {
  const records = await syncDb.entities.where("entityType").equals("canvas").and((record) => record.status !== "deleted").toArray()
  return records
    .map((record) => record.data)
    .filter(isCanvas)
    .sort((a, b) => Number(b.is_favourite) - Number(a.is_favourite) || a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at))
}

export async function cachedTiles(canvasId: number) {
  const records = await syncDb.entities.where("entityType").equals("tile").and((record) => record.status !== "deleted").toArray()
  return records
    .map((record) => record.data)
    .filter(isTile)
    .filter((tile) => tile.canvas_id === canvasId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
}

export async function cachedThoughtsForCanvas(canvasId: number) {
  const [tileRecords, thoughtRecords] = await Promise.all([
    syncDb.entities.where("entityType").equals("tile").and((record) => record.status !== "deleted").toArray(),
    syncDb.entities.where("entityType").equals("thought").and((record) => record.status !== "deleted").toArray(),
  ])
  const tileIds = new Set(tileRecords.map((record) => record.data).filter(isTile).filter((tile) => tile.canvas_id === canvasId).map((tile) => tile.id))
  return thoughtRecords
    .map((record) => record.data)
    .filter(isThought)
    .filter((thought) => tileIds.has(thought.tile_id))
    .sort((a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at))
}

export async function cachedTags() {
  const records = await syncDb.entities.where("entityType").equals("tag").and((record) => record.status !== "deleted").toArray()
  return records
    .map((record) => record.data)
    .filter((entity): entity is Tag => "color" in entity && !("content" in entity))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export async function metadataNumber(key: string) {
  const value = (await syncDb.metadata.get(key))?.value
  return typeof value === "number" ? value : 0
}

export async function setMetadataNumber(key: string, value: number) {
  await syncDb.metadata.put({ key, value })
}
