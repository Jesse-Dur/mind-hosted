import type { Canvas } from "../types"
import type { CanvasSlice, StoreSlice } from "./types"
import { getApi } from "./apiAuth"
import { getStoredActiveCanvasId, readStoredActiveCanvasId, writeStoredActiveCanvasId } from "./storage"
import { isTemporaryCanvasId } from "../utils/canvasIdentity"

type CanvasPersistUpdate = Partial<Pick<Canvas, "name" | "sort_order" | "is_favourite">>

let temporaryCanvasSequence = 0

function createTemporaryCanvasId() {
  temporaryCanvasSequence += 1
  return -(Date.now() * 1000 + temporaryCanvasSequence)
}

function buildPersistUpdate(serverCanvas: Canvas, localCanvas: Canvas) {
  const update: CanvasPersistUpdate = {}
  if (localCanvas.name !== serverCanvas.name) update.name = localCanvas.name
  if (localCanvas.sort_order !== serverCanvas.sort_order) update.sort_order = localCanvas.sort_order
  if (localCanvas.is_favourite !== serverCanvas.is_favourite) update.is_favourite = localCanvas.is_favourite
  return update
}

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
    const { tileCache, thoughtCache } = get()
    if (!isTemporaryCanvasId(id)) writeStoredActiveCanvasId(id)
    // Serve cached canvas data instantly. Temporary canvases only exist locally
    // until creation settles, so fetching them would produce rejected requests.
    set({ activeCanvasId: id, tiles: tileCache.get(id) ?? [], thoughts: thoughtCache.get(id) ?? [] })
    if (isTemporaryCanvasId(id)) return
    void get().loadTiles(id)
    void get().loadThoughts(id)
  },

  addCanvas: (name) => {
    const { canvases } = get()
    const tempId = createTemporaryCanvasId()
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

    const persisted = getApi().canvases.create(name, canvases.length).then(async (canvas) => {
      let localCanvas: Canvas = { ...canvas, stableKey }
      set((s) => {
        const tileCache = new Map(s.tileCache)
        const thoughtCache = new Map(s.thoughtCache)
        const tempTiles = tileCache.get(tempId) ?? []
        const tempThoughts = thoughtCache.get(tempId) ?? []
        const optimisticCanvas = s.canvases.find((item) => item.id === tempId) ?? tempCanvas
        localCanvas = {
          ...canvas,
          name: optimisticCanvas.name,
          sort_order: optimisticCanvas.sort_order,
          is_favourite: optimisticCanvas.is_favourite,
          stableKey,
        }

        tileCache.set(canvas.id, tempTiles)
        thoughtCache.set(canvas.id, tempThoughts)
        tileCache.delete(tempId)
        thoughtCache.delete(tempId)
        if (s.activeCanvasId === tempId) writeStoredActiveCanvasId(canvas.id)

        return {
          canvases: s.canvases.map((item) => item.id === tempId ? localCanvas : item),
          activeCanvasId: s.activeCanvasId === tempId ? canvas.id : s.activeCanvasId,
          tiles: s.activeCanvasId === tempId ? tempTiles : s.tiles,
          thoughts: s.activeCanvasId === tempId ? tempThoughts : s.thoughts,
          tileCache,
          thoughtCache,
        }
      })

      const update = buildPersistUpdate(canvas, localCanvas)
      if (Object.keys(update).length === 0) return localCanvas

      try {
        const savedCanvas = await getApi().canvases.update(canvas.id, update)
        let displayedCanvas = { ...savedCanvas, stableKey }
        set((s) => {
          const currentCanvas = s.canvases.find((item) => item.id === canvas.id)
          displayedCanvas = currentCanvas
            ? {
                ...savedCanvas,
                name: currentCanvas.name,
                sort_order: currentCanvas.sort_order,
                is_favourite: currentCanvas.is_favourite,
                stableKey,
              }
            : displayedCanvas
          return {
            canvases: s.canvases.map((item) => item.id === canvas.id ? displayedCanvas : item),
          }
        })
        return displayedCanvas
      } catch (error) {
        console.error(error)
        return localCanvas
      }
    }).catch((error) => {
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
    })

    return { canvas: tempCanvas, persisted }
  },

  updateCanvas: async (id, data) => {
    set((s) => ({ canvases: s.canvases.map((canvas) => canvas.id === id ? { ...canvas, ...data } : canvas) }))
    if (isTemporaryCanvasId(id)) return
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
    const persistedUpdates = updates.filter((update) => !isTemporaryCanvasId(update.id))
    if (persistedUpdates.length > 0) getApi().canvases.reorder(persistedUpdates).catch(console.error)
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
