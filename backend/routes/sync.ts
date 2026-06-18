import { Hono } from "hono"
import { getAuth } from "@clerk/hono"
import { syncDb, type SyncAction, type SyncEntityType, type SyncPayload } from "../db/sync"
import { isAutumnAccessDeniedError, isBillingEditingFrozenError } from "../billing/errors"

export const syncRoute = new Hono()

type SyncOperationRequest = {
  op_id: string
  entity_type: SyncEntityType
  action: SyncAction
  client_id?: string | null
  server_id?: number | null
  payload?: SyncPayload
}

const entityTypes = new Set<SyncEntityType>(["canvas", "tile", "thought", "tag"])
const actions = new Set<SyncAction>(["upsert", "delete"])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function parseServerId(value: unknown) {
  if (value === null || value === undefined) return null
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined
}

function parseOperation(value: unknown): SyncOperationRequest | null {
  if (!isRecord(value)) return null
  const opId = value.op_id
  const entityType = value.entity_type
  const action = value.action
  const serverId = parseServerId(value.server_id)
  if (typeof opId !== "string" || opId.length === 0) return null
  if (typeof entityType !== "string" || !entityTypes.has(entityType as SyncEntityType)) return null
  if (typeof action !== "string" || !actions.has(action as SyncAction)) return null
  if (serverId === undefined) return null
  if ("client_id" in value && value.client_id !== null && typeof value.client_id !== "string") return null
  if ("payload" in value && !isRecord(value.payload)) return null

  return {
    op_id: opId,
    entity_type: entityType as SyncEntityType,
    action: action as SyncAction,
    client_id: typeof value.client_id === "string" ? value.client_id : null,
    server_id: serverId,
    payload: isRecord(value.payload) ? value.payload : {},
  }
}

function parsePushBody(value: unknown) {
  if (!isRecord(value) || !Array.isArray(value.operations)) return null
  const operations = value.operations.map(parseOperation)
  if (operations.some((operation) => operation === null)) return null
  return operations as SyncOperationRequest[]
}

function parseSince(value: string | undefined) {
  if (value === undefined) return 0
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null
}

function parseCanvasId(value: string | undefined) {
  if (value === undefined) return undefined
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

function isPermanentSyncError(error: unknown) {
  if (isAutumnAccessDeniedError(error)) return true
  if (isBillingEditingFrozenError(error)) return true
  if (!(error instanceof Error)) return false
  return [
    "Invalid canvas id",
    "Canvas not found",
    "Invalid tile id",
    "Tile not found",
    "Invalid tag name",
    "Invalid target canvas",
    "Target canvas not found",
  ].includes(error.message)
}

syncRoute.post("/push", async (c) => {
  const auth = getAuth(c)
  if (!auth?.userId) return c.json({ error: "Unauthorized" }, 401)
  const operations = parsePushBody(await c.req.json().catch(() => null))
  if (!operations) return c.json({ error: "Invalid sync push request" }, 400)

  const results = []
  for (const operation of operations) {
    try {
      const existing = await syncDb.getApplied(auth.userId, operation.op_id)
      const result = existing ?? await syncDb.apply(
        auth.userId,
        operation.op_id,
        operation.entity_type,
        operation.action,
        operation.client_id ?? null,
        operation.server_id ?? null,
        operation.payload ?? {},
      )
      results.push({ ok: true, ...result })
    } catch (error) {
      if (!isPermanentSyncError(error)) throw error
      const message = error instanceof Error ? error.message : "Sync operation failed"
      results.push({
        ok: false,
        op_id: operation.op_id,
        entity_type: operation.entity_type,
        action: operation.action,
        client_id: operation.client_id ?? null,
        server_id: operation.server_id ?? null,
        error: message,
        ...(isAutumnAccessDeniedError(error) ? {
          code: error.code,
          feature_id: error.featureId,
          remaining: error.remaining,
          reset_at: error.resetAt,
        } : {}),
        ...(isBillingEditingFrozenError(error) ? {
          code: error.code,
        } : {}),
      })
    }
  }

  return c.json({ results })
})

syncRoute.get("/pull", async (c) => {
  const auth = getAuth(c)
  if (!auth?.userId) return c.json({ error: "Unauthorized" }, 401)
  const since = parseSince(c.req.query("since"))
  const canvasId = parseCanvasId(c.req.query("canvas_id"))
  if (since === null) return c.json({ error: "Invalid revision" }, 400)
  if (canvasId === null) return c.json({ error: "Invalid canvas id" }, 400)
  return c.json(await syncDb.pull(auth.userId, since, canvasId))
})

syncRoute.get("/snapshot", async (c) => {
  const auth = getAuth(c)
  if (!auth?.userId) return c.json({ error: "Unauthorized" }, 401)
  const canvasId = parseCanvasId(c.req.query("canvas_id"))
  if (canvasId === null) return c.json({ error: "Invalid canvas id" }, 400)
  return c.json(await syncDb.snapshot(auth.userId, canvasId))
})
