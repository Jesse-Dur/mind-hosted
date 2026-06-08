export interface Canvas {
  id: number
  name: string
  sort_order: number
  is_favourite: boolean
  created_at: string
  stableKey?: string
}

export interface Tile {
  id: number
  canvas_id: number | null
  title: string
  x: number
  y: number
  width: number
  height: number
  importance: number
  visible: boolean
  created_at: string
}

export interface Thought {
  id: number
  tile_id: number
  content: string
  tags: string[]
  sort_order: number
  created_at: string
}

export interface Tag {
  id: number
  name: string
  color: string
}

export interface HistoryEvent {
  id: number
  action: string
  summary: string
  detail: string | Record<string, unknown>
  created_at: string
}
