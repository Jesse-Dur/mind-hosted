import { applySyncOperation } from "./sync/apply"
import { getApplied, latestRevision, recordApplied } from "./sync/events"
import { pullSyncEvents } from "./sync/pull"
import { syncSnapshot } from "./sync/snapshot"

export type {
  ApplyOptions,
  SyncAction,
  SyncEntityType,
  SyncEvent,
  SyncPayload,
  SyncResult,
  SyncSnapshot,
} from "./sync/types"

export const syncDb = {
  latestRevision,
  getApplied,
  recordApplied,
  apply: applySyncOperation,
  snapshot: syncSnapshot,
  pull: pullSyncEvents,
}
