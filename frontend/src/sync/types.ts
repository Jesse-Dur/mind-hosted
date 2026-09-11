import type { Canvas, Tag, Thought, Tile } from "../types"

export type SyncEntityType = "canvas" | "tile" | "thought" | "tag"
export type SyncAction = "upsert" | "delete"
export type SyncStatus = "clean" | "dirty" | "deleted" | "error"
export type SyncDisposition = "normal" | "local_only"
export type SyncEntity = Canvas | Tile | Thought | Tag
export type SyncPayload = Record<string, unknown>

export type LocalEntityRecord = {
  key: string
  entityType: SyncEntityType
  clientId: string
  serverId: number | null
  tempId: number | null
  canvasId: number | null
  status: SyncStatus
  data: SyncEntity
  confirmedData?: SyncEntity | null
  syncDisposition?: SyncDisposition
  lastSyncedAt?: number | null
  updatedAt: number
}

export type OutboxRecord = {
  opId: string
  entityType: SyncEntityType
  action: SyncAction
  clientId: string
  serverId: number | null
  payload: SyncPayload
  beforeData?: SyncEntity | null
  recordHistory?: boolean
  status: "pending" | "flushing" | "error" | "local_only"
  attemptCount: number
  nextAttemptAt: number
  createdAt: number
  updatedAt: number
  error?: string
}

export type SyncVisualState = "pending" | "synced" | "error" | "local_only"
export type SyncActivityState = SyncVisualState | "discarded"

export type SyncEntityStatus = {
  key: string
  entityType: SyncEntityType
  clientId: string
  state: SyncVisualState
  opId: string | null
  action: SyncAction | null
  error: string | null
  updatedAt: number
}

export type SyncActivityRecord = {
  opId: string
  entityType: SyncEntityType
  clientId: string
  action: SyncAction
  state: SyncActivityState
  summary: string
  error: string | null
  createdAt: number
  updatedAt: number
  hidden?: boolean
}

export type MetadataRecord = {
  key: string
  value: string | number | boolean | null
}

export type SyncPushOperation = {
  op_id: string
  entity_type: SyncEntityType
  action: SyncAction
  client_id: string | null
  server_id: number | null
  payload: SyncPayload
  write_history?: boolean
  occurred_at?: string
}

export type SyncPushResult = {
  ok: boolean
  op_id: string
  entity_type: SyncEntityType
  action: SyncAction
  client_id: string | null
  server_id: number | null
  revision: number | null
  entity?: SyncEntity
  error?: string
  code?: string
  feature_id?: string
  remaining?: number | null
  reset_at?: string | null
}

export type SyncPullEvent = {
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

export type SyncPullResponse = {
  events: SyncPullEvent[]
  latest_revision: number
}

export type SyncPushResponse = {
  results: SyncPushResult[]
}

export type SyncSnapshotResponse = {
  revision: number
  active_canvas_id: number | null
  canvases: Canvas[]
  tags: Tag[]
  tiles: Tile[]
  thoughts: Thought[]
}
