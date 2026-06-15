import { sql } from "./client"

export interface HistoryEvent {
  id: number
  action: string
  summary: string
  detail: string
  created_at: string
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

  log: (userId: string, action: string, summary: string, detail: Record<string, unknown>) =>
    sql`INSERT INTO history (user_id, action, summary, detail) VALUES (${userId}, ${action}, ${summary}, ${sql.json(detail as never)})`,
}
