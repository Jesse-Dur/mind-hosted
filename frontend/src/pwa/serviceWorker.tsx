import { useEffect, useState } from "react"

let waitingWorker: ServiceWorker | null = null

function currentWorkspace() {
  return window.matchMedia("(max-width: 900px), ((pointer: coarse) and (max-width: 1180px))").matches ? "mobile" : "desktop"
}

function clerkAssets() {
  return performance.getEntriesByType("resource").map((entry) => entry.name).filter(isCacheableClerkAsset)
}

function messageWorker(worker: ServiceWorker, type: "PREPARE_UPDATE" | "SKIP_WAITING") {
  return new Promise<void>((resolve, reject) => {
    const channel = new MessageChannel()
    const finish = (error?: Error) => {
      window.clearTimeout(timeout)
      channel.port1.close()
      if (error) reject(error)
      else resolve()
    }
    const timeout = window.setTimeout(() => finish(new Error("Update download timed out")), 20000)
    channel.port1.onmessage = (event) => finish(event.data?.ok ? undefined : new Error("Update download failed"))
    worker.postMessage({ type, workspace: currentWorkspace(), urls: clerkAssets() }, [channel.port2])
  })
}

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
      async function prepareUpdate() {
        const worker = registration.waiting
        if (!worker) return
        try {
          await messageWorker(worker, "PREPARE_UPDATE")
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
  const [error, setError] = useState(false)
  async function update() {
    if (!waitingWorker) return
    setUpdating(true)
    setError(false)
    try {
      await messageWorker(waitingWorker, "SKIP_WAITING")
    } catch {
      setUpdating(false)
      setError(true)
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
  return <div role="status" style={{ position: "fixed", left: "50%", bottom: "max(16px,env(safe-area-inset-bottom))", transform: "translateX(-50%)", zIndex: 500, borderRadius: 10, background: "#222", color: "#fff", padding: "9px 10px 9px 13px", display: "flex", alignItems: "center", gap: 12, boxShadow: "0 8px 25px rgba(0,0,0,.24)", fontSize: 12, whiteSpace: "nowrap" }}><span>{error ? "Update failed. Reconnect and try again." : "Mind is ready to update"}</span><button disabled={updating} onClick={() => void update()} style={{ border: 0, borderRadius: 6, background: "#fff", color: "#222", padding: "5px 8px", fontWeight: 700 }}>{updating ? "Updating…" : "Update"}</button></div>
}
