import type { Canvas } from "../types"
import type { CanvasSlice, StoreSlice } from "./types"
import { getApi } from "./apiAuth"
import { getStoredActiveCanvasId, readStoredActiveCanvasId, writeStoredActiveCanvasId } from "./storage"

export const createCanvasSlice: StoreSlice<CanvasSlice> = (set, get) => ({
  canvases: [],
  activeCanvasId: readStoredActiveCanvasId(),

  loadCanvases: async () => {
    // Skip if already cached: canvases are kept in sync optimistically.
    // Still return the resolved active id so boot can fetch that exact canvas.
    if (get().canvases.length > 0) {
      const { canvases, activeCanvasId } = get()
      const stored = getStoredActiveCanvasId(canvases)
      const currentIsValid = activeCanvasId !== null && canvases.some((canvas) => canvas.id === activeCanvasId)
      if (stored !== null) {
        if (activeCanvasId !== stored) set({ activeCanvasId: stored })
        return stored
      }
      if (currentIsValid) return activeCanvasId
      const fallback = canvases[0]?.id ?? null
      writeStoredActiveCanvasId(fallback)
      set({ activeCanvasId: fallback })
      return fallback
    }

    const canvases = await getApi().canvases.list()
    let nextActiveCanvasId: number | null = null
    set((s) => {
      // Restore last active tab from localStorage, fall back to first canvas.
      const stored = getStoredActiveCanvasId(canvases)
      const currentIsValid = s.activeCanvasId !== null && canvases.some((canvas) => canvas.id === s.activeCanvasId)
      nextActiveCanvasId = stored ?? (currentIsValid ? s.activeCanvasId : canvases[0]?.id ?? null)
      writeStoredActiveCanvasId(nextActiveCanvasId)
      return { canvases, activeCanvasId: nextActiveCanvasId }
    })
    return nextActiveCanvasId
  },

  setActiveCanvas: (id) => {
    writeStoredActiveCanvasId(id)
    const { tileCache, thoughtCache } = get()
    // Serve cached canvas data instantly, then still refresh in background.
    set({ activeCanvasId: id, tiles: tileCache.get(id) ?? [], thoughts: thoughtCache.get(id) ?? [] })
    void get().loadTiles(id)
    void get().loadThoughts(id)
  },

  addCanvas: async (name) => {
    const { canvases } = get()
    const tempId = -Date.now()
    const stableKey = `canvas-${tempId}`
    const tempCanvas: Canvas = {
      id: tempId,
      name,
      sort_order: canvases.length,
      is_favourite: false,
      created_at: new Date().toISOString(),
      stableKey,
    }
    set((s) => ({
      canvases: [...s.canvases, tempCanvas],
      tileCache: new Map(s.tileCache).set(tempId, []),
      thoughtCache: new Map(s.thoughtCache).set(tempId, []),
    }))

    try {
      const canvas = await getApi().canvases.create(name, canvases.length)
      set((s) => {
        const tileCache = new Map(s.tileCache)
        const thoughtCache = new Map(s.thoughtCache)
        tileCache.set(canvas.id, tileCache.get(tempId) ?? [])
        thoughtCache.set(canvas.id, thoughtCache.get(tempId) ?? [])
        tileCache.delete(tempId)
        thoughtCache.delete(tempId)
        return {
          canvases: s.canvases.map((item) => item.id === tempId ? { ...canvas, stableKey } : item),
          tileCache,
          thoughtCache,
        }
      })
      return { ...canvas, stableKey }
    } catch (error) {
      set((s) => {
        const tileCache = new Map(s.tileCache)
        const thoughtCache = new Map(s.thoughtCache)
        tileCache.delete(tempId)
        thoughtCache.delete(tempId)

        const remainingCanvases = s.canvases.filter((canvas) => canvas.id !== tempId)
        const nextActiveCanvasId = s.activeCanvasId === tempId ? remainingCanvases[0]?.id ?? null : s.activeCanvasId
        if (s.activeCanvasId === tempId) writeStoredActiveCanvasId(nextActiveCanvasId)

        if (s.activeCanvasId !== tempId) return { canvases: remainingCanvases, tileCache, thoughtCache }
        return {
          canvases: remainingCanvases,
          activeCanvasId: nextActiveCanvasId,
          tiles: nextActiveCanvasId === null ? [] : tileCache.get(nextActiveCanvasId) ?? [],
          thoughts: nextActiveCanvasId === null ? [] : thoughtCache.get(nextActiveCanvasId) ?? [],
          tileCache,
          thoughtCache,
        }
      })
      throw error
    }
  },

  updateCanvas: async (id, data) => {
    set((s) => ({ canvases: s.canvases.map((canvas) => canvas.id === id ? { ...canvas, ...data } : canvas) }))
    getApi().canvases.update(id, data).catch(console.error)
  },

  reorderCanvases: (updates) => {
    const byId = new Map(updates.map((update) => [update.id, update]))
    set((s) => ({
      canvases: s.canvases.map((canvas) => {
        const update = byId.get(canvas.id)
        return update ? { ...canvas, ...update } : canvas
      }),
    }))
    getApi().canvases.reorder(updates).catch(console.error)
  },

  removeCanvas: async (id, options) => {
    const { canvases, activeCanvasId } = get()
    const remainingCanvases = canvases.filter((canvas) => canvas.id !== id)
    if (remainingCanvases.length === 0) throw new Error("Cannot delete the only canvas")

    const requestedTargetId = options.mode === "moveContents" ? options.targetCanvasId : null
    const nextActiveCanvasId = activeCanvasId === id
      ? requestedTargetId ?? remainingCanvases[0]?.id ?? null
      : activeCanvasId
    const rollback = {
      canvases,
      activeCanvasId,
      tileCache: new Map(get().tileCache),
      thoughtCache: new Map(get().thoughtCache),
      tiles: get().tiles,
      thoughts: get().thoughts,
    }

    writeStoredActiveCanvasId(nextActiveCanvasId)

    set((s) => {
      const tileCache = new Map(s.tileCache)
      const thoughtCache = new Map(s.thoughtCache)
      const sourceTilesAreKnown = tileCache.has(id) || s.activeCanvasId === id
      const sourceThoughtsAreKnown = thoughtCache.has(id) || s.activeCanvasId === id
      const sourceTiles = tileCache.get(id) ?? (s.activeCanvasId === id ? s.tiles : [])
      const sourceThoughts = thoughtCache.get(id) ?? (s.activeCanvasId === id ? s.thoughts : [])
      tileCache.delete(id)
      thoughtCache.delete(id)

      if (options.mode === "moveContents") {
        const movedTiles = sourceTiles.map((tile) => ({ ...tile, canvas_id: options.targetCanvasId }))
        const targetTilesAreKnown = tileCache.has(options.targetCanvasId) || s.activeCanvasId === options.targetCanvasId
        if (targetTilesAreKnown || sourceTilesAreKnown) {
          const targetTiles = tileCache.get(options.targetCanvasId) ?? (s.activeCanvasId === options.targetCanvasId ? s.tiles : [])
          const movedTileIds = new Set(movedTiles.map((tile) => tile.id))
          tileCache.set(options.targetCanvasId, [
            ...targetTiles.filter((tile) => !movedTileIds.has(tile.id)),
            ...movedTiles,
          ])
        }

        const targetThoughtsAreKnown = thoughtCache.has(options.targetCanvasId) || s.activeCanvasId === options.targetCanvasId
        if (targetThoughtsAreKnown || sourceThoughtsAreKnown) {
          const targetThoughts = thoughtCache.get(options.targetCanvasId) ?? (s.activeCanvasId === options.targetCanvasId ? s.thoughts : [])
          const movedThoughtIds = new Set(sourceThoughts.map((thought) => thought.id))
          thoughtCache.set(options.targetCanvasId, [
            ...targetThoughts.filter((thought) => !movedThoughtIds.has(thought.id)),
            ...sourceThoughts,
          ])
        }
      }

      const visibleTiles = nextActiveCanvasId === null
        ? []
        : tileCache.get(nextActiveCanvasId) ?? (s.activeCanvasId === nextActiveCanvasId ? s.tiles : [])
      const visibleThoughts = nextActiveCanvasId === null
        ? []
        : thoughtCache.get(nextActiveCanvasId) ?? (s.activeCanvasId === nextActiveCanvasId ? s.thoughts : [])

      return {
        canvases: s.canvases.filter((canvas) => canvas.id !== id),
        activeCanvasId: nextActiveCanvasId,
        tiles: visibleTiles,
        thoughts: visibleThoughts,
        tileCache,
        thoughtCache,
      }
    })

    try {
      const result = await getApi().canvases.remove(id, options)
      const refreshCanvasId = result.targetCanvasId ?? (activeCanvasId === id ? nextActiveCanvasId : null)
      if (refreshCanvasId === null) return

      const [tiles, thoughts] = await Promise.all([
        getApi().tiles.list(refreshCanvasId),
        getApi().thoughts.list({ canvasId: refreshCanvasId }),
      ])
      set((s) => {
        const tileCache = new Map(s.tileCache).set(refreshCanvasId, tiles)
        const thoughtCache = new Map(s.thoughtCache).set(refreshCanvasId, thoughts)
        return s.activeCanvasId === refreshCanvasId
          ? { tiles, thoughts, tileCache, thoughtCache }
          : { tileCache, thoughtCache }
      })
    } catch (error) {
      console.error(error)
      writeStoredActiveCanvasId(rollback.activeCanvasId)
      set({
        canvases: rollback.canvases,
        activeCanvasId: rollback.activeCanvasId,
        tileCache: rollback.tileCache,
        thoughtCache: rollback.thoughtCache,
        tiles: rollback.tiles,
        thoughts: rollback.thoughts,
      })
    }
  },
})
