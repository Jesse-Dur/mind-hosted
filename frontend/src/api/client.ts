import type { Tile, Thought, Tag, HistoryEvent, Canvas } from "../types"
import type { SyncPullResponse, SyncPushOperation, SyncPushResponse, SyncSnapshotResponse } from "../sync/types"
import { isReauthRequired, notifyReauthRequired } from "../auth/reauthSignal"
import { ApiUnauthorizedError } from "./errors"

const BASE = "/api"

type GetTokenOptions = { skipCache?: boolean }
type GetToken = (options?: GetTokenOptions) => Promise<string | null>
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

function throwUnauthorized(path: string): never {
  notifyReauthRequired()
  throw new ApiUnauthorizedError(path)
}

async function tokenForRequest(path: string, getToken: GetToken, options?: GetTokenOptions) {
  if (isReauthRequired()) throw new ApiUnauthorizedError(path)
  const token = await readToken(path, getToken, options)
  if (token) return token
  if (!options?.skipCache) {
    const refreshedToken = await readToken(path, getToken, { skipCache: true })
    if (refreshedToken) return refreshedToken
  }
  throwUnauthorized(path)
}

async function readToken(path: string, getToken: GetToken, options?: GetTokenOptions) {
  try {
    return await getToken(options)
  } catch {
    throwUnauthorized(path)
  }
}

async function authorizedFetch(path: string, getToken: GetToken, options?: RequestInit, tokenOptions?: GetTokenOptions) {
  const token = await tokenForRequest(path, getToken, tokenOptions)
  const headers = new Headers(options?.headers)
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json")
  headers.set("Authorization", `Bearer ${token}`)
  return fetch(`${BASE}${path}`, {
    ...options,
    headers,
  })
}

async function req<T>(path: string, getToken: GetToken, options?: RequestInit): Promise<T> {
  let res = await authorizedFetch(path, getToken, options)
  // Clerk can hand back a cached token near expiry; one uncached retry lets the
  // session refresh before sync treats the user as signed out.
  if (res.status === 401) res = await authorizedFetch(path, getToken, options, { skipCache: true })
  if (res.status === 401) throwUnauthorized(path)
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
        const requestTranscription = (token: string) => {
          const form = new FormData()
          form.append("audio", blob, "audio.webm")
          return fetch(`${BASE}/whisper/transcribe`, {
            method: "POST",
            headers: { "Authorization": `Bearer ${token}` },
            body: form,
          })
        }

        let res = await requestTranscription(await tokenForRequest("/whisper/transcribe", getToken))
        if (res.status === 401) {
          const refreshedToken = await tokenForRequest("/whisper/transcribe", getToken, { skipCache: true })
          res = await requestTranscription(refreshedToken)
        }
        if (res.status === 401) throwUnauthorized("/whisper/transcribe")
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
