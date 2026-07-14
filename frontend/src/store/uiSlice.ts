import type { StoreSlice, UiSlice } from "./types"
import { getApi } from "./apiAuth"

const REMOTE_CHANGE_ANIMATION_MS = 900
const LOCAL_TILE_CHANGE_SUPPRESSION_MS = 12000
export const DEFAULT_CANVAS_HEIGHT = 1440
export const DEFAULT_TABS_VISIBLE = true

let remoteChangeTimer: ReturnType<typeof setTimeout> | null = null
let canvasHeightRevision = 0
let tabsVisibleRevision = 0
let settingsSessionRevision = 0

function serverIds(ids: number[]) {
  return ids.filter((id) => Number.isInteger(id) && id > 0)
}

export const createUiSlice: StoreSlice<UiSlice> = (set, get) => ({
  tabsVisible: DEFAULT_TABS_VISIBLE,
  spotlightOpen: false,
  sidebarOpen: false,
  canvasHeight: DEFAULT_CANVAS_HEIGHT,
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
  loadUserSettings: async () => {
    const canvasLoadRevision = canvasHeightRevision
    const tabsLoadRevision = tabsVisibleRevision
    const sessionRevision = settingsSessionRevision
    const settings = await getApi().settings.get()
    if (sessionRevision !== settingsSessionRevision) return
    // A startup response must not replace a choice made while that request was in flight.
    if (canvasLoadRevision === canvasHeightRevision) {
      set({ canvasHeight: settings.canvas_height })
    }
    if (tabsLoadRevision === tabsVisibleRevision) {
      set({ tabsVisible: settings.tabs_visible })
    }
  },
  resetUserSettings: () => {
    // Invalidate in-flight reads when the signed-in user changes.
    settingsSessionRevision += 1
    canvasHeightRevision = 0
    tabsVisibleRevision = 0
    set({ canvasHeight: DEFAULT_CANVAS_HEIGHT, tabsVisible: DEFAULT_TABS_VISIBLE })
  },
  setCanvasHeight: async (height) => {
    // Update immediately while the authenticated request makes the choice durable across devices.
    const sessionRevision = settingsSessionRevision
    const updateRevision = ++canvasHeightRevision
    set({ canvasHeight: height })
    const api = getApi()
    try {
      await api.settings.update({ canvas_height: height })
      if (sessionRevision === settingsSessionRevision && updateRevision !== canvasHeightRevision) {
        // Reassert the newest value if overlapping requests reached the server out of order.
        await api.settings.update({ canvas_height: get().canvasHeight })
      }
    } catch (error) {
      console.error(error)
    }
  },
  setTabsVisible: async (visible) => {
    const sessionRevision = settingsSessionRevision
    const updateRevision = ++tabsVisibleRevision
    set({ tabsVisible: visible })
    const api = getApi()
    try {
      await api.settings.update({ tabs_visible: visible })
      if (sessionRevision === settingsSessionRevision && updateRevision !== tabsVisibleRevision) {
        await api.settings.update({ tabs_visible: get().tabsVisible })
      }
    } catch (error) {
      console.error(error)
    }
  },
})
