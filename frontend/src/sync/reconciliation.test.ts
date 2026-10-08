import { beforeEach, expect, test } from "bun:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { canvas, entityKey, entityRecord, resetFrontendState, syncDb, tag, thought, tile, useStore } from "../test/syncTestHarness"
import { cacheServerEntity, cacheSyncSnapshot, removeLocalThoughtTag } from "./cache"
import { captureEntityWriteGeneration } from "./entityWriteFence"
import { enqueueDelete, enqueueUpsert } from "./outbox"
import { flushSyncQueue } from "./flush"
import { pullSync } from "./pull"
import { discardSyncOperation } from "./resolution"
import { upsertEntityRecord } from "./entities"
import type { SyncPullEvent, SyncPushOperation } from "./types"
import { findMobileGestureTile } from "../utils/mobileTileGesture"
import { optimisticIdentityKey } from "../utils/optimisticIdentity"
import { beginCrossCanvasDrag, endCrossCanvasDrag, getCrossCanvasDrag } from "../utils/crossCanvasDrag"
import { MobileOverview } from "../layout/mobile/MobileOverview"
import { MobileFocusedTile } from "../layout/mobile/MobileFocusedTile"
import { adoptServerEntity } from "./storeBridge"
import { readPastEntitiesCache } from "./pastCache"

const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } })
const localTile = () => syncDb.entities.get(entityKey("tile", "tile-client"))
const event = (revision: number, x: number, opId = `remote-${revision}`, action: "upsert" | "delete" = "upsert"): SyncPullEvent => ({
  revision, canvas_id: 10, entity_type: "tile", entity_id: 20, client_id: "tile-client", op_id: opId,
  action, data: tile({ x }), created_at: "2026-01-01T00:00:00Z",
})

beforeEach(resetFrontendState)

test("an account reset clears private cross-canvas drag previews", () => {
  beginCrossCanvasDrag({ kind: "thought", thought: thought({ content: "Previous account" }), sourceTileId: 20, sourceCanvasId: 10, targetTileId: 20, targetIndex: 0, clientX: 50, clientY: 50, enteredCanvasId: null })
  useStore.getState().resetStore()
  expect(getCrossCanvasDrag()).toBeNull()
})

test("a delayed snapshot cannot restore a tile deleted by a newer pull", async () => {
  await cacheServerEntity("tile", tile(), false)
  const generation = captureEntityWriteGeneration()
  globalThis.fetch = async () => json({ events: [event(2, 0, "remote-delete", "delete")], latest_revision: 2 })
  await pullSync()
  expect(await localTile()).toBeUndefined()

  await cacheSyncSnapshot({ revision: 1, active_canvas_id: 10, canvases: [canvas()], tags: [], tiles: [tile()], thoughts: [] }, generation)
  expect(await localTile()).toBeUndefined()
  expect((await readPastEntitiesCache()).pastTiles.map((item) => item.id)).toEqual([20])
})

test("a delayed snapshot cannot replace a pending edit's newer confirmed baseline", async () => {
  await cacheServerEntity("tile", tile({ x: 0 }), false)
  await enqueueUpsert("tile", tile({ x: 240 }))
  const generation = captureEntityWriteGeneration()
  globalThis.fetch = async () => json({ events: [event(2, 480)], latest_revision: 2 })
  await pullSync()

  await cacheSyncSnapshot({ revision: 1, active_canvas_id: 10, canvases: [canvas()], tags: [], tiles: [tile({ x: 0 })], thoughts: [] }, generation)
  expect((await localTile())?.data).toMatchObject({ x: 240 })
  expect((await localTile())?.confirmedData).toMatchObject({ x: 480 })
})

test.each([false, true])("a remote canvas move protects the child tile's confirmed parent (pending: %s)", async (pending) => {
  await cacheServerEntity("canvas", canvas(), false)
  await cacheServerEntity("canvas", canvas({ id: 11, client_id: "target-canvas" }), false)
  await cacheServerEntity("tile", tile(), false)
  if (pending) await enqueueUpsert("tile", tile({ title: "Local edit" }))
  const generation = captureEntityWriteGeneration()
  globalThis.fetch = async () => json({ events: [{ ...event(2, 0, "delete-canvas", "delete"), entity_type: "canvas", entity_id: 10, client_id: "canvas-client", data: { id: 10, targetCanvasId: 11 } }], latest_revision: 2 })
  await pullSync()
  await cacheSyncSnapshot({ revision: 1, active_canvas_id: 10, canvases: [canvas()], tags: [], tiles: [tile()], thoughts: [] }, generation)
  expect((await localTile())?.confirmedData).toMatchObject({ canvas_id: 11 })
  if (pending) await discardSyncOperation((await syncDb.outbox.toArray())[0]!.opId)
  expect((await localTile())?.data).toMatchObject({ canvas_id: 11 })
})

