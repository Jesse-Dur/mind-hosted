import { deleteEntity } from "./delete"
import { logEvent, recordApplied } from "./events"
import { upsertCanvas, upsertTag, upsertThought, upsertTile } from "./upsert"
import type { ApplyOptions, DeletePayload, SyncAction, SyncEntityType, SyncPayload, SyncResult } from "./types"

export async function applySyncOperation(userId: string, opId: string, entityType: SyncEntityType, action: SyncAction, clientId: string | null, serverId: number | null, payload: SyncPayload, options: ApplyOptions = {}) {
  const writeHistory = options.writeHistory ?? true
  const entity = action === "upsert"
    ? entityType === "canvas"
      ? await upsertCanvas(userId, clientId, serverId, payload, writeHistory)
      : entityType === "tile"
        ? await upsertTile(userId, clientId, serverId, payload, writeHistory)
        : entityType === "thought"
          ? await upsertThought(userId, clientId, serverId, payload, writeHistory)
          : await upsertTag(userId, clientId, serverId, payload)
    : await deleteEntity(userId, entityType, serverId, payload as DeletePayload)
  const finalClientId = clientId ?? entity?.client_id ?? null
  const revision = await logEvent(userId, entityType, action, opId, entity, finalClientId, action === "upsert" ? (entity as unknown as SyncPayload) : { id: serverId, client_id: finalClientId, ...payload })
  const result: SyncResult = {
    op_id: opId,
    entity_type: entityType,
    action,
    client_id: finalClientId,
    server_id: entity?.id ?? serverId,
    revision,
    ...(action === "upsert" && entity ? { entity } : {}),
  }
  await recordApplied(userId, opId, result)
  return result
}
