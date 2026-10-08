import { afterAll, describe, expect, spyOn, test } from "bun:test"
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
const { assertSyncAccountScopeCurrent, currentSyncAccountScope, runSyncAccountTask, suspendSyncAccount } = await import("./accountScope")

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
  for (const phase of ["open", "lock"]) {
    await Dexie.delete(localDb.localDbNames.account(`account-poll-${phase}-a`))
    await Dexie.delete(localDb.localDbNames.account(`account-poll-${phase}-b`))
  }
  await Dexie.delete(localDb.localDbNames.account("account-unscoped"))
  await Dexie.delete(localDb.localDbNames.account("account-stale-opening"))
  await Dexie.delete(localDb.localDbNames.account("account-newer-opening"))
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
    // Start the task before initiating the transition; queued work is rejected.
    await Promise.resolve()

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
    await Promise.resolve()

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

  for (const phase of ["open", "lock"] as const) {
    test(`the App sync poll cannot upload old-account drafts while waiting for ${phase}`, async () => {
      const { setGetToken, useStore } = await import("../test/syncTestHarness")
      const from = `account-poll-${phase}-a`
      const to = `account-poll-${phase}-b`
      await localDb.configureAccountDatabase(from)
      const draft: OutboxRecord = {
        opId: `private-${phase}`, entityType: "canvas", action: "upsert", clientId: `private-${phase}`,
        serverId: null, payload: { name: "Account A private draft" }, status: "pending", attemptCount: 0,
        nextAttemptAt: 0, createdAt: 1, updatedAt: 1,
      }
      await localDb.syncDb.outbox.put(draft)
      const originalFetch = globalThis.fetch
      const originalNavigator = globalThis.navigator
      let requests = 0
      globalThis.fetch = async () => { requests += 1; return Response.json({ results: [] }) }
      let release!: () => void
      const gate = new Promise<void>((resolve) => { release = resolve })
      let entered!: () => void
      const waiting = new Promise<void>((resolve) => { entered = resolve })
      const originalOpen = localDb.MindSyncDb.prototype.open
      const open = phase === "open" ? spyOn(localDb.MindSyncDb.prototype, "open").mockImplementation(function () {
        if (this.name !== localDb.localDbNames.account(to)) return originalOpen.call(this)
        entered()
        return gate.then(() => originalOpen.call(this)) as ReturnType<typeof originalOpen>
      }) : null
      if (phase === "lock") {
        Object.defineProperty(globalThis, "navigator", { configurable: true, value: {
          locks: { request: async (_name: string, work: () => Promise<void>) => { entered(); await gate; return work() } },
        } })
      }
      // App fences before exposing Clerk's new token or waiting for its boot queue.
      suspendSyncAccount()
      setGetToken(async () => "account-b-token")
      await expect(useStore.getState().syncNow()).rejects.toThrow("Sync account changed")
      const switching = localDb.configureAccountDatabase(to)
      try {
        await waiting
        expect(currentSyncAccountScope()?.userId).toBe(from)
        expect(localDb.getActiveSyncUserId()).toBe(from)
        await expect(useStore.getState().syncNow()).rejects.toThrow("Sync account changed")
        expect(requests).toBe(0)
        expect(await localDb.syncDb.outbox.get(draft.opId)).toEqual(draft)
      } finally {
        release()
        await switching
        open?.mockRestore()
        globalThis.fetch = originalFetch
        Object.defineProperty(globalThis, "navigator", { configurable: true, value: originalNavigator })
      }
      expect(currentSyncAccountScope()?.userId).toBe(to)
      expect(localDb.getActiveSyncUserId()).toBe(to)
      expect(await localDb.syncDb.outbox.count()).toBe(0)
      await localDb.configureAccountDatabase(from)
      expect(await localDb.syncDb.outbox.get(draft.opId)).toEqual(draft)
    })
  }

  test("initial account preparation waits for unscoped work and blocks new tasks", async () => {
    localDb.closeAccountDatabase()
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const previousWork = runSyncAccountTask(async (scope) => {
      expect(scope).toBeNull()
      await gate
      assertSyncAccountScopeCurrent(scope)
    })
    void previousWork.catch(() => {})
    await Promise.resolve()
    const originalOpen = localDb.MindSyncDb.prototype.open
    let opened = false
    const open = spyOn(localDb.MindSyncDb.prototype, "open").mockImplementation(function () {
      opened = true
      return originalOpen.call(this)
    })
    const switching = localDb.configureAccountDatabase("account-unscoped")
    try {
      await Promise.resolve()
      expect(opened).toBe(false)
      let started = false
      await expect(runSyncAccountTask(async () => { started = true })).rejects.toThrow("Sync account changed")
      expect(started).toBe(false)
      release()
      await expect(previousWork).rejects.toThrow("Sync account changed")
      await switching
      expect(currentSyncAccountScope()?.userId).toBe("account-unscoped")
      expect(localDb.getActiveSyncUserId()).toBe("account-unscoped")
    } finally { release(); await switching; open.mockRestore() }
  })

  test("a stale database opening cannot replace a newer account", async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    let entered!: () => void
    const waiting = new Promise<void>((resolve) => { entered = resolve })
    const originalOpen = localDb.MindSyncDb.prototype.open
    const open = spyOn(localDb.MindSyncDb.prototype, "open").mockImplementation(function () {
      if (this.name !== localDb.localDbNames.account("account-stale-opening")) return originalOpen.call(this)
      entered()
      return gate.then(() => originalOpen.call(this)) as ReturnType<typeof originalOpen>
    })
    const staleOpening = localDb.configureAccountDatabase("account-stale-opening")
    void staleOpening.catch(() => {})
    try {
      await waiting
      await localDb.configureAccountDatabase("account-newer-opening")
      release()
      await expect(staleOpening).rejects.toThrow("Sync account changed")
      expect(localDb.getActiveSyncUserId()).toBe("account-newer-opening")
      expect(localDb.syncDb.name).toBe(localDb.localDbNames.account("account-newer-opening"))
      expect(currentSyncAccountScope()?.userId).toBe("account-newer-opening")
    } finally { release(); await staleOpening.catch(() => {}); open.mockRestore() }
  })
})
