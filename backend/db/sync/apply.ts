import { deleteEntity } from "./delete"
import { logEvent, recordApplied } from "./events"
import { upsertCanvas, upsertTag, upsertThought, upsertTile } from "./upsert"
import { assertBillingSyncAccess, requiresBillingEditingAccess } from "../../billing/syncAccess"
import { getBillingUsageStatus } from "../../billing/usageStatus"
import type { Tag } from "../../types"
import type { ApplyOptions, DeletePayload, SyncAction, SyncEntityType, SyncPayload, SyncResult } from "./types"

export async function applySyncOperation(userId: string, opId: string, entityType: SyncEntityType, action: SyncAction, clientId: string | null, serverId: number | null, payload: SyncPayload, options: ApplyOptions = {}) {
  if (requiresBillingEditingAccess(entityType, action)) {
    const billing = await getBillingUsageStatus(userId, { syncResources: false, syncStorage: false })
    assertBillingSyncAccess(entityType, action, billing.overage.editing_frozen)
  }

  const writeHistory = options.writeHistory ?? true
  const occurredAt = options.occurredAt
  const entity = action === "upsert"
    ? entityType === "canvas"
      ? await upsertCanvas(userId, clientId, serverId, payload, writeHistory, opId, occurredAt)
      : entityType === "tile"
        ? await upsertTile(userId, clientId, serverId, payload, writeHistory, opId, occurredAt)
        : entityType === "thought"
          ? await upsertThought(userId, clientId, serverId, payload, writeHistory, opId, occurredAt)
          : await upsertTag(userId, clientId, serverId, payload, writeHistory, opId, occurredAt)
    : await deleteEntity(userId, entityType, serverId, payload as DeletePayload, writeHistory, opId, clientId, occurredAt)
  const finalClientId = clientId ?? entity?.client_id ?? null
  // Identity fields come from the applied mutation, never from the caller's
  // free-form payload, so a malformed delete cannot publish misleading cleanup data.
  const deleteEventPayload = entityType === "tag" && entity
    ? { ...payload, id: serverId, client_id: finalClientId, name: (entity as Tag).name }
    : { ...payload, id: serverId, client_id: finalClientId }
  const revision = await logEvent(userId, entityType, action, opId, entity, finalClientId, action === "upsert" ? (entity as unknown as SyncPayload) : deleteEventPayload)
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
