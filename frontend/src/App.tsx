// App.tsx owns the top-level shell, auth gate, and startup sequencing entry point.
import { useCallback, useEffect, useRef, useState } from "react"
import { SignInButton, useAuth } from "@clerk/clerk-react"
import { CreationLimitNotice } from "./components/CreationLimitNotice"
import { LoadingScreen } from "./components/LoadingScreen"
import { OverageNotice } from "./components/OverageNotice"
import { PlansModal } from "./components/PlansModal"
import { ReauthenticationOverlay } from "./components/ReauthenticationOverlay"
import { Spotlight } from "./components/Spotlight"
import { ResponsiveWorkspace } from "./layout/ResponsiveWorkspace"
import { PwaUpdatePrompt } from "./pwa/serviceWorker"
import { useStore, setGetToken } from "./store"
import { clearReauthRequired } from "./auth/reauthSignal"
import { cachedOfflineUserId, rememberAuthenticatedUser } from "./auth/offlineIdentity"
import { bootstrapCriticalWorkspace, startDeferredWorkspaceWarmup } from "./startup/workspaceStartup"
import { closeAccountDatabase } from "./sync/localDb"
import { stopSyncRuntime } from "./sync/engine"
import { useOnline } from "./utils/connectivity"

export default function App() {
  const { getToken, isSignedIn, isLoaded, userId } = useAuth()
  const online = useOnline()
  const cachedUserId = cachedOfflineUserId()
  // Keep the last account-partitioned workspace mounted while Clerk checks the
  // session and after an expired session. Explicit sign-out removes this cached
  // identity from consideration in cachedOfflineUserId().
  const offlineUserId = !isSignedIn && cachedUserId ? cachedUserId : null
  const effectiveUserId = isSignedIn && userId ? userId : offlineUserId
  const canOpenWorkspace = Boolean(effectiveUserId)
  const reauthenticationRequired = Boolean(isLoaded && !isSignedIn && cachedUserId)
  const { syncNow, setSpotlightOpen, spotlightOpen, tabsVisible, resetStore } = useStore()
  const [openedByMic, setOpenedByMic] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [workspaceRendered, setWorkspaceRendered] = useState(false)
  const [workspaceUserId, setWorkspaceUserId] = useState<string | null>(null)
  const [plansOpen, setPlansOpen] = useState(() => window.location.hash === "#plans")
  const bootUserRef = useRef<string | null>(null)
  const requestedBootUserRef = useRef<string | null>(null)
  const bootQueueRef = useRef<Promise<void>>(Promise.resolve())
  const markWorkspaceRendered = useCallback(() => setWorkspaceRendered(true), [])

  function closeSpotlight() {
    setSpotlightOpen(false)
    setOpenedByMic(false)
  }

  function closePlans() {
    if (window.location.hash === "#plans") {
      window.history.pushState(null, "", `${window.location.pathname}${window.location.search}`)
    }
    setPlansOpen(false)
  }

  useEffect(() => { setGetToken(getToken) }, [getToken])

  useEffect(() => {
    if (!isSignedIn || !userId) return
    rememberAuthenticatedUser(userId)
    clearReauthRequired()
  }, [isSignedIn, userId])

  useEffect(() => {
    function onHashChange() {
      setPlansOpen(window.location.hash === "#plans")
    }

    onHashChange()
    window.addEventListener("hashchange", onHashChange)
    return () => window.removeEventListener("hashchange", onHashChange)
  }, [])

  useEffect(() => {
    if (!isLoaded || isSignedIn || !online || cachedUserId) return
    // Explicit sign-out removes the cached identity, so it still closes the
    // workspace without deleting its account-partitioned local database.
    clearReauthRequired()
    stopSyncRuntime()
    closeAccountDatabase()
    resetStore()
    setWorkspaceUserId(null)
  }, [cachedUserId, isLoaded, isSignedIn, online, resetStore])

  useEffect(() => {
    requestedBootUserRef.current = effectiveUserId
    if (!effectiveUserId) {
      bootUserRef.current = null
      setWorkspaceUserId(null)
      return
    }
    let cancelled = false
    setLoaded(false)
    setWorkspaceRendered(false)
    if (bootUserRef.current !== effectiveUserId) {
      setWorkspaceUserId(null)
      stopSyncRuntime()
      resetStore()
    }

    async function boot() {
      if (cancelled || requestedBootUserRef.current !== effectiveUserId) return
      if (bootUserRef.current && bootUserRef.current !== effectiveUserId) {
        stopSyncRuntime()
        resetStore()
      }
      bootUserRef.current = effectiveUserId
      const result = await bootstrapCriticalWorkspace(effectiveUserId)
      if (cancelled || requestedBootUserRef.current !== effectiveUserId) {
        if (requestedBootUserRef.current === null) {
          stopSyncRuntime()
          closeAccountDatabase()
          resetStore()
        }
        return
      }
      setLoaded(true)
      setWorkspaceUserId(effectiveUserId)
      startDeferredWorkspaceWarmup(result.activeCanvasId, result.hasUsableCache)
    }

    bootQueueRef.current = bootQueueRef.current.catch(console.error).then(boot).catch(console.error)
    return () => {
      cancelled = true
    }
  }, [effectiveUserId, resetStore])

  useEffect(() => {
    if (!effectiveUserId && (isLoaded || !online)) setLoaded(true)
  }, [effectiveUserId, isLoaded, online])

  useEffect(() => {
    if (!isSignedIn) return
    // A failed background pull is expected while connectivity is degraded.
    // Always observe the async result so the offline retry loop never creates
    // an unhandled promise rejection in the browser.
    const poll = window.setInterval(() => {
      void syncNow().catch(console.error)
    }, 15000)
    return () => window.clearInterval(poll)
  }, [isSignedIn, syncNow])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault()
        setOpenedByMic(false)
        setSpotlightOpen(true)
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === "M" || e.key === "m")) {
        e.preventDefault()
        const { spotlightOpen } = useStore.getState()
        if (!spotlightOpen) {
          setOpenedByMic(true)
          setSpotlightOpen(true)
        } else {
          window.dispatchEvent(new CustomEvent("mic-shortcut"))
        }
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [setSpotlightOpen])

  return (
    <>
      <PwaUpdatePrompt />
      {!canOpenWorkspace && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100vh", gap: 16, color: "#666" }}>
          <img src="/favicon.svg" width={48} height={48} alt="Mind" />
          <p style={{ margin: 0, fontSize: 15 }}>{online ? "Sign in to access your thoughts" : "Connect to the internet to sign in"}</p>
          {online && (
            <SignInButton mode="modal">
              <button style={{ padding: "8px 20px", borderRadius: 8, border: "1px solid #ddd", background: "#fff", cursor: "pointer", fontSize: 14 }}>
                Sign in
              </button>
            </SignInButton>
          )}
        </div>
      )}

      <LoadingScreen loaded={loaded && (!canOpenWorkspace || workspaceRendered)} />
      {canOpenWorkspace && workspaceUserId === effectiveUserId && (
        <>
        <OverageNotice tabsVisible={tabsVisible} />
        <CreationLimitNotice tabsVisible={tabsVisible} />
        <ResponsiveWorkspace onReady={markWorkspaceRendered} />
        {spotlightOpen && <Spotlight openedByMic={openedByMic} onClose={closeSpotlight} />}
        {plansOpen && <PlansModal onClose={closePlans} />}
        </>
      )}
      {canOpenWorkspace && workspaceUserId !== effectiveUserId && (
        <div aria-label="Loading account" style={{ position: "fixed", inset: 0, display: "grid", placeItems: "center", background: "#f5f5f5" }}>
          <img src="/favicon.svg" width={64} height={64} alt="" style={{ opacity: .48 }} />
        </div>
      )}
      {reauthenticationRequired && <ReauthenticationOverlay />}
    </>
  )
}
