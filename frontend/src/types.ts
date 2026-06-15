export interface Canvas {
  id: number
  client_id?: string | null
  name: string
  sort_order: number
  is_favourite: boolean
  created_at: string
  updated_at?: string
  stableKey?: string
}

export interface Tile {
  id: number
  client_id?: string | null
  canvas_id: number | null
  title: string
  x: number
  y: number
  width: number
  height: number
  importance: number
  visible: boolean
  created_at: string
  updated_at?: string
  stableKey?: string
}

export interface Thought {
  id: number
  client_id?: string | null
  tile_id: number
  content: string
  tags: string[]
  sort_order: number
  created_at: string
  updated_at?: string
  stableKey?: string
}

export interface Tag {
  id: number
  client_id?: string | null
  name: string
  color: string
  updated_at?: string
}

export interface OllamaJob {
  id: string
  input: string
  priority: "low" | "medium" | "high"
  status: "pending" | "processing" | "done" | "error"
  created_at: string
}

export interface HistoryEvent {
  id: number
  action: string
  summary: string
  detail: string | Record<string, unknown>
  created_at: string
}

export interface HistoryPage {
  events: HistoryEvent[]
  nextCursor: string | null
  hasMore: boolean
}

export type BillingFeatureUsage = {
  used?: number
  used_bytes?: number
  used_megabytes?: number
  allowed: boolean
  remaining: number | null
  reset_at: string | null
}

export type BillingUsage = {
  customer_id: string
  features: {
    canvases: BillingFeatureUsage
    tiles: BillingFeatureUsage
    thoughts: BillingFeatureUsage
    tags: BillingFeatureUsage
    ai_processing_requests: BillingFeatureUsage
    transcription_seconds: BillingFeatureUsage
    storage: BillingFeatureUsage
  }
}
