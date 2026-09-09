import type { Canvas, Tag, Thought, Tile } from "../types"
import { payloadForEntity } from "./entities"
import { entityKey, serverClientId } from "./ids"
import { syncDb } from "./localDb"
import type { LocalEntityRecord, SyncEntity, SyncEntityType, SyncSnapshotResponse } from "./types"
import { captureEntityWriteGeneration, entityWasWrittenAfter, markEntityWrite } from "./entityWriteFence"
import { evictPastEntitiesCache, evictPastEntityCache } from "./queryCache"
import { assertSyncAccountScopeCurrent, runSyncAccountTask } from "./accountScope"

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
  // Errors and intentionally local-only edits are still authoritative local
  // work. A pull must never overwrite them before the user resolves them.
  return syncDb.outbox.where("clientId").equals(clientId).first()
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

async function changedIdsForSnapshotEntities(entityType: "tile", entities: Tile[], snapshotGeneration: number): Promise<number[]>
async function changedIdsForSnapshotEntities(entityType: "thought", entities: Thought[], snapshotGeneration: number): Promise<number[]>
async function changedIdsForSnapshotEntities(entityType: "tile" | "thought", entities: Array<Tile | Thought>, snapshotGeneration: number) {
  const changedIds: number[] = []
  for (const entity of entities) {
    const existing = await findLocalIncomingRecord(entityType, entity)
    if (!existing) {
      changedIds.push(entity.id)
      continue
    }
    if (entityWasWrittenAfter(entityType, existing.clientId, snapshotGeneration)) continue
    if (await pendingOutboxFor(existing.clientId)) continue
    if (entityWasWrittenAfter(entityType, existing.clientId, snapshotGeneration)) continue
    if (payloadChanged(entityType, existing.data, entity)) changedIds.push(entity.id)
  }
  return changedIds
}

