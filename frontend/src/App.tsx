import { useEffect } from "react"
import { SignedIn, SignedOut, SignInButton } from "@clerk/clerk-react"
import { Canvas } from "./components/Canvas"
import { Sidebar } from "./components/Sidebar"
import { useStore } from "./store"

export default function App() {
  const { loadTiles, loadThoughts, loadTags, setSpotlightOpen, sidebarOpen, setSidebarOpen } = useStore()

  useEffect(() => {
    loadTiles()
    loadThoughts()
    loadTags()
    const poll = setInterval(loadThoughts, 5000)
    return () => clearInterval(poll)
  }, [loadTiles, loadThoughts, loadTags])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault()
        setSpotlightOpen(true)
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
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          style={{ position: "fixed", top: 12, left: 12, zIndex: 50, background: "none", border: "none", cursor: "pointer", width: 32, height: 32, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", transition: "background 0.15s ease", color: "#aaa" }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "#ebebeb")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
          title="Tags"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M2 4h12M2 8h8M2 12h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        </button>
        <Sidebar />
        <Canvas />
      </SignedIn>
    </>
  )
}
