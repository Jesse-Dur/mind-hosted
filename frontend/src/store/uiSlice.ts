import type { StoreSlice, UiSlice } from "./types"
import { readStoredCanvasHeight, readStoredTabsVisible, writeStoredCanvasHeight, writeStoredTabsVisible } from "./storage"

const REMOTE_CHANGE_ANIMATION_MS = 900
const LOCAL_TILE_CHANGE_SUPPRESSION_MS = 12000

let remoteChangeTimer: ReturnType<typeof setTimeout> | null = null

function serverIds(ids: number[]) {
  return ids.filter((id) => Number.isInteger(id) && id > 0)
}

export const createUiSlice: StoreSlice<UiSlice> = (set) => ({
  tabsVisible: readStoredTabsVisible(),
  spotlightOpen: false,
  sidebarOpen: false,
  canvasHeight: readStoredCanvasHeight(),
  highlightedId: null,
  recentLocalTileChangeIds: new Map(),
  remoteChangedTileIds: new Set(),
  remoteChangedThoughtIds: new Set(),

  setSpotlightOpen: (open) => set({ spotlightOpen: open }),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  markLocalTileChange: (tileId) => set((s) => {
    const now = Date.now()
    const recentLocalTileChangeIds = new Map(s.recentLocalTileChangeIds)
    recentLocalTileChangeIds.set(tileId, now + LOCAL_TILE_CHANGE_SUPPRESSION_MS)
    return { recentLocalTileChangeIds }
  }),
  markRemoteChanges: (tileIds, thoughtIds) => {
    const validTileIds = serverIds(tileIds)
    const validThoughtIds = serverIds(thoughtIds)
    const now = Date.now()

    // Local writes should not re-announce themselves as remote changes when the
    // sync layer later confirms the same payload.
    let shouldAnimate = false
    set((s) => {
      const recentLocalTileChangeIds = new Map<number, number>()
      for (const [id, expiresAt] of s.recentLocalTileChangeIds) {
        if (expiresAt > now) recentLocalTileChangeIds.set(id, expiresAt)
      }
      const filteredTileIds = validTileIds.filter((id) => !recentLocalTileChangeIds.has(id))
      shouldAnimate = filteredTileIds.length > 0 || validThoughtIds.length > 0
      return {
        recentLocalTileChangeIds,
        remoteChangedTileIds: shouldAnimate ? new Set([...s.remoteChangedTileIds, ...filteredTileIds]) : s.remoteChangedTileIds,
        remoteChangedThoughtIds: shouldAnimate ? new Set([...s.remoteChangedThoughtIds, ...validThoughtIds]) : s.remoteChangedThoughtIds,
      }
    })

    if (!shouldAnimate) return
    if (remoteChangeTimer !== null) clearTimeout(remoteChangeTimer)
    remoteChangeTimer = setTimeout(() => {
      remoteChangeTimer = null
      set({ remoteChangedTileIds: new Set(), remoteChangedThoughtIds: new Set() })
    }, REMOTE_CHANGE_ANIMATION_MS)
  },
  setHighlight: (type, id) => {
    set({ highlightedId: { type, id } })
    setTimeout(() => set({ highlightedId: null }), 3500)
  },
  setCanvasHeight: (height) => {
    writeStoredCanvasHeight(height)
    set({ canvasHeight: height })
  },
  setTabsVisible: (visible) => {
    writeStoredTabsVisible(visible)
    set({ tabsVisible: visible })
  },
})
