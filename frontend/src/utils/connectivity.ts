import { useSyncExternalStore } from "react"

type Listener = () => void

const listeners = new Set<Listener>()
let listening = false

function browserOnline() {
  return typeof navigator === "undefined" || navigator.onLine !== false
}

function emit() {
  for (const listener of listeners) listener()
}

function ensureListeners() {
  if (listening || typeof window === "undefined") return
  listening = true
  window.addEventListener("online", emit)
  window.addEventListener("offline", emit)
}

export function subscribeConnectivity(listener: Listener) {
  ensureListeners()
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function isOnline() {
  return browserOnline()
}

export function useOnline() {
  return useSyncExternalStore(subscribeConnectivity, browserOnline, () => true)
}
