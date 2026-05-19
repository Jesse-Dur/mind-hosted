export interface Tile {
  id: number
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
  detail: string
  created_at: string
}
