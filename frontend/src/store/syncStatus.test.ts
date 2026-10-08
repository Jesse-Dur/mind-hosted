import { beforeEach, expect, spyOn, test } from "bun:test"
import Dexie from "dexie"
import { resetFrontendState, syncDb, useStore } from "../test/syncTestHarness"
import { activityFromOutbox } from "../sync/activity"
import { MindSyncDb } from "../sync/localDb"
import { lastSyncAcknowledgedAt, markSyncAcknowledged, notifySyncStatusChanged, readSyncActivityPage, SYNC_ACTIVITY_PAGE_SIZE } from "../sync/status"
import { invalidateSyncAccount, prepareSyncAccount } from "../sync/accountScope"
import type { SyncActivityRecord } from "../sync/types"
import { outboxRecord } from "../test/syncTestHarness"

function activity(index: number, overrides: Partial<SyncActivityRecord> = {}): SyncActivityRecord {
  return { opId: `activity-${index}`, entityType: "thought", clientId: `thought-${index}`, action: "upsert", state: "synced", summary: `Saved ${index}`, error: null, createdAt: index, updatedAt: index, historyCreatedAt: index, ...overrides }
}

beforeEach(resetFrontendState)

test("routine activity reads stay bounded and preserve old issues and loaded server matches", async () => {
  const saved = Array.from({ length: 1000 }, (_,index) => activity(index))
  const hidden = Array.from({ length: 1000 }, (_,index) => activity(2000 + index, { hidden: true, historyCreatedAt: undefined }))
  const issues = [activity(-1, { state: "error" }), activity(-2, { state: "local_only" }), activity(-3, { state: "pending" })]
  await syncDb.syncActivity.bulkPut([...saved, ...hidden, ...issues])
  const page = await readSyncActivityPage(SYNC_ACTIVITY_PAGE_SIZE, [saved[1]!.opId])
  expect(page.hasMore).toBe(true)
  expect(page.activity).toHaveLength(SYNC_ACTIVITY_PAGE_SIZE + issues.length + 1)
  expect(page.activity).toContainEqual(saved[1])
  for (const issue of issues) expect(page.activity).toContainEqual(issue)
  expect(page.activity.every((row) => !row.hidden)).toBe(true)
  expect(await syncDb.syncActivity.count()).toBe(2003)
})

test("scrolling loads every retained local entry and refresh preserves loaded depth", async () => {
  await syncDb.syncActivity.bulkPut(Array.from({ length: 450 }, (_,index) => activity(index, { state: index % 2 ? "synced" : "discarded" })))
  await useStore.getState().refreshSyncStatuses()
  expect(useStore.getState().syncActivity).toHaveLength(200)
  expect(useStore.getState().syncActivityHasMore).toBe(true)
  await useStore.getState().loadMoreSyncActivity()
  expect(useStore.getState().syncActivity).toHaveLength(400)
  await useStore.getState().loadMoreSyncActivity()
  expect(useStore.getState().syncActivity).toHaveLength(450)
  expect(useStore.getState().syncActivityHasMore).toBe(false)
  await useStore.getState().refreshSyncStatuses()
  expect(useStore.getState().syncActivity).toHaveLength(450)
  expect(await syncDb.syncActivity.count()).toBe(450)
  useStore.getState().resetStore()
  expect(useStore.getState().syncActivityLimit).toBe(SYNC_ACTIVITY_PAGE_SIZE)
  expect(useStore.getState().syncActivity).toEqual([])
})

test("legacy visible activity gains the paging index without removing hidden markers", async () => {
  const name = "mind-history-paging-upgrade-test"
  await Dexie.delete(name)
  const legacy = new Dexie(name)
  legacy.version(5).stores({
    entities: "key, entityType, clientId, serverId, tempId, canvasId, status, syncDisposition, updatedAt, [entityType+serverId], [entityType+tempId]",
    outbox: "opId, entityType, clientId, serverId, status, nextAttemptAt, updatedAt",
    metadata: "key", queryCache: "key, updatedAt", syncActivity: "opId, entityType, clientId, state, createdAt, updatedAt",
  })
  const visible = activity(1, { historyCreatedAt: undefined })
  const hidden = activity(2, { hidden: true, historyCreatedAt: undefined })
  await legacy.table("syncActivity").bulkPut([visible, hidden])
  legacy.close()
  const upgraded = new MindSyncDb(name)
  try {
    await upgraded.open()
    expect(await upgraded.syncActivity.orderBy("historyCreatedAt").toArray()).toEqual([{ ...visible, historyCreatedAt: 1 }])
    expect(await upgraded.syncActivity.get(hidden.opId)).toEqual(hidden)
    expect(await upgraded.syncActivity.count()).toBe(2)
  } finally { upgraded.close(); await Dexie.delete(name) }
})

