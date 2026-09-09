import { beforeEach, describe, expect, test } from "bun:test"
import type { Tile } from "../types"
import type { SyncSnapshotResponse } from "./types"
import {
  canvas,
  entityKey,
  entityRecord,
  outboxRecord,
  resetFrontendState,
  syncDb,
  tag,
  thought,
  tile,
} from "../test/syncTestHarness"

const { enqueueDelete, enqueueUpsert } = await import("./outbox")
const { adoptLocalReferences, resolvePayload } = await import("./dependencies")
const { cacheServerEntity, cacheSyncSnapshot, cachedThoughtsForCanvas, cachedWorkspaceForSearch } = await import("./cache")
const { discardSyncOperation, keepSyncOperationLocal } = await import("./resolution")
const { cachePastEntity, readPastEntitiesCache } = await import("./pastCache")
const { captureEntityWriteGeneration } = await import("./entityWriteFence")
const { readSyncActivity } = await import("./status")

beforeEach(async () => {
  await resetFrontendState()
})

describe("frontend sync outbox", () => {
  test("repeated completed upserts preserve each action in order", async () => {
    await enqueueUpsert("tile", tile({ title: "Draft", width: 280 }))
    await enqueueUpsert("tile", tile({ title: "Final", width: 420 }))

    const records = (await syncDb.outbox.toArray()).sort((left, right) => left.createdAt - right.createdAt)
    const entity = await syncDb.entities.get(entityKey("tile", "tile-client"))

    expect(records).toHaveLength(2)
    expect(records[0]?.opId).toStartWith("tile:upsert:tile-client")
    expect(records[0]?.payload).toMatchObject({ title: "Draft", width: 280 })
    expect(records[1]?.payload).toMatchObject({ title: "Final", width: 420 })
    expect(records[1]!.createdAt).toBeGreaterThan(records[0]!.createdAt)
    expect(await syncDb.syncActivity.count()).toBe(2)
    expect(entity?.status).toBe("dirty")
    expect((entity?.data as Tile | undefined)?.title).toBe("Final")
  })

  test("a centred pinch is recorded as one resize action even when its position changes", async () => {
    const original = tile({ x: 48, y: 48, width: 280, height: 200 })
    await cacheServerEntity("tile", original, false)
    await enqueueUpsert("tile", { ...original, x: 24, y: 24, width: 328, height: 248 })

    expect((await syncDb.syncActivity.toArray())[0]?.summary).toBe("Resize tile “Tasks”")
  })

  test("internal writes remain durable without creating duplicate History actions", async () => {
    await enqueueUpsert("tile", tile({ title: "Internal reorder update" }), { recordHistory: false })

    expect(await syncDb.outbox.count()).toBe(1)
    expect((await syncDb.outbox.toArray())[0]?.recordHistory).toBe(false)
    expect(await syncDb.syncActivity.count()).toBe(1)
    expect((await syncDb.syncActivity.toArray())[0]?.hidden).toBe(true)
    expect(await readSyncActivity()).toHaveLength(0)
  })

  test("temporary create followed by delete preserves both completed actions", async () => {
    const tempThought = thought({ id: -30, client_id: "temp-thought", tile_id: -20 })
    await enqueueUpsert("thought", tempThought)
    await enqueueDelete("thought", tempThought)

    const operations = (await syncDb.outbox.toArray()).sort((left, right) => left.createdAt - right.createdAt)
    expect(operations.map((operation) => operation.action)).toEqual(["upsert", "delete"])
    expect((await syncDb.entities.get(entityKey("thought", "temp-thought")))?.status).toBe("deleted")
    expect(await syncDb.syncActivity.count()).toBe(2)
    expect((await readPastEntitiesCache()).pastThoughts).toContainEqual(tempThought)
  })

  test("deleting a persisted entity makes it available to Past without a network request", async () => {
    const deletedThought = thought({ id: 30, client_id: "thought-client", content: "Local past item" })
    await cacheServerEntity("thought", deletedThought, false)

    await enqueueDelete("thought", deletedThought)

    expect((await readPastEntitiesCache()).pastThoughts).toContainEqual(deletedThought)
  })

  test("a restored live entity evicts a legacy Past copy without a client id", async () => {
    const legacyDeleted = { ...thought({ id: 31, content: "Legacy deleted item" }), client_id: null }
    await cachePastEntity("thought", legacyDeleted)

    await cacheServerEntity("thought", { ...legacyDeleted, client_id: "restored-thought" }, false)

    expect((await readPastEntitiesCache()).pastThoughts).toHaveLength(0)
  })

  test("intentionally local-only entities stay local-only through later edits", async () => {
    await enqueueUpsert("tile", tile({ title: "First local edit" }))
    const operation = (await syncDb.outbox.toArray())[0]!
    await keepSyncOperationLocal(operation.opId)

    await enqueueUpsert("tile", tile({ title: "Later local edit" }))

    const updated = (await syncDb.outbox.toArray()).sort((left, right) => left.createdAt - right.createdAt)
    expect(updated).toHaveLength(2)
    expect(updated.every((candidate) => candidate.status === "local_only")).toBe(true)
    expect(updated[0]?.payload).toMatchObject({ title: "First local edit" })
    expect(updated[1]?.payload).toMatchObject({ title: "Later local edit" })
  })

  test("discard restores the last server-confirmed version", async () => {
    const confirmed = tile({ title: "Confirmed" })
    await cacheServerEntity("tile", confirmed, false)
    await enqueueUpsert("tile", tile({ title: "Rejected local edit" }))
    const operation = (await syncDb.outbox.toArray())[0]!
    await syncDb.outbox.put({ ...operation, status: "error", error: "Rejected" })

    await discardSyncOperation(operation.opId)

    const restored = await syncDb.entities.get(entityKey("tile", "tile-client"))
    expect((restored?.data as Tile | undefined)?.title).toBe("Confirmed")
    expect(restored?.status).toBe("clean")
    expect(await syncDb.outbox.where("clientId").equals("tile-client").count()).toBe(0)
  })

  test("discard resolves the selected action without removing later actions", async () => {
    const confirmed = tile({ title: "Confirmed" })
    await cacheServerEntity("tile", confirmed, false)
    await enqueueUpsert("tile", tile({ title: "First edit" }))
    await enqueueUpsert("tile", tile({ title: "Second edit" }))
    const operations = (await syncDb.outbox.toArray()).sort((left, right) => left.createdAt - right.createdAt)

    await discardSyncOperation(operations[0]!.opId)

    const remaining = (await syncDb.outbox.toArray()).sort((left, right) => left.createdAt - right.createdAt)
    const local = await syncDb.entities.get(entityKey("tile", "tile-client"))
    expect(remaining.map((operation) => operation.opId)).toEqual([operations[1]!.opId])
    expect((local?.data as Tile | undefined)?.title).toBe("Second edit")
    expect((await syncDb.syncActivity.get(operations[0]!.opId))?.state).toBe("discarded")

    await discardSyncOperation(operations[1]!.opId)
    const restored = await syncDb.entities.get(entityKey("tile", "tile-client"))
    expect((restored?.data as Tile | undefined)?.title).toBe("Confirmed")
    expect(restored?.status).toBe("clean")
  })

  test("discarding a local delete removes it from Past and restores the live entity", async () => {
    const confirmed = tile({ title: "Restore me" })
    await cacheServerEntity("tile", confirmed, false)
    await enqueueDelete("tile", confirmed)
    const operation = (await syncDb.outbox.toArray())[0]!
    expect((await readPastEntitiesCache()).pastTiles).toHaveLength(1)

    await discardSyncOperation(operation.opId)

    expect((await readPastEntitiesCache()).pastTiles).toHaveLength(0)
    expect((await syncDb.entities.get(entityKey("tile", "tile-client")))?.status).toBe("clean")
  })
})

