import { useEffect, useState } from "react"
import { respondToBuildQuery } from "./buildIdentity"
import { messageWorker, updateErrorMessage } from "./updateRequest"

let waitingWorker: ServiceWorker | null = null

function currentWorkspace() {
  return window.matchMedia("(max-width: 900px), ((pointer: coarse) and (max-width: 1180px))").matches ? "mobile" : "desktop"
}

function clerkAssets() {
  return performance.getEntriesByType("resource").map((entry) => entry.name).filter(isCacheableClerkAsset)
}

function isCacheableClerkAsset(value: string) {
  const url = new URL(value, location.href)
  return url.protocol === "https:"
    && url.pathname.startsWith("/npm/@clerk/clerk-js@")
    && url.pathname.endsWith(".js")
}

export function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return
  const buildCache = document.querySelector<HTMLMetaElement>('meta[name="mind-build-cache"]')?.content ?? null
  navigator.serviceWorker.addEventListener("message", (event) => respondToBuildQuery(event, buildCache))
  const cleanup = () => navigator.serviceWorker.controller?.postMessage({ type: "CLEANUP_CACHES" })
  window.addEventListener("pageshow", cleanup)
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") cleanup()
  })
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js").then(async (registration) => {
      async function prepareUpdate() {
        const worker = registration.waiting
        if (!worker) return
        try {
          await messageWorker(worker, "PREPARE_UPDATE", { workspace: currentWorkspace(), urls: clerkAssets() })
          if (registration.waiting !== worker) return
          waitingWorker = worker
          window.dispatchEvent(new Event("mind-pwa-update"))
        } catch {
          // Leave the current build usable and retry when connectivity returns.
        }
      }
      void prepareUpdate()
      window.addEventListener("online", () => void prepareUpdate())
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") void prepareUpdate()
      })
      registration.addEventListener("updatefound", () => {
        const worker = registration.installing
        worker?.addEventListener("statechange", () => {
          if (worker.state === "installed" && navigator.serviceWorker.controller) {
            void prepareUpdate()
          }
        })
      })
      const readyRegistration = await navigator.serviceWorker.ready
      const cacheWorkspace = () => {
        const loadedLocalAssets = performance.getEntriesByType("resource")
          .map((entry) => entry.name)
          .filter((value) => {
            const url = new URL(value, location.href)
            return url.origin === location.origin && !url.pathname.startsWith("/api/") || isCacheableClerkAsset(value)
          })
        readyRegistration.active?.postMessage({ type: "CACHE_URLS", workspace: currentWorkspace(), urls: loadedLocalAssets })
      }
      cacheWorkspace()
      window.addEventListener("online", cacheWorkspace)
      window.matchMedia("(max-width: 900px), ((pointer: coarse) and (max-width: 1180px))").addEventListener("change", cacheWorkspace)
    }).catch(console.error)
  })
}

export function PwaUpdatePrompt() {
  const [ready, setReady] = useState(() => Boolean(waitingWorker))
  const [updating, setUpdating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function update() {
    if (!waitingWorker) return
    setUpdating(true)
    setError(null)
    try {
      await messageWorker(waitingWorker, "SKIP_WAITING", { workspace: currentWorkspace(), urls: clerkAssets() })
    } catch (error) {
      console.error("PWA update failed", error)
      setUpdating(false)
      setError(updateErrorMessage(error))
    }
  }
  useEffect(() => {
    const show = () => setReady(true)
    window.addEventListener("mind-pwa-update", show)
    return () => window.removeEventListener("mind-pwa-update", show)
  }, [])
  useEffect(() => {
    let controller = navigator.serviceWorker?.controller
    const reload = () => {
      const next = navigator.serviceWorker?.controller
      if (controller && next !== controller) window.location.reload()
      controller = next
    }
    navigator.serviceWorker?.addEventListener("controllerchange", reload)
    return () => navigator.serviceWorker?.removeEventListener("controllerchange", reload)
  }, [])
  if (!ready) return null
  return <div role="status" style={{ position: "fixed", left: "50%", bottom: "max(16px,env(safe-area-inset-bottom))", transform: "translateX(-50%)", zIndex: 500, width: "max-content", maxWidth: "calc(100vw - 32px)", boxSizing: "border-box", borderRadius: 10, background: "#222", color: "#fff", padding: "9px 10px 9px 13px", display: "flex", alignItems: "center", gap: 12, boxShadow: "0 8px 25px rgba(0,0,0,.24)", fontSize: 12 }}><span style={{ minWidth: 0, overflowWrap: "anywhere" }}>{error ?? "Mind is ready to update"}</span><button disabled={updating} onClick={() => void update()} style={{ flexShrink: 0, whiteSpace: "nowrap", border: 0, borderRadius: 6, background: "#fff", color: "#222", padding: "5px 8px", fontWeight: 700 }}>{updating ? "Updating…" : error ? "Try again" : "Update"}</button></div>
}
