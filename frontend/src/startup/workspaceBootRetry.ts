import { isStaleSyncAccountError } from "../sync/accountScope"

export function startWorkspaceBootRetry(boot: () => Promise<void>, onRetryFailed: () => void) {
  let cancelled = false
  let failures = 0
  let timer: ReturnType<typeof setTimeout> | null = null

  async function attempt() {
    if (cancelled) return
    try {
      await boot()
    } catch (error) {
      // A superseded account must never restart its boot or change the loading UI.
      if (cancelled || isStaleSyncAccountError(error)) return
      console.error(error)
      failures += 1
      if (failures === 2) onRetryFailed()
      const delay = Math.min(1000 * 2 ** Math.min(failures - 1, 4), 15000)
      timer = setTimeout(attempt, delay)
    }
  }

  void attempt()
  return () => {
    cancelled = true
    if (timer !== null) clearTimeout(timer)
  }
}
