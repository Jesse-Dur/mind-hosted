import type { AutumnFeature } from "./features"

export class AutumnAccessDeniedError extends Error {
  readonly code = "autumn_access_denied"

  constructor(
    readonly featureId: AutumnFeature,
    readonly remaining: number | null,
    readonly resetAt: string | null,
  ) {
    super("Usage limit reached")
    this.name = "AutumnAccessDeniedError"
  }
}

export function isAutumnAccessDeniedError(error: unknown): error is AutumnAccessDeniedError {
  return error instanceof AutumnAccessDeniedError
}

export function autumnAccessDeniedResponse(error: AutumnAccessDeniedError) {
  return {
    error: error.message,
    code: error.code,
    feature_id: error.featureId,
    remaining: error.remaining,
    reset_at: error.resetAt,
  }
}
