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
import { createTemporaryId, isTemporaryId } from "../utils/optimisticIdentity"

function optimisticThought(tileId: number, content: string, tags: string[], sortOrder: number): Thought {
  return {
    id: createTemporaryId(),
    tile_id: tileId,
    content,
    tags,
    sort_order: sortOrder,
    created_at: new Date().toISOString(),
  }
}

function replaceThoughtId(list: Thought[], temporaryThoughtId: number, thought: Thought) {
  return list.map((item) => item.id === temporaryThoughtId ? thought : item)
}

function retileThoughts(list: Thought[], temporaryTileId: number, savedTileId: number, pendingIds: Set<number>) {
  return list.map((thought) => {
    if (thought.tile_id !== temporaryTileId) return thought
    pendingIds.add(thought.id)
    return { ...thought, tile_id: savedTileId }
  })
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
    if (isTemporaryId(data.tile_id)) return

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
    const stableKey = createTemporaryId()
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
    if (isTemporaryId(tileId)) return

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

  adoptTemporaryTileThoughts: async (temporaryTileId, savedTileId) => {
    const pendingIds = new Set<number>()
    set((s) => {
      const thoughtCache = new Map(s.thoughtCache)
      for (const [canvasId, thoughts] of thoughtCache) {
        thoughtCache.set(canvasId, retileThoughts(thoughts, temporaryTileId, savedTileId, pendingIds))
      }
      return {
        thoughts: retileThoughts(s.thoughts, temporaryTileId, savedTileId, pendingIds),
        thoughtCache,
      }
    })

    for (const temporaryThoughtId of pendingIds) {
      const latest = findThoughtInState(temporaryThoughtId, get().thoughts, get().thoughtCache)
      if (!latest || latest.tile_id !== savedTileId || !isTemporaryId(latest.id)) continue

      try {
        const savedThought = await getApi().thoughts.create({
          tile_id: savedTileId,
          content: latest.content,
          tags: latest.tags,
          sort_order: latest.sort_order,
        })
        let displayedThought: Thought | null = null
        set((s) => {
          const currentThought = findThoughtInState(temporaryThoughtId, s.thoughts, s.thoughtCache)
          const keys = new Map(s.thoughtStableKeys)
          const stableKey = keys.get(temporaryThoughtId)
          keys.delete(temporaryThoughtId)
          if (!currentThought) return { thoughtStableKeys: keys }

          const nextThought: Thought = {
            ...savedThought,
            content: currentThought.content,
            tags: currentThought.tags,
            sort_order: currentThought.sort_order,
          }
          displayedThought = nextThought
          if (stableKey !== undefined) keys.set(savedThought.id, stableKey)

          const thoughtCache = new Map(s.thoughtCache)
          for (const [canvasId, thoughts] of thoughtCache) {
            thoughtCache.set(canvasId, replaceThoughtId(thoughts, temporaryThoughtId, nextThought))
          }
          return {
            thoughts: replaceThoughtId(s.thoughts, temporaryThoughtId, nextThought),
            thoughtCache,
            thoughtStableKeys: keys,
          }
        })

        if (!displayedThought) {
          getApi().thoughts.remove(savedThought.id).catch(console.error)
          continue
        }
        if (displayedThought.content !== savedThought.content) {
          getApi().thoughts.updateContent(savedThought.id, displayedThought.content).catch(console.error)
        }
        if (displayedThought.tags.join("\u0000") !== savedThought.tags.join("\u0000")) {
          getApi().thoughts.updateTags(savedThought.id, displayedThought.tags).catch(console.error)
        }
      } catch (error) {
        console.error(error)
      }
    }
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

    const version = nextThoughtMoveVersion(id)
    const temporaryMove = isTemporaryId(id) || isTemporaryId(tileId)
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
        inFlightMoves: temporaryMove ? s.inFlightMoves : new Set(s.inFlightMoves).add(id),
      }
    })

    if (temporaryMove) {
      clearLatestThoughtMove(id, version)
      return
    }

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
      const keys = new Map(s.thoughtStableKeys)
      keys.delete(id)
      return { thoughts: s.thoughts.filter((thought) => thought.id !== id), thoughtCache, thoughtStableKeys: keys }
    })
    if (isTemporaryId(id)) return
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
    if (isTemporaryId(id)) return
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
    if (isTemporaryId(id)) return
    await getApi().thoughts.updateTags(id, tags)
  },
})
