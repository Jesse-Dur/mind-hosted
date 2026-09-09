import type { BillingPlanImpact, BillingPlanSwitchResult, BillingPlans, BillingUsage, Canvas, HistoryEvent, HistoryPage, Tag, Thought, Tile } from "../types"
import type { SyncPullResponse, SyncPushOperation, SyncPushResponse, SyncSnapshotResponse } from "../sync/types"
import { isReauthRequired, notifyReauthRequired } from "../auth/reauthSignal"
import { ApiRateLimitError, ApiUnauthorizedError } from "./errors"

const BASE = "/api"

type GetTokenOptions = { skipCache?: boolean }
type GetToken = (options?: GetTokenOptions) => Promise<string | null>
type ApiRequestContext = { signal: AbortSignal; assertCurrent: () => void }
type AiStatusResponse = { status: string; latest_revision: number }
export type DeviceClass = "phone" | "tablet" | "desktop"
export type DevicePreferencesResponse = {
  source: "device" | "device_class" | "defaults"
  device_id: string
  device_class: DeviceClass
  preferences: Record<string, unknown>
  updated_at: string | null
}

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

function normalizeHistoryPage(page: HistoryPage): HistoryPage {
  return {
    ...page,
    events: page.events.map(normalizeHistoryEvent),
  }
}

