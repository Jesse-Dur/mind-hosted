import { create } from "zustand"
import type { Tile, Thought, Tag } from "./types"
import { createApi } from "./api/client"

type GetToken = () => Promise<string | null>

let _getToken: GetToken = () => Promise.resolve(null)
export function setGetToken(fn: GetToken) { _getToken = fn }
const api = () => createApi(_getToken)

export type AiStatus = "idle" | "processing" | "queued" | "limited"

interface Store {
  tiles: Tile[]
  thoughts: Thought[]
  tags: Tag[]
  newThoughtIds: Set<number>
  thoughtStableKeys: Map<number, number>
  inFlightMoves: Set<number>
  newestTileId: number | null
  spotlightOpen: boolean
  sidebarOpen: boolean
  canvasHeight: number
  aiStatus: AiStatus
  setSpotlightOpen: (open: boolean) => void
  setSidebarOpen: (open: boolean) => void
  setCanvasHeight: (h: number) => void
  loadTiles: () => Promise<void>
  loadThoughts: () => Promise<void>
  loadTags: () => Promise<void>
  loadAiStatus: () => Promise<void>
  startAiPolling: () => void
  setAiStatus: (status: AiStatus) => void
  addTile: (tile: Omit<Tile, "id" | "created_at">) => Promise<void>
  moveTileLocal: (id: number, data: Partial<Tile>) => void
  updateTile: (id: number, data: Partial<Tile>) => Promise<void | Tile>
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
  thoughtStableKeys: new Map<number, number>(),
  inFlightMoves: new Set<number>(),
  newestTileId: null,
  spotlightOpen: false,
  sidebarOpen: false,
  canvasHeight: Number(localStorage.getItem("canvasHeight") ?? 1440),
  aiStatus: "idle" as AiStatus,

  setSpotlightOpen: (open) => set({ spotlightOpen: open }),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  setCanvasHeight: (h) => { localStorage.setItem("canvasHeight", String(h)); set({ canvasHeight: h }) },
  setAiStatus: (status) => set({ aiStatus: status }),

  loadTiles: async () => {
    const tiles = await api().tiles.list()
    set({ tiles })
  },

  loadThoughts: async () => {
    const state = useStore.getState()
    if (state.inFlightMoves.size > 0) return
    const prev = state.thoughts.map((t) => t.id)
    const thoughts = await api().thoughts.list()
    const newIds = new Set(thoughts.filter((t) => !prev.includes(t.id)).map((t) => t.id))
    set((s) => {
      if (s.inFlightMoves.size > 0) return s
      const merged = thoughts.map((t) => {
        const existing = s.thoughts.find((e) => e.id === t.id)
        if (existing && existing.tile_id !== t.tile_id) return existing
        return t
      })
      return { thoughts: merged, newThoughtIds: newIds }
    })
    if (newIds.size > 0) setTimeout(() => set({ newThoughtIds: new Set() }), 1000)
  },

  loadTags: async () => {
    const tags = await api().tags.list()
    set({ tags })
  },

  loadAiStatus: async () => {
    try {
      const { status } = await api().ai.status()
      set({ aiStatus: status as AiStatus })
    } catch { /* ignore */ }
  },

  startAiPolling: () => {
    let poll: ReturnType<typeof setInterval>
    const safety = setTimeout(() => clearInterval(poll), 120000)
    poll = setInterval(async () => {
      try {
        const { status } = await api().ai.status()
        set({ aiStatus: status as AiStatus })
        if (status === "idle") { clearInterval(poll); clearTimeout(safety) }
      } catch { clearInterval(poll); clearTimeout(safety) }
    }, 1000)
  },

  addTile: async (data) => {
    const tempId = -Date.now()
    const tempTile = { ...data, id: tempId, created_at: new Date().toISOString() }
    set((s) => ({ tiles: [...s.tiles, tempTile], newestTileId: tempId }))
    const tile = await api().tiles.create(data)
    set((s) => ({ tiles: s.tiles.map((t) => t.id === tempId ? tile : t), newestTileId: tile.id }))
  },

  moveTileLocal: (id, data) =>
    set((s) => ({ tiles: s.tiles.map((t) => (t.id === id ? { ...t, ...data } : t)) })),

  updateTile: (id, data) => {
    set((s) => ({ tiles: s.tiles.map((t) => (t.id === id ? { ...t, ...data } : t)) }))
    return api().tiles.update(id, data).catch(console.error)
  },

  removeTile: async (id) => {
    set((s) => ({ tiles: s.tiles.filter((t) => t.id !== id), thoughts: s.thoughts.filter((t) => t.tile_id !== id) }))
    api().tiles.remove(id).catch(console.error)
  },

  addThought: async (data) => {
    const tempId = -Date.now()
    const tempThought = { ...data, id: tempId, created_at: new Date().toISOString() }
    set((s) => ({ thoughts: [...s.thoughts, tempThought] }))
    const thought = await api().thoughts.create(data)
    set((s) => ({ thoughts: s.thoughts.map((t) => t.id === tempId ? thought : t) }))
  },

  updateThoughtContent: async (id, content) => {
    set((s) => ({ thoughts: s.thoughts.map((t) => t.id === id ? { ...t, content } : t) }))
    api().thoughts.updateContent(id, content).catch(console.error)
  },

  addTag: async (name, color) => {
    const tag = await api().tags.create(name, color)
    set((s) => ({ tags: [...s.tags.filter((t) => t.name !== name), tag] }))
  },

  updateTag: async (id, name, color) => {
    const oldTag = get().tags.find((t) => t.id === id)
    const tag = await api().tags.update(id, name, color)
    set((s) => ({
      tags: s.tags.map((t) => t.id === id ? tag : t),
      thoughts: s.thoughts.map((t) => ({
        ...t,
        tags: t.tags.map((tg) => oldTag && tg === oldTag.name ? name : tg),
      })),
    }))
  },

  removeTag: async (id) => {
    await api().tags.remove(id)
    set((s) => ({ tags: s.tags.filter((t) => t.id !== id) }))
  },
}))