describe("frontend sync dependencies", () => {
  test("records with temporary parents wait until the parent has a server id", async () => {
    await syncDb.entities.put(entityRecord({
      entityType: "canvas",
      clientId: "temp-canvas",
      serverId: null,
      tempId: -10,
      canvasId: -10,
      status: "dirty",
      data: canvas({ id: -10, client_id: "temp-canvas" }),
    }))

    const pendingTile = outboxRecord({
      opId: "tile-op",
      entityType: "tile",
      action: "upsert",
      clientId: "temp-tile",
      serverId: null,
      payload: { canvas_id: -10, title: "Blocked" },
    })

    expect(await resolvePayload(pendingTile)).toBeNull()

    await syncDb.entities.put(entityRecord({
      entityType: "canvas",
      clientId: "temp-canvas",
      serverId: 42,
      tempId: -10,
      canvasId: 42,
      status: "clean",
      data: canvas({ id: 42, client_id: "temp-canvas" }),
    }))

    expect(await resolvePayload(pendingTile)).toMatchObject({ canvas_id: 42 })
  })

  test("adopting a parent server id rewrites cached children and pending payloads", async () => {
    await syncDb.entities.put(entityRecord({
      entityType: "tile",
      clientId: "child-tile",
      serverId: null,
      tempId: -20,
      canvasId: -10,
      status: "dirty",
      data: tile({ id: -20, client_id: "child-tile", canvas_id: -10 }),
    }))
    await syncDb.outbox.put(outboxRecord({
      opId: "child-tile-op",
      entityType: "tile",
      action: "upsert",
      clientId: "child-tile",
      serverId: null,
      payload: { canvas_id: -10, title: "Child" },
    }))

    await adoptLocalReferences("canvas", -10, 42)

    const child = await syncDb.entities.get(entityKey("tile", "child-tile"))
    const pending = await syncDb.outbox.get("child-tile-op")

    expect((child?.data as Tile | undefined)?.canvas_id).toBe(42)
    expect(child?.canvasId).toBe(42)
    expect(pending?.payload).toMatchObject({ canvas_id: 42 })
  })
})

