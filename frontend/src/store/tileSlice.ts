import type { Tile } from "../types"
import type { StoreSlice, TileSlice } from "./types"
import { findThoughtsForTile, findTileInState, upsertTile, visibleThoughts, visibleTiles } from "./cacheHelpers"
import { enqueueDelete, enqueueUpsert } from "../sync/engine"
import { createClientId, createTemporarySyncId } from "../sync/ids"

function buildOptimisticTile(data: Omit<Tile, "id" | "created_at">, activeCanvasId: number | null): Tile {
  const clientId = createClientId("tile")
  return {
    ...data,
    id: createTemporarySyncId(),
    client_id: clientId,
    canvas_id: data.canvas_id ?? activeCanvasId,
    created_at: new Date().toISOString(),
    stableKey: `tile-${clientId}`,
  }
}

export const createTileSlice: StoreSlice<TileSlice> = (set, get) => ({
  addTile: async (data) => {
    const { activeCanvasId } = get()
    const tile = buildOptimisticTile(data, activeCanvasId)
    set((s) => {
      const tileCache = new Map(s.tileCache)
      if (tile.canvas_id !== null) tileCache.set(tile.canvas_id, [...(tileCache.get(tile.canvas_id) ?? []), tile])
      return { tiles: [...s.tiles, tile], tileCache }
    })
    await enqueueUpsert("tile", tile)
  },

  moveTileLocal: (id, data, fallbackTile) => {
    const { tiles } = get()
    if (tiles.some((tile) => tile.id === id)) {
      set({ tiles: tiles.map((tile) => (tile.id === id ? { ...tile, ...data } : tile)) })
      return
    }
    if (fallbackTile) set({ tiles: [...tiles, { ...fallbackTile, ...data }] })
  },

  updateTile: async (id, data) => {
    let updatedTile: Tile | undefined
    set((s) => {
      const tileCache = new Map(s.tileCache)
      for (const [canvasId, tiles] of tileCache) {
        tileCache.set(canvasId, tiles.map((tile) => {
          if (tile.id !== id) return tile
          updatedTile = { ...tile, ...data }
          return updatedTile
        }))
      }
      return {
        tiles: s.tiles.map((tile) => {
          if (tile.id !== id) return tile
          updatedTile = { ...tile, ...data }
          return updatedTile
        }),
        tileCache,
      }
    })
    if (updatedTile) await enqueueUpsert("tile", updatedTile)
    return updatedTile
  },

  moveTileToCanvas: async (id, targetCanvasId, x, y) => {
    const initial = get()
    const tile = findTileInState(id, initial.tiles, initial.tileCache)
    if (!tile) return

    const movedTile: Tile = { ...tile, canvas_id: targetCanvasId, x, y }
    const carriedThoughts = findThoughtsForTile(id, initial.thoughts, initial.thoughtCache)
    const carriedThoughtIds = new Set(carriedThoughts.map((thought) => thought.id))

    set((s) => {
      const tileCache = new Map(s.tileCache)
      for (const [canvasId, tiles] of tileCache) tileCache.set(canvasId, tiles.filter((item) => item.id !== id))
      tileCache.set(targetCanvasId, upsertTile(tileCache.get(targetCanvasId) ?? [], movedTile))

      const thoughtCache = new Map(s.thoughtCache)
      for (const [canvasId, thoughts] of thoughtCache) {
        thoughtCache.set(canvasId, thoughts.filter((thought) => !carriedThoughtIds.has(thought.id)))
      }
      if (carriedThoughts.length > 0) {
        thoughtCache.set(targetCanvasId, [...(thoughtCache.get(targetCanvasId) ?? []), ...carriedThoughts])
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
      }
    })

    await enqueueUpsert("tile", movedTile)
  },

  removeTile: async (id) => {
    const state = get()
    const tile = findTileInState(id, state.tiles, state.tileCache)
    if (!tile) return
    const tileThoughts = findThoughtsForTile(id, state.thoughts, state.thoughtCache)
    set((s) => {
      const tileCache = new Map(s.tileCache)
      const thoughtCache = new Map(s.thoughtCache)
      for (const [canvasId, tiles] of tileCache) tileCache.set(canvasId, tiles.filter((item) => item.id !== id))
      for (const [canvasId, thoughts] of thoughtCache) thoughtCache.set(canvasId, thoughts.filter((thought) => thought.tile_id !== id))
      return {
        tiles: s.tiles.filter((item) => item.id !== id),
        thoughts: s.thoughts.filter((thought) => thought.tile_id !== id),
        tileCache,
        thoughtCache,
      }
    })
    get().discardThoughtsForTile(id)
    await Promise.all([
      ...tileThoughts.map((thought) => enqueueDelete("thought", thought)),
      enqueueDelete("tile", tile),
    ])
  },
})
