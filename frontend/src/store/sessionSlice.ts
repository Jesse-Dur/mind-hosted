import { initialBillingState } from "./billingSlice"
import type { SessionSlice, StoreSlice } from "./types"
import { advanceLoadGeneration } from "./loadGeneration"

export const createSessionSlice: StoreSlice<SessionSlice> = (set, get) => ({
  resetStore: () => {
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
      highlightedId: null,
      recentLocalTileChangeIds: new Map(),
      remoteChangedTileIds: new Set(),
      remoteChangedThoughtIds: new Set(),
      sidebarOpen: false,
      spotlightOpen: false,
      ...initialBillingState(),
    })
  },
})
