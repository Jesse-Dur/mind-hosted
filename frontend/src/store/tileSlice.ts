import type { Tile } from "../types"
import type { StoreSlice, TileSlice } from "./types"
import { getApi } from "./apiAuth"
import { findThoughtsForTile, findTileInState, upsertTile, visibleThoughts, visibleTiles } from "./cacheHelpers"
import { clearLatestTileMove, isLatestTileMove, nextTileMoveVersion } from "./moveVersions"
import { isTemporaryCanvasId } from "../utils/canvasIdentity"
import { createTemporaryId, isTemporaryId } from "../utils/optimisticIdentity"

type TilePersistUpdate = Partial<Pick<Tile, "canvas_id" | "title" | "x" | "y" | "width" | "height" | "importance" | "visible">>
type TileCreateData = Omit<Tile, "id" | "created_at" | "stableKey">
const TEMPORARY_PARENT_RETRY_MS = 500
const TILE_PERSIST_RETRY_DELAYS_MS = [1000, 2000, 5000, 10000, 30000]

function buildTileCreateData(tile: Tile): TileCreateData {
  return {
    canvas_id: tile.canvas_id,
    title: tile.title,
    x: tile.x,
    y: tile.y,
    width: tile.width,
    height: tile.height,
    importance: tile.importance,
    visible: tile.visible,
  }
}

function buildTilePersistUpdate(serverTile: Tile, localTile: Tile) {
  const update: TilePersistUpdate = {}
  if (localTile.canvas_id !== serverTile.canvas_id) update.canvas_id = localTile.canvas_id
  if (localTile.title !== serverTile.title) update.title = localTile.title
  if (localTile.x !== serverTile.x) update.x = localTile.x
  if (localTile.y !== serverTile.y) update.y = localTile.y
  if (localTile.width !== serverTile.width) update.width = localTile.width
  if (localTile.height !== serverTile.height) update.height = localTile.height
  if (localTile.importance !== serverTile.importance) update.importance = localTile.importance
  if (localTile.visible !== serverTile.visible) update.visible = localTile.visible
  return update
}

function replaceTileId(list: Tile[], tempId: number, tile: Tile) {
  return list.map((item) => item.id === tempId ? tile : item)
}

function tilePersistRetryDelay(attempt: number) {
  return TILE_PERSIST_RETRY_DELAYS_MS[Math.min(attempt, TILE_PERSIST_RETRY_DELAYS_MS.length - 1)]
}

function waitForTilePersistRetry(attempt: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, tilePersistRetryDelay(attempt)))
}

function waitForTemporaryParent() {
  return new Promise<void>((resolve) => setTimeout(resolve, TEMPORARY_PARENT_RETRY_MS))
}

function apiErrorStatus(error: unknown) {
  if (!(error instanceof Error)) return null
  const match = error.message.match(/^API error (\d+):/)
  return match ? Number(match[1]) : null
}

function shouldRetryTilePersistence(error: unknown) {
  const status = apiErrorStatus(error)
  // Validation and missing-canvas errors need rollback; network/auth/server blips may self-heal.
  return status === null || status === 401 || status === 408 || status === 429 || status >= 500
}