test.each(["rename", "delete"] as const)("a remote tag %s updates the thought's discard baseline", async (action) => {
  const tagged = thought({ tags: ["old"] })
  const definition = tag({ name: "old" })
  await cacheServerEntity("tile", tile(), false)
  await cacheServerEntity("thought", tagged, false)
  await cacheServerEntity("tag", definition, false)
  await enqueueUpsert("thought", thought({ content: "Local edit", tags: [] }))
  const generation = captureEntityWriteGeneration()
  globalThis.fetch = async () => json({ events: [{ ...event(2, 0, "remote-tag"), entity_type: "tag", entity_id: definition.id, client_id: definition.client_id, action: action === "delete" ? "delete" : "upsert", data: { ...definition, name: action === "delete" ? "old" : "new" } }], latest_revision: 2 })
  await pullSync()
  await cacheSyncSnapshot({ revision: 1, active_canvas_id: 10, canvases: [canvas()], tags: [definition], tiles: [tile()], thoughts: [tagged] }, generation)
  await discardSyncOperation((await syncDb.outbox.toArray())[0]!.opId)
  expect((await syncDb.entities.get(entityKey("thought", "thought-client")))?.data).toMatchObject({ tags: action === "delete" ? [] : ["new"] })
})

test("a tag deletion changes the thought's confirmed baseline only after acknowledgement", async () => {
  const definition = tag({ name: "old" })
  await cacheServerEntity("thought", thought({ tags: ["old"] }), false)
  await cacheServerEntity("tag", definition, false)
  await enqueueUpsert("thought", thought({ content: "Rejected edit", tags: ["old"] }))
  await removeLocalThoughtTag("old")
  const record = () => syncDb.entities.get(entityKey("thought", "thought-client"))
  expect((await record())?.confirmedData).toMatchObject({ tags: ["old"] })
  await enqueueDelete("tag", definition)
  globalThis.fetch = async (_path, init) => {
    const op = JSON.parse(init!.body as string).operations[0] as SyncPushOperation
    return json({ results: [{ ok: op.entity_type === "tag", server_id: definition.id, revision: 2, error: "Rejected" }] })
  }
  await flushSyncQueue()
  expect((await record())?.confirmedData).toMatchObject({ tags: [] })
  await discardSyncOperation((await syncDb.outbox.toArray())[0]!.opId)
  expect((await record())?.data).toMatchObject({ tags: [] })
})

test.each(["tile", "canvas"] as const)("discard cannot restore a thought deleted with its remote %s", async (parent) => {
  await cacheServerEntity("canvas", canvas(), false)
  await cacheServerEntity("tile", tile(), false)
  await cacheServerEntity("thought", thought(), false)
  await enqueueUpsert("thought", thought({ content: "Local edit" }))
  const generation = captureEntityWriteGeneration()
  globalThis.fetch = async () => json({ events: [{ ...event(2, 0, "delete-parent", "delete"), entity_type: parent, entity_id: parent === "tile" ? 20 : 10, client_id: `${parent}-client`, data: { id: parent === "tile" ? 20 : 10 } }], latest_revision: 2 })
  await pullSync()
  await cacheSyncSnapshot({ revision: 1, active_canvas_id: 10, canvases: [canvas()], tags: [], tiles: [tile()], thoughts: [thought()] }, generation)
  expect((await syncDb.entities.get(entityKey("thought", "thought-client")))?.confirmedData).toBeNull()
  await discardSyncOperation((await syncDb.outbox.toArray())[0]!.opId)
  expect(await syncDb.entities.get(entityKey("thought", "thought-client"))).toBeUndefined()
})

