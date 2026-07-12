import { AutumnAccessDeniedError } from "./errors"
import type { AutumnFeature } from "./features"
import { checkAutumnFeature } from "./autumnClient"

function resetAtIso(value: number | null | undefined) {
  return typeof value === "number" ? new Date(value).toISOString() : null
}

export async function consumeAutumnFeature(userId: string, featureId: AutumnFeature, amount = 1) {
  const result = await checkAutumnFeature(userId, featureId, { sendEvent: true, requiredBalance: amount })
  if (!result || result.allowed !== false) return
  const remaining = typeof result.balance?.remaining === "number" ? result.balance.remaining : null
  const resetAt = resetAtIso(result.balance?.next_reset_at ?? result.balance?.nextResetAt)
  throw new AutumnAccessDeniedError(featureId, remaining, resetAt)
}

export async function assertAutumnFeatureAllowed(userId: string, featureId: AutumnFeature, requiredBalance = 1) {
  const result = await checkAutumnFeature(userId, featureId, { requiredBalance })
  if (!result || result.allowed !== false) return
  const remaining = typeof result.balance?.remaining === "number" ? result.balance.remaining : null
  const resetAt = resetAtIso(result.balance?.next_reset_at ?? result.balance?.nextResetAt)
  throw new AutumnAccessDeniedError(featureId, remaining, resetAt)
}