export const createTileSlice: StoreSlice<TileSlice> = (set, get) => ({
  inFlightTileMoves: new Set<number>(),
  newestTileId: null,

  addTile: async (data) => {
    const { activeCanvasId } = get()
    const tempId = createTemporaryId()
    const stableKey = `tile-${tempId}`
    const tempTile: Tile = { ...data, id: tempId, canvas_id: activeCanvasId, created_at: new Date().toISOString(), stableKey }
    set((s) => {
      const tileCache = new Map(s.tileCache)
      if (activeCanvasId !== null) tileCache.set(activeCanvasId, [...(tileCache.get(activeCanvasId) ?? []), tempTile])
      return { tiles: [...s.tiles, tempTile], tileCache, newestTileId: tempId }
    })

    try {
      let attempt = 0
      let tile: Tile | null = null
      while (tile === null) {
        const pendingTile = findTileInState(tempId, get().tiles, get().tileCache)
        if (!pendingTile) return
        if (pendingTile.canvas_id !== null && isTemporaryCanvasId(pendingTile.canvas_id)) {
          await waitForTemporaryParent()
          continue
        }
        try {
          tile = await getApi().tiles.create(buildTileCreateData(pendingTile))
        } catch (error) {
          if (!shouldRetryTilePersistence(error)) throw error
          console.error(error)
          await waitForTilePersistRetry(attempt)
          attempt += 1
        }
      }

      let localTile: Tile | null = null
      set((s) => {
        const currentTile = findTileInState(tempId, s.tiles, s.tileCache)
        if (!currentTile) return {}
        localTile = { ...tile, ...currentTile, id: tile.id, created_at: tile.created_at, stableKey }
        const tileCache = new Map(s.tileCache)
        for (const [canvasId, tiles] of tileCache) {
          tileCache.set(canvasId, replaceTileId(tiles, tempId, localTile))
        }
        if (localTile.canvas_id !== null && !tileCache.get(localTile.canvas_id)?.some((item) => item.id === tile.id)) {
          tileCache.set(localTile.canvas_id, upsertTile(tileCache.get(localTile.canvas_id) ?? [], localTile))
        }
        return {
          tiles: replaceTileId(s.tiles, tempId, localTile),
          tileCache,
          newestTileId: tile.id,
        }
      })

      if (!localTile) {
        getApi().tiles.remove(tile.id).catch(console.error)
        return
      }

      await get().adoptTemporaryTileThoughts(tempId, tile.id)

      let persistedTile = tile
      let updateAttempt = 0
      while (true) {
        const latestTile = findTileInState(tile.id, get().tiles, get().tileCache)
        if (!latestTile) return

        const update = buildTilePersistUpdate(persistedTile, latestTile)
        if (Object.keys(update).length === 0) return

        try {
          const savedTile = await getApi().tiles.update(tile.id, update)
          persistedTile = savedTile
          updateAttempt = 0
          set((s) => {
            const currentTile = findTileInState(tile.id, s.tiles, s.tileCache)
            if (!currentTile) return {}
            const displayedTile = { ...savedTile, ...currentTile, id: savedTile.id, created_at: savedTile.created_at, stableKey }
            const tileCache = new Map(s.tileCache)
            for (const [canvasId, tiles] of tileCache) {
              tileCache.set(canvasId, tiles.map((item) => item.id === tile.id ? displayedTile : item))
            }
            return {
              tiles: s.tiles.map((item) => item.id === tile.id ? displayedTile : item),
              tileCache,
            }
          })
        } catch (error) {
          if (!shouldRetryTilePersistence(error)) {
            console.error(error)
            return
          }
          console.error(error)
          await waitForTilePersistRetry(updateAttempt)
          updateAttempt += 1
        }
      }
    } catch (error) {
      console.error(error)
      set((s) => {
        const tileCache = new Map(s.tileCache)
        for (const [canvasId, tiles] of tileCache) tileCache.set(canvasId, tiles.filter((tile) => tile.id !== tempId))
        return {
          tiles: s.tiles.filter((tile) => tile.id !== tempId),
          tileCache,
          newestTileId: s.newestTileId === tempId ? null : s.newestTileId,
        }
      })
      get().discardThoughtsForTile(tempId)
    }
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
    if (isTemporaryId(id)) return Promise.resolve(updatedTile)
    return getApi().tiles.update(id, data).catch(console.error)
  },

  moveTileToCanvas: async (id, targetCanvasId, x, y) => {
    const initial = get()
    const tile = findTileInState(id, initial.tiles, initial.tileCache)
    if (!tile) return

    const version = nextTileMoveVersion(id)
    const temporaryTile = isTemporaryId(id)
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
        inFlightTileMoves: temporaryTile ? s.inFlightTileMoves : new Set(s.inFlightTileMoves).add(id),
      }
    })

    if (temporaryTile) return

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
    const temporaryTile = isTemporaryId(id)
    if (temporaryTile) get().discardThoughtsForTile(id)
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
    if (temporaryTile) return
    getApi().tiles.remove(id).catch(console.error)
  },
})