test("mobile thought drag adopts thought and parent IDs without duplicating the preview", async () => {
  const sourceCanvas = canvas({ id: -10 })
  const sourceTile = tile({ id: -20, canvas_id: -10 })
  const moving = thought({ id: -30, tile_id: -20 })
  useStore.setState({ activeCanvasId: -10, canvases: [sourceCanvas], tiles: [sourceTile], thoughts: [moving] })
  beginCrossCanvasDrag({ kind: "thought", thought: moving, sourceTileId: -20, sourceCanvasId: -10, targetTileId: -20, targetIndex: 0, clientX: 50, clientY: 50, enteredCanvasId: -10 })
  try {
    adoptServerEntity("thought", entityRecord({ entityType: "thought", tempId: -30, data: moving }), thought({ tile_id: -20 }))
    adoptServerEntity("tile", entityRecord({ entityType: "tile", tempId: -20, data: sourceTile }), tile({ canvas_id: -10 }))
    adoptServerEntity("canvas", entityRecord({ entityType: "canvas", tempId: -10, data: sourceCanvas }), canvas())
    expect(getCrossCanvasDrag()).toMatchObject({ thought: { id: 30, tile_id: 20 }, sourceTileId: 20, targetTileId: 20, sourceCanvasId: 10, enteredCanvasId: 10 })

    const initial = useStore.getInitialState()
    const original = { ...initial }
    try {
      Object.assign(initial, useStore.getState())
      const html = renderToStaticMarkup(createElement(MobileFocusedTile, { tile: useStore.getState().tiles[0]!, thoughts: useStore.getState().thoughts, onFocusTarget: () => {} }))
      expect(html.match(/data-mobile-thought-id="30"/g)).toHaveLength(1)
      expect(html).not.toContain('data-mobile-thought-id="-30"')
    } finally { Object.assign(initial, original) }
  } finally { endCrossCanvasDrag() }
})

test("mobile overview keeps the original tile hidden when creation sync changes its ID during a drag", async () => {
  const moving = tile({ id: -20, stableKey: "moving-tile" })
  const other = tile({ id: 21, client_id: "other-tile" })
  await enqueueUpsert("tile", moving)
  useStore.setState({ activeCanvasId: 10, tiles: [moving, other], tileCache: new Map([[10, [moving, other]]]) })
  beginCrossCanvasDrag({ kind: "tile", tile: moving, thoughts: [], sourceCanvasId: 10, grabOffsetX: 0, grabOffsetY: 0, clientX: 50, clientY: 50, enteredCanvasId: null })
  const renderOverview = () => {
    // Zustand's server renderer reads the initial snapshot. Use the current
    // state for this render, then restore it without changing subscriptions.
    const initial = useStore.getInitialState()
    const original = { ...initial }
    try {
      Object.assign(initial, useStore.getState())
      return renderToStaticMarkup(createElement(MobileOverview, { focusedTileId: null, onFocusTile: () => {} }))
    } finally { Object.assign(initial, original) }
  }
  const tileElement = (html: string, id: number) => html.match(new RegExp(`<div[^>]*data-mobile-tile-id="${id}"[^>]*>`))?.[0]
  try {
    expect(tileElement(renderOverview(), moving.id)).toContain("opacity:0;")
    mockPush(1)
    await flushSyncQueue()
    expect(useStore.getState().tiles.map((item) => item.id)).toEqual([20, 21])
    const html = renderOverview()
    expect(tileElement(html, 20)).toContain("opacity:0;")
    expect(tileElement(html, other.id)).toContain("opacity:1;")
    endCrossCanvasDrag()
    expect(tileElement(renderOverview(), 20)).toContain("opacity:1;")
  } finally { endCrossCanvasDrag() }
})

const tileEdits = [
  { action: "move", target: { canvas_id: 10, x: 240, y: 192, width: 280, height: 200 } },
  { action: "cross-canvas move", target: { canvas_id: 11, x: 240, y: 192, width: 280, height: 200 } },
  { action: "resize", target: { canvas_id: 10, x: 24, y: 24, width: 480, height: 336 } },
] as const

