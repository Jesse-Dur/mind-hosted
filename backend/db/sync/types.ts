import type { Canvas, Tag, Thought, Tile } from "../../types"

export type SyncEntityType = "canvas" | "tile" | "thought" | "tag"
export type SyncAction = "upsert" | "delete"
export type SyncPayload = Record<string, unknown>
export type SyncResult = {
  op_id: string
  entity_type: SyncEntityType
  action: SyncAction
  client_id: string | null
  server_id: number | null
  revision: number | null
  entity?: Canvas | Tile | Thought | Tag
}
export type SyncEvent = {
  revision: number
  canvas_id: number | null
  entity_type: SyncEntityType
  entity_id: number | null
  client_id: string | null
  op_id: string | null
  action: SyncAction
  data: SyncPayload
  created_at: string
}
export type SyncSnapshot = {
  revision: number
  active_canvas_id: number | null
  canvases: Canvas[]
  tags: Tag[]
  tiles: Tile[]
  thoughts: Thought[]
}

export type SyncEntity = Canvas | Tile | Thought | Tag
export type DeletePayload = { mode?: "deleteContents" | "moveContents"; targetCanvasId?: number }
export type ApplyOptions = { writeHistory?: boolean }
