export class ApiUnauthorizedError extends Error {
  constructor(path: string) {
    // Auth expiry is expected during idle browser sessions, so callers need a
    // distinct error they can use to pause background work without noisy logs.
    super(`API authorization is unavailable for ${path}`)
    this.name = "ApiUnauthorizedError"
  }
}

export function isApiUnauthorizedError(error: unknown): error is ApiUnauthorizedError {
  return error instanceof ApiUnauthorizedError
}
