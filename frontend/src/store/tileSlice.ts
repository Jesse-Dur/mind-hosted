import type { Tile } from "../types"
import type { StoreSlice, TileSlice } from "./types"
import { getApi } from "./apiAuth"
import { findThoughtsForTile, findTileInState, upsertTile, visibleThoughts, visibleTiles } from "./cacheHelpers"
import { clearLatestTileMove, isLatestTileMove, nextTileMoveVersion } from "./moveVersions"

export const createTileSlice: StoreSlice<TileSlice> = (set, get) => ({
  inFlightTileMoves: new Set<number>(),
  newestTileId: null,

  addTile: async (data) => {
    const { activeCanvasId } = get()
    const tempId = -Date.now()
    const tempTile: Tile = { ...data, id: tempId, canvas_id: activeCanvasId, created_at: new Date().toISOString() }
    set((s) => {
      const tileCache = new Map(s.tileCache)
      if (activeCanvasId !== null) tileCache.set(activeCanvasId, [...(tileCache.get(activeCanvasId) ?? []), tempTile])
      return { tiles: [...s.tiles, tempTile], tileCache, newestTileId: tempId }
    })

    const tile = await getApi().tiles.create({ ...data, canvas_id: activeCanvasId })
    set((s) => {
      const tileCache = new Map(s.tileCache)
      if (activeCanvasId !== null) {
        tileCache.set(activeCanvasId, (tileCache.get(activeCanvasId) ?? []).map((item) => item.id === tempId ? tile : item))
      }
      return { tiles: s.tiles.map((item) => item.id === tempId ? tile : item), tileCache, newestTileId: tile.id }
    })
  },

  moveTileLocal: (id, data, fallbackTile) => {
    const { tiles } = get()
    if (tiles.some((tile) => tile.id === id)) {
      set({ tiles: tiles.map((tile) => (tile.id === id ? { ...tile, ...data } : tile)) })
      return
    }
    if (fallbackTile) set({ tiles: [...tiles, { ...fallbackTile, ...data }] })
  },

  updateTile: (id, data) => {
    set((s) => {
      const tileCache = new Map(s.tileCache)
      for (const [canvasId, tiles] of tileCache) {
        tileCache.set(canvasId, tiles.map((tile) => tile.id === id ? { ...tile, ...data } : tile))
      }
      return { tiles: s.tiles.map((tile) => (tile.id === id ? { ...tile, ...data } : tile)), tileCache }
    })
    return getApi().tiles.update(id, data).catch(console.error)
  },

  moveTileToCanvas: async (id, targetCanvasId, x, y) => {
    const initial = get()
    const tile = findTileInState(id, initial.tiles, initial.tileCache)
    if (!tile) return

    const version = nextTileMoveVersion(id)
    const movedTile: Tile = { ...tile, canvas_id: targetCanvasId, x, y }
    const carriedThoughts = findThoughtsForTile(id, initial.thoughts, initial.thoughtCache)
    const carriedThoughtIds = new Set(carriedThoughts.map((thought) => thought.id))

    set((s) => {
      const tileCache = new Map(s.tileCache)
      for (const [canvasId, tiles] of tileCache) {
        tileCache.set(canvasId, tiles.filter((item) => item.id !== id))
      }
      tileCache.set(targetCanvasId, upsertTile(tileCache.get(targetCanvasId) ?? [], movedTile))

      const thoughtCache = new Map(s.thoughtCache)
      for (const [canvasId, thoughts] of thoughtCache) {
        thoughtCache.set(canvasId, thoughts.filter((thought) => !carriedThoughtIds.has(thought.id)))
      }
      if (carriedThoughts.length > 0) {
        thoughtCache.set(targetCanvasId, [
          ...(thoughtCache.get(targetCanvasId) ?? []),
          ...carriedThoughts,
        ])
      }

      const fallbackTiles = s.activeCanvasId === targetCanvasId
        ? upsertTile(s.tiles.filter((item) => item.id !== id), movedTile)
        : s.tiles.filter((item) => item.id !== id)
      const fallbackThoughts = s.activeCanvasId === targetCanvasId
        ? [...s.thoughts.filter((thought) => !carriedThoughtIds.has(thought.id)), ...carriedThoughts]
        : s.thoughts.filter((thought) => !carriedThoughtIds.has(thought.id))

      return {
        tiles: visibleTiles(s.activeCanvasId, tileCache, fallbackTiles),
        thoughts: visibleThoughts(s.activeCanvasId, thoughtCache, fallbackThoughts),
        tileCache,
        thoughtCache,
        inFlightTileMoves: new Set(s.inFlightTileMoves).add(id),
      }
    })

    try {
      const savedTile = await getApi().tiles.update(id, { canvas_id: targetCanvasId, x, y })
      if (!isLatestTileMove(id, version)) return
      set((s) => {
        const tileCache = new Map(s.tileCache)
        for (const [canvasId, tiles] of tileCache) {
          tileCache.set(canvasId, tiles.filter((item) => item.id !== id))
        }
        if (savedTile.canvas_id !== null) {
          tileCache.set(savedTile.canvas_id, upsertTile(tileCache.get(savedTile.canvas_id) ?? [], savedTile))
        }
        const fallbackTiles = s.activeCanvasId === savedTile.canvas_id
          ? upsertTile(s.tiles.filter((item) => item.id !== id), savedTile)
          : s.tiles.filter((item) => item.id !== id)
        return {
          tiles: visibleTiles(s.activeCanvasId, tileCache, fallbackTiles),
          tileCache,
        }
      })
    } catch (error) {
      console.error(error)
      if (!isLatestTileMove(id, version)) return
      set((s) => {
        const tileCache = new Map(s.tileCache)
        for (const [canvasId, tiles] of tileCache) {
          tileCache.set(canvasId, tiles.filter((item) => item.id !== id))
        }
        if (tile.canvas_id !== null) {
          tileCache.set(tile.canvas_id, upsertTile(tileCache.get(tile.canvas_id) ?? [], tile))
        }

        const thoughtCache = new Map(s.thoughtCache)
        for (const [canvasId, thoughts] of thoughtCache) {
          thoughtCache.set(canvasId, thoughts.filter((thought) => !carriedThoughtIds.has(thought.id)))
        }
        if (tile.canvas_id !== null && carriedThoughts.length > 0) {
          thoughtCache.set(tile.canvas_id, [
            ...(thoughtCache.get(tile.canvas_id) ?? []),
            ...carriedThoughts,
          ])
        }

        const fallbackTiles = s.activeCanvasId === tile.canvas_id
          ? upsertTile(s.tiles.filter((item) => item.id !== id), tile)
          : s.tiles.filter((item) => item.id !== id)
        const fallbackThoughts = s.activeCanvasId === tile.canvas_id
          ? [...s.thoughts.filter((thought) => !carriedThoughtIds.has(thought.id)), ...carriedThoughts]
          : s.thoughts.filter((thought) => !carriedThoughtIds.has(thought.id))

        return {
          tiles: visibleTiles(s.activeCanvasId, tileCache, fallbackTiles),
          thoughts: visibleThoughts(s.activeCanvasId, thoughtCache, fallbackThoughts),
          tileCache,
          thoughtCache,
        }
      })
    } finally {
      if (!isLatestTileMove(id, version)) return
      clearLatestTileMove(id, version)
      set((s) => {
        const inFlightTileMoves = new Set(s.inFlightTileMoves)
        inFlightTileMoves.delete(id)
        return { inFlightTileMoves }
      })
      const state = get()
      if (state.inFlightTileMoves.size === 0) {
        void state.loadTiles()
        void state.loadThoughts()
      }
    }
  },

  removeTile: async (id) => {
    set((s) => {
      const tileCache = new Map(s.tileCache)
      const thoughtCache = new Map(s.thoughtCache)
      for (const [canvasId, tiles] of tileCache) tileCache.set(canvasId, tiles.filter((tile) => tile.id !== id))
      for (const [canvasId, thoughts] of thoughtCache) thoughtCache.set(canvasId, thoughts.filter((thought) => thought.tile_id !== id))
      return {
        tiles: s.tiles.filter((tile) => tile.id !== id),
        thoughts: s.thoughts.filter((thought) => thought.tile_id !== id),
        tileCache,
        thoughtCache,
      }
    })
    getApi().tiles.remove(id).catch(console.error)
  },
})
