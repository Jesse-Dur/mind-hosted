export class ApiUnauthorizedError extends Error {
  constructor(path: string) {
    // Auth expiry is expected during idle browser sessions, so callers need a
    // distinct error they can use to pause background work without noisy logs.
    super(`API authorization is unavailable for ${path}`)
    this.name = "ApiUnauthorizedError"
  }
}

export class ApiRateLimitError extends Error {
  readonly code = "autumn_access_denied"

  constructor(
    readonly path: string,
    readonly featureId: string,
    readonly resetAt: string | null,
  ) {
    super(`Rate limit exceeded for ${path}`)
    this.name = "ApiRateLimitError"
  }
}

export function isApiUnauthorizedError(error: unknown): error is ApiUnauthorizedError {
  return error instanceof ApiUnauthorizedError
}

export function isApiRateLimitError(error: unknown): error is ApiRateLimitError {
  return error instanceof ApiRateLimitError
}
