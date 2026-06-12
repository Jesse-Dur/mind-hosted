import type { Thought } from "../types"
import type { StoreSlice, ThoughtSlice } from "./types"
import {
  applyOrderedThoughts,
  buildThoughtOrderIds,
  findThoughtInState,
  findThoughtsForTile,
  sameNumberArray,
  sortThoughtsForPlacement,
  visibleThoughts,
} from "./cacheHelpers"
import { enqueueDelete, enqueueUpsert } from "../sync/engine"
import { createClientId, createTemporarySyncId } from "../sync/ids"

function optimisticThought(tileId: number, content: string, tags: string[], sortOrder: number): Thought {
  const clientId = createClientId("thought")
  return {
    id: createTemporarySyncId(),
    client_id: clientId,
    tile_id: tileId,
    content,
    tags,
    sort_order: sortOrder,
    created_at: new Date().toISOString(),
    stableKey: `thought-${clientId}`,
  }
}

function removeThoughtFromCache(cache: Map<number, Thought[]>, id: number) {
  const next = new Map(cache)
  for (const [canvasId, thoughts] of next) next.set(canvasId, thoughts.filter((thought) => thought.id !== id))
  return next
}

export const createThoughtSlice: StoreSlice<ThoughtSlice> = (set, get) => ({
  thoughtStableKeys: new Map<number, number>(),

  addThought: async (data) => {
    const { activeCanvasId } = get()
    const tempThought = optimisticThought(data.tile_id, data.content, data.tags, data.sort_order)
    set((s) => {
      const thoughtCache = new Map(s.thoughtCache)
      if (activeCanvasId !== null) thoughtCache.set(activeCanvasId, [...(thoughtCache.get(activeCanvasId) ?? []), tempThought])
      return { thoughts: [...s.thoughts, tempThought], thoughtCache }
    })
    await enqueueUpsert("thought", tempThought)
  },

  addThoughtToTile: async (tileId, content, tags) => {
    const state = get()
    const maxOrder = Math.max(-1, ...state.thoughts.filter((thought) => thought.tile_id === tileId).map((thought) => thought.sort_order))
    const tempThought = optimisticThought(tileId, content, tags, maxOrder + 1)
    const stableKey = createTemporarySyncId()
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
    await enqueueUpsert("thought", tempThought)
  },

  adoptTemporaryTileThoughts: async () => {
    // The sync engine resolves temporary tile dependencies before pushing thoughts.
  },

  discardThoughtsForTile: (tileId) => {
    set((s) => {
      const removedIds = new Set(s.thoughts.filter((thought) => thought.tile_id === tileId).map((thought) => thought.id))
      const thoughtCache = new Map(s.thoughtCache)
      for (const [canvasId, thoughts] of thoughtCache) {
        const removedCachedIds = thoughts.filter((thought) => thought.tile_id === tileId).map((thought) => thought.id)
        for (const id of removedCachedIds) removedIds.add(id)
        thoughtCache.set(canvasId, thoughts.filter((thought) => thought.tile_id !== tileId))
      }
      const keys = new Map(s.thoughtStableKeys)
      for (const id of removedIds) keys.delete(id)
      return {
        thoughts: s.thoughts.filter((thought) => thought.tile_id !== tileId),
        thoughtCache,
        thoughtStableKeys: keys,
      }
    })
  },

  moveThoughtToTile: async (id, tileId, options) => {
    const initial = get()
    const thought = findThoughtInState(id, initial.thoughts, initial.thoughtCache)
    if (!thought || (thought.tile_id === tileId && (!options?.orderedIds || options.orderedIds.length === 0))) return

    const targetCanvasId = options?.targetCanvasId ?? initial.activeCanvasId
    const targetTileThoughts = findThoughtsForTile(tileId, initial.thoughts, initial.thoughtCache)
    const finalIds = buildThoughtOrderIds(options?.orderedIds, id, targetTileThoughts)
    const currentTargetIds = sortThoughtsForPlacement(targetTileThoughts).map((item) => item.id)
    if (thought.tile_id === tileId && sameNumberArray(finalIds, currentTargetIds)) {
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
      }
    })

    for (const orderedThought of orderedThoughts) await enqueueUpsert("thought", orderedThought)
  },

  removeThought: (id) => {
    const thought = findThoughtInState(id, get().thoughts, get().thoughtCache)
    set((s) => {
      const keys = new Map(s.thoughtStableKeys)
      keys.delete(id)
      return {
        thoughts: s.thoughts.filter((item) => item.id !== id),
        thoughtCache: removeThoughtFromCache(s.thoughtCache, id),
        thoughtStableKeys: keys,
      }
    })
    if (thought) void enqueueDelete("thought", thought)
  },

  updateThoughtContent: async (id, content) => {
    let updatedThought: Thought | undefined
    set((s) => {
      const thoughtCache = new Map(s.thoughtCache)
      for (const [canvasId, thoughts] of thoughtCache) {
        thoughtCache.set(canvasId, thoughts.map((thought) => {
          if (thought.id !== id) return thought
          updatedThought = { ...thought, content }
          return updatedThought
        }))
      }
      return {
        thoughts: s.thoughts.map((thought) => {
          if (thought.id !== id) return thought
          updatedThought = { ...thought, content }
          return updatedThought
        }),
        thoughtCache,
      }
    })
    if (updatedThought) await enqueueUpsert("thought", updatedThought)
  },

  updateThoughtTags: async (id, tags) => {
    let updatedThought: Thought | undefined
    set((s) => {
      const thoughtCache = new Map(s.thoughtCache)
      for (const [canvasId, thoughts] of thoughtCache) {
        thoughtCache.set(canvasId, thoughts.map((thought) => {
          if (thought.id !== id) return thought
          updatedThought = { ...thought, tags }
          return updatedThought
        }))
      }
      return {
        thoughts: s.thoughts.map((thought) => {
          if (thought.id !== id) return thought
          updatedThought = { ...thought, tags }
          return updatedThought
        }),
        thoughtCache,
      }
    })
    if (updatedThought) await enqueueUpsert("thought", updatedThought)
  },
})
