import { create } from "zustand"
import type { Tile, Thought, Tag } from "./types"
import { tilesApi, thoughtsApi, tagsApi } from "./api/client"

interface Store {
  tiles: Tile[]
  thoughts: Thought[]
  tags: Tag[]
  newThoughtIds: Set<number>
  newestTileId: number | null
  spotlightOpen: boolean
  sidebarOpen: boolean
  canvasHeight: number
  setSpotlightOpen: (open: boolean) => void
  setSidebarOpen: (open: boolean) => void
  setCanvasHeight: (h: number) => void
  loadTiles: () => Promise<void>
  loadThoughts: () => Promise<void>
  loadTags: () => Promise<void>
  addTile: (tile: Omit<Tile, "id" | "created_at">) => Promise<void>
  updateTile: (id: number, data: Partial<Tile>) => Promise<void>
  removeTile: (id: number) => Promise<void>
  addThought: (thought: Omit<Thought, "id" | "created_at">) => Promise<void>
  updateThoughtContent: (id: number, content: string) => Promise<void>
  addTag: (name: string, color: string) => Promise<void>
  updateTag: (id: number, name: string, color: string) => Promise<void>
  removeTag: (id: number) => Promise<void>
}

export const useStore = create<Store>((set, get) => ({
  tiles: [],
  thoughts: [],
  tags: [],
  newThoughtIds: new Set<number>(),
  newestTileId: null,
  spotlightOpen: false,
  sidebarOpen: false,
  canvasHeight: Number(localStorage.getItem("canvasHeight") ?? 1440),

  setSpotlightOpen: (open) => set({ spotlightOpen: open }),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  setCanvasHeight: (h) => { localStorage.setItem("canvasHeight", String(h)); set({ canvasHeight: h }) },

  loadTiles: async () => {
    const tiles = await tilesApi.list()
    set({ tiles })
  },

  loadThoughts: async () => {
    const prev = useStore.getState().thoughts.map((t) => t.id)
    const thoughts = await thoughtsApi.list()
    const newIds = new Set(thoughts.filter((t) => !prev.includes(t.id)).map((t) => t.id))
    set({ thoughts, newThoughtIds: newIds })
    if (newIds.size > 0) setTimeout(() => set({ newThoughtIds: new Set() }), 1000)
  },

  loadTags: async () => {
    const tags = await tagsApi.list()
    set({ tags })
  },

  addTile: async (data) => {
    const tile = await tilesApi.create(data)
    set((s) => ({ tiles: [...s.tiles, tile], newestTileId: tile.id }))
  },

  updateTile: async (id, data) => {
    const updated = await tilesApi.update(id, data)
    set((s) => ({ tiles: s.tiles.map((t) => (t.id === id ? updated : t)) }))
  },

  removeTile: async (id) => {
    await tilesApi.remove(id)
    set((s) => ({ tiles: s.tiles.filter((t) => t.id !== id), thoughts: s.thoughts.filter((t) => t.tile_id !== id) }))
  },

  addThought: async (data) => {
    const thought = await thoughtsApi.create(data)
    set((s) => ({ thoughts: [...s.thoughts, thought] }))
    get().loadTiles()
  },

  updateThoughtContent: async (id: number, content: string) => {
    set((s) => ({ thoughts: s.thoughts.map((t) => t.id === id ? { ...t, content } : t) }))
    await thoughtsApi.updateContent(id, content)
  },

  addTag: async (name, color) => {
    const tag = await tagsApi.create(name, color)
    set((s) => ({ tags: [...s.tags.filter((t) => t.name !== name), tag] }))
  },

  updateTag: async (id: number, name: string, color: string) => {
    const tag = await tagsApi.update(id, name, color)
    set((s) => ({
      tags: s.tags.map((t) => t.id === id ? tag : t),
      thoughts: s.thoughts.map((t) => ({
        ...t,
        tags: t.tags.map((tg) => {
          const old = s.tags.find(tag => tag.id === id)
          return old && tg === old.name ? name : tg
        })
      }))
    }))
  },

  removeTag: async (id) => {
    await tagsApi.remove(id)
    set((s) => ({ tags: s.tags.filter((t) => t.id !== id) }))
  },
}))
