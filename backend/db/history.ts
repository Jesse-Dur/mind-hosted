import { sql } from "./client"
import type postgres from "postgres"

export interface HistoryEvent {
  id: number
  action: string
  summary: string
  detail: string | Record<string, unknown>
  client_id: string
  op_id: string | null
  occurred_at: string
  created_at: string
}

type HistorySource = {
  clientId?: string | null
  opId?: string | null
  occurredAt?: string | Date
  query?: typeof sql | postgres.TransactionSql
}

export interface HistoryPage {
  events: HistoryEvent[]
  nextCursor: string | null
  hasMore: boolean
}

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 100

function makeCursor(event: HistoryEvent) {
  const createdAt = event.created_at as unknown
  return `${createdAt instanceof Date ? createdAt.toISOString() : event.created_at}|${event.id}`
}

function parseCursor(cursor?: string | null) {
  if (!cursor) return null
  const separator = cursor.lastIndexOf("|")
  if (separator === -1) return null

  const createdAt = cursor.slice(0, separator)
  const id = Number(cursor.slice(separator + 1))
  if (!createdAt || !Number.isInteger(id) || id < 1) return null

  return { createdAt, id }
}

export const historyDb = {
  list: async (userId: string, options: { limit?: number; cursor?: string | null } = {}): Promise<HistoryPage> => {
    const limit = Math.min(Math.max(options.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT)
    const cursor = parseCursor(options.cursor)

    const events = await sql<HistoryEvent[]>`
      SELECT * FROM history
      WHERE user_id = ${userId}
        AND created_at >= NOW() - INTERVAL '30 days'
        ${cursor ? sql`AND (created_at, id) < (${cursor.createdAt}::timestamptz, ${cursor.id})` : sql``}
      ORDER BY created_at DESC, id DESC
      LIMIT ${limit + 1}
    `
    const page = events.slice(0, limit)
    const lastEvent = page.at(-1)

    return {
      events: page,
      nextCursor: events.length > limit && lastEvent ? makeCursor(lastEvent) : null,
      hasMore: events.length > limit,
    }
  },

  log: (userId: string, action: string, summary: string, detail: Record<string, unknown>, source: HistorySource = {}) => {
    const clientId = source.clientId ?? crypto.randomUUID()
    const occurredAt = source.occurredAt ? new Date(source.occurredAt) : new Date()
    const query = source.query ?? sql
    return query`
      INSERT INTO history (user_id, action, summary, detail, client_id, op_id, occurred_at)
      VALUES (${userId}, ${action}, ${summary}, ${sql.json(detail as never)}, ${clientId}, ${source.opId ?? null}, ${occurredAt})
      ON CONFLICT (user_id, op_id) WHERE op_id IS NOT NULL DO NOTHING
    `
  },
}
