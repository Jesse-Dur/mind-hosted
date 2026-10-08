import { initialBillingState } from "./billingSlice"
import type { SessionSlice, StoreSlice } from "./types"
import { advanceLoadGeneration } from "./loadGeneration"
import { endCrossCanvasDrag } from "../utils/crossCanvasDrag"
import { SYNC_ACTIVITY_PAGE_SIZE } from "../sync/status"

export const createSessionSlice: StoreSlice<SessionSlice> = (set, get) => ({
  resetStore: () => {
    endCrossCanvasDrag()
    advanceLoadGeneration()
    get().resetBillingState()
    set({
      canvases: [],
      activeCanvasId: null,
      tags: [],
      tiles: [],
      thoughts: [],
      tileCache: new Map(),
      thoughtCache: new Map(),
      thoughtStableKeys: new Map(),
      historyEvents: [],
      historyNextCursor: null,
      historyHasMore: false,
      historyLoaded: false,
      historyRefreshing: false,
      historyLoadingMore: false,
      newHistoryIds: new Set(),
      aiStatus: "idle",
      syncPendingCount: 0,
      syncEntityStatuses: new Map(),
      syncActivity: [],
      syncActivityLimit: SYNC_ACTIVITY_PAGE_SIZE,
      syncActivityHasMore: false,
      syncActivityLoadingMore: false,
      syncLastAcknowledgedAt: 0,
      highlightedId: null,
      recentLocalTileChangeIds: new Map(),
      remoteChangedTileIds: new Set(),
      remoteChangedThoughtIds: new Set(),
      remoteThoughtRevision: 0,
      remoteCanvasRevision: 0,
      sidebarOpen: false,
      spotlightOpen: false,
      ...initialBillingState(),
    })
  },
})
