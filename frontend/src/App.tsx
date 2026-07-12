// App.tsx owns the top-level shell, auth gate, and startup sequencing entry point.
import { useEffect, useState } from "react"
import { SignedIn, SignedOut, SignInButton, useAuth } from "@clerk/clerk-react"
import { Canvas } from "./components/Canvas"
import { CreationLimitNotice } from "./components/CreationLimitNotice"
import { AiStatusPill } from "./components/AiStatusPill"
import { LoadingScreen } from "./components/LoadingScreen"
import { OverageNotice } from "./components/OverageNotice"
import { PlansModal } from "./components/PlansModal"
import { Sidebar } from "./components/Sidebar"
import { TabBar } from "./components/TabBar"
import { Tooltip } from "./components/Tooltip"
import { Spotlight } from "./components/Spotlight"
import { useStore, setGetToken } from "./store"
import { clearReauthRequired } from "./auth/reauthSignal"
import { bootstrapCriticalWorkspace, startDeferredWorkspaceWarmup, startSidebarWarmupOnHover } from "./startup/workspaceStartup"

export default function App() {
  const { getToken, isSignedIn, isLoaded } = useAuth()
  const { syncNow, setSpotlightOpen, spotlightOpen, sidebarOpen, setSidebarOpen, tabsVisible, resetStore } = useStore()
  const [openedByMic, setOpenedByMic] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [tabBarVisible, setTabBarVisible] = useState(tabsVisible)
  const [tabBarAnimating, setTabBarAnimating] = useState(false)
  const [plansOpen, setPlansOpen] = useState(() => window.location.hash === "#plans")

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
    function onHashChange() {
      setPlansOpen(window.location.hash === "#plans")
    }

    onHashChange()
    window.addEventListener("hashchange", onHashChange)
    return () => window.removeEventListener("hashchange", onHashChange)
  }, [])

  useEffect(() => {
    if (!isLoaded || isSignedIn) return
    // A real sign-out is already handled by Clerk; clear the quiet sync pause so
    // a future sign-in starts from a clean auth state.
    clearReauthRequired()
    resetStore()
  }, [isLoaded, isSignedIn, resetStore])

  useEffect(() => {
    if (!isLoaded) return
    if (!isSignedIn) { setLoaded(true); return }
    let cancelled = false

    async function boot() {
      const result = await bootstrapCriticalWorkspace()
      if (cancelled) return
      setLoaded(true)
      startDeferredWorkspaceWarmup(result.activeCanvasId, result.hasUsableCache)
    }

    boot().catch(console.error)
    const poll = setInterval(syncNow, 15000)
    return () => {
      cancelled = true
      clearInterval(poll)
    }
  }, [isLoaded, isSignedIn, syncNow])

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
        <CreationLimitNotice tabsVisible={tabsVisible} />
        {!tabsVisible && (
          <div style={{ position: "fixed", top: 12, left: 12, zIndex: 50, display: "flex", alignItems: "center", gap: 6 }}>
            <Tooltip label="Sidebar" placement="bottom" align="start">
              <button
                onClick={() => setSidebarOpen(!sidebarOpen)}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "#ebebeb"
                  startSidebarWarmupOnHover()
                }}
                onFocus={() => { startSidebarWarmupOnHover() }}
                onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
                style={{ background: "none", border: "none", cursor: "pointer", width: 32, height: 32, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", transition: "background 0.15s ease", color: "#aaa" }}
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
        {spotlightOpen && <Spotlight openedByMic={openedByMic} onClose={closeSpotlight} />}
        {plansOpen && <PlansModal onClose={closePlans} />}
      </SignedIn>
    </>
  )
}