test.each(tileEdits)("a mobile $action survives tile creation sync before, during and after the commit", async ({ action, target }) => {
  for (const timing of ["before", "during", "after"] as const) {
    await resetFrontendState()
    const moving = tile({ id: -20, stableKey: "moving-tile" })
    const contents = thought({ tile_id: moving.id })
    await enqueueUpsert("tile", moving)
    useStore.setState({
      activeCanvasId: 10, canvases: [canvas(), canvas({ id: 11, client_id: "target-canvas" })],
      tiles: [moving], thoughts: [contents],
      tileCache: new Map([[10, [moving]], [11, []]]), thoughtCache: new Map([[10, [contents]]]),
    })
    // The gesture and Undo keep this identity even after the numeric ID changes.
    const tileKey = optimisticIdentityKey(moving, "tile")
    let release!: (response: Response) => void
    globalThis.fetch = () => new Promise<Response>((resolve) => { release = resolve })
    const push = flushSyncQueue()
    while (!release) await new Promise((resolve) => setTimeout(resolve, 0))
    const acknowledge = () => release(json({ results: [{ ok: true, server_id: 20, revision: 1, entity: tile() }] }))
    if (timing === "before") {
      acknowledge()
      await push
    }
    const state = useStore.getState()
    const current = findMobileGestureTile(tileKey, state.tiles, state.tileCache)!
    expect(current).toBeDefined()
    expect(current.id).toBe(timing === "before" ? 20 : -20)
    const frames: ReturnType<typeof tile>[] = []
    const unsubscribe = useStore.subscribe((next) => {
      const item = findMobileGestureTile(tileKey, next.tiles, next.tileCache)
      if (item) frames.push(item)
    })
    try {
      const drop = action === "cross-canvas move"
        ? state.moveTileToCanvas(current.id, target.canvas_id, target.x, target.y)
        : state.updateTile(current.id, target)
      if (timing === "after") await drop
      if (timing !== "before") acknowledge()
      await Promise.all([drop, push])
      expect(frames.length).toBeGreaterThan(0)
      for (const frame of frames) expect(frame).toMatchObject(target)
      expect(useStore.getState().tileCache.get(target.canvas_id)).toMatchObject([{ id: 20, ...target, stableKey: tileKey }])
      expect(useStore.getState().thoughtCache.get(target.canvas_id)?.[0]?.tile_id).toBe(20)
      expect(useStore.getState().tiles).toHaveLength(target.canvas_id === 10 ? 1 : 0)

      mockPush(2)
      await flushSyncQueue()
      expect((await localTile())?.data).toMatchObject({ id: 20, ...target })
      expect(await syncDb.outbox.count()).toBe(0)
      // Undo must also find a synced tile after switching away from its canvas.
      const synced = findMobileGestureTile(tileKey, useStore.getState().tiles, useStore.getState().tileCache)!
      expect(synced).toMatchObject({ id: 20, ...target })
      if (target.canvas_id !== moving.canvas_id) await useStore.getState().moveTileToCanvas(synced.id, moving.canvas_id!, moving.x, moving.y)
      else await useStore.getState().updateTile(synced.id, { x: moving.x, y: moving.y, width: moving.width, height: moving.height })
      expect(useStore.getState().tiles).toMatchObject([{ id: 20, canvas_id: 10, x: moving.x, y: moving.y, width: moving.width, height: moving.height }])
    } finally { unsubscribe() }
  }
})

test("tile adoption preserves a dropped frame when its local record is written before its outbox row", async () => {
  const moving = tile({ id: -20, stableKey: "moving-tile" })
  await enqueueUpsert("tile", moving)
  useStore.setState({ activeCanvasId: 10, tiles: [moving], tileCache: new Map([[10, [moving]]]) })
  let release!: (response: Response) => void
  globalThis.fetch = () => new Promise<Response>((resolve) => { release = resolve })
  const push = flushSyncQueue()
  while (!release) await new Promise((resolve) => setTimeout(resolve, 0))
  const dropped = { ...moving, x: 240, y: 192 }
  // Reproduce the interval between the local entity write and saveOutbox.
  useStore.setState({ tiles: [dropped], tileCache: new Map([[10, [dropped]]]) })
  await upsertEntityRecord("tile", dropped, "dirty")
  release(json({ results: [{ ok: true, server_id: 20, revision: 1, entity: tile() }] }))
  await push
  expect(useStore.getState().tiles).toMatchObject([{ id: 20, x: 240, y: 192, stableKey: "moving-tile" }])
  expect(useStore.getState().tileCache.get(10)).toMatchObject([{ id: 20, x: 240, y: 192 }])
  await enqueueUpsert("tile", useStore.getState().tiles[0]!)
  mockPush(2)
  await flushSyncQueue()
  expect((await localTile())?.data).toMatchObject({ id: 20, x: 240, y: 192 })
})

