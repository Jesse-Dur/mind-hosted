import type { CanvasDataSlice, StoreSlice } from "./types"
import { getApi } from "./apiAuth"

export const createCanvasDataSlice: StoreSlice<CanvasDataSlice> = (set, get) => ({
  tileCache: new Map(),
  thoughtCache: new Map(),
  tiles: [],
  thoughts: [],

  loadTiles: async (canvasId) => {
    const state = get()
    if (state.inFlightTileMoves.size > 0) return
    const targetCanvasId = canvasId ?? state.activeCanvasId
    if (targetCanvasId === null) {
      set({ tiles: [] })
      return
    }

    const tiles = await getApi().tiles.list(targetCanvasId)
    if (get().inFlightTileMoves.size > 0) return

    // The active arrays are a view of the per-canvas cache, not separate source data.
    set((s) => {
      const tileCache = new Map(s.tileCache)
      tileCache.set(targetCanvasId, tiles)
      return s.activeCanvasId === targetCanvasId ? { tiles, tileCache } : { tileCache }
    })
  },

  loadThoughts: async (canvasId) => {
    const state = get()
    if (state.inFlightMoves.size > 0 || state.inFlightTileMoves.size > 0) return
    const targetCanvasId = canvasId ?? state.activeCanvasId
    if (targetCanvasId === null) {
      set({ thoughts: [] })
      return
    }

    const prev = targetCanvasId === state.activeCanvasId
      ? state.thoughts.map((thought) => thought.id)
      : state.thoughtCache.get(targetCanvasId)?.map((thought) => thought.id) ?? []
    const thoughts = await getApi().thoughts.list({ canvasId: targetCanvasId })
    const newIds = new Set(thoughts.filter((thought) => !prev.includes(thought.id)).map((thought) => thought.id))

    {
      const latest = get()
      if (latest.inFlightMoves.size > 0 || latest.inFlightTileMoves.size > 0) return
    }

    set((s) => {
      const thoughtCache = new Map(s.thoughtCache)
      const merged = thoughts.map((thought) => {
        const existing = (s.activeCanvasId === targetCanvasId ? s.thoughts : thoughtCache.get(targetCanvasId) ?? [])
          .find((item) => item.id === thought.id)
        if (existing && existing.tile_id !== thought.tile_id) return existing
        return thought
      })
      thoughtCache.set(targetCanvasId, merged)
      return s.activeCanvasId === targetCanvasId
        ? { thoughts: merged, thoughtCache, newThoughtIds: newIds }
        : { thoughtCache }
    })
    if (newIds.size > 0) setTimeout(() => set({ newThoughtIds: new Set() }), 1000)
  },

  hydrateRemainingCanvases: async (refresh = false) => {
    const { canvases, activeCanvasId, tileCache, thoughtCache } = get()
    const ids = canvases.map((canvas) => canvas.id).filter((id) => id !== activeCanvasId)
    const missing = ids.filter((id) => refresh || !tileCache.has(id) || !thoughtCache.has(id))
    await Promise.all(missing.map(async (id) => {
      const [tiles, thoughts] = await Promise.all([
        getApi().tiles.list(id),
        getApi().thoughts.list({ canvasId: id }),
      ])

      {
        const latest = get()
        if (latest.inFlightMoves.size > 0 || latest.inFlightTileMoves.size > 0) return
      }

      set((s) => {
        const nextTileCache = new Map(s.tileCache).set(id, tiles)
        const nextThoughtCache = new Map(s.thoughtCache).set(id, thoughts)
        const visible = s.activeCanvasId === id
        return visible
          ? { tiles, thoughts, tileCache: nextTileCache, thoughtCache: nextThoughtCache }
          : { tileCache: nextTileCache, thoughtCache: nextThoughtCache }
      })
    }))
  },
})
