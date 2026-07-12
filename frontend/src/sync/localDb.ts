import Dexie, { type Table } from "dexie"
import type { LocalEntityRecord, MetadataRecord, OutboxRecord } from "./types"
import type { QueryCacheRecord } from "./queryCacheTypes"

class MindSyncDb extends Dexie {
  entities!: Table<LocalEntityRecord, string>
  outbox!: Table<OutboxRecord, string>
  metadata!: Table<MetadataRecord, string>
  queryCache!: Table<QueryCacheRecord, QueryCacheRecord["key"]>

  constructor() {
    super("mind-sync")
    this.version(2).stores({
      entities: "key, entityType, clientId, serverId, tempId, canvasId, status, updatedAt, [entityType+serverId], [entityType+tempId]",
      outbox: "opId, entityType, clientId, serverId, status, nextAttemptAt, updatedAt",
      metadata: "key",
      queryCache: "key, updatedAt",
    })
  }
}

export const syncDb = new MindSyncDb()