test.each(["untag", "delete tag"] as const)("adding tags then %s does not flash as a remote edit", async (removal) => {
  const initial = thought({ tags: [] })
  const definition = tag({ name: "recent" })
  await cacheServerEntity("tile", tile(), false)
  await cacheServerEntity("thought", initial, false)
  await cacheServerEntity("tag", definition, false)
  useStore.setState({ activeCanvasId: 10, tiles: [tile()], thoughts: [initial], tags: [definition] })

  const events: SyncPullEvent[] = []
  globalThis.fetch = async (_path, init) => {
    if (!init?.body) return json({ events, latest_revision: events.length })
    const operations = JSON.parse(init.body as string).operations as SyncPushOperation[]
    return json({ results: operations.map((op) => {
      const revision = events.length + 1
      const entity = op.entity_type === "thought" ? thought({ ...op.payload }) : definition
      events.push({
        revision, canvas_id: op.entity_type === "thought" ? 10 : null,
        entity_type: op.entity_type, entity_id: entity.id, client_id: entity.client_id!, op_id: op.op_id,
        action: op.action, data: entity, created_at: "2026-01-01T00:00:00Z",
      })
      return { ok: true, op_id: op.op_id, entity_type: op.entity_type, action: op.action, client_id: op.client_id, server_id: entity.id, revision, ...(op.action === "upsert" ? { entity } : {}) }
    }) })
  }

  await useStore.getState().updateThoughtTags(initial.id, ["recent"])
  await flushSyncQueue()
  if (removal === "untag") await useStore.getState().updateThoughtTags(initial.id, [])
  else await useStore.getState().removeTag(definition.id)

  // The server can echo the earlier tagged payload while the removal is pending.
  await pullSync(10)
  expect(useStore.getState().thoughts[0]?.tags).toEqual([])
  expect(useStore.getState().remoteChangedThoughtIds.size).toBe(0)
  expect(useStore.getState().remoteChangedTileIds.size).toBe(0)

  await flushSyncQueue()
  await pullSync(10)
  expect(useStore.getState().thoughts[0]?.tags).toEqual([])
  expect((await syncDb.entities.get(entityKey("thought", "thought-client")))?.data).toMatchObject({ tags: [] })
  expect(useStore.getState().remoteChangedThoughtIds.size).toBe(0)
  expect(useStore.getState().remoteChangedTileIds.size).toBe(0)

  // A subsequent edit from another device is still tracked as a remote change.
  events.push({
    revision: events.length + 1, canvas_id: 10, entity_type: "thought", entity_id: initial.id,
    client_id: initial.client_id!, op_id: "another-device-tag-edit", action: "upsert",
    data: thought({ tags: ["remote-tag"] }), created_at: "2026-01-01T00:00:05Z",
  })
  await pullSync(10)
  expect(useStore.getState().thoughts[0]?.tags).toEqual(["remote-tag"])
  expect(useStore.getState().remoteChangedThoughtIds.has(initial.id)).toBe(true)
})

function mockPush(revision: number, rejectAfterFirst = false) {
  let calls = 0
  globalThis.fetch = async (_path, init) => {
    const op = JSON.parse(init!.body as string).operations[0] as SyncPushOperation
    return json({ results: [{
      ok: !rejectAfterFirst || calls++ === 0, error: "Rejected", op_id: op.op_id,
      entity_type: op.entity_type, action: op.action, client_id: op.client_id, server_id: 20, revision,
      ...(op.action === "upsert" ? { entity: tile({ ...op.payload, id: 20 }) } : {}),
    }] })
  }
}

test("interleaved device edits respect acknowledged revisions after reopening IndexedDB", async () => {
  await cacheServerEntity("tile", tile(), false)
  await enqueueUpsert("tile", tile({ x: 100 }))
  const own = (await syncDb.outbox.toArray())[0]!
  mockPush(2)
  await flushSyncQueue()
  syncDb.close()
  await syncDb.open()
  useStore.setState({ activeCanvasId: 10, tiles: [tile({ x: 100 })] })
  globalThis.fetch = async () => json({ events: [event(1, 50), event(2, 100, own.opId)], latest_revision: 2 })
  await pullSync(10)
  expect((await localTile())?.data).toMatchObject({ x: 100 })
  expect(useStore.getState().tiles[0]?.x).toBe(100)
  expect(useStore.getState().remoteChangedTileIds.size).toBe(0)

  globalThis.fetch = async () => json({ events: [event(3, 150)], latest_revision: 3 })
  await pullSync(10)
  expect((await localTile())?.data).toMatchObject({ x: 150 })
})