function normalizeSnapshot(snapshot: SyncSnapshotResponse): SyncSnapshotResponse {
  const canvases = Array.isArray(snapshot.canvases) ? snapshot.canvases : []
  const tags = Array.isArray(snapshot.tags) ? snapshot.tags : []
  const tiles = Array.isArray(snapshot.tiles) ? snapshot.tiles : []
  const thoughts = Array.isArray(snapshot.thoughts) ? snapshot.thoughts : []
  return {
    revision: Number(snapshot.revision ?? 0),
    active_canvas_id: snapshot.active_canvas_id === null || snapshot.active_canvas_id === undefined ? null : Number(snapshot.active_canvas_id),
    canvases: canvases.map(normalizeCanvas),
    tags: tags.map(normalizeTag),
    tiles: tiles.map(normalizeTile),
    thoughts: thoughts.map(normalizeThought),
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

async function authorizedFetch(path: string, getToken: GetToken, options?: RequestInit, tokenOptions?: GetTokenOptions, context?: ApiRequestContext) {
  const token = await tokenForRequest(path, getToken, tokenOptions)
  context?.assertCurrent()
  const headers = new Headers(options?.headers)
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json")
  headers.set("Authorization", `Bearer ${token}`)
  return fetch(`${BASE}${path}`, {
    ...options,
    headers,
    signal: options?.signal ?? context?.signal,
  })
}

async function req<T>(path: string, getToken: GetToken, options?: RequestInit, context?: ApiRequestContext): Promise<T> {
  let res: Response
  try {
    context?.assertCurrent()
    res = await authorizedFetch(path, getToken, options, undefined, context)
    context?.assertCurrent()
  } catch (error) {
    context?.assertCurrent()
    throw error
  }
  // Clerk can hand back a cached token near expiry; one uncached retry lets the
  // session refresh before sync treats the user as signed out.
  if (res.status === 401) res = await authorizedFetch(path, getToken, options, { skipCache: true }, context)
  context?.assertCurrent()
  if (res.status === 401) throwUnauthorized(path)
  if (!res.ok) {
    const detail = await res.text().catch(() => "")
    let message = detail
    let rateLimit: { feature_id: string; reset_at: string | null } | null = null
    try {
      const parsed = JSON.parse(detail) as { error?: unknown; code?: unknown; feature_id?: unknown; reset_at?: unknown }
      if (typeof parsed.error === "string") message = parsed.error
      if (
        res.status === 429
        && parsed.code === "autumn_access_denied"
        && typeof parsed.feature_id === "string"
      ) {
        rateLimit = { feature_id: parsed.feature_id, reset_at: typeof parsed.reset_at === "string" ? parsed.reset_at : null }
      }
    } catch { /* keep raw detail */ }
    if (rateLimit) throw new ApiRateLimitError(path, rateLimit.feature_id, rateLimit.reset_at)
    throw new Error(`API error ${res.status}: ${path}${message ? ` - ${message}` : ""}`)
  }
  if (res.status === 204) return undefined as T
  const data = await res.json() as T
  context?.assertCurrent()
  return data
}

export function createApi(getToken: GetToken, context?: ApiRequestContext) {
  return {
    tiles: {
      listPast: () => req<Tile[]>("/tiles/past", getToken, undefined, context).then((tiles) => tiles.map(normalizeTile)),
    },

    thoughts: {
      listPast: () => req<Thought[]>("/thoughts/past", getToken, undefined, context).then((thoughts) => thoughts.map(normalizeThought)),
    },

    ai: {
      process: (input: string, priority: "low" | "medium" | "high") =>
        req<{ job_id: string }>("/ai/process", getToken, { method: "POST", body: JSON.stringify({ input, priority }) }, context),
      status: () => req<AiStatusResponse>("/ai/status", getToken, undefined, context),
    },

    whisper: {
      transcribe: async (blob: Blob): Promise<{ text: string }> => {
        const requestTranscription = (token: string) => {
          context?.assertCurrent()
          const form = new FormData()
          form.append("audio", blob, "audio.webm")
          return fetch(`${BASE}/whisper/transcribe`, {
            method: "POST",
            headers: { "Authorization": `Bearer ${token}` },
            body: form,
            signal: context?.signal,
          })
        }

        let res = await requestTranscription(await tokenForRequest("/whisper/transcribe", getToken))
        context?.assertCurrent()
        if (res.status === 401) {
          const refreshedToken = await tokenForRequest("/whisper/transcribe", getToken, { skipCache: true })
          res = await requestTranscription(refreshedToken)
          context?.assertCurrent()
        }
        if (res.status === 401) throwUnauthorized("/whisper/transcribe")
        if (!res.ok) {
          const detail = await res.text().catch(() => "")
          try {
            const parsed = JSON.parse(detail) as { code?: unknown; feature_id?: unknown; reset_at?: unknown }
            if (
              res.status === 429
              && parsed.code === "autumn_access_denied"
              && typeof parsed.feature_id === "string"
            ) {
              throw new ApiRateLimitError("/whisper/transcribe", parsed.feature_id, typeof parsed.reset_at === "string" ? parsed.reset_at : null)
            }
          } catch (error) {
            if (error instanceof ApiRateLimitError) throw error
          }
          throw new Error(`API error ${res.status}: /whisper/transcribe`)
        }
        const data = await res.json()
        context?.assertCurrent()
        return data
      },
    },

    history: {
      list: (cursor?: string | null, limit = 50) => {
        const params = new URLSearchParams({ limit: String(limit) })
        if (cursor) params.set("cursor", cursor)
        return req<HistoryPage>(`/history?${params.toString()}`, getToken, undefined, context).then(normalizeHistoryPage)
      },
    },

    billing: {
      usage: () => req<BillingUsage>("/billing/usage", getToken, undefined, context),
      plans: () => req<BillingPlans>("/billing/plans", getToken, undefined, context),
      planImpact: (planId: string) => {
        const params = new URLSearchParams({ plan_id: planId })
        return req<BillingPlanImpact>(`/billing/plan-impact?${params.toString()}`, getToken, undefined, context)
      },
      switchPlan: (planId: string, confirmedOverLimit = false) => req<BillingPlanSwitchResult>("/billing/switch-plan", getToken, { method: "POST", body: JSON.stringify({ plan_id: planId, confirmed_over_limit: confirmedOverLimit }) }, context),
    },

    preferences: {
      device: (deviceId: string, deviceClass: DeviceClass) => {
        const params = new URLSearchParams({ device_id: deviceId, device_class: deviceClass })
        return req<DevicePreferencesResponse>(`/preferences/device?${params}`, getToken, undefined, context)
      },
      saveDevice: (deviceId: string, deviceClass: DeviceClass, preferences: Record<string, unknown>) =>
        req<{ device_id: string; device_class: DeviceClass; preferences: Record<string, unknown>; updated_at: string }>("/preferences/device", getToken, {
          method: "PUT",
          body: JSON.stringify({ device_id: deviceId, device_class: deviceClass, preferences }),
        }, context),
    },

    sync: {
      push: (operations: SyncPushOperation[]) =>
        req<SyncPushResponse>("/sync/push", getToken, { method: "POST", body: JSON.stringify({ operations }) }, context),
      pull: (since: number, canvasId?: number) => {
        const params = new URLSearchParams({ since: String(since) })
        if (canvasId !== undefined) params.set("canvas_id", String(canvasId))
        return req<SyncPullResponse>(`/sync/pull?${params}`, getToken, undefined, context)
      },
      snapshot: (canvasId?: number) => {
        const params = new URLSearchParams()
        if (canvasId !== undefined) params.set("canvas_id", String(canvasId))
        const query = params.toString()
        return req<SyncSnapshotResponse>(`/sync/snapshot${query ? `?${query}` : ""}`, getToken, undefined, context).then(normalizeSnapshot)
      },
    },
  }
}
