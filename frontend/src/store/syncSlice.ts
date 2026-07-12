// This slice owns sync runtime startup and the derived pending-count badge state.
import type { StoreSlice, SyncSlice } from "./types"
import { startSyncRuntime, syncInBackground } from "../sync/engine"
import { syncDb } from "../sync/localDb"

let runtimeStarted = false

async function pendingCount() {
  return syncDb.outbox.where("status").anyOf(["pending", "flushing", "error"]).count()
}

export const createSyncSlice: StoreSlice<SyncSlice> = (set) => ({
  syncPendingCount: 0,

  startSyncRuntime: async () => {
    if (!runtimeStarted) {
      runtimeStarted = true
      startSyncRuntime()
    }
    set({ syncPendingCount: await pendingCount() })
  },

  syncNow: async () => {
    await syncInBackground()
    set({ syncPendingCount: await pendingCount() })
  },
})
