import type { Canvas, Thought, Tile } from "../types"
import type { CanvasSlice, StoreSlice } from "./types"
import { getStoredActiveCanvasId, readStoredActiveCanvasId, writeStoredActiveCanvasId } from "./storage"
import { isTemporaryCanvasId } from "../utils/canvasIdentity"
import { cachedCanvases } from "../sync/cache"
import { enqueueDelete, enqueueUpsert, setSyncActiveCanvas } from "../sync/engine"
import { createClientId, createTemporarySyncId } from "../sync/ids"
import { advanceLoadGeneration } from "./loadGeneration"
import { fetchAndCacheSnapshot } from "../sync/snapshot"
import { isApiUnauthorizedError } from "../api/errors"

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
        setSyncActiveCanvas(stored)
        return stored
      }
      if (currentIsValid) {
        setSyncActiveCanvas(activeCanvasId)
        return activeCanvasId
      }
      const fallback = canvases[0]?.id ?? null
      writeStoredActiveCanvasId(fallback)
      set({ activeCanvasId: fallback })
      setSyncActiveCanvas(fallback)
      return fallback
    }

    const cached = await cachedCanvases()
    if (cached.length > 0) {
      const cachedActive = getStoredActiveCanvasId(cached) ?? cached[0]?.id ?? null
      writeStoredActiveCanvasId(cachedActive)
      set({ canvases: cached, activeCanvasId: cachedActive })
      setSyncActiveCanvas(cachedActive)
      void (async () => {
        try {
          const snapshot = await fetchAndCacheSnapshot(cachedActive)
          const mergedCanvases = snapshot.canvases
          set((s) => {
            const currentIsValid = s.activeCanvasId !== null && mergedCanvases.some((canvas) => canvas.id === s.activeCanvasId)
            const nextActiveCanvasId = currentIsValid ? s.activeCanvasId : snapshot.activeCanvasId ?? getStoredActiveCanvasId(mergedCanvases) ?? mergedCanvases[0]?.id ?? null
            writeStoredActiveCanvasId(nextActiveCanvasId)
            return {
              canvases: mergedCanvases,
              activeCanvasId: nextActiveCanvasId,
              tags: snapshot.tags,
              tiles: s.activeCanvasId === snapshot.activeCanvasId ? snapshot.tiles : s.tiles,
              thoughts: s.activeCanvasId === snapshot.activeCanvasId ? snapshot.thoughts : s.thoughts,
              tileCache: snapshot.activeCanvasId === null ? s.tileCache : new Map(s.tileCache).set(snapshot.activeCanvasId, snapshot.tiles),
              thoughtCache: snapshot.activeCanvasId === null ? s.thoughtCache : new Map(s.thoughtCache).set(snapshot.activeCanvasId, snapshot.thoughts),
            }
          })
          get().markRemoteChanges(snapshot.changedTileIds, snapshot.changedThoughtIds)
        } catch (error) {
          if (isApiUnauthorizedError(error)) return
          console.error(error)
        }
      })()
      return cachedActive
    }

    let snapshot: Awaited<ReturnType<typeof fetchAndCacheSnapshot>>
    try {
      snapshot = await fetchAndCacheSnapshot(readStoredActiveCanvasId())
    } catch (error) {
      if (isApiUnauthorizedError(error)) {
        const { canvases: localCanvases, activeCanvasId } = get()
        return activeCanvasId ?? localCanvases[0]?.id ?? null
      }
      console.error(error)
      const { canvases: localCanvases, activeCanvasId } = get()
      return activeCanvasId ?? localCanvases[0]?.id ?? null
    }
    let nextActiveCanvasId: number | null = null
    set((s) => {
      // Restore last active tab from localStorage, fall back to first canvas.
      const stored = getStoredActiveCanvasId(snapshot.canvases)
      const currentIsValid = s.activeCanvasId !== null && snapshot.canvases.some((canvas) => canvas.id === s.activeCanvasId)
      nextActiveCanvasId = snapshot.activeCanvasId ?? stored ?? (currentIsValid ? s.activeCanvasId : snapshot.canvases[0]?.id ?? null)
      writeStoredActiveCanvasId(nextActiveCanvasId)
      const tileCache = snapshot.activeCanvasId === null ? s.tileCache : new Map(s.tileCache).set(snapshot.activeCanvasId, snapshot.tiles)
      const thoughtCache = snapshot.activeCanvasId === null ? s.thoughtCache : new Map(s.thoughtCache).set(snapshot.activeCanvasId, snapshot.thoughts)
      return {
        canvases: snapshot.canvases,
        activeCanvasId: nextActiveCanvasId,
        tags: snapshot.tags,
        tiles: snapshot.activeCanvasId === nextActiveCanvasId ? snapshot.tiles : [],
        thoughts: snapshot.activeCanvasId === nextActiveCanvasId ? snapshot.thoughts : [],
        tileCache,
        thoughtCache,
      }
    })
    get().markRemoteChanges(snapshot.changedTileIds, snapshot.changedThoughtIds)
    setSyncActiveCanvas(nextActiveCanvasId)
    return nextActiveCanvasId
  },

  setActiveCanvas: (id) => {
    advanceLoadGeneration()
    const { tileCache, thoughtCache } = get()
    if (!isTemporaryCanvasId(id)) writeStoredActiveCanvasId(id)
    // Serve cached canvas data instantly. Temporary canvases only exist locally
    // until creation settles, so fetching them would produce rejected requests.
    set({ activeCanvasId: id, tiles: tileCache.get(id) ?? [], thoughts: thoughtCache.get(id) ?? [] })
    setSyncActiveCanvas(id)
    if (isTemporaryCanvasId(id)) return
    void get().loadTiles(id)
    void get().loadThoughts(id)
  },

  addCanvas: (name) => {
    const { canvases } = get()
    const clientId = createClientId("canvas")
    const tempId = createTemporarySyncId()
    const stableKey = `canvas-${clientId}`
    const tempCanvas: Canvas = {
      id: tempId,
      client_id: clientId,
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

    const persisted = enqueueUpsert("canvas", tempCanvas).then(() => tempCanvas)
    void persisted.catch(console.error)

    return { canvas: tempCanvas, persisted }
  },

  updateCanvas: async (id, data) => {
    let updatedCanvas: Canvas | undefined
    set((s) => ({
      canvases: s.canvases.map((canvas) => {
        if (canvas.id !== id) return canvas
        updatedCanvas = { ...canvas, ...data }
        return updatedCanvas
      }),
    }))
    if (updatedCanvas) await enqueueUpsert("canvas", updatedCanvas)
  },

  reorderCanvases: (updates) => {
    const byId = new Map(updates.map((update) => [update.id, update]))
    const changed: Canvas[] = []
    set((s) => ({
      canvases: s.canvases.map((canvas) => {
        const update = byId.get(canvas.id)
        if (!update) return canvas
        const updated = { ...canvas, ...update }
        changed.push(updated)
        return updated
      }),
    }))
    for (const canvas of changed) void enqueueUpsert("canvas", canvas)
  },

  removeCanvas: async (id, options) => {
    const { canvases, activeCanvasId, tileCache, thoughtCache, tiles, thoughts } = get()
    const removedCanvas = canvases.find((canvas) => canvas.id === id)
    const remainingCanvases = canvases.filter((canvas) => canvas.id !== id)
    if (!removedCanvas) return
    if (remainingCanvases.length === 0) throw new Error("Cannot delete the only canvas")

    const requestedTargetId = options.mode === "moveContents" ? options.targetCanvasId : null
    const nextActiveCanvasId = activeCanvasId === id
      ? requestedTargetId ?? remainingCanvases[0]?.id ?? null
      : activeCanvasId
    const sourceTiles: Tile[] = tileCache.get(id) ?? (activeCanvasId === id ? tiles : [])
    const sourceThoughts: Thought[] = thoughtCache.get(id) ?? (activeCanvasId === id ? thoughts : [])

    writeStoredActiveCanvasId(nextActiveCanvasId)
    if (nextActiveCanvasId !== null) setSyncActiveCanvas(nextActiveCanvasId)

    set((s) => {
      const tileCache = new Map(s.tileCache)
      const thoughtCache = new Map(s.thoughtCache)
      const sourceTilesAreKnown = tileCache.has(id) || s.activeCanvasId === id
      const sourceThoughtsAreKnown = thoughtCache.has(id) || s.activeCanvasId === id
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

    await enqueueDelete("canvas", removedCanvas, {
      mode: options.mode,
      ...(options.mode === "moveContents" ? { targetCanvasId: options.targetCanvasId } : {}),
    })
    if (options.mode === "moveContents") {
      await Promise.all(sourceTiles.map((tile) => enqueueUpsert("tile", { ...tile, canvas_id: options.targetCanvasId })))
    } else {
      await Promise.all([
        ...sourceThoughts.map((thought) => enqueueDelete("thought", thought)),
        ...sourceTiles.map((tile) => enqueueDelete("tile", tile)),
      ])
    }
  },
})
