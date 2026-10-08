// This slice owns sync runtime startup and the derived pending-count badge state.
import type { StoreSlice, SyncSlice } from "./types"
import { startSyncRuntime, syncInBackground } from "../sync/engine"
import { syncDb } from "../sync/localDb"
import { discardSyncOperation, keepSyncOperationLocal, retrySyncOperation } from "../sync/resolution"
import { lastSyncAcknowledgedAt, readSyncActivityPage, readSyncStatuses, subscribeSyncStatus, SYNC_ACTIVITY_PAGE_SIZE } from "../sync/status"
import { assertSyncAccountScopeCurrent, currentSyncAccountScope, isSyncAccountScopeCurrent, isStaleSyncAccountError, runSyncAccountTask, type SyncAccountScope } from "../sync/accountScope"

let statusSubscribed = false

async function pendingCount() {
  return syncDb.outbox.where("status").anyOf(["pending", "flushing", "error", "local_only"]).count()
}

export const createSyncSlice: StoreSlice<SyncSlice> = (set, get) => {
  let statusTimer: number | null = null
  let timerScope: SyncAccountScope | null = null
  let refresh: { scope: SyncAccountScope | null; again: boolean; promise: Promise<void> } | null = null
  return {
    syncPendingCount: 0,
    syncEntityStatuses: new Map(),
    syncActivity: [],
    syncActivityLimit: SYNC_ACTIVITY_PAGE_SIZE,
    syncActivityHasMore: false,
    syncActivityLoadingMore: false,
    syncLastAcknowledgedAt: 0,

    refreshSyncStatuses: () => runSyncAccountTask(async (scope) => {
      if (refresh?.scope === scope) {
        refresh.again = true
        await refresh.promise
        return
      }
      const next = { scope, again: false, promise: Promise.resolve() }
      refresh = next
      next.promise = (async () => {
        do {
          next.again = false
          const state = get()
          const opIds = state.historyEvents.flatMap((event) => event.op_id ? [event.op_id] : [])
          const [statuses, page, count] = await Promise.all([
            readSyncStatuses(), readSyncActivityPage(state.syncActivityLimit, opIds), pendingCount(),
          ])
          assertSyncAccountScopeCurrent(scope)
          set({ syncEntityStatuses: statuses, syncActivity: page.activity, syncActivityHasMore: page.hasMore, syncPendingCount: count, syncLastAcknowledgedAt: lastSyncAcknowledgedAt() })
        } while (next.again)
      })()
      try { await next.promise } finally { if (refresh === next) refresh = null }
    }),

    loadMoreSyncActivity: () => runSyncAccountTask(async (scope) => {
      if (!get().syncActivityHasMore || get().syncActivityLoadingMore) return
      set((state) => ({ syncActivityLimit: state.syncActivityLimit + SYNC_ACTIVITY_PAGE_SIZE, syncActivityLoadingMore: true }))
      try {
        await get().refreshSyncStatuses()
      } finally {
        if (isSyncAccountScopeCurrent(scope)) set({ syncActivityLoadingMore: false })
      }
    }),

    startSyncRuntime: async () => {
      startSyncRuntime()
      if (!statusSubscribed) {
        statusSubscribed = true
        subscribeSyncStatus(() => {
          const scope = currentSyncAccountScope()
          if (statusTimer !== null) {
            if (scope === timerScope) return
            window.clearTimeout(statusTimer)
          }
          timerScope = scope
          // One refresh for a burst of enqueues/acks, with a bounded delay even
          // when a large batch keeps producing notifications.
          statusTimer = window.setTimeout(() => {
            statusTimer = null
            if (!isSyncAccountScopeCurrent(scope)) return
            void get().refreshSyncStatuses().catch((error) => {
              if (!isStaleSyncAccountError(error)) console.error(error)
            })
          }, 100)
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
  }
}
