// This slice restores cached workspace state from local storage and IndexedDB.
import type { CachedWorkspaceHydration, StoreSlice, WorkspaceRestoreSlice } from "./types"
import { getStoredActiveCanvasId, writeStoredActiveCanvasId } from "./storage"
import { cachedCanvases, cachedTags, cachedThoughtsForCanvas, cachedTiles } from "../sync/cache"
import { setSyncActiveCanvas } from "../sync/engine"

export const createWorkspaceRestoreSlice: StoreSlice<WorkspaceRestoreSlice> = (set) => ({
  restoreCachedWorkspace: async () => {
    const canvases = await cachedCanvases()
    if (canvases.length === 0) {
      setSyncActiveCanvas(null)
      return { activeCanvasId: null, hasUsableCache: false }
    }

    const activeCanvasId = getStoredActiveCanvasId(canvases) ?? canvases[0]?.id ?? null
    writeStoredActiveCanvasId(activeCanvasId)

    const [tags, tiles, thoughts] = activeCanvasId === null
      ? [await cachedTags(), [], []]
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

    // The sync engine can follow the restored active canvas immediately; it does not need the shell to finish fading.
    setSyncActiveCanvas(activeCanvasId)
    return { activeCanvasId, hasUsableCache: true } satisfies CachedWorkspaceHydration
  },
})
