import type { CanvasDataSlice, StoreSlice } from "./types"
import type { Thought, Tile } from "../types"
import { isTemporaryCanvasId } from "../utils/canvasIdentity"
import { isTemporaryId } from "../utils/optimisticIdentity"
import { cachedThoughtsForCanvas, cachedTiles } from "../sync/cache"
import { currentLoadGeneration } from "./loadGeneration"
import { fetchAndCacheSnapshot } from "../sync/snapshot"

function mergeTiles(existingTiles: Tile[], serverTiles: Tile[]) {
  const optimisticTiles = existingTiles.filter((tile) => isTemporaryId(tile.id))
  return [...optimisticTiles, ...serverTiles]
}

function mergeThoughts(existingThoughts: Thought[], serverThoughts: Thought[]) {
  const optimisticThoughts = existingThoughts.filter((thought) => isTemporaryId(thought.id) || isTemporaryId(thought.tile_id))
  const serverIds = new Set(serverThoughts.map((thought) => thought.id))
  return [...optimisticThoughts.filter((thought) => !serverIds.has(thought.id)), ...serverThoughts]
}

export const createCanvasDataSlice: StoreSlice<CanvasDataSlice> = (set, get) => ({
  tileCache: new Map(),
  thoughtCache: new Map(),
  tiles: [],
  thoughts: [],

  loadTiles: async (canvasId) => {
    const state = get()
    const targetCanvasId = canvasId ?? state.activeCanvasId
    if (targetCanvasId === null || isTemporaryCanvasId(targetCanvasId)) {
      set({ tiles: [] })
      return
    }

    const generation = currentLoadGeneration()
    const refreshTiles = async () => {
      let tiles: Tile[]
      let thoughts: Thought[]
      let changedTileIds: number[] = []
      let changedThoughtIds: number[] = []
      try {
        const snapshot = await fetchAndCacheSnapshot(targetCanvasId)
        tiles = await cachedTiles(targetCanvasId)
        thoughts = await cachedThoughtsForCanvas(targetCanvasId)
        if (snapshot.activeCanvasId !== targetCanvasId) return
        changedTileIds = snapshot.changedTileIds
        changedThoughtIds = snapshot.changedThoughtIds
      } catch (error) {
        console.error(error)
        return
      }
      if (generation !== currentLoadGeneration()) return

      // The active arrays are a view of the per-canvas cache, not separate source data.
      set((s) => {
        const tileCache = new Map(s.tileCache)
        const thoughtCache = new Map(s.thoughtCache)
        const existingTiles = s.activeCanvasId === targetCanvasId ? s.tiles : tileCache.get(targetCanvasId) ?? []
        const existingThoughts = s.activeCanvasId === targetCanvasId ? s.thoughts : thoughtCache.get(targetCanvasId) ?? []
        const mergedTiles = mergeTiles(existingTiles, tiles)
        const mergedThoughts = mergeThoughts(existingThoughts, thoughts)
        tileCache.set(targetCanvasId, mergedTiles)
        thoughtCache.set(targetCanvasId, mergedThoughts)
        return s.activeCanvasId === targetCanvasId
          ? { tiles: mergedTiles, thoughts: mergedThoughts, tileCache, thoughtCache }
          : { tileCache, thoughtCache }
      })
      get().markRemoteChanges(changedTileIds, changedThoughtIds)
    }

    const cached = await cachedTiles(targetCanvasId)
    if (cached.length > 0) {
      set((s) => {
        const tileCache = new Map(s.tileCache).set(targetCanvasId, cached)
        return s.activeCanvasId === targetCanvasId ? { tiles: cached, tileCache } : { tileCache }
      })
      void refreshTiles()
      return
    }
    await refreshTiles()
  },

  loadThoughts: async (canvasId) => {
    const state = get()
    const targetCanvasId = canvasId ?? state.activeCanvasId
    if (targetCanvasId === null || isTemporaryCanvasId(targetCanvasId)) {
      set({ thoughts: [] })
      return
    }

    const generation = currentLoadGeneration()
    const refreshThoughts = async () => {
      let tiles: Tile[]
      let thoughts: Thought[]
      let changedTileIds: number[] = []
      let changedThoughtIds: number[] = []
      try {
        const snapshot = await fetchAndCacheSnapshot(targetCanvasId)
        tiles = await cachedTiles(targetCanvasId)
        thoughts = await cachedThoughtsForCanvas(targetCanvasId)
        if (snapshot.activeCanvasId !== targetCanvasId) return
        changedTileIds = snapshot.changedTileIds
        changedThoughtIds = snapshot.changedThoughtIds
      } catch (error) {
        console.error(error)
        return
      }
      if (generation !== currentLoadGeneration()) return

      set((s) => {
        const tileCache = new Map(s.tileCache)
        const thoughtCache = new Map(s.thoughtCache)
        const existingTiles = s.activeCanvasId === targetCanvasId ? s.tiles : tileCache.get(targetCanvasId) ?? []
        const existingThoughts = s.activeCanvasId === targetCanvasId ? s.thoughts : thoughtCache.get(targetCanvasId) ?? []
        const mergedTiles = mergeTiles(existingTiles, tiles)
        const merged = thoughts.map((thought) => {
          const existing = existingThoughts.find((item) => item.id === thought.id)
          if (existing && existing.tile_id !== thought.tile_id) return existing
          return thought
        })
        const visibleThoughts = mergeThoughts(existingThoughts, merged)
        tileCache.set(targetCanvasId, mergedTiles)
        thoughtCache.set(targetCanvasId, visibleThoughts)
        return s.activeCanvasId === targetCanvasId
          ? { tiles: mergedTiles, thoughts: visibleThoughts, tileCache, thoughtCache }
          : { tileCache, thoughtCache }
      })
      get().markRemoteChanges(changedTileIds, changedThoughtIds)
    }

    const cached = await cachedThoughtsForCanvas(targetCanvasId)
    if (cached.length > 0) {
      set((s) => {
        const thoughtCache = new Map(s.thoughtCache).set(targetCanvasId, cached)
        return s.activeCanvasId === targetCanvasId ? { thoughts: cached, thoughtCache } : { thoughtCache }
      })
      void refreshThoughts()
      return
    }
    await refreshThoughts()
  },

  hydrateRemainingCanvases: async (refresh = false) => {
    const { canvases, activeCanvasId, tileCache, thoughtCache } = get()
    const ids = canvases.map((canvas) => canvas.id).filter((id) => id !== activeCanvasId && !isTemporaryCanvasId(id))
    const missing = ids.filter((id) => refresh || !tileCache.has(id) || !thoughtCache.has(id))
    const generation = currentLoadGeneration()
    for (const id of missing) {
      if (generation !== currentLoadGeneration()) return
      const [cachedTileRows, cachedThoughtRows] = await Promise.all([
        cachedTiles(id),
        cachedThoughtsForCanvas(id),
      ])

      if (cachedTileRows.length > 0 || cachedThoughtRows.length > 0) {
        set((s) => {
          const nextTileCache = cachedTileRows.length > 0 ? new Map(s.tileCache).set(id, cachedTileRows) : s.tileCache
          const nextThoughtCache = cachedThoughtRows.length > 0 ? new Map(s.thoughtCache).set(id, cachedThoughtRows) : s.thoughtCache
          return { tileCache: nextTileCache, thoughtCache: nextThoughtCache }
        })
      }

      let tiles: Tile[]
      let thoughts: Thought[]
      let changedTileIds: number[] = []
      let changedThoughtIds: number[] = []
      try {
        const snapshot = await fetchAndCacheSnapshot(id)
        ;[tiles, thoughts] = await Promise.all([
          cachedTiles(id),
          cachedThoughtsForCanvas(id),
        ])
        if (snapshot.activeCanvasId !== id) continue
        changedTileIds = snapshot.changedTileIds
        changedThoughtIds = snapshot.changedThoughtIds
      } catch (error) {
        console.error(error)
        continue
      }
      if (generation !== currentLoadGeneration()) return

      set((s) => {
        const existingTiles = s.activeCanvasId === id ? s.tiles : s.tileCache.get(id) ?? []
        const existingThoughts = s.activeCanvasId === id ? s.thoughts : s.thoughtCache.get(id) ?? []
        const nextTiles = mergeTiles(existingTiles, tiles)
        const nextThoughts = mergeThoughts(existingThoughts, thoughts)
        const nextTileCache = new Map(s.tileCache).set(id, nextTiles)
        const nextThoughtCache = new Map(s.thoughtCache).set(id, nextThoughts)
        const visible = s.activeCanvasId === id
        return visible
          ? { tiles: nextTiles, thoughts: nextThoughts, tileCache: nextTileCache, thoughtCache: nextThoughtCache }
          : { tileCache: nextTileCache, thoughtCache: nextThoughtCache }
      })
      get().markRemoteChanges(changedTileIds, changedThoughtIds)
    }
  },
})
