import type { Tile, Thought, Tag, HistoryEvent, Canvas } from "../types"
import type { SyncPullResponse, SyncPushOperation, SyncPushResponse, SyncSnapshotResponse } from "../sync/types"

const BASE = "/api"

type GetToken = () => Promise<string | null>
type AiStatusResponse = { status: string; latest_revision: number }

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

function normalizeSnapshot(snapshot: SyncSnapshotResponse): SyncSnapshotResponse {
  return {
    revision: Number(snapshot.revision),
    active_canvas_id: snapshot.active_canvas_id === null ? null : Number(snapshot.active_canvas_id),
    canvases: snapshot.canvases.map(normalizeCanvas),
    tags: snapshot.tags.map(normalizeTag),
    tiles: snapshot.tiles.map(normalizeTile),
    thoughts: snapshot.thoughts.map(normalizeThought),
  }
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
    tiles: {
      listPast: () => req<Tile[]>("/tiles/past", getToken).then((tiles) => tiles.map(normalizeTile)),
    },

    thoughts: {
      listPast: () => req<Thought[]>("/thoughts/past", getToken).then((thoughts) => thoughts.map(normalizeThought)),
    },

    ai: {
      process: (input: string, priority: "low" | "medium" | "high") =>
        req<{ job_id: string }>("/ai/process", getToken, { method: "POST", body: JSON.stringify({ input, priority }) }),
      status: () => req<AiStatusResponse>("/ai/status", getToken),
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

    sync: {
      push: (operations: SyncPushOperation[]) =>
        req<SyncPushResponse>("/sync/push", getToken, { method: "POST", body: JSON.stringify({ operations }) }),
      pull: (since: number, canvasId?: number) => {
        const params = new URLSearchParams({ since: String(since) })
        if (canvasId !== undefined) params.set("canvas_id", String(canvasId))
        return req<SyncPullResponse>(`/sync/pull?${params}`, getToken)
      },
      snapshot: (canvasId?: number) => {
        const params = new URLSearchParams()
        if (canvasId !== undefined) params.set("canvas_id", String(canvasId))
        const query = params.toString()
        return req<SyncSnapshotResponse>(`/sync/snapshot${query ? `?${query}` : ""}`, getToken).then(normalizeSnapshot)
      },
    },
  }
}
