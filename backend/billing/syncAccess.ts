// Which sync operations remain available while an account is above its resource limits?
// Cleanup deletes must remain possible so users always have a way to get back under their plan.

import type { SyncAction, SyncEntityType } from "../db/sync/types"
import { BillingEditingFrozenError } from "./errors"

export function requiresBillingEditingAccess(entityType: SyncEntityType, action: SyncAction) {
  return action === "upsert"
}

export function assertBillingSyncAccess(entityType: SyncEntityType, action: SyncAction, editingFrozen: boolean) {
  if (editingFrozen && requiresBillingEditingAccess(entityType, action)) {
    throw new BillingEditingFrozenError()
  }
}
