import { beforeEach, describe, expect, test } from "bun:test"
import type { SyncPullResponse } from "./types"
import {
  canvas,
  entityKey,
  entityRecord,
  outboxRecord,
  resetFrontendState,
  syncDb,
  tile,
  useStore,
} from "../test/syncTestHarness"

const { pullSync } = await import("./pull")

let pullResponse: SyncPullResponse = { events: [], latest_revision: 0 }

function tileEventData(overrides: Record<string, unknown> = {}) {
  return {
    id: 20,
    client_id: "tile-client",
    canvas_id: 10,
    title: "Remote",
    x: 0,
    y: 0,
    width: 280,
    height: 200,
    importance: 1,
    visible: true,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  }
}

function installPullFetchMock() {
  const globals = globalThis as unknown as {
    fetch: (path: string, init?: RequestInit) => Promise<Response>
  }
  globals.fetch = async () => new Response(JSON.stringify(pullResponse), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  })
}

beforeEach(async () => {
  await resetFrontendState()
  pullResponse = { events: [], latest_revision: 0 }
  installPullFetchMock()
})

describe("frontend sync pull", () => {
  test("pending local changes are not overwritten by stale remote upserts", async () => {
    const localTile = tile({ id: 20, client_id: "tile-client", title: "Local" })
    await syncDb.entities.put(entityRecord({
      entityType: "tile",
      clientId: "tile-client",
      serverId: 20,
      tempId: null,
      canvasId: 10,
      status: "dirty",
      data: localTile,
    }))
    await syncDb.outbox.put(outboxRecord({
      opId: "tile-local-op",
      entityType: "tile",
      action: "upsert",
      clientId: "tile-client",
      serverId: 20,
      payload: { canvas_id: 10, title: "Local" },
    }))
    useStore.setState({
      activeCanvasId: 10,
      tiles: [localTile],
      tileCache: new Map([[10, [localTile]]]),
    })
    pullResponse = {
      latest_revision: 3,
      events: [{
        revision: 3,
        canvas_id: 10,
        entity_type: "tile",
        entity_id: 20,
        client_id: "tile-client",
        op_id: "remote-op",
        action: "upsert",
        data: tileEventData({ title: "Remote" }),
        created_at: "2026-01-01T00:00:00.000Z",
      }],
    }

    await pullSync(10)

    const record = await syncDb.entities.get(entityKey("tile", "tile-client"))
    expect(record?.data).toMatchObject({ title: "Local" })
    expect(useStore.getState().tiles[0]?.title).toBe("Local")
  })

  test("remote tile creates update cache, store, metadata, and animation state", async () => {
    useStore.setState({
      activeCanvasId: 10,
      tiles: [],
      tileCache: new Map([[10, []]]),
    })
    pullResponse = {
      latest_revision: 4,
      events: [{
        revision: 4,
        canvas_id: 10,
        entity_type: "tile",
        entity_id: 20,
        client_id: "tile-client",
        op_id: "remote-op",
        action: "upsert",
        data: tileEventData({ title: "Remote Create" }),
        created_at: "2026-01-01T00:00:00.000Z",
      }],
    }

    await pullSync(10)

    const record = await syncDb.entities.get(entityKey("tile", "tile-client"))
    const revision = await syncDb.metadata.get("canvasRevision:10")

    expect(record?.status).toBe("clean")
    expect(useStore.getState().tiles[0]?.title).toBe("Remote Create")
    expect(useStore.getState().remoteChangedTileIds.has(20)).toBe(true)
    expect(revision?.value).toBe(4)
  })

  test("pulling this device's already-applied payload does not animate", async () => {
    const existingTile = tile({ id: 20, client_id: "tile-client", title: "Already Applied" })
    await syncDb.entities.put(entityRecord({
      entityType: "tile",
      clientId: "tile-client",
      serverId: 20,
      tempId: null,
      canvasId: 10,
      status: "clean",
      data: existingTile,
    }))
    useStore.setState({
      activeCanvasId: 10,
      tiles: [existingTile],
      tileCache: new Map([[10, [existingTile]]]),
    })
    pullResponse = {
      latest_revision: 5,
      events: [{
        revision: 5,
        canvas_id: 10,
        entity_type: "tile",
        entity_id: 20,
        client_id: "tile-client",
        op_id: "own-op",
        action: "upsert",
        data: tileEventData({ title: "Already Applied" }),
        created_at: "2026-01-01T00:00:00.000Z",
      }],
    }

    await pullSync(10)

    expect(useStore.getState().remoteChangedTileIds.has(20)).toBe(false)
  })

  test("remote deletes do not remove locally dirty entities", async () => {
    const dirtyTile = tile({ id: 20, client_id: "tile-client", title: "Dirty" })
    await syncDb.entities.put(entityRecord({
      entityType: "tile",
      clientId: "tile-client",
      serverId: 20,
      tempId: null,
      canvasId: 10,
      status: "dirty",
      data: dirtyTile,
    }))
    await syncDb.outbox.put(outboxRecord({
      opId: "tile-dirty-op",
      entityType: "tile",
      action: "upsert",
      clientId: "tile-client",
      serverId: 20,
      payload: { canvas_id: 10, title: "Dirty" },
    }))
    useStore.setState({ activeCanvasId: 10, tiles: [dirtyTile], tileCache: new Map([[10, [dirtyTile]]]) })
    pullResponse = {
      latest_revision: 6,
      events: [{
        revision: 6,
        canvas_id: 10,
        entity_type: "tile",
        entity_id: 20,
        client_id: "tile-client",
        op_id: "remote-delete",
        action: "delete",
        data: { id: 20 },
        created_at: "2026-01-01T00:00:00.000Z",
      }],
    }

    await pullSync(10)

    expect(await syncDb.entities.get(entityKey("tile", "tile-client"))).toBeDefined()
    expect(useStore.getState().tiles).toHaveLength(1)
  })

  test("remote canvas delete with moveContents moves cached child tiles", async () => {
    const sourceCanvas = canvas({ id: 10, client_id: "source-canvas", name: "Source" })
    const targetCanvas = canvas({ id: 11, client_id: "target-canvas", name: "Target" })
    const childTile = tile({ id: 20, client_id: "tile-client", canvas_id: 10 })
    await syncDb.entities.bulkPut([
      entityRecord({
        entityType: "canvas",
        clientId: "source-canvas",
        serverId: 10,
        tempId: null,
        canvasId: 10,
        status: "clean",
        data: sourceCanvas,
      }),
      entityRecord({
        entityType: "canvas",
        clientId: "target-canvas",
        serverId: 11,
        tempId: null,
        canvasId: 11,
        status: "clean",
        data: targetCanvas,
      }),
      entityRecord({
        entityType: "tile",
        clientId: "tile-client",
        serverId: 20,
        tempId: null,
        canvasId: 10,
        status: "clean",
        data: childTile,
      }),
    ])
    useStore.setState({
      canvases: [sourceCanvas, targetCanvas],
      activeCanvasId: 10,
      tiles: [childTile],
      tileCache: new Map([[10, [childTile]], [11, []]]),
      thoughtCache: new Map([[10, []], [11, []]]),
    })
    pullResponse = {
      latest_revision: 7,
      events: [{
        revision: 7,
        canvas_id: 10,
        entity_type: "canvas",
        entity_id: 10,
        client_id: "source-canvas",
        op_id: "remote-canvas-delete",
        action: "delete",
        data: { id: 10, targetCanvasId: 11 },
        created_at: "2026-01-01T00:00:00.000Z",
      }],
    }

    await pullSync(10)

    const childRecord = await syncDb.entities.get(entityKey("tile", "tile-client"))
    expect(await syncDb.entities.get(entityKey("canvas", "source-canvas"))).toBeUndefined()
    expect(childRecord?.data).toMatchObject({ canvas_id: 11 })
    expect(useStore.getState().activeCanvasId).toBe(11)
    expect(useStore.getState().tileCache.get(11)?.[0]).toMatchObject({ id: 20, canvas_id: 11 })
  })
})
