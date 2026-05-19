import type { Tile, Thought, Tag, HistoryEvent } from "../types"

const BASE = "/api"

async function req<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  })
  if (!res.ok) throw new Error(`API error ${res.status}: ${path}`)
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

export const tilesApi = {
  list: () => req<Tile[]>("/tiles"),
  listPast: () => req<Tile[]>("/tiles/past"),
  create: (data: Omit<Tile, "id" | "created_at">) =>
    req<Tile>("/tiles", { method: "POST", body: JSON.stringify(data) }),
  update: (id: number, data: Partial<Tile>) =>
    req<Tile>(`/tiles/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  remove: (id: number) => req<void>(`/tiles/${id}`, { method: "DELETE" }),
}

export const thoughtsApi = {
  list: (tileId?: number) =>
    req<Thought[]>(tileId ? `/thoughts?tile_id=${tileId}` : "/thoughts"),
  listPast: () => req<Thought[]>("/thoughts/past"),
  create: (data: Omit<Thought, "id" | "created_at">) =>
    req<Thought>("/thoughts", { method: "POST", body: JSON.stringify(data) }),
  reorder: (id: number, sort_order: number) =>
    req<void>(`/thoughts/${id}/reorder`, { method: "PATCH", body: JSON.stringify({ sort_order }) }),
  updateTags: (id: number, tags: string[]) =>
    req<Thought>(`/thoughts/${id}/tags`, { method: "PATCH", body: JSON.stringify({ tags }) }),
  updateContent: (id: number, content: string) =>
    req<void>(`/thoughts/${id}/content`, { method: "PATCH", body: JSON.stringify({ content }) }),
  move: (id: number, tile_id: number) =>
    req<void>(`/thoughts/${id}/move`, { method: "PATCH", body: JSON.stringify({ tile_id }) }),
  remove: (id: number) => req<void>(`/thoughts/${id}`, { method: "DELETE" }),
}

export const tagsApi = {
  list: () => req<Tag[]>("/tags"),
  create: (name: string, color: string) =>
    req<Tag>("/tags", { method: "POST", body: JSON.stringify({ name, color }) }),
  update: (id: number, name: string, color: string) =>
    req<Tag>(`/tags/${id}`, { method: "PATCH", body: JSON.stringify({ name, color }) }),
  remove: (id: number) => req<void>(`/tags/${id}`, { method: "DELETE" }),
}

export const ollamaApi = {
  process: (input: string, priority: "low" | "medium" | "high") =>
    req<{ job_id: string }>("/ollama/process", {
      method: "POST",
      body: JSON.stringify({ input, priority }),
    }),
}

export const historyApi = {
  list: () => req<HistoryEvent[]>("/history"),
}
