// Which sync operations remain available while an account is above its resource limits?
// Cleanup deletes must remain possible so users always have a way to get back under their plan.

import type { SyncAction } from "../db/sync/types"
import { BillingEditingFrozenError } from "./errors"

export function requiresBillingEditingAccess(action: SyncAction) {
  return action === "upsert"
}

export function assertBillingSyncAccess(action: SyncAction, editingFrozen: boolean) {
  if (editingFrozen && requiresBillingEditingAccess(action)) {
    throw new BillingEditingFrozenError()
  }
}
