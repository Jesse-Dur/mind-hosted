import type { SyncEntity, SyncEntityType } from "./types"
import type { Thought, Tile } from "../types"
import { getApi } from "../store/apiAuth"
import { cacheOptimisticPastEntity, evictPastEntityCache, readPastEntitiesCache, replaceServerPastEntitiesCache } from "./queryCache"
import { assertSyncAccountScopeCurrent, runSyncAccountTask } from "./accountScope"

export { readPastEntitiesCache }

export async function cachePastEntity(entityType: SyncEntityType, entity: SyncEntity) {
  if (entityType === "tile") {
    await cacheOptimisticPastEntity({ pastTiles: [entity as Tile] })
  } else if (entityType === "thought") {
    await cacheOptimisticPastEntity({ pastThoughts: [entity as Thought] })
  }
}

export async function evictPastEntity(entityType: SyncEntityType, entity: SyncEntity) {
  if (entityType === "tile" || entityType === "thought") await evictPastEntityCache(entity as Tile | Thought)
}

export async function refreshPastEntitiesCache() {
  return runSyncAccountTask(async (scope) => {
    const api = getApi(scope)
    const [pastTiles, pastThoughts] = await Promise.all([
      api.tiles.listPast(),
      api.thoughts.listPast(),
    ])
    assertSyncAccountScopeCurrent(scope)
    await replaceServerPastEntitiesCache({ pastTiles, pastThoughts })
    assertSyncAccountScopeCurrent(scope)
  })
}
