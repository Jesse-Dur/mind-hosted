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
const { cacheServerEntity, cacheSyncSnapshot, cachedThoughtsForCanvas } = await import("./cache")

beforeEach(async () => {
  await resetFrontendState()
})

describe("frontend sync outbox", () => {
  test("repeated upserts keep one durable operation with the latest payload", async () => {
    await enqueueUpsert("tile", tile({ title: "Draft", width: 280 }))
    await enqueueUpsert("tile", tile({ title: "Final", width: 420 }))

    const records = await syncDb.outbox.toArray()
    const entity = await syncDb.entities.get(entityKey("tile", "tile-client"))

    expect(records).toHaveLength(1)
    expect(records[0]?.opId).toStartWith("tile:upsert:tile-client")
    expect(records[0]?.payload).toMatchObject({ title: "Final", width: 420 })
    expect(entity?.status).toBe("dirty")
    expect((entity?.data as Tile | undefined)?.title).toBe("Final")
  })

  test("temporary create followed by delete removes local state before flush", async () => {
    const tempThought = thought({ id: -30, client_id: "temp-thought", tile_id: -20 })
    await enqueueUpsert("thought", tempThought)
    await enqueueDelete("thought", tempThought)

    expect(await syncDb.outbox.toArray()).toHaveLength(0)
    expect(await syncDb.entities.get(entityKey("thought", "temp-thought"))).toBeUndefined()
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

  test("server tag rename rewrites cached thought tag labels", async () => {
    await cacheServerEntity("tag", tag({ id: 40, client_id: "tag-client", name: "old" }))
    await cacheServerEntity("tile", tile({ id: 20, client_id: "tile-client", canvas_id: 10 }))
    await cacheServerEntity("thought", thought({ id: 30, client_id: "thought-client", tags: ["old"] }))

    await cacheServerEntity("tag", tag({ id: 40, client_id: "tag-client", name: "new" }))

    const thoughts = await cachedThoughtsForCanvas(10)
    expect(thoughts[0]?.tags).toEqual(["new"])
  })
})
