const LAST_AUTHENTICATED_USER_KEY = "mind:last-authenticated-user"
const EXPLICIT_SIGN_OUT_KEY = "mind:explicit-sign-out"

export function rememberAuthenticatedUser(userId: string) {
  localStorage.setItem(LAST_AUTHENTICATED_USER_KEY, userId)
  localStorage.removeItem(EXPLICIT_SIGN_OUT_KEY)
}

export function markExplicitSignOut() {
  localStorage.setItem(EXPLICIT_SIGN_OUT_KEY, "true")
}

export function cachedOfflineUserId() {
  if (localStorage.getItem(EXPLICIT_SIGN_OUT_KEY) === "true") return null
  return localStorage.getItem(LAST_AUTHENTICATED_USER_KEY)
}

export function forgetOfflineIdentity() {
  localStorage.removeItem(LAST_AUTHENTICATED_USER_KEY)
  localStorage.setItem(EXPLICIT_SIGN_OUT_KEY, "true")
}
