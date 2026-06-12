import { sql } from "../client"
import type { SyncEvent } from "./types"

type DbId = number | string | null
type SyncEventRow = Omit<SyncEvent, "revision" | "canvas_id" | "entity_id"> & {
  revision: number | string
  canvas_id: DbId
  entity_id: DbId
}

function nullableNumber(value: DbId) {
  return value === null ? null : Number(value)
}

function normalizeEvent(event: SyncEventRow): SyncEvent {
  // Postgres BIGINT/BIGSERIAL can be returned as strings by JS drivers; the
  // public sync API keeps ids numeric so IndexedDB/store comparisons are stable.
  return {
    ...event,
    revision: Number(event.revision),
    canvas_id: nullableNumber(event.canvas_id),
    entity_id: nullableNumber(event.entity_id),
  }
}

export async function pullSyncEvents(userId: string, since: number, canvasId?: number) {
  const rows = canvasId === undefined
    ? await sql<SyncEventRow[]>`
        SELECT revision, canvas_id, entity_type, entity_id, client_id, op_id, action, data, created_at
        FROM sync_events
        WHERE user_id = ${userId} AND revision > ${since}
        ORDER BY revision ASC
      `
    : await sql<SyncEventRow[]>`
        SELECT revision, canvas_id, entity_type, entity_id, client_id, op_id, action, data, created_at
        FROM sync_events
        WHERE user_id = ${userId} AND revision > ${since} AND (canvas_id IS NULL OR canvas_id = ${canvasId})
        ORDER BY revision ASC
      `
  const latest = rows.reduce((max, event) => Math.max(max, Number(event.revision)), since)
  return { events: rows.map(normalizeEvent), latest_revision: latest }
}
