import { createApi } from "../api/client"
import { assertSyncAccountScopeCurrent, currentSyncAccountScope, type SyncAccountScope } from "../sync/accountScope"

type GetTokenOptions = { skipCache?: boolean }
type GetToken = (options?: GetTokenOptions) => Promise<string | null>

let getToken: GetToken = () => Promise.resolve(null)

export function setGetToken(fn: GetToken) {
  getToken = fn
}

export function getApi(scope: SyncAccountScope | null = currentSyncAccountScope()) {
  // Centralizing auth keeps slices focused on state transitions instead of token plumbing.
  return createApi(getToken, scope ? {
    signal: scope.signal,
    assertCurrent: () => assertSyncAccountScopeCurrent(scope),
  } : undefined)
}