async function snapshotChangeIds(snapshot: SyncSnapshotResponse, snapshotGeneration: number): Promise<SnapshotChangeIds> {
  const [tileIds, thoughtIds] = await Promise.all([
    changedIdsForSnapshotEntities("tile", snapshot.tiles, snapshotGeneration),
    changedIdsForSnapshotEntities("thought", snapshot.thoughts, snapshotGeneration),
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

export function removeLocalThoughtTag(tagName: string) {
  return runSyncAccountTask(async (scope) => {
    const thoughtRecords = await syncDb.entities.where("entityType").equals("thought").toArray()
    assertSyncAccountScopeCurrent(scope)
    await Promise.all(thoughtRecords.map(async (record) => {
      if (!isThought(record.data) || !record.data.tags.includes(tagName)) return Promise.resolve()
      // Thought tags are stored by name, so removing the tag definition must also
      // clean durable edits so a later offline flush cannot restore the label.
      const pendingOperations = await syncDb.outbox.where("clientId").equals(record.clientId).toArray()
      await Promise.all([
        syncDb.entities.put({
          ...record,
          data: { ...record.data, tags: record.data.tags.filter((tag) => tag !== tagName) },
          updatedAt: Date.now(),
        }),
        ...pendingOperations.map((operation) => {
          if (operation.entityType !== "thought" || operation.action !== "upsert" || !Array.isArray(operation.payload.tags)) return Promise.resolve()
          return syncDb.outbox.put({
            ...operation,
            payload: { ...operation.payload, tags: operation.payload.tags.filter((tag) => tag !== tagName) },
            updatedAt: Date.now(),
          })
        }),
      ])
    }))
    assertSyncAccountScopeCurrent(scope)
  })
}

export function cacheServerEntity(entityType: SyncEntityType, entity: SyncEntity, preserveDirty?: boolean): Promise<LocalEntityRecord>
export function cacheServerEntity(entityType: SyncEntityType, entity: SyncEntity, preserveDirty: boolean, snapshotGeneration: number): Promise<LocalEntityRecord | undefined>
export function cacheServerEntity(entityType: SyncEntityType, entity: SyncEntity, preserveDirty: boolean, snapshotGeneration: number, evictFromPast: boolean): Promise<LocalEntityRecord | undefined>
export async function cacheServerEntity(entityType: SyncEntityType, entity: SyncEntity, preserveDirty = true, snapshotGeneration?: number, evictFromPast = true) {
  const serverClient = serverClientId(entityType, entity.id)
  const clientId = entity.client_id ?? serverClient
  if (snapshotGeneration === undefined) markEntityWrite(entityType, clientId)
  const key = entityKey(entityType, clientId)
  const existing = await syncDb.entities.get(key) ?? await findLocalServerRecord(entityType, entity.id)
  const existingClientId = existing?.clientId ?? clientId
  if (snapshotGeneration !== undefined && entityWasWrittenAfter(entityType, existingClientId, snapshotGeneration)) return existing
  const dirty = existing ? await pendingOutboxFor(existing.clientId) : null
  if (snapshotGeneration !== undefined && entityWasWrittenAfter(entityType, existingClientId, snapshotGeneration)) return existing
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
    confirmedData: { ...entity, client_id: clientId },
    syncDisposition: preserveDirty && dirty ? existing?.syncDisposition ?? "normal" : "normal",
    lastSyncedAt: Date.now(),
    updatedAt: Date.now(),
  }
  if (snapshotGeneration !== undefined && entityWasWrittenAfter(entityType, existingClientId, snapshotGeneration)) return existing
  if (existing && existing.key !== key) await syncDb.entities.delete(existing.key)
  await syncDb.entities.put(record)
  if (evictFromPast && (entityType === "tile" || entityType === "thought")) await evictPastEntityCache(record.data as Tile | Thought)
  return record
}

export async function cacheServerEntities(entityType: SyncEntityType, entities: SyncEntity[], snapshotGeneration: number) {
  await Promise.all(entities.map((entity) => cacheServerEntity(entityType, entity, true, snapshotGeneration, false)))
}

async function deleteCleanMissingRecords(entityType: SyncEntityType, presentServerIds: Set<number>, includeRecord: (record: LocalEntityRecord) => boolean, snapshotGeneration: number) {
  const records = await syncDb.entities.where("entityType").equals(entityType).toArray()
  await Promise.all(records.map(async (record) => {
    if (!includeRecord(record) || record.serverId === null || presentServerIds.has(record.serverId)) return
    if (entityWasWrittenAfter(entityType, record.clientId, snapshotGeneration)) return
    if (await pendingOutboxFor(record.clientId)) return
    if (entityWasWrittenAfter(entityType, record.clientId, snapshotGeneration)) return
    await syncDb.entities.delete(record.key)
  }))
}

async function reconcileSnapshot(snapshot: SyncSnapshotResponse, snapshotGeneration: number) {
  const serverCanvasIds = new Set(snapshot.canvases.map((canvas) => Number(canvas.id)))
  const serverTagIds = new Set(snapshot.tags.map((tag) => Number(tag.id)))
  await Promise.all([
    deleteCleanMissingRecords("canvas", serverCanvasIds, () => true, snapshotGeneration),
    deleteCleanMissingRecords("tag", serverTagIds, () => true, snapshotGeneration),
  ])

  const canvasId = snapshot.active_canvas_id
  if (canvasId === null) return
  const serverTileIds = new Set(snapshot.tiles.map((tile) => Number(tile.id)))
  const serverThoughtIds = new Set(snapshot.thoughts.map((thought) => Number(thought.id)))
  const localTileRecords = await syncDb.entities.where("entityType").equals("tile").toArray()
  const localCanvasTileRecords = localTileRecords
    .filter((record): record is LocalEntityRecord => isTile(record.data) && record.data.canvas_id === canvasId)
  const localCanvasTileIds = new Set(localCanvasTileRecords.map((record) => record.data.id))
  const localCanvasTileRecordsById = new Map(localCanvasTileRecords.map((record) => [record.data.id, record]))

  await Promise.all([
    deleteCleanMissingRecords("tile", serverTileIds, (record) => isTile(record.data) && record.data.canvas_id === canvasId, snapshotGeneration),
    syncDb.entities.where("entityType").equals("thought").toArray().then(async (records) => {
      await Promise.all(records.map(async (record) => {
        if (!isThought(record.data) || !localCanvasTileIds.has(record.data.tile_id)) return
        if (record.serverId === null || serverThoughtIds.has(record.serverId)) return
        if (entityWasWrittenAfter("thought", record.clientId, snapshotGeneration)) return
        // A stale snapshot can arrive before a moved tile's write is fully
        // reflected server-side. Keep its thoughts until the tile sync settles.
        const parentTile = localCanvasTileRecordsById.get(record.data.tile_id)
        if (parentTile && entityWasWrittenAfter("tile", parentTile.clientId, snapshotGeneration)) return
        if (parentTile && await pendingOutboxFor(parentTile.clientId)) return
        if (await pendingOutboxFor(record.clientId)) return
        if (entityWasWrittenAfter("thought", record.clientId, snapshotGeneration)) return
        await syncDb.entities.delete(record.key)
      }))
    }),
  ])
}

export async function cacheSyncSnapshot(snapshot: SyncSnapshotResponse, snapshotGeneration = captureEntityWriteGeneration()): Promise<SnapshotChangeIds> {
  const changedIds = await snapshotChangeIds(snapshot, snapshotGeneration)
  await reconcileSnapshot(snapshot, snapshotGeneration)
  await Promise.all([
    cacheServerEntities("canvas", snapshot.canvases, snapshotGeneration),
    cacheServerEntities("tag", snapshot.tags, snapshotGeneration),
    cacheServerEntities("tile", snapshot.tiles, snapshotGeneration),
    cacheServerEntities("thought", snapshot.thoughts, snapshotGeneration),
  ])
  await evictPastEntitiesCache([...snapshot.tiles, ...snapshot.thoughts])
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

export async function cachedWorkspaceForSearch() {
  const [tileRecords, thoughtRecords] = await Promise.all([
    syncDb.entities.where("entityType").equals("tile").and((record) => record.status !== "deleted").toArray(),
    syncDb.entities.where("entityType").equals("thought").and((record) => record.status !== "deleted").toArray(),
  ])
  const tiles = tileRecords.map((record) => record.data).filter(isTile)
  const tileIds = new Set(tiles.map((tile) => tile.id))
  const thoughts = thoughtRecords
    .map((record) => record.data)
    .filter(isThought)
    .filter((thought) => tileIds.has(thought.tile_id))
  return { tiles, thoughts }
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
