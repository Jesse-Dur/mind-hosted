import type { StoreSlice, TagSlice } from "./types"
import { getApi } from "./apiAuth"

export const createTagSlice: StoreSlice<TagSlice> = (set, get) => ({
  tags: [],

  loadTags: async () => {
    const tags = await getApi().tags.list()
    set({ tags })
  },

  addTag: async (name, color) => {
    const tag = await getApi().tags.create(name, color)
    set((s) => ({ tags: [...s.tags.filter((item) => item.name !== name), tag] }))
  },

  updateTag: async (id, name, color) => {
    const oldTag = get().tags.find((tag) => tag.id === id)
    const tag = await getApi().tags.update(id, name, color)
    set((s) => ({
      tags: s.tags.map((item) => item.id === id ? tag : item),
      thoughts: s.thoughts.map((thought) => ({
        ...thought,
        tags: thought.tags.map((thoughtTag) => oldTag && thoughtTag === oldTag.name ? name : thoughtTag),
      })),
      thoughtCache: new Map([...s.thoughtCache].map(([canvasId, thoughts]) => [canvasId, thoughts.map((thought) => ({
        ...thought,
        tags: thought.tags.map((thoughtTag) => oldTag && thoughtTag === oldTag.name ? name : thoughtTag),
      }))])),
    }))
  },

  removeTag: async (id) => {
    await getApi().tags.remove(id)
    set((s) => ({ tags: s.tags.filter((tag) => tag.id !== id) }))
  },
})
