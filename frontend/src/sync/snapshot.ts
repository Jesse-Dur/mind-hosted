import type { Canvas, Tag, Thought, Tile } from "../types"
import { getApi } from "../store/apiAuth"
import { cacheSyncSnapshot, cachedCanvases, cachedTags, cachedThoughtsForCanvas, cachedTiles, setMetadataNumber } from "./cache"
import { GLOBAL_REVISION_KEY, canvasRevisionKey } from "./revisions"
import { captureEntityWriteGeneration } from "./entityWriteFence"
import { assertSyncAccountScopeCurrent, currentSyncAccountScope, runSyncAccountTask } from "./accountScope"

export type CachedSnapshot = {
  revision: number
  activeCanvasId: number | null
  canvases: Canvas[]
  tags: Tag[]
  tiles: Tile[]
  thoughts: Thought[]
  changedTileIds: number[]
  changedThoughtIds: number[]
}

const inFlightSnapshots = new Map<string, Promise<CachedSnapshot>>()

function snapshotKey(canvasId: number | null | undefined) {
  const account = currentSyncAccountScope()?.userId ?? "unscoped"
  const canvas = canvasId === null || canvasId === undefined ? "default" : String(canvasId)
  return `${account}:${canvas}`
}

export async function fetchAndCacheSnapshot(canvasId?: number | null): Promise<CachedSnapshot> {
  const key = snapshotKey(canvasId)
  const existing = inFlightSnapshots.get(key)
  if (existing) return existing

  const snapshotGeneration = captureEntityWriteGeneration()
  const request = runSyncAccountTask(async (scope) => {
    const snapshot = await getApi(scope).sync.snapshot(canvasId ?? undefined)
    assertSyncAccountScopeCurrent(scope)
    const changedIds = await cacheSyncSnapshot(snapshot, snapshotGeneration)
    assertSyncAccountScopeCurrent(scope)
    await setMetadataNumber(GLOBAL_REVISION_KEY, snapshot.revision)
    if (snapshot.active_canvas_id !== null) {
      await setMetadataNumber(canvasRevisionKey(snapshot.active_canvas_id), snapshot.revision)
    }
    return {
      revision: snapshot.revision,
      activeCanvasId: snapshot.active_canvas_id,
      canvases: await cachedCanvases(),
      tags: await cachedTags(),
      tiles: snapshot.active_canvas_id === null ? [] : await cachedTiles(snapshot.active_canvas_id),
      thoughts: snapshot.active_canvas_id === null ? [] : await cachedThoughtsForCanvas(snapshot.active_canvas_id),
      changedTileIds: changedIds.tileIds,
      changedThoughtIds: changedIds.thoughtIds,
    }
  }).finally(() => {
    inFlightSnapshots.delete(key)
  })

  inFlightSnapshots.set(key, request)
  return request
}
