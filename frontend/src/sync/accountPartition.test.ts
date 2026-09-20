import { afterAll, describe, expect, test } from "bun:test"
import Dexie from "dexie"
import { IDBKeyRange, indexedDB } from "fake-indexeddb"
import type { Canvas } from "../types"
import type { OutboxRecord } from "./types"

const globals = globalThis as unknown as { indexedDB: typeof indexedDB; IDBKeyRange: typeof IDBKeyRange; navigator: object }
globals.indexedDB = indexedDB
globals.IDBKeyRange = IDBKeyRange
globals.navigator = {}
Dexie.dependencies.indexedDB = indexedDB
Dexie.dependencies.IDBKeyRange = IDBKeyRange

const localDb = await import("./localDb")
const { entityKey } = await import("./ids")
const { assertSyncAccountScopeCurrent, runSyncAccountTask } = await import("./accountScope")

const legacyCanvas: Canvas = {
  id: -1,
  client_id: "legacy-canvas",
  name: "Offline draft",
  sort_order: 0,
  is_favourite: false,
  created_at: "2026-01-01T00:00:00.000Z",
}

afterAll(async () => {
  localDb.closeAccountDatabase()
  await Dexie.delete(localDb.localDbNames.account("account-a"))
  await Dexie.delete(localDb.localDbNames.account("account-b"))
  await Dexie.delete(localDb.localDbNames.account("account-race-a"))
  await Dexie.delete(localDb.localDbNames.account("account-race-b"))
  await Dexie.delete(localDb.localDbNames.account("account-signout-a"))
  await Dexie.delete(localDb.localDbNames.account("account-signout-b"))
  await Dexie.delete(localDb.localDbNames.account("account-migration"))
  await Dexie.delete(localDb.localDbNames.legacy)
})

describe("per-account IndexedDB partitioning", () => {
  test("automatically claims legacy content once and never exposes it to another account", async () => {
    await localDb.syncDb.entities.put({
      key: entityKey("canvas", "legacy-canvas"),
      entityType: "canvas",
      clientId: "legacy-canvas",
      serverId: null,
      tempId: -1,
      canvasId: -1,
      status: "dirty",
      data: legacyCanvas,
      updatedAt: Date.now(),
    })

    await localDb.configureAccountDatabase("account-a")
    expect(localDb.syncDb.name).toBe(localDb.localDbNames.account("account-a"))
    expect(await localDb.syncDb.entities.get(entityKey("canvas", "legacy-canvas"))).toBeDefined()
    expect(await Dexie.exists(localDb.localDbNames.legacy)).toBe(false)

    await localDb.configureAccountDatabase("account-b")
    expect(localDb.syncDb.name).toBe(localDb.localDbNames.account("account-b"))
    expect(await localDb.syncDb.entities.count()).toBe(0)

    await localDb.configureAccountDatabase("account-a")
    expect(await localDb.syncDb.entities.get(entityKey("canvas", "legacy-canvas"))).toBeDefined()
  })

  test("waits for old-account work before swapping the shared database handle", async () => {
    await localDb.configureAccountDatabase("account-race-a")
    let releaseTask = () => {}
    const gate = new Promise<void>((resolve) => { releaseTask = resolve })
    const oldAccountTask = runSyncAccountTask(async (scope) => {
      await gate
      await localDb.syncDb.entities.put({
        key: entityKey("canvas", "race-canvas"),
        entityType: "canvas",
        clientId: "race-canvas",
        serverId: null,
        tempId: -2,
        canvasId: -2,
        status: "dirty",
        data: { ...legacyCanvas, id: -2, client_id: "race-canvas", name: "Account A only" },
        updatedAt: Date.now(),
      })
      assertSyncAccountScopeCurrent(scope)
    })

    const switchAccount = localDb.configureAccountDatabase("account-race-b")
    await Promise.resolve()
    expect(localDb.syncDb.name).toBe(localDb.localDbNames.account("account-race-a"))
    releaseTask()
    await expect(oldAccountTask).rejects.toThrow("Sync account changed")
    await switchAccount

    expect(localDb.syncDb.name).toBe(localDb.localDbNames.account("account-race-b"))
    expect(await localDb.syncDb.entities.get(entityKey("canvas", "race-canvas"))).toBeUndefined()
    await localDb.configureAccountDatabase("account-race-a")
    expect(await localDb.syncDb.entities.get(entityKey("canvas", "race-canvas"))).toBeDefined()
  })

  test("a sign-out boundary cannot orphan work into the next signed-in account", async () => {
    await localDb.configureAccountDatabase("account-signout-a")
    let releaseTask = () => {}
    const gate = new Promise<void>((resolve) => { releaseTask = resolve })
    const oldAccountTask = runSyncAccountTask(async (scope) => {
      await gate
      await localDb.syncDb.entities.put({
        key: entityKey("canvas", "signed-out-canvas"),
        entityType: "canvas",
        clientId: "signed-out-canvas",
        serverId: null,
        tempId: -3,
        canvasId: -3,
        status: "dirty",
        data: { ...legacyCanvas, id: -3, client_id: "signed-out-canvas", name: "Signed-out account only" },
        updatedAt: Date.now(),
      })
      assertSyncAccountScopeCurrent(scope)
    })

    localDb.closeAccountDatabase()
    const nextSignIn = localDb.configureAccountDatabase("account-signout-b")
    await Promise.resolve()
    expect(localDb.syncDb.name).toBe(localDb.localDbNames.account("account-signout-a"))
    releaseTask()
    await expect(oldAccountTask).rejects.toBeInstanceOf(Error)
    await nextSignIn

    expect(localDb.syncDb.name).toBe(localDb.localDbNames.account("account-signout-b"))
    expect(await localDb.syncDb.entities.get(entityKey("canvas", "signed-out-canvas"))).toBeUndefined()
    await localDb.configureAccountDatabase("account-signout-a")
    expect(await localDb.syncDb.entities.get(entityKey("canvas", "signed-out-canvas"))).toBeUndefined()
  })

  test("version five backfills History rows for operations already in the outbox", async () => {
    localDb.closeAccountDatabase()
    const name = localDb.localDbNames.account("account-migration")
    await Dexie.delete(name)
    const versionFour = new Dexie(name)
    versionFour.version(4).stores({
      entities: "key, entityType, clientId, serverId, tempId, canvasId, status, syncDisposition, updatedAt, [entityType+serverId], [entityType+tempId]",
      outbox: "opId, entityType, clientId, serverId, status, nextAttemptAt, updatedAt",
      metadata: "key",
      queryCache: "key, updatedAt",
      syncActivity: "opId, entityType, clientId, state, createdAt, updatedAt",
    })
    await versionFour.open()
    const now = Date.now()
    await versionFour.table<OutboxRecord, string>("outbox").put({
      opId: "pre-migration-operation",
      entityType: "canvas",
      action: "upsert",
      clientId: "pre-migration-canvas",
      serverId: 7,
      payload: { name: "Renamed", sort_order: 0, is_favourite: false },
      status: "pending",
      attemptCount: 0,
      nextAttemptAt: 0,
      createdAt: now,
      updatedAt: now,
    })
    versionFour.close()

    await localDb.configureAccountDatabase("account-migration")

    expect(await localDb.syncDb.syncActivity.get("pre-migration-operation")).toMatchObject({
      opId: "pre-migration-operation",
      clientId: "pre-migration-canvas",
      state: "pending",
    })
  })
})
