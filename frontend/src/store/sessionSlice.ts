import { initialBillingState } from "./billingSlice"
import { writeStoredActiveCanvasId } from "./storage"
import type { SessionSlice, StoreSlice } from "./types"

export const createSessionSlice: StoreSlice<SessionSlice> = (set, get) => ({
  resetStore: () => {
    get().resetBillingState()
    get().resetUserSettings()
    writeStoredActiveCanvasId(null)
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