test("a burst of notifications causes one bounded status refresh", async () => {
  await prepareSyncAccount("notification-test")
  const originalSetTimeout = window.setTimeout
  const originalClearTimeout = window.clearTimeout
  const callbacks: Array<() => void> = []
  window.setTimeout = (handler, delay) => { if (delay === 100) callbacks.push(handler as () => void); return callbacks.length + 100 }
  window.clearTimeout = () => {}
  let reads = 0
  const orderBy = syncDb.syncActivity.orderBy.bind(syncDb.syncActivity)
  const read = spyOn(syncDb.syncActivity, "orderBy").mockImplementation((index) => { if (index === "historyCreatedAt") reads++; return orderBy(index) })
  try {
    await syncDb.syncActivity.bulkPut(Array.from({ length: 1000 }, (_,index) => activity(index)))
    await useStore.getState().startSyncRuntime()
    reads = 0
    await syncDb.syncActivity.put(activity(1001))
    for (let index = 0; index < 50; index++) notifySyncStatusChanged()
    expect(callbacks).toHaveLength(1)
    callbacks[0]!()
    for (let attempt = 0; attempt < 100 && !useStore.getState().syncActivity.some((row) => row.opId === "activity-1001"); attempt++) await new Promise((resolve) => setTimeout(resolve, 1))
    expect(reads).toBe(1)
    expect(useStore.getState().syncActivity).toHaveLength(200)
    expect(useStore.getState().syncActivity.some((row) => row.opId === "activity-1001")).toBe(true)
  } finally { read.mockRestore(); window.setTimeout = originalSetTimeout; window.clearTimeout = originalClearTimeout; invalidateSyncAccount() }
})

test("a refresh requested during a read publishes the later activity state", async () => {
  const original = activityFromOutbox(outboxRecord({ opId: "pending-operation", entityType: "thought", clientId: "thought-client", action: "upsert", serverId: 30, payload: { tile_id: 20, content: "Edit" } }))
  await syncDb.syncActivity.put(original)
  const collection = syncDb.syncActivity.orderBy("historyCreatedAt").reverse().limit(201)
  const realRead = collection.toArray.bind(collection)
  let release!: () => void
  let enter!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  const entered = new Promise<void>((resolve) => { enter = resolve })
  let reads = 0
  const order = spyOn(syncDb.syncActivity, "orderBy").mockReturnValue(collection)
  const delayed = spyOn(collection, "toArray").mockImplementation(async () => {
    reads++
    const rows = await realRead()
    if (reads === 1) { enter(); await Dexie.waitFor(gate) }
    return rows
  })
  try {
    const first = useStore.getState().refreshSyncStatuses()
    await entered
    // The activity read holds its readonly transaction. Let it complete before
    // the queued error write, then request another refresh before publication.
    const write = Dexie.ignoreTransaction(() => syncDb.syncActivity.put({ ...original, state: "error", error: "Rejected" }))
    const second = Dexie.ignoreTransaction(() => useStore.getState().refreshSyncStatuses())
    release()
    await write
    await Promise.all([first, second])
    expect(reads).toBe(2)
    expect(useStore.getState().syncActivity[0]?.state).toBe("error")
  } finally { release(); delayed.mockRestore(); order.mockRestore() }
})

test("an acknowledgement outside loaded pages refreshes History while a newer issue keeps its attention state", async () => {
  await prepareSyncAccount("history-acknowledgement")
  try {
    const operation = outboxRecord({ opId: "old-operation", entityType: "thought", clientId: "same-thought", action: "upsert", payload: { content: "Old edit" } })
    const old = { ...operation, createdAt: 1, updatedAt: 1 }
    const blocked = { ...operation, opId: "newer-blocked-operation", createdAt: 2, updatedAt: 2, status: "error" as const }
    await syncDb.outbox.bulkPut([old, blocked])
    await syncDb.syncActivity.bulkPut([
      ...Array.from({ length: 250 }, (_, index) => activity(index + 100)),
      activityFromOutbox(old), activityFromOutbox(blocked),
    ])
    await useStore.getState().refreshSyncStatuses()
    expect(useStore.getState().syncActivity.some((row) => row.opId === old.opId)).toBe(true)

    await syncDb.outbox.delete(old.opId)
    await syncDb.syncActivity.update(old.opId, { state: "synced", updatedAt: Date.now() })
    markSyncAcknowledged(old.entityType, old.clientId)
    await useStore.getState().refreshSyncStatuses()
    const state = useStore.getState()
    expect(state.syncActivity.some((row) => row.opId === old.opId)).toBe(false)
    expect(state.syncEntityStatuses.get("thought:same-thought")?.state).toBe("error")
    expect(state.syncLastAcknowledgedAt).toBeGreaterThan(349)
    expect(state.syncLastAcknowledgedAt).toBe(lastSyncAcknowledgedAt())
  } finally { invalidateSyncAccount() }
})

test("History acknowledgement markers exclude hidden operations and cannot cross account generations", async () => {
  await prepareSyncAccount("history-marker-a")
  try {
    markSyncAcknowledged("thought", "hidden-operation", false)
    await useStore.getState().refreshSyncStatuses()
    expect(useStore.getState().syncLastAcknowledgedAt).toBe(0)
    markSyncAcknowledged("thought", "visible-operation")
    await useStore.getState().refreshSyncStatuses()
    expect(useStore.getState().syncLastAcknowledgedAt).toBeGreaterThan(0)
    invalidateSyncAccount()
    useStore.getState().resetStore()
    expect(lastSyncAcknowledgedAt()).toBe(0)
    expect(useStore.getState().syncLastAcknowledgedAt).toBe(0)
    await prepareSyncAccount("history-marker-b")
    await useStore.getState().refreshSyncStatuses()
    expect(useStore.getState().syncLastAcknowledgedAt).toBe(0)
  } finally { invalidateSyncAccount() }
})