test("acknowledged deletion cannot be resurrected by an older remote edit", async () => {
  await cacheServerEntity("tile", tile(), false)
  await enqueueDelete("tile", tile())
  mockPush(4)
  await flushSyncQueue()
  syncDb.close()
  await syncDb.open()
  globalThis.fetch = async () => json({ events: [event(3, 50)], latest_revision: 3 })
  await pullSync(10)
  expect(await localTile()).toBeUndefined()
})

test("overlapping pulls cannot regress entity state or the cursor", async () => {
  let release!: (response: Response) => void
  globalThis.fetch = () => new Promise<Response>((resolve) => { release = resolve })
  const older = pullSync(10)
  while (!release) await new Promise((resolve) => setTimeout(resolve, 0))
  globalThis.fetch = async () => json({ events: [event(8, 80)], latest_revision: 8 })
  await pullSync(10)
  release(json({ events: [event(7, 70)], latest_revision: 7 }))
  await older
  expect((await localTile())?.data).toMatchObject({ x: 80 })
  expect((await syncDb.metadata.get("canvasRevision:10"))?.value).toBe(8)
})

test.each([20, -20])("discard restores the accepted edit for entity %s after reload", async (id) => {
  if (id > 0) await cacheServerEntity("tile", tile({ title: "Original" }), false)
  await enqueueUpsert("tile", tile({ id, title: "Accepted" }))
  await enqueueUpsert("tile", tile({ id, title: "Rejected" }))
  mockPush(2, true)
  await flushSyncQueue()
  expect((await localTile())?.data).toMatchObject({ id: 20, title: "Rejected" })
  syncDb.close()
  await syncDb.open()
  await discardSyncOperation((await syncDb.outbox.toArray())[0]!.opId)
  expect((await localTile())?.data).toMatchObject({ id: 20, title: "Accepted" })
  expect((await localTile())?.status).toBe("clean")
})

test("pending local edits retain the newest remote baseline for discard", async () => {
  await cacheServerEntity("tile", tile({ x: 0 }), false)
  await enqueueUpsert("tile", tile({ x: 100 }))
  globalThis.fetch = async () => json({ events: [event(2, 50)], latest_revision: 2 })
  await pullSync(10)
  expect((await localTile())?.data).toMatchObject({ x: 100 })
  await discardSyncOperation((await syncDb.outbox.toArray())[0]!.opId)
  expect((await localTile())?.data).toMatchObject({ x: 50 })
})

test("legacy acknowledgements seed revision ordering before interleaved remote edits", async () => {
  await cacheServerEntity("tile", tile({ x: 100 }), false)
  await syncDb.syncActivity.put({ opId: "legacy-own", entityType: "tile", clientId: "tile-client", action: "upsert", state: "synced", summary: "Moved tile", error: null, createdAt: 1, updatedAt: 2 })
  globalThis.fetch = async () => json({ events: [event(1, 50), event(2, 100, "legacy-own")], latest_revision: 2 })
  await pullSync(10)
  expect((await localTile())?.data).toMatchObject({ x: 100 })
})

test("a delete followed by a failed restore remains deleted after discard", async () => {
  await cacheServerEntity("tile", tile(), false)
  await enqueueDelete("tile", tile())
  await enqueueUpsert("tile", tile({ title: "Restore" }))
  mockPush(2, true)
  await flushSyncQueue()
  expect((await localTile())?.data).toMatchObject({ title: "Restore" })
  await discardSyncOperation((await syncDb.outbox.toArray())[0]!.opId)
  expect(await localTile()).toBeUndefined()
})

