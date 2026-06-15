import { beforeEach, describe, expect, test } from "bun:test"
import {
  canvas,
  entityRecord,
  resetFrontendState,
  syncDb,
  tag,
  thought,
  tile,
  useStore,
} from "../test/syncTestHarness"

beforeEach(async () => {
  await resetFrontendState()
})

describe("frontend store optimistic updates", () => {
  test("cached workspace hydration resolves without waiting for network sync", async () => {
    const globals = globalThis as unknown as {
      fetch: (path: string, init?: RequestInit) => Promise<Response>
    }
    globals.fetch = () => new Promise<Response>(() => {})
    await syncDb.entities.bulkPut([
      entityRecord({
        entityType: "canvas",
        clientId: "canvas-client",
        serverId: 10,
        tempId: null,
        canvasId: 10,
        status: "clean",
        data: canvas({ id: 10, name: "Cached" }),
      }),
      entityRecord({
        entityType: "tag",
        clientId: "tag-client",
        serverId: 40,
        tempId: null,
        canvasId: null,
        status: "clean",
        data: tag({ id: 40, name: "cached-tag" }),
      }),
      entityRecord({
        entityType: "tile",
        clientId: "tile-client",
        serverId: 20,
        tempId: null,
        canvasId: 10,
        status: "clean",
        data: tile({ id: 20, canvas_id: 10, title: "Cached tile" }),
      }),
      entityRecord({
        entityType: "thought",
        clientId: "thought-client",
        serverId: 30,
        tempId: null,
        canvasId: 10,
        status: "clean",
        data: thought({ id: 30, tile_id: 20, content: "Cached thought" }),
      }),
    ])

    const result = await useStore.getState().hydrateCachedWorkspace()
    const state = useStore.getState()

    expect(result).toEqual({ activeCanvasId: 10, hasUsableCache: true })
    expect(state.canvases[0]?.name).toBe("Cached")
    expect(state.tags[0]?.name).toBe("cached-tag")
    expect(state.tiles[0]?.title).toBe("Cached tile")
    expect(state.thoughts[0]?.content).toBe("Cached thought")
  })

  test("sync initialization starts runtime without waiting for network", async () => {
    const globals = globalThis as unknown as {
      fetch: (path: string, init?: RequestInit) => Promise<Response>
    }
    globals.fetch = () => new Promise<Response>(() => {})

    await useStore.getState().initializeSync()

    expect(useStore.getState().syncPendingCount).toBe(0)
  })

  test("adding a canvas updates visible state and queues a sync operation", async () => {
    const creation = useStore.getState().addCanvas("Ideas")
    await creation.persisted

    const state = useStore.getState()
    const records = await syncDb.outbox.toArray()

    expect(state.canvases).toHaveLength(1)
    expect(state.canvases[0]?.name).toBe("Ideas")
    expect(records).toHaveLength(1)
    expect(records[0]?.entityType).toBe("canvas")
  })

  test("renaming a tag updates local thought labels and queues the tag", async () => {
    useStore.setState({
      tags: [tag({ id: 40, name: "old" })],
      thoughts: [thought({ id: 30, tags: ["old"] })],
      thoughtCache: new Map([[10, [thought({ id: 30, tags: ["old"] })]]]),
    })

    await useStore.getState().updateTag(40, "new", "#abcdef")

    const state = useStore.getState()
    const records = await syncDb.outbox.toArray()

    expect(state.tags[0]?.name).toBe("new")
    expect(state.thoughts[0]?.tags).toEqual(["new"])
    expect(state.thoughtCache.get(10)?.[0]?.tags).toEqual(["new"])
    expect(records[0]?.entityType).toBe("tag")
    expect(records[0]?.payload).toMatchObject({ name: "new", color: "#abcdef" })
  })

  test("rapid canvas to tile to thought creation queues a dependency chain", async () => {
    const creation = useStore.getState().addCanvas("Sprint")
    await creation.persisted
    const tempCanvasId = creation.canvas.id

    useStore.setState({
      activeCanvasId: tempCanvasId,
      tiles: [],
      thoughts: [],
      tileCache: new Map([[tempCanvasId, []]]),
      thoughtCache: new Map([[tempCanvasId, []]]),
    })

    await useStore.getState().addTile({
      client_id: null,
      canvas_id: null,
      title: "Backlog",
      x: 10,
      y: 20,
      width: 300,
      height: 220,
      importance: 1,
      visible: true,
    })
    const tempTileId = useStore.getState().tiles[0]?.id
    if (tempTileId === undefined) throw new Error("Expected optimistic tile")

    await useStore.getState().addThoughtToTile(tempTileId, "Write tests", ["work"])

    const records = await syncDb.outbox.toArray()
    const tileRecord = records.find((record) => record.entityType === "tile")
    const thoughtRecord = records.find((record) => record.entityType === "thought")

    expect(records.map((record) => record.entityType).sort()).toEqual(["canvas", "thought", "tile"])
    expect(tileRecord?.payload).toMatchObject({ canvas_id: tempCanvasId, title: "Backlog" })
    expect(thoughtRecord?.payload).toMatchObject({ tile_id: tempTileId, content: "Write tests" })
  })

  test("rapid tile create then move coalesces to the final canvas position", async () => {
    useStore.setState({
      canvases: [canvas({ id: 10 }), canvas({ id: 11, name: "Later" })],
      activeCanvasId: 10,
      tileCache: new Map([[10, []], [11, []]]),
      thoughtCache: new Map([[10, []], [11, []]]),
    })

    await useStore.getState().addTile({
      client_id: null,
      canvas_id: null,
      title: "Move me",
      x: 0,
      y: 0,
      width: 280,
      height: 200,
      importance: 1,
      visible: true,
    })
    const optimisticTile = useStore.getState().tiles[0]
    if (!optimisticTile) throw new Error("Expected optimistic tile")

    await useStore.getState().moveTileToCanvas(optimisticTile.id, 11, 300, 400)

    const records = await syncDb.outbox.where("clientId").equals(optimisticTile.client_id ?? "").toArray()
    const state = useStore.getState()

    expect(records).toHaveLength(1)
    expect(records[0]?.payload).toMatchObject({ canvas_id: 11, x: 300, y: 400 })
    expect(state.tiles).toHaveLength(0)
    expect(state.tileCache.get(11)?.[0]).toMatchObject({ id: optimisticTile.id, canvas_id: 11 })
  })

  test("moving a tile across canvases carries its cached thoughts", async () => {
    const sourceTile = tile({ id: 20, canvas_id: 10 })
    const sourceThought = thought({ id: 30, tile_id: 20 })
    useStore.setState({
      canvases: [canvas({ id: 10 }), canvas({ id: 11, name: "Later" })],
      activeCanvasId: 10,
      tiles: [sourceTile],
      thoughts: [sourceThought],
      tileCache: new Map([[10, [sourceTile]], [11, []]]),
      thoughtCache: new Map([[10, [sourceThought]], [11, []]]),
    })

    await useStore.getState().moveTileToCanvas(20, 11, 50, 60)

    const state = useStore.getState()
    const records = await syncDb.outbox.toArray()

    expect(state.tiles).toHaveLength(0)
    expect(state.thoughts).toHaveLength(0)
    expect(state.tileCache.get(11)?.[0]).toMatchObject({ id: 20, canvas_id: 11 })
    expect(state.thoughtCache.get(11)?.[0]).toMatchObject({ id: 30, tile_id: 20 })
    expect(records[0]?.payload).toMatchObject({ canvas_id: 11, x: 50, y: 60 })
  })

  test("rapid thought reorder bursts keep final sort orders in the outbox", async () => {
    const thoughts = [
      thought({ id: 30, client_id: "thought-30", content: "A", sort_order: 0 }),
      thought({ id: 31, client_id: "thought-31", content: "B", sort_order: 1 }),
      thought({ id: 32, client_id: "thought-32", content: "C", sort_order: 2 }),
    ]
    useStore.setState({
      activeCanvasId: 10,
      tiles: [tile({ id: 20 })],
      thoughts,
      tileCache: new Map([[10, [tile({ id: 20 })]]]),
      thoughtCache: new Map([[10, thoughts]]),
    })

    await useStore.getState().moveThoughtToTile(32, 20, { targetCanvasId: 10, orderedIds: [32, 31, 30] })
    await useStore.getState().moveThoughtToTile(31, 20, { targetCanvasId: 10, orderedIds: [31, 30, 32] })

    const records = await syncDb.outbox.toArray()
    const orderByClientId = new Map(records.map((record) => [record.clientId, record.payload.sort_order]))
    const finalOrder = [...useStore.getState().thoughts]
      .sort((left, right) => left.sort_order - right.sort_order)
      .map((item) => [item.id, item.sort_order])

    expect(finalOrder).toEqual([[31, 0], [30, 1], [32, 2]])
    expect(orderByClientId.get("thought-31")).toBe(0)
    expect(orderByClientId.get("thought-30")).toBe(1)
    expect(orderByClientId.get("thought-32")).toBe(2)
  })

  test("temporary tile with temporary thoughts can be deleted before flush", async () => {
    useStore.setState({
      activeCanvasId: 10,
      tileCache: new Map([[10, []]]),
      thoughtCache: new Map([[10, []]]),
    })

    await useStore.getState().addTile({
      client_id: null,
      canvas_id: 10,
      title: "Disposable",
      x: 0,
      y: 0,
      width: 280,
      height: 200,
      importance: 1,
      visible: true,
    })
    const optimisticTile = useStore.getState().tiles[0]
    if (!optimisticTile) throw new Error("Expected optimistic tile")
    await useStore.getState().addThoughtToTile(optimisticTile.id, "Disposable thought", [])

    await useStore.getState().removeTile(optimisticTile.id)

    expect(useStore.getState().tiles).toHaveLength(0)
    expect(useStore.getState().thoughts).toHaveLength(0)
    expect(await syncDb.outbox.toArray()).toHaveLength(0)
    expect(await syncDb.entities.toArray()).toHaveLength(0)
  })

  test("deleting a canvas with moveContents moves known children and queues server work", async () => {
    const sourceTile = tile({ id: 20, client_id: "tile-20", canvas_id: 10 })
    const sourceThought = thought({ id: 30, client_id: "thought-30", tile_id: 20 })
    useStore.setState({
      canvases: [canvas({ id: 10 }), canvas({ id: 11, name: "Target" })],
      activeCanvasId: 10,
      tiles: [sourceTile],
      thoughts: [sourceThought],
      tileCache: new Map([[10, [sourceTile]], [11, []]]),
      thoughtCache: new Map([[10, [sourceThought]], [11, []]]),
    })

    await useStore.getState().removeCanvas(10, { mode: "moveContents", targetCanvasId: 11 })

    const state = useStore.getState()
    const records = await syncDb.outbox.toArray()
    const canvasDelete = records.find((record) => record.entityType === "canvas" && record.action === "delete")
    const tileUpsert = records.find((record) => record.entityType === "tile" && record.action === "upsert")

    expect(state.activeCanvasId).toBe(11)
    expect(state.tileCache.get(11)?.[0]).toMatchObject({ id: 20, canvas_id: 11 })
    expect(state.thoughtCache.get(11)?.[0]).toMatchObject({ id: 30, tile_id: 20 })
    expect(canvasDelete?.payload).toMatchObject({ mode: "moveContents", targetCanvasId: 11 })
    expect(tileUpsert?.payload).toMatchObject({ canvas_id: 11 })
  })
})
