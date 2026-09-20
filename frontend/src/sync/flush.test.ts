import { beforeEach, describe, expect, test } from "bun:test"
import type { SyncPushOperation, SyncPushResponse } from "./types"
import { isReauthRequired, notifyReauthRequired } from "../auth/reauthSignal"
import {
  canvas,
  entityKey,
  entityRecord,
  outboxRecord,
  resetFrontendState,
  setGetToken,
  syncDb,
  tag,
  thought,
  tile,
} from "../test/syncTestHarness"

const { flushSyncQueue } = await import("./flush")
const { startSyncRuntime, stopSyncRuntime } = await import("./runtime")

async function reconnect() {
  const addEventListener = window.addEventListener
  let online: (() => void | Promise<void>) | undefined
  window.addEventListener = (type, listener) => {
    if (type === "online") online = listener as () => void | Promise<void>
  }
  try {
    startSyncRuntime()
    if (!online) throw new Error("Missing online listener")
    await online()
    // The test harness does not run window timers; run the scheduled flush too.
    await flushSyncQueue()
  } finally {
    stopSyncRuntime()
    window.addEventListener = addEventListener
  }
}

type MockResponse = {
  ok: boolean
  status: number
  json: () => Promise<SyncPushResponse>
  text: () => Promise<string>
}

type FetchCall = {
  path: string
  operation: SyncPushOperation
}

const fetchCalls: FetchCall[] = []
let fetchResponse: SyncPushResponse = { results: [] }
let fetchResponder: ((operation: SyncPushOperation) => SyncPushResponse) | null = null
let fetchError: Error | null = null
let fetchStatus = 200

function installFetchMock() {
  const globals = globalThis as unknown as {
    fetch: (path: string, init?: RequestInit) => Promise<MockResponse>
  }
  globals.fetch = async (path, init) => {
    if (fetchError) throw fetchError
    const body = typeof init?.body === "string"
      ? JSON.parse(init.body) as { operations: SyncPushOperation[] }
      : { operations: [] }
    const operation = body.operations[0]
    if (!operation) throw new Error("Expected one sync operation")
    fetchCalls.push({ path, operation })
    const response = fetchResponder?.(operation) ?? fetchResponse
    const ok = fetchStatus >= 200 && fetchStatus < 300
    return {
      ok,
      status: fetchStatus,
      json: async () => response,
      text: async () => JSON.stringify(ok ? response : { error: "Unauthorized" }),
    }
  }
}

beforeEach(async () => {
  await resetFrontendState()
  fetchCalls.length = 0
  fetchError = null
  fetchStatus = 200
  fetchResponse = { results: [] }
  fetchResponder = null
  installFetchMock()
})