test.each(["upsert", "delete"] as const)("a newer remote %s wins over a delayed push acknowledgement", async (action) => {
  await cacheServerEntity("tile", tile(), false)
  await enqueueUpsert("tile", tile({ x: 100 }))
  const own = (await syncDb.outbox.toArray())[0]!
  let release!: (response: Response) => void
  globalThis.fetch = () => new Promise<Response>((resolve) => { release = resolve })
  const push = flushSyncQueue()
  while (!release) await new Promise((resolve) => setTimeout(resolve, 0))
  globalThis.fetch = async () => json({ events: [event(3, 150, "newer-remote", action)], latest_revision: 3 })
  await pullSync(10)
  release(json({ results: [{ ok: true, op_id: own.opId, server_id: 20, revision: 2, entity: tile({ x: 100 }) }] }))
  await push
  if (action === "delete") expect(await localTile()).toBeUndefined()
  else expect((await localTile())?.data).toMatchObject({ x: 150 })
  expect(await syncDb.outbox.count()).toBe(0)
})

test("temporary identities are adopted even when a newer pull precedes the create acknowledgement", async () => {
  await enqueueUpsert("tile", tile({ id: -20, x: 100 }))
  await upsertEntityRecord("thought", thought({ tile_id: -20 }), "dirty")
  useStore.setState({ activeCanvasId: 10, tiles: [tile({ id: -20, x: 100 })], thoughts: [thought({ tile_id: -20 })] })
  let release!: (response: Response) => void
  globalThis.fetch = () => new Promise<Response>((resolve) => { release = resolve })
  const push = flushSyncQueue()
  while (!release) await new Promise((resolve) => setTimeout(resolve, 0))
  globalThis.fetch = async () => json({ events: [event(3, 150)], latest_revision: 3 })
  await pullSync(10)
  release(json({ results: [{ ok: true, server_id: 20, revision: 2, entity: tile({ x: 100 }) }] }))
  await push
  expect(useStore.getState().tiles.map((tile) => tile.id)).toEqual([20])
  expect(useStore.getState().thoughts[0]?.tile_id).toBe(20)
  expect((await syncDb.entities.get(entityKey("thought", "thought-client")))?.data).toMatchObject({ tile_id: 20 })
})

test("a creation acknowledgement cannot move a dropped thought back to its source tile", async () => {
  const source = tile()
  const target = tile({ id: 21, client_id: "target-tile" })
  const moving = thought({ id: -30, tile_id: source.id, stableKey: "moving-thought" })
  await cacheServerEntity("tile", source, false)
  await cacheServerEntity("tile", target, false)
  await enqueueUpsert("thought", moving)
  useStore.setState({
    activeCanvasId: 10, tiles: [source, target], thoughts: [moving],
    thoughtCache: new Map([[10, [moving]]]),
  })
  let release!: (response: Response) => void
  globalThis.fetch = () => new Promise<Response>((resolve) => { release = resolve })
  const push = flushSyncQueue()
  while (!release) await new Promise((resolve) => setTimeout(resolve, 0))
  const positions: number[] = []
  const unsubscribe = useStore.subscribe((state) => {
    const current = state.thoughts.find((item) => item.client_id === moving.client_id)
    if (current) positions.push(current.tile_id)
  })
  try {
    const drop = useStore.getState().moveThoughtToTile(moving.id, target.id, { orderedIds: [moving.id] })
    expect(useStore.getState().thoughts[0]?.tile_id).toBe(target.id)
    release(json({ results: [{ ok: true, server_id: 30, revision: 1, entity: thought({ tile_id: source.id }) }] }))
    await Promise.all([drop, push])
    expect(positions.length).toBeGreaterThan(0)
    expect(positions.every((id) => id === target.id)).toBe(true)
    expect(useStore.getState().thoughts[0]).toMatchObject({ id: 30, tile_id: target.id, stableKey: "moving-thought" })
    expect(useStore.getState().thoughtCache.get(10)?.[0]?.tile_id).toBe(target.id)

    globalThis.fetch = async (_path, init) => {
      const op = JSON.parse(init!.body as string).operations[0] as SyncPushOperation
      return json({ results: [{ ok: true, server_id: 30, revision: 2, entity: thought({ ...op.payload, id: 30 }) }] })
    }
    await flushSyncQueue()
    expect(positions.every((id) => id === target.id)).toBe(true)
    expect((await syncDb.entities.get(entityKey("thought", moving.client_id!)))?.data).toMatchObject({ id: 30, tile_id: target.id })
  } finally { unsubscribe() }
})
