import { sql } from "./client"

export interface HistoryEvent {
  id: number
  action: string
  summary: string
  detail: string
  created_at: string
}

export const historyDb = {
  list: async (userId: string) =>
    sql<HistoryEvent[]>`
      SELECT * FROM history
      WHERE user_id = ${userId} AND created_at >= NOW() - INTERVAL '30 days'
      ORDER BY created_at DESC
    `,

  log: (userId: string, action: string, summary: string, detail: Record<string, unknown>) =>
    sql`INSERT INTO history (user_id, action, summary, detail) VALUES (${userId}, ${action}, ${summary}, ${sql.json(detail as never)})`,
}
