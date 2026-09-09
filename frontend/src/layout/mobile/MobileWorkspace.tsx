import { useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { useStore } from "../../store"
import { canvasIdentityKey } from "../../utils/canvasIdentity"
import { optimisticIdentityKey } from "../../utils/optimisticIdentity"
import { UtilityContent } from "../../components/UtilityContent"
import { AiStatusPill } from "../../components/AiStatusPill"
import { AiSparkleIcon } from "../../components/AiSparkleIcon"
import { startSidebarWarmupOnOpen } from "../../startup/workspaceStartup"
import { hasExpandedTextSelection } from "../../utils/textSelection"
import { MobileDragOverlay } from "./MobileDragOverlay"
import { MobileFocusedTile } from "./MobileFocusedTile"
import { MobileOverview } from "./MobileOverview"
import { MobileTabBar } from "./MobileTabBar"

const PREVIEW_RESIZE_TRANSITION = "flex-basis 240ms cubic-bezier(.2,.8,.2,1)"

function usePortrait() {
  const [portrait, setPortrait] = useState(() => window.innerHeight >= window.innerWidth)
  useEffect(() => {
    const update = () => setPortrait(window.innerHeight >= window.innerWidth)
    window.addEventListener("resize", update)
    window.screen.orientation?.addEventListener("change", update)
    return () => {
      window.removeEventListener("resize", update)
      window.screen.orientation?.removeEventListener("change", update)
    }
  }, [])
  return portrait
}

export default function MobileWorkspace() {
  const { canvases, activeCanvasId, tiles, thoughts, focusedTileByCanvas, setFocusedTile, mobilePortraitSplit, mobileLandscapeSplit, setMobileSplit, setSpotlightOpen } = useStore()
  const portrait = usePortrait()
  const activeCanvas = canvases.find((canvas) => canvas.id === activeCanvasId) ?? null
  const canvasKey = activeCanvas ? canvasIdentityKey(activeCanvas) : "no-canvas"
  const [utilitiesOpen, setUtilitiesOpen] = useState(false)
  const previewPaneRef = useRef<HTMLDivElement>(null)
  const resizeCleanupRef = useRef<(() => void) | null>(null)
  const storedFocusedKey = focusedTileByCanvas[canvasKey]
  const visibleTiles = useMemo(() => tiles.filter((tile) => tile.visible), [tiles])
  const focusedTile = visibleTiles.find((tile) => optimisticIdentityKey(tile, "tile") === storedFocusedKey)
    ?? [...visibleTiles].sort((a, b) => a.y - b.y || a.x - b.x)[0]
    ?? null

  useEffect(() => {
    if (focusedTile && storedFocusedKey !== optimisticIdentityKey(focusedTile, "tile")) setFocusedTile(canvasKey, optimisticIdentityKey(focusedTile, "tile"))
  }, [canvasKey, focusedTile?.id, storedFocusedKey])

  useEffect(() => {
    if (!utilitiesOpen) return
    void startSidebarWarmupOnOpen()
  }, [utilitiesOpen])
  useEffect(() => () => resizeCleanupRef.current?.(), [])

  function focusTile(tileId: number, canvasId = activeCanvasId) {
    const state = useStore.getState()
    const canvas = state.canvases.find((item) => item.id === canvasId)
    const targetTiles = canvasId === state.activeCanvasId ? state.tiles : state.tileCache.get(canvasId ?? 0) ?? []
    const tile = targetTiles.find((item) => item.id === tileId)
    if (!canvas || !tile) return
    const nextCanvasKey = canvasIdentityKey(canvas)
    const nextTileKey = optimisticIdentityKey(tile, "tile")
    if (state.focusedTileByCanvas[nextCanvasKey] !== nextTileKey) state.setFocusedTile(nextCanvasKey, nextTileKey)
  }

  function beginResize(event: React.PointerEvent<HTMLDivElement>) {
    // Native mobile selection handles can be hit-tested as the divider beneath
    // them. Let that gesture keep adjusting the selection instead of collapsing
    // the canvas preview.
    if (hasExpandedTextSelection()) return
    event.preventDefault()
    event.stopPropagation()
    resizeCleanupRef.current?.()
    const pointerId = event.pointerId
    const start = portrait ? event.clientY : event.clientX
    const initial = portrait ? mobilePortraitSplit : mobileLandscapeSplit
    const bounds = event.currentTarget.parentElement?.getBoundingClientRect()
    const available = portrait ? bounds?.height ?? window.innerHeight - 70 : bounds?.width ?? window.innerWidth
    const orientation = portrait ? "portrait" : "landscape"
    const pane = previewPaneRef.current
    let nextRatio = initial
    let frame: number | null = null
    if (pane) pane.style.transition = "none"
    const draw = () => {
      frame = null
      if (pane) pane.style.flexBasis = `${nextRatio * 100}%`
    }
    const move = (pointerEvent: PointerEvent) => {
      if (pointerEvent.pointerId !== pointerId) return
      if (hasExpandedTextSelection()) {
        finish(false)
        return
      }
      pointerEvent.preventDefault()
      const delta = (portrait ? pointerEvent.clientY : pointerEvent.clientX) - start
      nextRatio = Math.max(0, Math.min(.72, initial + delta / Math.max(1, available)))
      if (frame === null) frame = window.requestAnimationFrame(draw)
    }
    const finish = (commit: boolean) => {
      if (!commit) nextRatio = initial
      if (frame !== null) window.cancelAnimationFrame(frame)
      draw()
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", up)
      window.removeEventListener("pointercancel", cancel)
      if (pane) pane.style.transition = PREVIEW_RESIZE_TRANSITION
      resizeCleanupRef.current = null
      if (commit) setMobileSplit(orientation, nextRatio)
    }
    const up = (pointerEvent: PointerEvent) => {
      if (pointerEvent.pointerId === pointerId) finish(true)
    }
    const cancel = (pointerEvent: PointerEvent) => {
      if (pointerEvent.pointerId === pointerId) finish(false)
    }
    resizeCleanupRef.current = () => finish(false)
    window.addEventListener("pointermove", move, { passive: false })
    window.addEventListener("pointerup", up)
    window.addEventListener("pointercancel", cancel)
  }

  const split = portrait ? mobilePortraitSplit : mobileLandscapeSplit
  const previewBasis = `${split * 100}%`

  return (
    <main style={{ position: "fixed", inset: 0, height: "100dvh", display: "flex", flexDirection: "column", background: "#f2f2f2", overflow: "hidden" }}>
      <MobileTabBar onOpenUtilities={() => setUtilitiesOpen(true)} />
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: portrait ? "column" : "row" }}>
        <div ref={previewPaneRef} style={{ flex: `0 0 ${previewBasis}`, minHeight: 0, minWidth: 0, overflow: "hidden", transition: PREVIEW_RESIZE_TRANSITION }}>
          <MobileOverview focusedTileId={focusedTile?.id ?? null} onFocusTile={focusTile} />
        </div>
        <div onPointerDown={beginResize} role="separator" aria-orientation={portrait ? "horizontal" : "vertical"} aria-label="Resize canvas preview" style={{ position: "relative", zIndex: 5, flex: "0 0 18px", background: "#fff", borderTop: portrait ? "1px solid #ddd" : 0, borderBottom: portrait ? "1px solid #ddd" : 0, borderLeft: !portrait ? "1px solid #ddd" : 0, borderRight: !portrait ? "1px solid #ddd" : 0, cursor: portrait ? "ns-resize" : "ew-resize", touchAction: "none", display: "grid", placeItems: "center", userSelect: "none", WebkitUserSelect: "none", WebkitTouchCallout: "none" }}>
          <span style={{ width: portrait ? 38 : 4, height: portrait ? 4 : 38, borderRadius: 99, background: "#d0d0d0" }} />
        </div>
        <div style={{ flex: 1, minHeight: 0, minWidth: 0, overflow: "hidden" }}><MobileFocusedTile tile={focusedTile} thoughts={thoughts} onFocusTarget={focusTile} /></div>
      </div>
      <div style={{ position: "fixed", right: 14, bottom: "max(14px,env(safe-area-inset-bottom))", zIndex: 25, display: "flex", alignItems: "center", gap: 5 }}><AiStatusPill /><button onClick={() => setSpotlightOpen(true)} aria-label="Open AI input" style={{ width: 39, height: 39, padding: 0, borderRadius: 20, border: "1px solid #ddd", background: "rgba(255,255,255,.94)", color: "#7c3aed", boxShadow: "0 5px 18px rgba(0,0,0,.12)", display: "grid", placeItems: "center" }}><AiSparkleIcon size={18} /></button></div>
      <MobileDragOverlay />
      {utilitiesOpen && createPortal(<div style={{ position: "fixed", inset: 0, zIndex: 150, background: "rgba(0,0,0,.32)", padding: "max(8px,env(safe-area-inset-top)) 7px max(7px,env(safe-area-inset-bottom))" }} onPointerDown={(event) => { if (event.target === event.currentTarget) setUtilitiesOpen(false) }}><section aria-label="Mind menu" style={{ height: "100%", maxWidth: 560, margin: "0 auto", background: "#fff", borderRadius: 16, padding: "14px 14px 0", boxShadow: "0 20px 60px rgba(0,0,0,.22)", overflow: "hidden" }}><UtilityContent onClose={() => setUtilitiesOpen(false)} /></section></div>, document.body)}
    </main>
  )
}
