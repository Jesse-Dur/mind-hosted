import { beforeEach, describe, expect, test } from "bun:test"
import type { SyncPushOperation, SyncPushResponse } from "./types"
import {
  canvas,
  entityKey,
  entityRecord,
  outboxRecord,
  resetFrontendState,
  syncDb,
  tile,
} from "../test/syncTestHarness"

const { flushSyncQueue } = await import("./flush")

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
let fetchError: Error | null = null

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
    return {
      ok: true,
      status: 200,
      json: async () => fetchResponse,
      text: async () => JSON.stringify(fetchResponse),
    }
  }
}

beforeEach(async () => {
  await resetFrontendState()
  fetchCalls.length = 0
  fetchError = null
  fetchResponse = { results: [] }
  installFetchMock()
})

describe("frontend sync flush", () => {
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

    expect(fetchCalls).toHaveLength(1)
    expect(child?.canvasId).toBe(10)
    expect(child?.data).toMatchObject({ canvas_id: 10 })
    expect(childOperation?.payload).toMatchObject({ canvas_id: 10 })
  })
})
