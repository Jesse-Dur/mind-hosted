import type { Tag } from "../types"
import type { StoreSlice, TagSlice } from "./types"
import { cachedTags } from "../sync/cache"
import { enqueueDelete, enqueueUpsert } from "../sync/engine"
import { createClientId, createTemporarySyncId } from "../sync/ids"
import { fetchAndCacheSnapshot } from "../sync/snapshot"
import { isApiUnauthorizedError } from "../api/errors"
import { assertEditingAllowed } from "../billing/access"

function optimisticTag(name: string, color: string): Tag {
  const clientId = createClientId("tag")
  return {
    id: createTemporarySyncId(),
    client_id: clientId,
    name,
    color,
  }
}

function renameThoughtTags(tags: string[], oldName: string | undefined, newName: string) {
  return oldName ? tags.map((tag) => tag === oldName ? newName : tag) : tags
}

export const createTagSlice: StoreSlice<TagSlice> = (set, get) => ({
  tags: [],

  loadTags: async () => {
    const cached = await cachedTags()
    if (cached.length > 0) {
      set({ tags: cached })
      void (async () => {
        try {
          await fetchAndCacheSnapshot(get().activeCanvasId)
          set({ tags: await cachedTags() })
        } catch (error) {
          if (isApiUnauthorizedError(error)) return
          console.error(error)
        }
      })()
      return
    }
    try {
      await fetchAndCacheSnapshot(get().activeCanvasId)
      set({ tags: await cachedTags() })
    } catch (error) {
      if (isApiUnauthorizedError(error)) return
      console.error(error)
    }
  },

  addTag: async (name, color) => {
    assertEditingAllowed()
    const tag = optimisticTag(name, color)
    set((s) => ({ tags: [...s.tags.filter((item) => item.name !== name), tag].sort((a, b) => a.name.localeCompare(b.name)) }))
    await enqueueUpsert("tag", tag)
  },

  updateTag: async (id, name, color) => {
    assertEditingAllowed()
    const oldTag = get().tags.find((tag) => tag.id === id)
    let updatedTag: Tag | undefined
    set((s) => ({
      tags: s.tags.map((item) => {
        if (item.id !== id) return item
        updatedTag = { ...item, name, color }
        return updatedTag
      }).sort((a, b) => a.name.localeCompare(b.name)),
      thoughts: s.thoughts.map((thought) => ({
        ...thought,
        tags: renameThoughtTags(thought.tags, oldTag?.name, name),
      })),
      thoughtCache: new Map([...s.thoughtCache].map(([canvasId, thoughts]) => [canvasId, thoughts.map((thought) => ({
        ...thought,
        tags: renameThoughtTags(thought.tags, oldTag?.name, name),
      }))])),
    }))
    if (updatedTag) await enqueueUpsert("tag", updatedTag)
  },

  removeTag: async (id) => {
    assertEditingAllowed()
    const tag = get().tags.find((item) => item.id === id)
    set((s) => ({ tags: s.tags.filter((item) => item.id !== id) }))
    if (tag) await enqueueDelete("tag", tag)
  },
})
