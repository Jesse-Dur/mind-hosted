import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { ThoughtTags } from "../../components/ThoughtTags"
import { getCrossCanvasDrag, subscribeCrossCanvasDrag, subscribeCrossCanvasDragPointer, type CrossCanvasDragSession } from "../../utils/crossCanvasDrag"

type ThoughtDragSession = Extract<CrossCanvasDragSession, { kind: "thought" }>

export function MobileDragOverlay() {
  const [session, setSession] = useState<ThoughtDragSession | null>(() => {
    const current = getCrossCanvasDrag()
    return current?.kind === "thought" ? current : null
  })
  const frameRef = useRef<number | null>(null)
  const pendingRef = useRef<ThoughtDragSession | null>(null)

  useEffect(() => {
    const unsubscribeSnapshot = subscribeCrossCanvasDrag((next) => {
      if (next?.kind === "thought") {
        setSession((current) => current ?? next)
        return
      }
      pendingRef.current = null
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current)
      frameRef.current = null
      setSession(null)
    })
    const unsubscribePointer = subscribeCrossCanvasDragPointer((next) => {
      if (next.kind !== "thought") return
      pendingRef.current = next
      if (frameRef.current !== null) return
      frameRef.current = window.requestAnimationFrame(() => {
        frameRef.current = null
        if (pendingRef.current) setSession(pendingRef.current)
      })
    })
    return () => {
      unsubscribeSnapshot()
      unsubscribePointer()
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current)
    }
  }, [])

  if (!session) return null

  const width = Math.min(290, window.innerWidth - 24)
  const visibleEdge = Math.min(64, width * .35)
  const left = Math.max(-width + visibleEdge, Math.min(window.innerWidth - visibleEdge, session.clientX - 28))
  const top = Math.max(-22, Math.min(window.innerHeight - 26, session.clientY - 22))

  return createPortal(
    <div data-mobile-drag-preview style={{ position: "fixed", left, top, zIndex: 230, width, minHeight: 42, boxSizing: "border-box", display: "flex", alignItems: "center", gap: 7, padding: "8px 9px", borderRadius: 8, border: "1px solid #a78bfa", background: "rgba(255,255,255,.96)", boxShadow: "0 14px 32px rgba(88,28,135,.2)", color: "#222", fontSize: 14, lineHeight: 1.45, opacity: .9, transform: "scale(1.02)", pointerEvents: "none", userSelect: "none", WebkitUserSelect: "none" }}>
      <span aria-hidden style={{ color: "#bbb", fontSize: 14, flexShrink: 0 }}>⠿</span>
      <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{session.thought.content}</span>
      <ThoughtTags tags={session.thought.tags} expandOnHover={false} />
    </div>,
    document.body
  )
}
