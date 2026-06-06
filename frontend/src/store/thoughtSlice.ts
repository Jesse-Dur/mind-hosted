import type { Thought } from "../types"
import type { StoreSlice, ThoughtSlice } from "./types"
import { getApi } from "./apiAuth"
import {
  applyOrderedThoughts,
  buildThoughtOrderIds,
  findThoughtCanvasId,
  findThoughtInState,
  findThoughtsForTile,
  sameNumberArray,
  sortThoughtsForPlacement,
  visibleThoughts,
} from "./cacheHelpers"
import { clearLatestThoughtMove, isLatestThoughtMove, nextThoughtMoveVersion } from "./moveVersions"

function optimisticThought(tileId: number, content: string, tags: string[], sortOrder: number): Thought {
  return {
    id: -Date.now(),
    tile_id: tileId,
    content,
    tags,
    sort_order: sortOrder,
    created_at: new Date().toISOString(),
  }
}

export const createThoughtSlice: StoreSlice<ThoughtSlice> = (set, get) => ({
  newThoughtIds: new Set<number>(),
  thoughtStableKeys: new Map<number, number>(),
  inFlightMoves: new Set<number>(),

  addThought: async (data) => {
    const { activeCanvasId } = get()
    const tempThought = optimisticThought(data.tile_id, data.content, data.tags, data.sort_order)
    set((s) => {
      const thoughtCache = new Map(s.thoughtCache)
      if (activeCanvasId !== null) thoughtCache.set(activeCanvasId, [...(thoughtCache.get(activeCanvasId) ?? []), tempThought])
      return { thoughts: [...s.thoughts, tempThought], thoughtCache }
    })

    const thought = await getApi().thoughts.create(data)
    set((s) => {
      const thoughtCache = new Map(s.thoughtCache)
      if (activeCanvasId !== null) {
        thoughtCache.set(activeCanvasId, (thoughtCache.get(activeCanvasId) ?? []).map((item) => item.id === tempThought.id ? thought : item))
      }
      return { thoughts: s.thoughts.map((item) => item.id === tempThought.id ? thought : item), thoughtCache }
    })
  },

  addThoughtToTile: async (tileId, content, tags) => {
    const state = get()
    const stableKey = Date.now()
    const maxOrder = Math.max(-1, ...state.thoughts.filter((thought) => thought.tile_id === tileId).map((thought) => thought.sort_order))
    const tempThought = optimisticThought(tileId, content, tags, maxOrder + 1)
    const activeCanvasId = state.activeCanvasId

    set((s) => {
      const thoughtCache = new Map(s.thoughtCache)
      if (activeCanvasId !== null) thoughtCache.set(activeCanvasId, [...(thoughtCache.get(activeCanvasId) ?? []), tempThought])
      return {
        thoughts: [...s.thoughts, tempThought],
        thoughtCache,
        thoughtStableKeys: new Map(s.thoughtStableKeys).set(tempThought.id, stableKey),
      }
    })

    try {
      const thought = await getApi().thoughts.create({ tile_id: tileId, content, tags, sort_order: 0 })
      set((s) => {
        const keys = new Map(s.thoughtStableKeys)
        const thoughtCache = new Map(s.thoughtCache)
        keys.delete(tempThought.id)
        keys.set(thought.id, stableKey)
        if (activeCanvasId !== null) {
          thoughtCache.set(activeCanvasId, (thoughtCache.get(activeCanvasId) ?? []).map((item) => item.id === tempThought.id ? thought : item))
        }
        return {
          thoughts: s.thoughts.map((item) => item.id === tempThought.id ? thought : item),
          thoughtCache,
          thoughtStableKeys: keys,
        }
      })
    } catch {
      set((s) => {
        const thoughtCache = new Map(s.thoughtCache)
        if (activeCanvasId !== null) {
          thoughtCache.set(activeCanvasId, (thoughtCache.get(activeCanvasId) ?? []).filter((thought) => thought.id !== tempThought.id))
        }
        return { thoughts: s.thoughts.filter((thought) => thought.id !== tempThought.id), thoughtCache }
      })
    }
  },

  moveThoughtToTile: async (id, tileId, options) => {
    const initial = get()
    const thought = findThoughtInState(id, initial.thoughts, initial.thoughtCache)
    if (!thought || (thought.tile_id === tileId && (!options?.orderedIds || options.orderedIds.length === 0))) return

    const version = nextThoughtMoveVersion(id)
    const sourceCanvasId = options?.sourceCanvasId ?? findThoughtCanvasId(id, initial.thoughtCache) ?? initial.activeCanvasId
    const targetCanvasId = options?.targetCanvasId ?? initial.activeCanvasId
    const targetTileThoughts = findThoughtsForTile(tileId, initial.thoughts, initial.thoughtCache)
    const finalIds = buildThoughtOrderIds(options?.orderedIds, id, targetTileThoughts)
    const currentTargetIds = sortThoughtsForPlacement(targetTileThoughts).map((item) => item.id)
    if (thought.tile_id === tileId && sameNumberArray(finalIds, currentTargetIds)) {
      clearLatestThoughtMove(id, version)
      return
    }

    const targetThoughtById = new Map(targetTileThoughts.map((item) => [item.id, item]))
    targetThoughtById.set(id, thought)
    const orderedThoughts = finalIds
      .map((thoughtId, sortOrder) => {
        const base = targetThoughtById.get(thoughtId)
        return base ? { ...base, tile_id: tileId, sort_order: sortOrder } : null
      })
      .filter((item): item is Thought => item !== null)

    set((s) => {
      const thoughtCache = new Map(s.thoughtCache)
      for (const [canvasId, thoughts] of thoughtCache) {
        thoughtCache.set(canvasId, applyOrderedThoughts(thoughts, id, orderedThoughts, canvasId === targetCanvasId))
      }
      if (targetCanvasId !== null) {
        const targetThoughts = thoughtCache.get(targetCanvasId) ?? (s.activeCanvasId === targetCanvasId ? s.thoughts : [])
        thoughtCache.set(targetCanvasId, applyOrderedThoughts(targetThoughts, id, orderedThoughts, true))
      }

      const fallbackThoughts = s.activeCanvasId === targetCanvasId
        ? applyOrderedThoughts(s.thoughts, id, orderedThoughts, true)
        : applyOrderedThoughts(s.thoughts, id, orderedThoughts, false)

      return {
        thoughts: visibleThoughts(s.activeCanvasId, thoughtCache, fallbackThoughts),
        thoughtCache,
        inFlightMoves: new Set(s.inFlightMoves).add(id),
      }
    })

    try {
      await getApi().thoughts.move(id, tileId, finalIds)
    } catch (error) {
      console.error(error)
      if (!isLatestThoughtMove(id, version)) return
      set((s) => {
        const thoughtCache = new Map(s.thoughtCache)
        const previousThoughts = [...targetTileThoughts, thought]
        for (const [canvasId, thoughts] of thoughtCache) {
          thoughtCache.set(canvasId, applyOrderedThoughts(thoughts, id, previousThoughts, canvasId === sourceCanvasId))
        }
        if (sourceCanvasId !== null) {
          const sourceThoughts = thoughtCache.get(sourceCanvasId) ?? (s.activeCanvasId === sourceCanvasId ? s.thoughts : [])
          thoughtCache.set(sourceCanvasId, applyOrderedThoughts(sourceThoughts, id, previousThoughts, true))
        }

        const fallbackThoughts = s.activeCanvasId === sourceCanvasId
          ? applyOrderedThoughts(s.thoughts, id, previousThoughts, true)
          : applyOrderedThoughts(s.thoughts, id, previousThoughts, false)

        return {
          thoughts: visibleThoughts(s.activeCanvasId, thoughtCache, fallbackThoughts),
          thoughtCache,
        }
      })
    } finally {
      if (!isLatestThoughtMove(id, version)) return
      clearLatestThoughtMove(id, version)
      set((s) => {
        const inFlightMoves = new Set(s.inFlightMoves)
        inFlightMoves.delete(id)
        return { inFlightMoves }
      })
      const state = get()
      if (state.inFlightMoves.size === 0) void state.loadThoughts()
    }
  },

  removeThought: (id) => {
    set((s) => {
      const thoughtCache = new Map(s.thoughtCache)
      for (const [canvasId, thoughts] of thoughtCache) thoughtCache.set(canvasId, thoughts.filter((thought) => thought.id !== id))
      return { thoughts: s.thoughts.filter((thought) => thought.id !== id), thoughtCache }
    })
    getApi().thoughts.remove(id).catch(console.error)
  },

  updateThoughtContent: async (id, content) => {
    set((s) => {
      const thoughtCache = new Map(s.thoughtCache)
      for (const [canvasId, thoughts] of thoughtCache) {
        thoughtCache.set(canvasId, thoughts.map((thought) => thought.id === id ? { ...thought, content } : thought))
      }
      return { thoughts: s.thoughts.map((thought) => thought.id === id ? { ...thought, content } : thought), thoughtCache }
    })
    getApi().thoughts.updateContent(id, content).catch(console.error)
  },

  updateThoughtTags: async (id, tags) => {
    set((s) => {
      const thoughtCache = new Map(s.thoughtCache)
      for (const [canvasId, thoughts] of thoughtCache) {
        thoughtCache.set(canvasId, thoughts.map((thought) => thought.id === id ? { ...thought, tags } : thought))
      }
      return { thoughts: s.thoughts.map((thought) => thought.id === id ? { ...thought, tags } : thought), thoughtCache }
    })
    await getApi().thoughts.updateTags(id, tags)
  },
})
