import { useEffect, useRef } from "react"

// minimum time the loading screen is shown in ms
const MIN_MS = 200

export function LoadingScreen({ loaded }: { loaded: boolean }) {
  const mountTime = useRef(Date.now())

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
