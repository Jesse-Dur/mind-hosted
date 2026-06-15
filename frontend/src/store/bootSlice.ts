import type { BootSlice, StoreSlice } from "./types"
import { getStoredActiveCanvasId, writeStoredActiveCanvasId } from "./storage"
import { cachedCanvases, cachedTags, cachedThoughtsForCanvas, cachedTiles } from "../sync/cache"
import { setSyncActiveCanvas } from "../sync/engine"

export const createBootSlice: StoreSlice<BootSlice> = (set) => ({
  hydrateCachedWorkspace: async () => {
    const canvases = await cachedCanvases()
    if (canvases.length === 0) {
      setSyncActiveCanvas(null)
      return { activeCanvasId: null, hasUsableCache: false }
    }

    const activeCanvasId = getStoredActiveCanvasId(canvases) ?? canvases[0]?.id ?? null
    writeStoredActiveCanvasId(activeCanvasId)

    const [tags, tiles, thoughts] = activeCanvasId === null
      ? [await cachedTags(), [], []] as const
      : await Promise.all([
        cachedTags(),
        cachedTiles(activeCanvasId),
        cachedThoughtsForCanvas(activeCanvasId),
      ])

    set({
      canvases,
      activeCanvasId,
      tags,
      tiles,
      thoughts,
      tileCache: activeCanvasId === null ? new Map() : new Map([[activeCanvasId, tiles]]),
      thoughtCache: activeCanvasId === null ? new Map() : new Map([[activeCanvasId, thoughts]]),
    })

    // Once localStorage/cache reveals the active canvas, sync can start without
    // waiting for the loading overlay or animation lifecycle.
    setSyncActiveCanvas(activeCanvasId)
    return { activeCanvasId, hasUsableCache: true }
  },
})
