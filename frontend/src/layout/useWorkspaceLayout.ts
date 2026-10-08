import { useSyncExternalStore } from "react"

const QUERY = "(max-width: 900px), ((pointer: coarse) and (max-width: 1180px))"

function subscribe(listener: () => void) {
  const media = window.matchMedia(QUERY)
  media.addEventListener("change", listener)
  window.addEventListener("resize", listener)
  return () => {
    media.removeEventListener("change", listener)
    window.removeEventListener("resize", listener)
  }
}

export function useMobileWorkspace() {
  return useSyncExternalStore(subscribe, () => window.matchMedia(QUERY).matches, () => false)
}
