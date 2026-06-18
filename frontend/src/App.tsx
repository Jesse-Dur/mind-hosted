import { Suspense, useEffect, useState } from "react"
import { SignedIn, SignedOut, SignInButton, useAuth } from "@clerk/clerk-react"
import { Canvas } from "./components/Canvas"
import { Sidebar } from "./components/Sidebar"
import { AiStatusPill } from "./components/AiStatusPill"
import { LoadingScreen } from "./components/LoadingScreen"
import { OverageNotice } from "./components/OverageNotice"
import { TabBar } from "./components/TabBar"
import { Tooltip } from "./components/Tooltip"
import { LazySpotlight, preloadDeferredSurfaces } from "./components/lazySurfaces"
import { useStore, setGetToken } from "./store"
import { clearReauthRequired } from "./auth/reauthSignal"

function SpotlightFallback({ onClose }: { onClose: () => void }) {
  return (
    <div
      onMouseDown={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.2)", display: "flex", alignItems: "flex-start", justifyContent: "center", paddingTop: 120, zIndex: 100 }}
    >
      <div style={{ width: 560, background: "#fff", border: "1px solid #e0e0e0", borderRadius: 12, boxShadow: "0 8px 32px rgba(0,0,0,0.12)", padding: "14px 16px", color: "#999", fontSize: 13 }}>
        Loading command center...
      </div>
    </div>
  )
}

export default function App() {
  const { getToken, isSignedIn, isLoaded } = useAuth()
  const { hydrateCachedWorkspace, loadTiles, loadThoughts, loadTags, loadCanvases, hydrateRemainingCanvases, initializeSync, syncNow, setSpotlightOpen, spotlightOpen, sidebarOpen, setSidebarOpen, tabsVisible } = useStore()
  const [openedByMic, setOpenedByMic] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [tabBarVisible, setTabBarVisible] = useState(tabsVisible)
  const [tabBarAnimating, setTabBarAnimating] = useState(false)

  function closeSpotlight() {
    setSpotlightOpen(false)
    setOpenedByMic(false)
  }

  // Delay unmount of TabBar so slide-out animation can play
  useEffect(() => {
    if (tabsVisible) {
      setTabBarVisible(true)
      setTabBarAnimating(false)
    } else {
      setTabBarAnimating(true)
      const t = setTimeout(() => { setTabBarVisible(false); setTabBarAnimating(false) }, 180)
      return () => clearTimeout(t)
    }
  }, [tabsVisible])

  useEffect(() => { setGetToken(getToken) }, [getToken])

  useEffect(() => {
    if (!isLoaded || isSignedIn) return
    // A real sign-out is already handled by Clerk; clear the quiet sync pause so
    // a future sign-in starts from a clean auth state.
    clearReauthRequired()
  }, [isLoaded, isSignedIn])

  useEffect(() => {
    if (!isLoaded) return
    if (!isSignedIn) { setLoaded(true); return }
    let cancelled = false

    function startBackgroundHydration(activeCanvasId: number | null, refreshActiveCanvas: boolean) {
      void (async () => {
        if (refreshActiveCanvas && activeCanvasId !== null) {
          await Promise.all([
            loadCanvases(),
            loadTags(),
            loadTiles(activeCanvasId),
            loadThoughts(activeCanvasId),
          ])
        }
        if (cancelled) return
        preloadDeferredSurfaces()
        await hydrateRemainingCanvases()
      })().catch(console.error)
    }

    async function boot() {
      await initializeSync()
      if (cancelled) return

      const cached = await hydrateCachedWorkspace()
      if (cancelled) return
      if (cached.hasUsableCache) {
        setLoaded(true)
        startBackgroundHydration(cached.activeCanvasId, true)
        return
      }

      // Load canvases first so the restored tab id is known before canvas data is fetched.
      const initialCanvasId = await loadCanvases()
      if (cancelled) return

      const initialCanvasData = initialCanvasId === null
        ? Promise.resolve()
        : Promise.all([loadTiles(initialCanvasId), loadThoughts(initialCanvasId)]).then(() => undefined)
      await Promise.all([initialCanvasData, loadTags()])
      if (cancelled) return

      setLoaded(true)
      startBackgroundHydration(initialCanvasId, false)
    }

    boot().catch(console.error)
    const poll = setInterval(syncNow, 15000)
    return () => {
      cancelled = true
      clearInterval(poll)
    }
  }, [isLoaded, isSignedIn, hydrateCachedWorkspace, loadCanvases, loadTiles, loadThoughts, loadTags, hydrateRemainingCanvases, initializeSync, syncNow])

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
      <SignedOut>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100vh", gap: 16, color: "#666" }}>
          <img src="/favicon.svg" width={48} height={48} alt="Mind" />
          <p style={{ margin: 0, fontSize: 15 }}>Sign in to access your thoughts</p>
          <SignInButton mode="modal">
            <button style={{ padding: "8px 20px", borderRadius: 8, border: "1px solid #ddd", background: "#fff", cursor: "pointer", fontSize: 14 }}>
              Sign in
            </button>
          </SignInButton>
        </div>
      </SignedOut>

      <LoadingScreen loaded={loaded} />
      <SignedIn>
        <Sidebar />
        {tabBarVisible && <TabBar slidingOut={tabBarAnimating} />}
        <OverageNotice tabsVisible={tabsVisible} />
        {!tabsVisible && (
          <div style={{ position: "fixed", top: 12, left: 12, zIndex: 50, display: "flex", alignItems: "center", gap: 6 }}>
            <Tooltip label="Sidebar" placement="bottom" align="start">
              <button
                onClick={() => setSidebarOpen(!sidebarOpen)}
                style={{ background: "none", border: "none", cursor: "pointer", width: 32, height: 32, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", transition: "background 0.15s ease", color: "#aaa" }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "#ebebeb")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
                aria-label="Sidebar"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ pointerEvents: "none" }}>
                  <path d="M2 4h12M2 8h8M2 12h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
              </button>
            </Tooltip>
            <AiStatusPill />
          </div>
        )}
        <Canvas tabBarVisible={tabsVisible} />
        {spotlightOpen && (
          <Suspense fallback={<SpotlightFallback onClose={closeSpotlight} />}>
            <LazySpotlight openedByMic={openedByMic} onClose={closeSpotlight} />
          </Suspense>
        )}
      </SignedIn>
    </>
  )
}
