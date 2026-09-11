// This slice owns sync runtime startup and the derived pending-count badge state.
import type { StoreSlice, SyncSlice } from "./types"
import { startSyncRuntime, syncInBackground } from "../sync/engine"
import { syncDb } from "../sync/localDb"
import { discardSyncOperation, keepSyncOperationLocal, retrySyncOperation } from "../sync/resolution"
import { readSyncActivity, readSyncStatuses, subscribeSyncStatus } from "../sync/status"

let statusSubscribed = false

async function pendingCount() {
  return syncDb.outbox.where("status").anyOf(["pending", "flushing", "error", "local_only"]).count()
}

export const createSyncSlice: StoreSlice<SyncSlice> = (set) => ({
  syncPendingCount: 0,
  syncEntityStatuses: new Map(),
  syncActivity: [],

  refreshSyncStatuses: async () => {
    const [statuses, activity] = await Promise.all([readSyncStatuses(), readSyncActivity()])
    set({ syncEntityStatuses: statuses, syncActivity: activity, syncPendingCount: await pendingCount() })
  },

  startSyncRuntime: async () => {
    startSyncRuntime()
    if (!statusSubscribed) {
      statusSubscribed = true
      subscribeSyncStatus(() => {
        void Promise.all([readSyncStatuses(), readSyncActivity(), pendingCount()]).then(([statuses, activity, count]) => set({ syncEntityStatuses: statuses, syncActivity: activity, syncPendingCount: count }))
      })
    }
    const [statuses, activity] = await Promise.all([readSyncStatuses(), readSyncActivity()])
    set({ syncEntityStatuses: statuses, syncActivity: activity, syncPendingCount: await pendingCount() })
  },

  syncNow: async () => {
    await syncInBackground()
    const [statuses, activity] = await Promise.all([readSyncStatuses(), readSyncActivity()])
    set({ syncEntityStatuses: statuses, syncActivity: activity, syncPendingCount: await pendingCount() })
  },

  retrySyncOperation: async (opId) => {
    await retrySyncOperation(opId)
    await syncInBackground()
    const [statuses, activity] = await Promise.all([readSyncStatuses(), readSyncActivity()])
    set({ syncEntityStatuses: statuses, syncActivity: activity, syncPendingCount: await pendingCount() })
  },

  keepSyncOperationLocal: async (opId) => {
    await keepSyncOperationLocal(opId)
    const [statuses, activity] = await Promise.all([readSyncStatuses(), readSyncActivity()])
    set({ syncEntityStatuses: statuses, syncActivity: activity, syncPendingCount: await pendingCount() })
  },

  discardSyncOperation: async (opId) => {
    await discardSyncOperation(opId)
    const [statuses, activity] = await Promise.all([readSyncStatuses(), readSyncActivity()])
    set({ syncEntityStatuses: statuses, syncActivity: activity, syncPendingCount: await pendingCount() })
  },
})
