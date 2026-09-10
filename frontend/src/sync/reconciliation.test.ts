import { beforeEach, expect, test } from "bun:test"
import { entityKey, resetFrontendState, syncDb, tag, thought, tile, useStore } from "../test/syncTestHarness"
import { cacheServerEntity } from "./cache"
import { enqueueDelete, enqueueUpsert } from "./outbox"
import { flushSyncQueue } from "./flush"
import { pullSync } from "./pull"
import { discardSyncOperation } from "./resolution"
import { upsertEntityRecord } from "./entities"
import type { SyncPullEvent, SyncPushOperation } from "./types"

const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } })
const localTile = () => syncDb.entities.get(entityKey("tile", "tile-client"))
const event = (revision: number, x: number, opId = `remote-${revision}`, action: "upsert" | "delete" = "upsert"): SyncPullEvent => ({
  revision, canvas_id: 10, entity_type: "tile", entity_id: 20, client_id: "tile-client", op_id: opId,
  action, data: tile({ x }), created_at: "2026-01-01T00:00:00Z",
})

beforeEach(resetFrontendState)

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

  // A subsequent edit from another device still deserves the purple indicator.
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
