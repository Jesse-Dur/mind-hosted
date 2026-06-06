import type { Tile, Thought, Tag, HistoryPage } from "../types"

const BASE = "/api"

type GetToken = () => Promise<string | null>

async function req<T>(path: string, getToken: GetToken, options?: RequestInit): Promise<T> {
  const token = await getToken()
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { "Authorization": `Bearer ${token}` } : {}),
      ...(options?.headers ?? {}),
    },
  })
  if (!res.ok) throw new Error(`API error ${res.status}: ${path}`)
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

export function createApi(getToken: GetToken) {
  return {
    tiles: {
      list: () => req<Tile[]>("/tiles", getToken),
      listPast: () => req<Tile[]>("/tiles/past", getToken),
      create: (data: Omit<Tile, "id" | "created_at">) =>
        req<Tile>("/tiles", getToken, { method: "POST", body: JSON.stringify(data) }),
      update: (id: number, data: Partial<Tile>) =>
        req<Tile>(`/tiles/${id}`, getToken, { method: "PATCH", body: JSON.stringify(data) }),
      remove: (id: number) => req<void>(`/tiles/${id}`, getToken, { method: "DELETE" }),
    },

    thoughts: {
      list: (tileId?: number) =>
        req<Thought[]>(tileId ? `/thoughts?tile_id=${tileId}` : "/thoughts", getToken),
      listPast: () => req<Thought[]>("/thoughts/past", getToken),
      create: (data: Omit<Thought, "id" | "created_at">) =>
        req<Thought>("/thoughts", getToken, { method: "POST", body: JSON.stringify(data) }),
      reorder: (id: number, sort_order: number) =>
        req<void>(`/thoughts/${id}/reorder`, getToken, { method: "PATCH", body: JSON.stringify({ sort_order }) }),
      updateTags: (id: number, tags: string[]) =>
        req<Thought>(`/thoughts/${id}/tags`, getToken, { method: "PATCH", body: JSON.stringify({ tags }) }),
      updateContent: (id: number, content: string) =>
        req<void>(`/thoughts/${id}/content`, getToken, { method: "PATCH", body: JSON.stringify({ content }) }),
      move: (id: number, tile_id: number) =>
        req<void>(`/thoughts/${id}/move`, getToken, { method: "PATCH", body: JSON.stringify({ tile_id }) }),
      remove: (id: number) => req<void>(`/thoughts/${id}`, getToken, { method: "DELETE" }),
    },

    tags: {
      list: () => req<Tag[]>("/tags", getToken),
      create: (name: string, color: string) =>
        req<Tag>("/tags", getToken, { method: "POST", body: JSON.stringify({ name, color }) }),
      update: (id: number, name: string, color: string) =>
        req<Tag>(`/tags/${id}`, getToken, { method: "PATCH", body: JSON.stringify({ name, color }) }),
      remove: (id: number) => req<void>(`/tags/${id}`, getToken, { method: "DELETE" }),
    },

    ai: {
      process: (input: string, priority: "low" | "medium" | "high") =>
        req<{ job_id: string }>("/ai/process", getToken, { method: "POST", body: JSON.stringify({ input, priority }) }),
      status: () => req<{ status: string }>("/ai/status", getToken),
    },

    whisper: {
      transcribe: async (blob: Blob): Promise<{ text: string }> => {
        const token = await getToken()
        const form = new FormData()
        form.append("audio", blob, "audio.webm")
        const res = await fetch(`${BASE}/whisper/transcribe`, {
          method: "POST",
          headers: token ? { "Authorization": `Bearer ${token}` } : {},
          body: form,
        })
        if (!res.ok) throw new Error(`API error ${res.status}: /whisper/transcribe`)
        return res.json()
      },
    },

    history: {
      list: (cursor?: string | null, limit = 50) => {
        const params = new URLSearchParams({ limit: String(limit) })
        if (cursor) params.set("cursor", cursor)
        return req<HistoryPage>(`/history?${params.toString()}`, getToken)
      },
    },
  }
}
