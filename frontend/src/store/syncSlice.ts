// This slice owns sync runtime startup and the derived pending-count badge state.
import type { StoreSlice, SyncSlice } from "./types"
import { startSyncRuntime, syncInBackground } from "../sync/engine"
import { syncDb } from "../sync/localDb"
import { discardSyncOperation, keepSyncOperationLocal, retrySyncOperation } from "../sync/resolution"
import { readSyncActivity, readSyncStatuses, subscribeSyncStatus } from "../sync/status"
import { assertSyncAccountScopeCurrent, isStaleSyncAccountError, runSyncAccountTask } from "../sync/accountScope"

let statusSubscribed = false

async function pendingCount() {
  return syncDb.outbox.where("status").anyOf(["pending", "flushing", "error", "local_only"]).count()
}

export const createSyncSlice: StoreSlice<SyncSlice> = (set, get) => ({
  syncPendingCount: 0,
  syncEntityStatuses: new Map(),
  syncActivity: [],

  refreshSyncStatuses: () => runSyncAccountTask(async (scope) => {
    const [statuses, activity, count] = await Promise.all([readSyncStatuses(), readSyncActivity(), pendingCount()])
    assertSyncAccountScopeCurrent(scope)
    set({ syncEntityStatuses: statuses, syncActivity: activity, syncPendingCount: count })
  }),

  startSyncRuntime: async () => {
    startSyncRuntime()
    if (!statusSubscribed) {
      statusSubscribed = true
      subscribeSyncStatus(() => {
        void get().refreshSyncStatuses().catch((error) => {
          if (!isStaleSyncAccountError(error)) console.error(error)
        })
      })
    }
    await get().refreshSyncStatuses()
  },

  syncNow: () => runSyncAccountTask(async (scope) => {
    await syncInBackground()
    assertSyncAccountScopeCurrent(scope)
    await get().refreshSyncStatuses()
  }),

  retrySyncOperation: (opId) => runSyncAccountTask(async (scope) => {
    await retrySyncOperation(opId)
    assertSyncAccountScopeCurrent(scope)
    await syncInBackground()
    assertSyncAccountScopeCurrent(scope)
    await get().refreshSyncStatuses()
  }),

  keepSyncOperationLocal: (opId) => runSyncAccountTask(async (scope) => {
    await keepSyncOperationLocal(opId)
    assertSyncAccountScopeCurrent(scope)
    await get().refreshSyncStatuses()
  }),

  discardSyncOperation: (opId) => runSyncAccountTask(async (scope) => {
    await discardSyncOperation(opId)
    assertSyncAccountScopeCurrent(scope)
    await get().refreshSyncStatuses()
  }),
})
