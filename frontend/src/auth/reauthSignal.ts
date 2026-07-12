let reauthRequired = false

export function notifyReauthRequired() {
  // The API client runs outside React; this latch lets sync pause quietly after
  // a final auth failure instead of repeatedly hitting protected endpoints.
  reauthRequired = true
}

export function clearReauthRequired() {
  reauthRequired = false
}

export function isReauthRequired() {
  return reauthRequired
}
