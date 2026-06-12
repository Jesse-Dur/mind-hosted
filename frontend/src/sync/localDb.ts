import Dexie, { type Table } from "dexie"
import type { LocalEntityRecord, MetadataRecord, OutboxRecord } from "./types"

class MindSyncDb extends Dexie {
  entities!: Table<LocalEntityRecord, string>
  outbox!: Table<OutboxRecord, string>
  metadata!: Table<MetadataRecord, string>

  constructor() {
    super("mind-sync")
    this.version(1).stores({
      entities: "key, entityType, clientId, serverId, tempId, canvasId, status, updatedAt, [entityType+serverId], [entityType+tempId]",
      outbox: "opId, entityType, clientId, serverId, status, nextAttemptAt, updatedAt",
      metadata: "key",
    })
  }
}

export const syncDb = new MindSyncDb()
