import { useEffect, useState } from "react"

let waitingWorker: ServiceWorker | null = null

function isCacheableClerkAsset(value: string) {
  const url = new URL(value, location.href)
  return url.protocol === "https:"
    && url.pathname.startsWith("/npm/@clerk/clerk-js@")
    && url.pathname.endsWith(".js")
}

export function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js").then(async (registration) => {
      if (registration.waiting) {
        waitingWorker = registration.waiting
        window.dispatchEvent(new Event("mind-pwa-update"))
      }
      registration.addEventListener("updatefound", () => {
        const worker = registration.installing
        worker?.addEventListener("statechange", () => {
          if (worker.state === "installed" && navigator.serviceWorker.controller) {
            waitingWorker = worker
            window.dispatchEvent(new Event("mind-pwa-update"))
          }
        })
      })
      const readyRegistration = await navigator.serviceWorker.ready
      const loadedLocalAssets = performance.getEntriesByType("resource")
        .map((entry) => entry.name)
        .filter((value) => {
          const url = new URL(value, location.href)
          return url.origin === location.origin && !url.pathname.startsWith("/api/") || isCacheableClerkAsset(value)
        })
      readyRegistration.active?.postMessage({ type: "CACHE_URLS", urls: loadedLocalAssets })
    }).catch(console.error)
  })
}

export function PwaUpdatePrompt() {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const show = () => setReady(true)
    window.addEventListener("mind-pwa-update", show)
    return () => window.removeEventListener("mind-pwa-update", show)
  }, [])
  useEffect(() => {
    if (!navigator.serviceWorker?.controller) return
    const reload = () => window.location.reload()
    navigator.serviceWorker?.addEventListener("controllerchange", reload, { once: true })
    return () => navigator.serviceWorker?.removeEventListener("controllerchange", reload)
  }, [])
  if (!ready) return null
  return <div role="status" style={{ position: "fixed", left: "50%", bottom: "max(16px,env(safe-area-inset-bottom))", transform: "translateX(-50%)", zIndex: 500, borderRadius: 10, background: "#222", color: "#fff", padding: "9px 10px 9px 13px", display: "flex", alignItems: "center", gap: 12, boxShadow: "0 8px 25px rgba(0,0,0,.24)", fontSize: 12, whiteSpace: "nowrap" }}><span>Mind is ready to update</span><button onClick={() => waitingWorker?.postMessage({ type: "SKIP_WAITING" })} style={{ border: 0, borderRadius: 6, background: "#fff", color: "#222", padding: "5px 8px", fontWeight: 700 }}>Update</button></div>
}
