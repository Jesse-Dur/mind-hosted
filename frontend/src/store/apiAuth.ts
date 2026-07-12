import { createApi } from "../api/client"

type GetTokenOptions = { skipCache?: boolean }
type GetToken = (options?: GetTokenOptions) => Promise<string | null>

let getToken: GetToken = () => Promise.resolve(null)

export function setGetToken(fn: GetToken) {
  getToken = fn
}

export function getApi() {
  // Centralizing auth keeps slices focused on state transitions instead of token plumbing.
  return createApi(getToken)
}
