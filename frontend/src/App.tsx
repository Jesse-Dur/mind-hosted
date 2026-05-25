import { useState, useEffect } from "react"
import { SignedIn, SignedOut, SignInButton, useAuth } from "@clerk/clerk-react"
import { Canvas } from "./components/Canvas"
import { Sidebar } from "./components/Sidebar"
import { Spotlight } from "./components/Spotlight"
import { AiStatusPill } from "./components/AiStatusPill"
import { LoadingScreen } from "./components/LoadingScreen"
import { useStore, setGetToken } from "./store"

export default function App() {
  const { getToken, isSignedIn } = useAuth()
  const { loadTiles, loadThoughts, loadTags, setSpotlightOpen, spotlightOpen, sidebarOpen, setSidebarOpen } = useStore()
  const [openedByMic, setOpenedByMic] = useState(false)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => { setGetToken(getToken) }, [getToken])

  useEffect(() => {
    if (!isSignedIn) return
    Promise.all([loadTiles(), loadThoughts(), loadTags()]).then(() => setLoaded(true))
    const poll = setInterval(loadThoughts, 15000)
    return () => clearInterval(poll)
  }, [isSignedIn, loadTiles, loadThoughts, loadTags])

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
          setTimeout(() => window.dispatchEvent(new CustomEvent("mic-shortcut")), 50)
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

      <SignedIn>
        <LoadingScreen loaded={loaded} />
        <div style={{ position: "fixed", top: 12, left: 12, zIndex: 50, display: "flex", alignItems: "center", gap: 6 }}>
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            style={{ background: "none", border: "none", cursor: "pointer", width: 32, height: 32, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", transition: "background 0.15s ease", color: "#aaa" }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "#ebebeb")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
            title="Sidebar"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ pointerEvents: "none" }}>
              <path d="M2 4h12M2 8h8M2 12h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
          <AiStatusPill />
        </div>
        <Sidebar />
        <Canvas />
        {spotlightOpen && <Spotlight openedByMic={openedByMic} onClose={() => { setSpotlightOpen(false); setOpenedByMic(false) }} />}
      </SignedIn>
    </>
  )
}
