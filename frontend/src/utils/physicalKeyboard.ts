import { useEffect, useState } from "react"

const DESKTOP_INPUT_QUERY = "(any-hover: hover) and (any-pointer: fine)"

export function keyIndicatesPhysicalKeyboard(event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey">) {
  return event.ctrlKey
    || event.metaKey
    || event.altKey
    || /^(Arrow|Page|F\d+$)/.test(event.key)
    || ["Tab", "Escape", "Home", "End", "Insert", "Delete"].includes(event.key)
}

export function usePhysicalKeyboard() {
  const [detected, setDetected] = useState(() => window.matchMedia(DESKTOP_INPUT_QUERY).matches)

  useEffect(() => {
    const media = window.matchMedia(DESKTOP_INPUT_QUERY)
    const detectFromPointer = () => { if (media.matches) setDetected(true) }
    const detectFromKey = (event: KeyboardEvent) => { if (keyIndicatesPhysicalKeyboard(event)) setDetected(true) }
    media.addEventListener("change", detectFromPointer)
    window.addEventListener("keydown", detectFromKey, true)
    return () => {
      media.removeEventListener("change", detectFromPointer)
      window.removeEventListener("keydown", detectFromKey, true)
    }
  }, [])

  return detected
}
