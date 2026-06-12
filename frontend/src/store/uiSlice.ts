import type { StoreSlice, UiSlice } from "./types"
import { readStoredCanvasHeight, readStoredTabsVisible, writeStoredCanvasHeight, writeStoredTabsVisible } from "./storage"

const REMOTE_CHANGE_ANIMATION_MS = 900

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
  remoteChangedTileIds: new Set(),
  remoteChangedThoughtIds: new Set(),

  setSpotlightOpen: (open) => set({ spotlightOpen: open }),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  markRemoteChanges: (tileIds, thoughtIds) => {
    const validTileIds = serverIds(tileIds)
    const validThoughtIds = serverIds(thoughtIds)
    if (validTileIds.length === 0 && validThoughtIds.length === 0) return

    // Remote highlights are transient UI, so keep them out of entity state and
    // clear them together after the paint-only animation has had time to finish.
    set((s) => ({
      remoteChangedTileIds: new Set([...s.remoteChangedTileIds, ...validTileIds]),
      remoteChangedThoughtIds: new Set([...s.remoteChangedThoughtIds, ...validThoughtIds]),
    }))

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
