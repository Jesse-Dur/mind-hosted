import { useEffect, useRef } from "react"

// minimum time the loading screen is shown in ms
const MIN_MS = 200
export const LOADING_RETRY_MESSAGE = "Loading failed, automatically retrying"

export function LoadingScreen({ loaded, retrying = false }: { loaded: boolean; retrying?: boolean }) {
  const mountTime = useRef(Date.now())

  useEffect(() => {
    const message = document.getElementById("splash-retry-message")
    if (!message) return
    message.textContent = retrying ? LOADING_RETRY_MESSAGE : ""
    message.hidden = !retrying
  }, [retrying])

  useEffect(() => {
    if (!loaded) return
    const splash = document.getElementById("splash")
    if (!splash) return
    const elapsed = Date.now() - mountTime.current
    const delay = Math.max(0, MIN_MS - elapsed)
    let removalTimer: number | null = null
    const t = setTimeout(() => {
      splash.classList.add("hide")
      removalTimer = window.setTimeout(() => splash.remove(), 420)
    }, delay)
    return () => {
      clearTimeout(t)
      if (removalTimer !== null) window.clearTimeout(removalTimer)
    }
  }, [loaded])

  return null
}
