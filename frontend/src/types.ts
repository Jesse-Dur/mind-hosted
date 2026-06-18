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
  id: "ai_processing_requests" | "transcription_seconds" | "storage" | "canvases" | "tiles" | "thoughts"
  label: string
  used: number
  unit: string
  limit: number | null
  remaining: number | null
  unlimited: boolean
  reset_at: string | null
  cost: string | null
}

export type BillingPlan = {
  id: string
  name: string
  cost: string
}

export type BillingOverageItem = {
  id: "canvases" | "tiles" | "thoughts"
  label: string
  used: number
  limit: number
  over_by: number
  unit: string
}

export type BillingOverage = {
  is_over_limit: boolean
  editing_frozen: boolean
  overages: BillingOverageItem[]
  suspended_creation: BillingOverageItem["id"][]
}

export type BillingUsage = {
  customer_id: string
  plans: BillingPlan[]
  features: BillingFeatureUsage[]
  overage: BillingOverage
}
