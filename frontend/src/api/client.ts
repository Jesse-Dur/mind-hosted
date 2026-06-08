import type { Tile, Thought, Tag, HistoryEvent, Canvas } from "../types"

const BASE = "/api"

type GetToken = () => Promise<string | null>
type ThoughtScope = { tileId?: number; canvasId?: number }
type CanvasOrderUpdate = Pick<Canvas, "id" | "sort_order" | "is_favourite">
export type CanvasDeleteOptions =
  | { mode: "deleteContents" }
  | { mode: "moveContents"; targetCanvasId: number }
export type CanvasDeleteResult = { targetCanvasId: number | null }

function normalizeCanvas(canvas: Canvas): Canvas {
  return { ...canvas, id: Number(canvas.id), sort_order: Number(canvas.sort_order) }
}

function normalizeTile(tile: Tile): Tile {
  return {
    ...tile,
    id: Number(tile.id),
    canvas_id: tile.canvas_id === null ? null : Number(tile.canvas_id),
  }
}

function normalizeThought(thought: Thought): Thought {
  return {
    ...thought,
    id: Number(thought.id),
    tile_id: Number(thought.tile_id),
    sort_order: Number(thought.sort_order),
  }
}

function normalizeTag(tag: Tag): Tag {
  return { ...tag, id: Number(tag.id) }
}

function normalizeHistoryEvent(event: HistoryEvent): HistoryEvent {
  return { ...event, id: Number(event.id) }
}

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
  if (!res.ok) {
    const detail = await res.text().catch(() => "")
    let message = detail
    try {
      const parsed = JSON.parse(detail) as { error?: unknown }
      if (typeof parsed.error === "string") message = parsed.error
    } catch { /* keep raw detail */ }
    throw new Error(`API error ${res.status}: ${path}${message ? ` - ${message}` : ""}`)
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

export function createApi(getToken: GetToken) {
  return {
    canvases: {
      list: () => req<Canvas[]>("/canvases", getToken).then((canvases) => canvases.map(normalizeCanvas)),
      create: (name: string, sort_order: number) =>
        req<Canvas>("/canvases", getToken, { method: "POST", body: JSON.stringify({ name, sort_order }) }).then(normalizeCanvas),
      update: (id: number, data: Partial<Pick<Canvas, "name" | "sort_order" | "is_favourite">>) =>
        req<Canvas>(`/canvases/${id}`, getToken, { method: "PATCH", body: JSON.stringify(data) }).then(normalizeCanvas),
      reorder: (updates: CanvasOrderUpdate[]) =>
        req<void>("/canvases/reorder", getToken, { method: "PATCH", body: JSON.stringify({ updates }) }),
      remove: (id: number, options: CanvasDeleteOptions) => {
        const params = new URLSearchParams({ mode: options.mode })
        if (options.mode === "moveContents") params.set("targetCanvasId", String(options.targetCanvasId))
        return req<CanvasDeleteResult>(`/canvases/${id}?${params}`, getToken, { method: "DELETE", body: JSON.stringify(options) })
      },
    },

    tiles: {
      list: (canvasId?: number) =>
        req<Tile[]>(canvasId !== undefined ? `/tiles?canvas_id=${canvasId}` : "/tiles", getToken).then((tiles) => tiles.map(normalizeTile)),
      listPast: () => req<Tile[]>("/tiles/past", getToken).then((tiles) => tiles.map(normalizeTile)),
      create: (data: Omit<Tile, "id" | "created_at">) =>
        req<Tile>("/tiles", getToken, { method: "POST", body: JSON.stringify(data) }).then(normalizeTile),
      update: (id: number, data: Partial<Tile>) =>
        req<Tile>(`/tiles/${id}`, getToken, { method: "PATCH", body: JSON.stringify(data) }).then(normalizeTile),
      remove: (id: number) => req<void>(`/tiles/${id}`, getToken, { method: "DELETE" }),
    },

    thoughts: {
      list: (scope: ThoughtScope = {}) => {
        const params = new URLSearchParams()
        if (scope.tileId !== undefined) params.set("tile_id", String(scope.tileId))
        if (scope.canvasId !== undefined) params.set("canvas_id", String(scope.canvasId))
        const query = params.toString()
        return req<Thought[]>(query ? `/thoughts?${query}` : "/thoughts", getToken).then((thoughts) => thoughts.map(normalizeThought))
      },
      listPast: () => req<Thought[]>("/thoughts/past", getToken).then((thoughts) => thoughts.map(normalizeThought)),
      create: (data: Omit<Thought, "id" | "created_at">) =>
        req<Thought>("/thoughts", getToken, { method: "POST", body: JSON.stringify(data) }).then(normalizeThought),
      reorder: (id: number, sort_order: number) =>
        req<void>(`/thoughts/${id}/reorder`, getToken, { method: "PATCH", body: JSON.stringify({ sort_order }) }),
      updateTags: (id: number, tags: string[]) =>
        req<Thought>(`/thoughts/${id}/tags`, getToken, { method: "PATCH", body: JSON.stringify({ tags }) }).then(normalizeThought),
      updateContent: (id: number, content: string) =>
        req<void>(`/thoughts/${id}/content`, getToken, { method: "PATCH", body: JSON.stringify({ content }) }),
      move: (id: number, tile_id: number, ordered_ids?: number[]) =>
        req<void>(`/thoughts/${id}/move`, getToken, { method: "PATCH", body: JSON.stringify({ tile_id, ...(ordered_ids ? { ordered_ids } : {}) }) }),
      remove: (id: number) => req<void>(`/thoughts/${id}`, getToken, { method: "DELETE" }),
    },

    tags: {
      list: () => req<Tag[]>("/tags", getToken).then((tags) => tags.map(normalizeTag)),
      create: (name: string, color: string) =>
        req<Tag>("/tags", getToken, { method: "POST", body: JSON.stringify({ name, color }) }).then(normalizeTag),
      update: (id: number, name: string, color: string) =>
        req<Tag>(`/tags/${id}`, getToken, { method: "PATCH", body: JSON.stringify({ name, color }) }).then(normalizeTag),
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
      list: () => req<HistoryEvent[]>("/history", getToken).then((events) => events.map(normalizeHistoryEvent)),
    },
  }
}
