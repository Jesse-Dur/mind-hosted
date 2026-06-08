import type { StoreSlice, UiSlice } from "./types"
import { readStoredCanvasHeight, readStoredTabsVisible, writeStoredCanvasHeight, writeStoredTabsVisible } from "./storage"

export const createUiSlice: StoreSlice<UiSlice> = (set) => ({
  tabsVisible: readStoredTabsVisible(),
  spotlightOpen: false,
  sidebarOpen: false,
  canvasHeight: readStoredCanvasHeight(),
  highlightedId: null,

  setSpotlightOpen: (open) => set({ spotlightOpen: open }),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
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