describe("frontend sync flush", () => {
  test.each(["throws", "returns null"])("sync resumes after token retrieval %s during an outage", async (failure) => {
    const { enqueueUpsert } = await import("./outbox")
    await enqueueUpsert("thought", thought({ id: 30, client_id: "first" }))
    await enqueueUpsert("thought", thought({ id: 31, client_id: "second" }))
    let tokensAvailable = true
    setGetToken(async () => {
      if (tokensAvailable) return "test-token"
      if (failure === "throws") throw new TypeError("Failed to fetch")
      return null
    })
    fetchResponder = (op) => {
      tokensAvailable = false
      return { results: [{ ...op, ok: true, revision: 1, entity: thought({ id: op.server_id!, client_id: op.client_id! }) }] }
    }
    await flushSyncQueue()
    expect(fetchCalls).toHaveLength(1)
    const pending = (await syncDb.outbox.toArray())[0]!
    expect(pending.status).toBe("pending")

    // Connectivity can return before Clerk can obtain a fresh token.
    await reconnect()
    tokensAvailable = true
    await flushSyncQueue()

    expect(fetchCalls).toHaveLength(2)
    expect(fetchCalls[1]?.operation.op_id).toBe(pending.opId)
    expect(await syncDb.outbox.count()).toBe(0)
    expect((await syncDb.syncActivity.toArray()).every((activity) => activity.state === "synced")).toBe(true)
  })

  test("reconnecting rechecks a previously latched auth failure", async () => {
    const { enqueueUpsert } = await import("./outbox")
    await enqueueUpsert("thought", thought())
    notifyReauthRequired()
    fetchResponder = (op) => ({ results: [{ ...op, ok: true, revision: 1, entity: thought() }] })
    await reconnect()
    expect(fetchCalls).toHaveLength(1)
    expect(await syncDb.outbox.count()).toBe(0)
    expect(isReauthRequired()).toBe(false)
  })

  test("reconnecting retries a network failure before its backoff expires", async () => {
    const { enqueueUpsert } = await import("./outbox")
    await enqueueUpsert("thought", thought({ content: "Saved offline" }))
    fetchError = new TypeError("Failed to fetch")
    await flushSyncQueue()
    const failed = (await syncDb.outbox.toArray())[0]!
    expect(failed.nextAttemptAt).toBeGreaterThan(Date.now())
    // Make the assertion independent of how long the test machine takes.
    await syncDb.outbox.update(failed.opId, { nextAttemptAt: Date.now() + 60000 })
    fetchError = null
    fetchResponder = (op) => ({ results: [{ ...op, ok: true, revision: 1, entity: thought({ content: "Saved offline" }) }] })

    await reconnect()

    expect(fetchCalls).toHaveLength(1)
    expect(fetchCalls[0]?.operation.op_id).toBe(failed.opId)
    expect(await syncDb.outbox.count()).toBe(0)
    expect((await syncDb.syncActivity.get(failed.opId))?.state).toBe("synced")
  })

  test("reconnecting preserves rejected and local-only operations", async () => {
    for (const status of ["error", "local_only"] as const) {
      await syncDb.outbox.put({
        ...outboxRecord({ opId: status, entityType: "thought", action: "upsert", clientId: status, serverId: 30, payload: { tile_id: 20 } }),
        status, attemptCount: 1, nextAttemptAt: Date.now() + 60000, error: "Do not retry",
      })
    }
    const before = await syncDb.outbox.toArray()

    await reconnect()

    expect(fetchCalls).toHaveLength(0)
    expect(await syncDb.outbox.toArray()).toEqual(before)
  })

  test("reconnecting during a failing upload waits for it and then retries once", async () => {
    const { enqueueUpsert } = await import("./outbox")
    await enqueueUpsert("thought", thought())
    const inFlight = Promise.withResolvers<Response>()
    const requested = Promise.withResolvers<void>()
    let calls = 0
    globalThis.fetch = async (_path, init) => {
      const op = JSON.parse(init!.body as string).operations[0] as SyncPushOperation
      if (++calls === 1) {
        requested.resolve()
        return inFlight.promise
      }
      return Response.json({ results: [{ ...op, ok: true, revision: 1, entity: thought() }] })
    }
    const flushing = flushSyncQueue()
    await requested.promise
    const reconnected = reconnect()
    expect(calls).toBe(1)
    inFlight.reject(new TypeError("Failed to fetch"))
    await Promise.all([flushing, reconnected])

    expect(calls).toBe(2)
    expect(await syncDb.outbox.count()).toBe(0)
  })

  test("new canvas and tile string IDs are numeric for queued children and moves", async () => {
    const { enqueueUpsert } = await import("./outbox")
    await enqueueUpsert("canvas", canvas({ id: -10, client_id: "new-canvas" }))
    await enqueueUpsert("tile", tile({ id: -20, client_id: "new-tile", canvas_id: -10 }))
    await enqueueUpsert("tile", tile({ id: 21, client_id: "moved-tile", canvas_id: -10 }))
    await enqueueUpsert("thought", thought({ id: -30, client_id: "new-thought", tile_id: -20 }))
    await enqueueUpsert("thought", thought({ id: 31, client_id: "moved-thought", tile_id: -20 }))
    await syncDb.entities.put(entityRecord({
      entityType: "thought", clientId: "local-thought", serverId: null, tempId: -32,
      canvasId: null, status: "dirty", syncDisposition: "local_only",
      data: thought({ id: -32, client_id: "local-thought", tile_id: -20 }),
    }))
    fetchResponder = (operation) => {
      if (operation.entity_type === "tile" && operation.payload.canvas_id !== 10) {
        return { results: [{ ...operation, ok: false, error: "Invalid canvas id", revision: null }] }
      }
      if (operation.entity_type === "thought" && operation.payload.tile_id !== 20) {
        return { results: [{ ...operation, ok: false, error: "Invalid tile id", revision: null }] }
      }
      const id = operation.server_id ?? (operation.entity_type === "canvas" ? 10 : operation.entity_type === "tile" ? 20 : 30)
      // BIGSERIAL IDs arrive as strings from Postgres, despite the API's TS types.
      return { results: [{
        ...operation, ok: true, server_id: String(id), revision: fetchCalls.length,
        entity: { ...operation.payload, id: String(id), client_id: operation.client_id },
      }] } as unknown as SyncPushResponse
    }

    await flushSyncQueue()

    expect(fetchCalls.filter(({ operation }) => operation.entity_type === "tile")
      .map(({ operation }) => operation.payload.canvas_id)).toEqual([10, 10])
    expect(fetchCalls.filter(({ operation }) => operation.entity_type === "thought")
      .map(({ operation }) => operation.payload.tile_id)).toEqual([20, 20])
    expect(await syncDb.outbox.count()).toBe(0)
    expect((await syncDb.entities.get(entityKey("thought", "local-thought")))?.data).toMatchObject({ tile_id: 20 })
    for (const clientId of ["new-thought", "moved-thought"]) {
      expect((await syncDb.entities.get(entityKey("thought", clientId)))?.data).toMatchObject({ tile_id: 20 })
    }
  })

  test("moving a deleted canvas's contents to a new canvas sends a numeric target ID", async () => {
    const { enqueueDelete, enqueueUpsert } = await import("./outbox")
    await enqueueUpsert("canvas", canvas({ id: -10, client_id: "new-canvas" }))
    await enqueueDelete("canvas", canvas({ id: 11 }), { mode: "moveContents", targetCanvasId: -10 })
    fetchResponder = (operation) => ({ results: [{
      ...operation, ok: true, server_id: String(operation.server_id ?? 10), revision: fetchCalls.length,
      ...(operation.action === "upsert" ? { entity: { ...canvas(), id: "10", client_id: operation.client_id } } : {}),
    }] } as unknown as SyncPushResponse)

    await flushSyncQueue()

    expect(fetchCalls.map(({ operation }) => operation.action)).toEqual(["upsert", "delete"])
    expect(fetchCalls[1]?.operation.payload.targetCanvasId).toBe(10)
    expect(await syncDb.outbox.count()).toBe(0)
  })

  test.each([
    ["canvas", canvas({ id: -10 })],
    ["tile", tile({ id: -20 })],
    ["thought", thought({ id: -30 })],
    ["tag", tag({ id: -40 })],
  ] as const)("%s create, edit and delete keep numeric IDs with string acknowledgements", async (entityType, entity) => {
    const { enqueueDelete, enqueueUpsert } = await import("./outbox")
    await enqueueUpsert(entityType, entity)
    await enqueueUpsert(entityType, { ...entity, ...("name" in entity ? { name: "Edited" } : "content" in entity ? { content: "Edited" } : { title: "Edited" }) })
    await enqueueDelete(entityType, entity)
    fetchResponder = (operation) => ({ results: [{
      ...operation, ok: true, server_id: String(-entity.id), revision: fetchCalls.length,
      ...(operation.action === "upsert" ? { entity: { ...entity, ...operation.payload, id: String(-entity.id) } } : {}),
    }] } as unknown as SyncPushResponse)

    await flushSyncQueue()

    expect(fetchCalls.map(({ operation }) => operation.action)).toEqual(["upsert", "upsert", "delete"])
    expect(fetchCalls.map(({ operation }) => operation.server_id)).toEqual([null, -entity.id, -entity.id])
    expect(await syncDb.outbox.count()).toBe(0)
    expect(await syncDb.entities.count()).toBe(0)
  })

  test("retry repairs a thought's string tile ID saved by an earlier acknowledgement", async () => {
    const { retrySyncOperation } = await import("./resolution")
    await syncDb.outbox.put({
      ...outboxRecord({
        opId: "failed-thought", entityType: "thought", action: "upsert",
        clientId: "thought-client", serverId: "30" as unknown as number, payload: { tile_id: "20", content: "Keep me" },
      }),
      status: "error", error: "Invalid tile id",
    })
    fetchResponder = (operation) => operation.payload.tile_id === 20
      ? { results: [{ ...operation, ok: true, server_id: 30, revision: 1, entity: thought({ content: "Keep me" }) }] }
      : { results: [{ ...operation, ok: false, error: "Invalid tile id", revision: null }] }

    await retrySyncOperation("failed-thought")
    await flushSyncQueue()

    expect(fetchCalls[0]?.operation.payload.tile_id).toBe(20)
    expect(fetchCalls[0]?.operation.server_id).toBe(30)
    expect(await syncDb.outbox.count()).toBe(0)
  })

  test("unresolved temporary parent dependencies stay queued without a network call", async () => {
    await syncDb.outbox.put(outboxRecord({
      opId: "blocked-tile-op",
      entityType: "tile",
      action: "upsert",
      clientId: "blocked-tile",
      serverId: null,
      payload: { canvas_id: -10, title: "Blocked" },
    }))

    await flushSyncQueue()

    const record = await syncDb.outbox.get("blocked-tile-op")
    expect(fetchCalls).toHaveLength(0)
    expect(record?.status).toBe("pending")
  })

  test("network failure records retry metadata and preserves the operation", async () => {
    fetchError = new Error("offline")
    await syncDb.outbox.put(outboxRecord({
      opId: "retry-tile-op",
      entityType: "tile",
      action: "upsert",
      clientId: "retry-tile",
      serverId: 20,
      payload: { canvas_id: 10, title: "Retry" },
    }))

    await flushSyncQueue()

    const record = await syncDb.outbox.get("retry-tile-op")
    expect(record?.status).toBe("pending")
    expect(record?.attemptCount).toBe(1)
    expect(record?.nextAttemptAt).toBeGreaterThan(Date.now())
    expect(record?.error).toBe("offline")
  })

  test("missing auth token leaves pending operations untouched without a fetch", async () => {
    setGetToken(() => Promise.resolve(null))
    await syncDb.outbox.put(outboxRecord({
      opId: "auth-paused-tile-op",
      entityType: "tile",
      action: "upsert",
      clientId: "auth-paused-tile",
      serverId: 20,
      payload: { canvas_id: 10, title: "Paused" },
    }))

    await flushSyncQueue()

    const record = await syncDb.outbox.get("auth-paused-tile-op")
    expect(fetchCalls).toHaveLength(0)
    expect(record?.status).toBe("pending")
    expect(record?.attemptCount).toBe(0)
    expect(record?.error).toBeUndefined()
    expect(isReauthRequired()).toBe(false)
  })

  test("token refresh failures pause sync without retry penalty", async () => {
    setGetToken(() => Promise.reject(new Error("session expired")))
    await syncDb.outbox.put(outboxRecord({
      opId: "expired-token-tile-op",
      entityType: "tile",
      action: "upsert",
      clientId: "expired-token-tile",
      serverId: 20,
      payload: { canvas_id: 10, title: "Expired" },
    }))

    await flushSyncQueue()

    const record = await syncDb.outbox.get("expired-token-tile-op")
    expect(fetchCalls).toHaveLength(0)
    expect(record?.status).toBe("pending")
    expect(record?.attemptCount).toBe(0)
    expect(record?.error).toBeUndefined()
    expect(isReauthRequired()).toBe(false)
  })

  test("unauthorized responses retry with a fresh token before pausing sync", async () => {
    const tokenOptions: Array<{ skipCache?: boolean } | undefined> = []
    setGetToken((options) => {
      tokenOptions.push(options)
      return Promise.resolve("test-token")
    })
    fetchStatus = 401
    await syncDb.outbox.put(outboxRecord({
      opId: "refresh-token-tile-op",
      entityType: "tile",
      action: "upsert",
      clientId: "refresh-token-tile",
      serverId: 20,
      payload: { canvas_id: 10, title: "Refresh" },
    }))

    await flushSyncQueue()

    const record = await syncDb.outbox.get("refresh-token-tile-op")
    expect(fetchCalls).toHaveLength(2)
    expect(tokenOptions.map((options) => options?.skipCache === true)).toEqual([false, true])
    expect(record?.status).toBe("pending")
    expect(record?.attemptCount).toBe(0)
    expect(record?.error).toBeUndefined()
    expect(isReauthRequired()).toBe(true)
  })

  test("stale flushing records are retried and removed after server ack", async () => {
    await syncDb.entities.put(entityRecord({
      entityType: "tile",
      clientId: "stale-tile",
      serverId: 20,
      tempId: null,
      canvasId: 10,
      status: "dirty",
      data: tile({ id: 20, client_id: "stale-tile", title: "Old" }),
    }))
    await syncDb.outbox.put({
      ...outboxRecord({
        opId: "stale-tile-op",
        entityType: "tile",
        action: "upsert",
        clientId: "stale-tile",
        serverId: 20,
        payload: { canvas_id: 10, title: "New" },
      }),
      status: "flushing",
      updatedAt: Date.now() - 121000,
    })
    fetchResponse = {
      results: [{
        ok: true,
        op_id: "stale-tile-op",
        entity_type: "tile",
        action: "upsert",
        client_id: "stale-tile",
        server_id: 20,
        revision: 7,
        entity: tile({ id: 20, client_id: "stale-tile", title: "New" }),
      }],
    }

    await flushSyncQueue()

    const entity = await syncDb.entities.get(entityKey("tile", "stale-tile"))
    expect(fetchCalls).toHaveLength(1)
    expect(await syncDb.outbox.get("stale-tile-op")).toBeUndefined()
    expect(entity?.status).toBe("clean")
    expect(entity?.data).toMatchObject({ title: "New" })
  })

  test("server ack for a temporary canvas rewrites pending child payloads", async () => {
    await syncDb.entities.put(entityRecord({
      entityType: "canvas",
      clientId: "temp-canvas",
      serverId: null,
      tempId: -10,
      canvasId: -10,
      status: "dirty",
      data: canvas({ id: -10, client_id: "temp-canvas" }),
    }))
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
      opId: "temp-canvas-op",
      entityType: "canvas",
      action: "upsert",
      clientId: "temp-canvas",
      serverId: null,
      payload: { name: "New Canvas", sort_order: 0, is_favourite: false },
    }))
    await syncDb.outbox.put(outboxRecord({
      opId: "child-tile-op",
      entityType: "tile",
      action: "upsert",
      clientId: "child-tile",
      serverId: null,
      payload: { canvas_id: -10, title: "Child" },
    }))
    fetchResponse = {
      results: [{
        ok: true,
        op_id: "temp-canvas-op",
        entity_type: "canvas",
        action: "upsert",
        client_id: "temp-canvas",
        server_id: 10,
        revision: 1,
        entity: canvas({ id: 10, client_id: "temp-canvas", name: "New Canvas" }),
      }],
    }

    await flushSyncQueue()

    const child = await syncDb.entities.get(entityKey("tile", "child-tile"))
    const childOperation = await syncDb.outbox.get("child-tile-op")

    expect(fetchCalls.length).toBeGreaterThanOrEqual(1)
    expect(child?.canvasId).toBe(10)
    expect(child?.data).toMatchObject({ canvas_id: 10 })
    if (childOperation) {
      expect(childOperation.payload).toMatchObject({ canvas_id: 10 })
    } else {
      expect(fetchCalls.some((call) => call.operation.client_id === "child-tile" && call.operation.payload.canvas_id === 10)).toBe(true)
    }
  })

  test("completed actions for one entity flush sequentially without losing history", async () => {
    const { enqueueUpsert } = await import("./outbox")
    await syncDb.entities.put(entityRecord({
      entityType: "tile",
      clientId: "tile-client",
      serverId: 20,
      tempId: null,
      canvasId: 10,
      status: "clean",
      data: tile({ title: "Before" }),
      confirmedData: tile({ title: "Before" }),
    }))
    await enqueueUpsert("tile", tile({ title: "Draft" }))
    await enqueueUpsert("tile", tile({ title: "Final" }))
    fetchResponder = (operation) => ({
      results: [{
        ok: true,
        op_id: operation.op_id,
        entity_type: "tile",
        action: "upsert",
        client_id: "tile-client",
        server_id: 20,
        revision: fetchCalls.length,
        entity: tile({ title: String(operation.payload.title) }),
      }],
    })

    await flushSyncQueue()

    expect(fetchCalls.map((call) => call.operation.payload.title)).toEqual(["Draft", "Final"])
    expect(await syncDb.outbox.count()).toBe(0)
    expect((await syncDb.entities.get(entityKey("tile", "tile-client")))?.data).toMatchObject({ title: "Final" })
    const activities = await syncDb.syncActivity.orderBy("createdAt").toArray()
    expect(activities.map((activity) => activity.state)).toEqual(["synced", "synced"])
    expect(fetchCalls.map((call) => Date.parse(call.operation.occurred_at!))).toEqual(activities.map((activity) => activity.createdAt))
  })

  test("internal grouped updates tell the server not to duplicate History", async () => {
    await syncDb.entities.put(entityRecord({
      entityType: "tile",
      clientId: "internal-tile",
      serverId: 20,
      tempId: null,
      canvasId: 10,
      status: "dirty",
      data: tile({ client_id: "internal-tile" }),
    }))
    await syncDb.outbox.put({
      ...outboxRecord({
        opId: "internal-tile-op",
        entityType: "tile",
        action: "upsert",
        clientId: "internal-tile",
        serverId: 20,
        payload: { canvas_id: 10, title: "Internal" },
      }),
      recordHistory: false,
    })
    fetchResponse = {
      results: [{
        ok: true,
        op_id: "internal-tile-op",
        entity_type: "tile",
        action: "upsert",
        client_id: "internal-tile",
        server_id: 20,
        revision: 9,
        entity: tile({ client_id: "internal-tile", title: "Internal" }),
      }],
    }

    await flushSyncQueue()

    expect(fetchCalls[0]?.operation.write_history).toBe(false)
  })
})