describe("local cross-canvas search cache", () => {
  test("returns entities from every locally stored canvas", async () => {
    await Promise.all([
      cacheServerEntity("tile", tile({ id: 20, client_id: "tile-a", canvas_id: 10 }), false),
      cacheServerEntity("tile", tile({ id: 21, client_id: "tile-b", canvas_id: 11 }), false),
      cacheServerEntity("thought", thought({ id: 30, client_id: "thought-a", tile_id: 20 }), false),
      cacheServerEntity("thought", thought({ id: 31, client_id: "thought-b", tile_id: 21 }), false),
    ])

    const workspace = await cachedWorkspaceForSearch()

    expect(workspace.tiles.map((item) => item.id).sort()).toEqual([20, 21])
    expect(workspace.thoughts.map((item) => item.id).sort()).toEqual([30, 31])
  })
})

describe("frontend sync cache", () => {
  test("snapshot reconciliation deletes clean missing records and preserves dirty ones", async () => {
    await syncDb.entities.put(entityRecord({
      entityType: "tile",
      clientId: "clean-tile",
      serverId: 1,
      tempId: null,
      canvasId: 10,
      status: "clean",
      data: tile({ id: 1, client_id: "clean-tile", canvas_id: 10 }),
    }))
    await syncDb.entities.put(entityRecord({
      entityType: "tile",
      clientId: "dirty-tile",
      serverId: 2,
      tempId: null,
      canvasId: 10,
      status: "dirty",
      data: tile({ id: 2, client_id: "dirty-tile", canvas_id: 10 }),
    }))
    await syncDb.outbox.put(outboxRecord({
      opId: "dirty-tile-op",
      entityType: "tile",
      action: "upsert",
      clientId: "dirty-tile",
      serverId: 2,
      payload: { canvas_id: 10, title: "Dirty" },
    }))

    const snapshot: SyncSnapshotResponse = {
      revision: 1,
      active_canvas_id: 10,
      canvases: [canvas({ id: 10 })],
      tags: [],
      tiles: [],
      thoughts: [],
    }

    await cacheSyncSnapshot(snapshot)

    expect(await syncDb.entities.get(entityKey("tile", "clean-tile"))).toBeUndefined()
    expect(await syncDb.entities.get(entityKey("tile", "dirty-tile"))).toBeDefined()
  })

  test("snapshot reconciliation keeps thoughts while a moved parent tile is still pending", async () => {
    await syncDb.entities.put(entityRecord({
      entityType: "tile",
      clientId: "moved-tile",
      serverId: 20,
      tempId: null,
      canvasId: 11,
      status: "dirty",
      data: tile({ id: 20, client_id: "moved-tile", canvas_id: 11 }),
    }))
    await syncDb.outbox.put(outboxRecord({
      opId: "moved-tile-op",
      entityType: "tile",
      action: "upsert",
      clientId: "moved-tile",
      serverId: 20,
      payload: { canvas_id: 11, title: "Moved" },
    }))
    await syncDb.entities.put(entityRecord({
      entityType: "thought",
      clientId: "moved-thought",
      serverId: 30,
      tempId: null,
      canvasId: 11,
      status: "clean",
      data: thought({ id: 30, client_id: "moved-thought", tile_id: 20, content: "Keep me" }),
    }))

    const snapshot: SyncSnapshotResponse = {
      revision: 1,
      active_canvas_id: 11,
      canvases: [canvas({ id: 11 })],
      tags: [],
      tiles: [],
      thoughts: [],
    }

    await cacheSyncSnapshot(snapshot)

    expect(await syncDb.entities.get(entityKey("thought", "moved-thought"))).toBeDefined()
    expect(await cachedThoughtsForCanvas(11)).toHaveLength(1)
    expect((await cachedThoughtsForCanvas(11))[0]?.content).toBe("Keep me")
  })

  test("server tag rename rewrites cached thought tag labels", async () => {
    await cacheServerEntity("tag", tag({ id: 40, client_id: "tag-client", name: "old" }))
    await cacheServerEntity("tile", tile({ id: 20, client_id: "tile-client", canvas_id: 10 }))
    await cacheServerEntity("thought", thought({ id: 30, client_id: "thought-client", tags: ["old"] }))

    await cacheServerEntity("tag", tag({ id: 40, client_id: "tag-client", name: "new" }))

    const thoughts = await cachedThoughtsForCanvas(10)
    expect(thoughts[0]?.tags).toEqual(["new"])
  })

  test("snapshot reconciliation cannot overwrite failed or local-only work", async () => {
    const localTile = tile({ title: "Local authority" })
    await syncDb.entities.put(entityRecord({
      entityType: "tile",
      clientId: "tile-client",
      serverId: 20,
      tempId: null,
      canvasId: 10,
      status: "dirty",
      data: localTile,
      confirmedData: tile({ title: "Earlier server version" }),
      syncDisposition: "local_only",
    }))
    await syncDb.outbox.put({ ...outboxRecord({
      opId: "local-only-op",
      entityType: "tile",
      action: "upsert",
      clientId: "tile-client",
      serverId: 20,
      payload: { title: "Local authority" },
    }), status: "local_only" })

    await cacheSyncSnapshot({
      revision: 2,
      active_canvas_id: 10,
      canvases: [canvas()],
      tags: [],
      tiles: [tile({ title: "Stale remote version" })],
      thoughts: [],
    })

    const record = await syncDb.entities.get(entityKey("tile", "tile-client"))
    expect((record?.data as Tile | undefined)?.title).toBe("Local authority")
    expect((record?.confirmedData as Tile | undefined)?.title).toBe("Stale remote version")
    expect(record?.syncDisposition).toBe("local_only")
  })

  test("an in-flight snapshot cannot roll an acknowledged local tile back to stale geometry", async () => {
    await cacheServerEntity("tile", tile({ x: 0, y: 0, width: 280, height: 200 }), false)
    const snapshotGeneration = captureEntityWriteGeneration()

    await enqueueUpsert("tile", tile({ x: 240, y: 168, width: 432, height: 312 }))
    const localRecord = await syncDb.entities.get(entityKey("tile", "tile-client"))
    await syncDb.entities.put({ ...localRecord!, status: "clean" })
    await syncDb.outbox.where("clientId").equals("tile-client").delete()

    const changed = await cacheSyncSnapshot({
      revision: 2,
      active_canvas_id: 10,
      canvases: [canvas()],
      tags: [],
      tiles: [tile({ x: 0, y: 0, width: 280, height: 200 })],
      thoughts: [],
    }, snapshotGeneration)

    const cached = await syncDb.entities.get(entityKey("tile", "tile-client"))
    expect(cached?.data).toMatchObject({ x: 240, y: 168, width: 432, height: 312 })
    expect(changed.tileIds).toEqual([])
  })

  test("an in-flight snapshot cannot delete a locally changed tile after its outbox clears", async () => {
    await Promise.all([
      cacheServerEntity("tile", tile(), false),
      cacheServerEntity("thought", thought(), false),
    ])
    const snapshotGeneration = captureEntityWriteGeneration()

    await enqueueUpsert("tile", tile({ x: 120 }))
    await syncDb.outbox.where("clientId").equals("tile-client").delete()

    await cacheSyncSnapshot({
      revision: 2,
      active_canvas_id: 10,
      canvases: [canvas()],
      tags: [],
      tiles: [],
      thoughts: [],
    }, snapshotGeneration)

    expect(await syncDb.entities.get(entityKey("tile", "tile-client"))).toBeDefined()
    expect(await syncDb.entities.get(entityKey("thought", "thought-client"))).toBeDefined()
  })
})
