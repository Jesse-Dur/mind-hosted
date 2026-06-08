import type { CanvasDataSlice, StoreSlice } from "./types"
import { getApi } from "./apiAuth"
import { isTemporaryCanvasId } from "../utils/canvasIdentity"
import { isTemporaryId } from "../utils/optimisticIdentity"

export const createCanvasDataSlice: StoreSlice<CanvasDataSlice> = (set, get) => ({
  tileCache: new Map(),
  thoughtCache: new Map(),
  tiles: [],
  thoughts: [],

  loadTiles: async (canvasId) => {
    const state = get()
    if (state.inFlightTileMoves.size > 0) return
    const targetCanvasId = canvasId ?? state.activeCanvasId
    if (targetCanvasId === null || isTemporaryCanvasId(targetCanvasId)) {
      set({ tiles: [] })
      return
    }

    const tiles = await getApi().tiles.list(targetCanvasId)
    if (get().inFlightTileMoves.size > 0) return

    // The active arrays are a view of the per-canvas cache, not separate source data.
    set((s) => {
      const tileCache = new Map(s.tileCache)
      const existingTiles = s.activeCanvasId === targetCanvasId ? s.tiles : tileCache.get(targetCanvasId) ?? []
      const optimisticTiles = existingTiles.filter((tile) => isTemporaryId(tile.id))
      const mergedTiles = [...optimisticTiles, ...tiles]
      tileCache.set(targetCanvasId, mergedTiles)
      return s.activeCanvasId === targetCanvasId ? { tiles: mergedTiles, tileCache } : { tileCache }
    })
  },

  loadThoughts: async (canvasId) => {
    const state = get()
    if (state.inFlightMoves.size > 0 || state.inFlightTileMoves.size > 0) return
    const targetCanvasId = canvasId ?? state.activeCanvasId
    if (targetCanvasId === null || isTemporaryCanvasId(targetCanvasId)) {
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
      const existingThoughts = s.activeCanvasId === targetCanvasId ? s.thoughts : thoughtCache.get(targetCanvasId) ?? []
      const optimisticThoughts = existingThoughts.filter((thought) => isTemporaryId(thought.id) || isTemporaryId(thought.tile_id))
      const merged = thoughts.map((thought) => {
        const existing = existingThoughts.find((item) => item.id === thought.id)
        if (existing && existing.tile_id !== thought.tile_id) return existing
        return thought
      })
      const serverIds = new Set(merged.map((thought) => thought.id))
      const visibleThoughts = [...optimisticThoughts.filter((thought) => !serverIds.has(thought.id)), ...merged]
      thoughtCache.set(targetCanvasId, visibleThoughts)
      return s.activeCanvasId === targetCanvasId
        ? { thoughts: visibleThoughts, thoughtCache, newThoughtIds: newIds }
        : { thoughtCache }
    })
    if (newIds.size > 0) setTimeout(() => set({ newThoughtIds: new Set() }), 1000)
  },

  hydrateRemainingCanvases: async (refresh = false) => {
    const { canvases, activeCanvasId, tileCache, thoughtCache } = get()
    const ids = canvases.map((canvas) => canvas.id).filter((id) => id !== activeCanvasId && !isTemporaryCanvasId(id))
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
        const existingTiles = s.activeCanvasId === id ? s.tiles : s.tileCache.get(id) ?? []
        const existingThoughts = s.activeCanvasId === id ? s.thoughts : s.thoughtCache.get(id) ?? []
        const optimisticTiles = existingTiles.filter((tile) => isTemporaryId(tile.id))
        const optimisticThoughts = existingThoughts.filter((thought) => isTemporaryId(thought.id) || isTemporaryId(thought.tile_id))
        const serverThoughtIds = new Set(thoughts.map((thought) => thought.id))
        const nextTiles = [...optimisticTiles, ...tiles]
        const nextThoughts = [...optimisticThoughts.filter((thought) => !serverThoughtIds.has(thought.id)), ...thoughts]
        const nextTileCache = new Map(s.tileCache).set(id, nextTiles)
        const nextThoughtCache = new Map(s.thoughtCache).set(id, nextThoughts)
        const visible = s.activeCanvasId === id
        return visible
          ? { tiles: nextTiles, thoughts: nextThoughts, tileCache: nextTileCache, thoughtCache: nextThoughtCache }
          : { tileCache: nextTileCache, thoughtCache: nextThoughtCache }
      })
    }))
  },
})
