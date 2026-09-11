import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react"
import { useStore } from "../../store"
import { beginCrossCanvasDrag, endCrossCanvasDrag, getCrossCanvasDrag, moveCrossCanvasDrag, subscribeCrossCanvasDrag } from "../../utils/crossCanvasDrag"
import { suppressNativeSelection } from "../../utils/mobileGestureSelection"
import { shouldDismissMobileToast } from "../../utils/mobileSwipeDismiss"
import { getMobileTileDropPoint, getMobileTileResize } from "../../utils/mobileTileGesture"
import { optimisticIdentityKey } from "../../utils/optimisticIdentity"
import type { Tile } from "../../types"

const GRID = 24
const HOLD_TO_DRAG_MS = 300
const MOVE_THRESHOLD = 10
const snap = (value: number) => Math.round(value / GRID) * GRID

type TileFrame = Pick<Tile, "x" | "y" | "width" | "height">
type OverviewDragFeedback = { thoughtDragging: boolean; targetTileId: number | null; tileDraggingId: number | null }
type Interaction = { kind: "drag" | "resize"; tileId: number }
type Undo = { tileId: number; beforeCanvasId: number | null; before: TileFrame }
type TileGesture = {
  mode: "pending" | "dragging" | "resizing"
  tile: Tile
  sourceCanvasId: number | null
  primaryId: number
  secondaryId: number | null
  startX: number
  startY: number
  lastX: number
  lastY: number
  grabOffsetX: number
  grabOffsetY: number
  moved: boolean
  cancelled: boolean
  holdTimer: number | null
  points: Map<number, { x: number; y: number }>
  startSpanX: number
  startSpanY: number
}

function overviewDragFeedback(session = getCrossCanvasDrag()): OverviewDragFeedback {
  if (session?.kind === "thought") return { thoughtDragging: true, targetTileId: session.targetTileId, tileDraggingId: null }
  if (session?.kind === "tile") return { thoughtDragging: false, targetTileId: null, tileDraggingId: session.tile.id }
  return { thoughtDragging: false, targetTileId: null, tileDraggingId: null }
}

export function MobileOverview({ focusedTileId, onFocusTile }: { focusedTileId: number | null; onFocusTile: (tileId: number, canvasId?: number | null) => void }) {
  const { tiles, thoughts, canvasHeight, activeCanvasId, addTile, updateTile, moveTileToCanvas, setActiveCanvas } = useStore()
  const canvasWidth = Math.round(canvasHeight * 16 / 9)
  const hostRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLDivElement>(null)
  const gestureRef = useRef<TileGesture | null>(null)
  const gestureCleanupRef = useRef<(() => void) | null>(null)
  const draftRef = useRef<(TileFrame & { tile: Tile }) | null>(null)
  const pendingDraftRef = useRef<(TileFrame & { tile: Tile }) | null>(null)
  const draftFrameRef = useRef<number | null>(null)
  const scaleRef = useRef(.1)
  const [size, setSize] = useState({ width: 1, height: 1 })
  const [dragFeedback, setDragFeedback] = useState<OverviewDragFeedback>(() => overviewDragFeedback())
  const [interaction, setInteraction] = useState<Interaction | null>(null)
  const [draft, setDraft] = useState<(TileFrame & { tile: Tile }) | null>(null)
  const [droppedTile, setDroppedTile] = useState<{ id: number; x: number; y: number } | null>(null)
  const [undo, setUndo] = useState<Undo | null>(null)
  const thoughtCountByTile = useMemo(() => {
    const counts = new Map<number, number>()
    for (const thought of thoughts) counts.set(thought.tile_id, (counts.get(thought.tile_id) ?? 0) + 1)
    return counts
  }, [thoughts])

  useEffect(() => {
    if (!hostRef.current) return
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }))
    observer.observe(hostRef.current)
    return () => observer.disconnect()
  }, [])

  useEffect(() => subscribeCrossCanvasDrag((session) => {
    const next = overviewDragFeedback(session)
    setDragFeedback((current) => current.thoughtDragging === next.thoughtDragging && current.targetTileId === next.targetTileId && current.tileDraggingId === next.tileDraggingId ? current : next)
  }), [])

  useLayoutEffect(() => {
    if (!droppedTile) return
    // Commit the drop position and full opacity before restoring transitions.
    // Flushing layout here avoids a timer that could also suppress a quick Undo or sync update.
    canvasRef.current?.querySelector<HTMLElement>(`[data-mobile-tile-id="${droppedTile.id}"]`)?.getBoundingClientRect()
    setDroppedTile(null)
  }, [droppedTile])

  useEffect(() => () => {
    const gesture = gestureRef.current
    if (gesture) clearHold(gesture)
    gestureRef.current = null
    gestureCleanupRef.current?.()
    if (draftFrameRef.current !== null) window.cancelAnimationFrame(draftFrameRef.current)
    if (getCrossCanvasDrag()?.kind === "tile") endCrossCanvasDrag()
  }, [])

  useEffect(() => {
    if (!undo) return
    const dismiss = (event: PointerEvent) => {
      if ((event.target as HTMLElement).closest("[data-mobile-tile-undo]")) return
      setUndo(null)
    }
    window.addEventListener("pointerdown", dismiss, true)
    const timer = window.setTimeout(() => setUndo(null), 8000)
    return () => {
      window.removeEventListener("pointerdown", dismiss, true)
      window.clearTimeout(timer)
    }
  }, [undo])

  const padding = 12
  const scale = Math.max(0.01, Math.min((size.width - padding * 2) / canvasWidth, (size.height - padding * 2) / canvasHeight))
  scaleRef.current = scale
  const draggingCanvas = dragFeedback.thoughtDragging || dragFeedback.tileDraggingId !== null
  const activeTileDrag = getCrossCanvasDrag()
  const dragPreviewThoughtCount = activeTileDrag?.kind === "tile" ? Math.min(6, activeTileDrag.thoughts.length) : 0

  function setTileDraft(next: (TileFrame & { tile: Tile }) | null, immediate = false) {
    draftRef.current = next
    pendingDraftRef.current = next
    if (next === null) {
      if (draftFrameRef.current !== null) window.cancelAnimationFrame(draftFrameRef.current)
      draftFrameRef.current = null
      setDraft(null)
      return
    }
    if (immediate) {
      if (draftFrameRef.current !== null) window.cancelAnimationFrame(draftFrameRef.current)
      draftFrameRef.current = null
      setDraft(next)
      return
    }
    if (draftFrameRef.current !== null) return
    draftFrameRef.current = window.requestAnimationFrame(() => {
      draftFrameRef.current = null
      setDraft(pendingDraftRef.current)
    })
  }

  function clearHold(gesture: TileGesture) {
    if (gesture.holdTimer === null) return
    window.clearTimeout(gesture.holdTimer)
    gesture.holdTimer = null
  }

  function canvasPoint(clientX: number, clientY: number, gesture: Pick<TileGesture, "tile" | "grabOffsetX" | "grabOffsetY">) {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return null
    return getMobileTileDropPoint({
      clientX,
      clientY,
      hostLeft: rect.left,
      hostTop: rect.top,
      viewX: 0,
      viewY: 0,
      scale: scaleRef.current,
      grabOffsetX: gesture.grabOffsetX,
      grabOffsetY: gesture.grabOffsetY,
      canvasWidth,
      canvasHeight,
      tileWidth: gesture.tile.width,
      tileHeight: gesture.tile.height,
    })
  }

  function startTileDrag(gesture: TileGesture) {
    if (gestureRef.current !== gesture || gesture.mode !== "pending" || gesture.cancelled) return
    gesture.mode = "dragging"
    gesture.holdTimer = null
    navigator.vibrate?.(12)
    setInteraction({ kind: "drag", tileId: gesture.tile.id })
    setTileDraft({ tile: gesture.tile, x: gesture.tile.x, y: gesture.tile.y, width: gesture.tile.width, height: gesture.tile.height }, true)
    const tileThoughts = thoughts.filter((thought) => thought.tile_id === gesture.tile.id)
    beginCrossCanvasDrag({
      kind: "tile",
      tile: gesture.tile,
      thoughts: tileThoughts,
      sourceCanvasId: gesture.sourceCanvasId,
      grabOffsetX: gesture.grabOffsetX,
      grabOffsetY: gesture.grabOffsetY,
      clientX: gesture.lastX,
      clientY: gesture.lastY,
      enteredCanvasId: null,
    })
  }

  function beginResize(gesture: TileGesture, event: PointerEvent) {
    if (gesture.mode === "dragging") {
      if (gesture.moved || getCrossCanvasDrag()?.kind !== "tile") return
      endCrossCanvasDrag()
    } else if (gesture.mode !== "pending") {
      return
    }
    clearHold(gesture)
    event.preventDefault()
    gesture.mode = "resizing"
    gesture.secondaryId = event.pointerId
    gesture.points.set(gesture.primaryId, { x: gesture.lastX, y: gesture.lastY })
    gesture.points.set(event.pointerId, { x: event.clientX, y: event.clientY })
    const [first, second] = [...gesture.points.values()]
    gesture.startSpanX = Math.abs(first.x - second.x)
    gesture.startSpanY = Math.abs(first.y - second.y)
    setInteraction({ kind: "resize", tileId: gesture.tile.id })
    setTileDraft({ tile: gesture.tile, x: gesture.tile.x, y: gesture.tile.y, width: gesture.tile.width, height: gesture.tile.height }, true)
  }

  function finishGesture(pointerId: number, cancelled: boolean) {
    const gesture = gestureRef.current
    if (!gesture || (pointerId !== gesture.primaryId && pointerId !== gesture.secondaryId)) return
    clearHold(gesture)
    const session = getCrossCanvasDrag()
    const finalDraft = draftRef.current
    gestureCleanupRef.current?.()
    gestureCleanupRef.current = null
    gestureRef.current = null
    setInteraction(null)
    setTileDraft(null)

    if (gesture.mode === "pending") return
    if (gesture.mode === "dragging") {
      if (session?.kind === "tile") endCrossCanvasDrag()
      if (cancelled || !gesture.moved || !finalDraft) {
        if (cancelled && gesture.sourceCanvasId !== null && useStore.getState().activeCanvasId !== gesture.sourceCanvasId) setActiveCanvas(gesture.sourceCanvasId)
        return
      }
      const targetCanvasId = session?.kind === "tile" ? session.enteredCanvasId ?? gesture.sourceCanvasId : gesture.sourceCanvasId
      setDroppedTile({ id: gesture.tile.id, x: finalDraft.x, y: finalDraft.y })
      setUndo({ tileId: gesture.tile.id, beforeCanvasId: gesture.sourceCanvasId, before: { x: gesture.tile.x, y: gesture.tile.y, width: gesture.tile.width, height: gesture.tile.height } })
      if (targetCanvasId !== null && targetCanvasId !== gesture.sourceCanvasId) {
        void moveTileToCanvas(gesture.tile.id, targetCanvasId, finalDraft.x, finalDraft.y)
      } else {
        void updateTile(gesture.tile.id, { x: finalDraft.x, y: finalDraft.y })
      }
      onFocusTile(gesture.tile.id, targetCanvasId)
      return
    }

    if (cancelled || !finalDraft) return
    const changed = finalDraft.x !== gesture.tile.x || finalDraft.y !== gesture.tile.y || finalDraft.width !== gesture.tile.width || finalDraft.height !== gesture.tile.height
    if (!changed) return
    setUndo({ tileId: gesture.tile.id, beforeCanvasId: gesture.sourceCanvasId, before: { x: gesture.tile.x, y: gesture.tile.y, width: gesture.tile.width, height: gesture.tile.height } })
    void updateTile(gesture.tile.id, { x: finalDraft.x, y: finalDraft.y, width: finalDraft.width, height: finalDraft.height })
  }

  function beginTileGesture(event: ReactPointerEvent<HTMLDivElement>, tile: Tile) {
    if (event.button !== 0) return
    event.stopPropagation()
    event.preventDefault()
    if (gestureRef.current) return
    gestureCleanupRef.current?.()
    const releaseNativeSelection = suppressNativeSelection()
    try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* Older mobile engines still use the window listeners below. */ }
    onFocusTile(tile.id, activeCanvasId)
    const rect = canvasRef.current?.getBoundingClientRect()
    const pointX = rect ? (event.clientX - rect.left) / Math.max(.01, scaleRef.current) : tile.x
    const pointY = rect ? (event.clientY - rect.top) / Math.max(.01, scaleRef.current) : tile.y
    const gesture: TileGesture = {
      mode: "pending",
      tile,
      sourceCanvasId: tile.canvas_id ?? activeCanvasId,
      primaryId: event.pointerId,
      secondaryId: null,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      grabOffsetX: pointX - tile.x,
      grabOffsetY: pointY - tile.y,
      moved: false,
      cancelled: false,
      holdTimer: null,
      points: new Map([[event.pointerId, { x: event.clientX, y: event.clientY }]]),
      startSpanX: 0,
      startSpanY: 0,
    }
    gestureRef.current = gesture
    gesture.holdTimer = window.setTimeout(() => startTileDrag(gesture), HOLD_TO_DRAG_MS)

    const additionalDown = (pointerEvent: PointerEvent) => {
      const current = gestureRef.current
      if (!current || pointerEvent.pointerId === current.primaryId || !hostRef.current?.contains(pointerEvent.target as Node)) return
      beginResize(current, pointerEvent)
    }
    const move = (pointerEvent: PointerEvent) => {
      const current = gestureRef.current
      if (!current || (pointerEvent.pointerId !== current.primaryId && pointerEvent.pointerId !== current.secondaryId)) return
      pointerEvent.preventDefault()
      if (pointerEvent.pointerId === current.primaryId) {
        current.lastX = pointerEvent.clientX
        current.lastY = pointerEvent.clientY
      }
      current.points.set(pointerEvent.pointerId, { x: pointerEvent.clientX, y: pointerEvent.clientY })
      if (current.mode === "pending") {
        if (Math.hypot(pointerEvent.clientX - current.startX, pointerEvent.clientY - current.startY) > MOVE_THRESHOLD) {
          current.cancelled = true
          clearHold(current)
        }
        return
      }
      if (current.mode === "dragging") {
        current.moved = current.moved || Math.hypot(pointerEvent.clientX - current.startX, pointerEvent.clientY - current.startY) > MOVE_THRESHOLD
        moveCrossCanvasDrag(pointerEvent.clientX, pointerEvent.clientY)
        const point = canvasPoint(pointerEvent.clientX, pointerEvent.clientY, current)
        if (point) setTileDraft({ tile: current.tile, ...point, width: current.tile.width, height: current.tile.height })
        return
      }
      if (current.points.size < 2) return
      const [first, second] = [...current.points.values()]
      const frame = getMobileTileResize({
        tile: current.tile,
        startSpanX: current.startSpanX,
        startSpanY: current.startSpanY,
        spanX: Math.abs(first.x - second.x),
        spanY: Math.abs(first.y - second.y),
        scale: scaleRef.current,
        canvasWidth,
        canvasHeight,
      })
      setTileDraft({ tile: current.tile, ...frame })
    }
    const up = (pointerEvent: PointerEvent) => finishGesture(pointerEvent.pointerId, false)
    const cancel = (pointerEvent: PointerEvent) => finishGesture(pointerEvent.pointerId, true)
    window.addEventListener("pointerdown", additionalDown, true)
    window.addEventListener("pointermove", move, { passive: false })
    window.addEventListener("pointerup", up)
    window.addEventListener("pointercancel", cancel)
    gestureCleanupRef.current = () => {
      releaseNativeSelection()
      window.removeEventListener("pointerdown", additionalDown, true)
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", up)
      window.removeEventListener("pointercancel", cancel)
    }
  }

  function addDefaultTile() {
    const width = Math.min(480, snap(canvasWidth * .28))
    const height = Math.min(336, snap(canvasHeight * .25))
    let found = { x: GRID * 2, y: GRID * 2 }
    outer: for (let y = GRID * 2; y <= canvasHeight - height; y += GRID * 2) {
      for (let x = GRID * 2; x <= canvasWidth - width; x += GRID * 2) {
        const overlaps = tiles.some((tile) => tile.visible && x < tile.x + tile.width && x + width > tile.x && y < tile.y + tile.height && y + height > tile.y)
        if (!overlaps) { found = { x, y }; break outer }
      }
    }
    const known = new Set(tiles.map((tile) => optimisticIdentityKey(tile, "tile")))
    const pending = addTile({ title: "New Tile", ...found, width, height, importance: 1, visible: true, canvas_id: activeCanvasId })
    const created = useStore.getState().tiles.find((tile) => !known.has(optimisticIdentityKey(tile, "tile")))
    if (created) onFocusTile(created.id, activeCanvasId)
    void pending.catch(console.error)
  }

  function undoLastChange() {
    if (!undo) return
    const state = useStore.getState()
    const current = state.tiles.find((tile) => tile.id === undo.tileId)
      ?? [...state.tileCache.values()].flat().find((tile) => tile.id === undo.tileId)
    if (!current) { setUndo(null); return }
    if (undo.beforeCanvasId !== null && current.canvas_id !== undo.beforeCanvasId) {
      void state.moveTileToCanvas(undo.tileId, undo.beforeCanvasId, undo.before.x, undo.before.y)
    } else {
      void state.updateTile(undo.tileId, undo.before)
    }
    setUndo(null)
  }

  return (
    <div ref={hostRef} style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden", background: "#ededed", display: "flex", alignItems: "center", justifyContent: "center", touchAction: "none", userSelect: "none", WebkitUserSelect: "none", WebkitTouchCallout: "none" }}>
      <div ref={canvasRef} aria-label="Canvas overview" style={{ position: "relative", width: canvasWidth, height: canvasHeight, flexShrink: 0, boxSizing: "border-box", transform: `scale(${scale})`, transformOrigin: "center", backgroundColor: draggingCanvas ? "#faf7ff" : "#f7f7f7", backgroundImage: "radial-gradient(circle, #c8c8c8 1.2px, transparent 1.2px)", backgroundSize: "24px 24px", border: `${Math.max(1, 1 / scale)}px solid ${draggingCanvas ? "#7c3aed" : "#d7d7d7"}`, borderRadius: 12 / scale, boxShadow: draggingCanvas ? "0 10px 36px rgba(124,58,237,.2)" : "0 8px 30px rgba(0,0,0,0.08)", transition: "background-color 160ms ease, border-color 160ms ease, box-shadow 160ms ease", userSelect: "none", WebkitUserSelect: "none", WebkitTouchCallout: "none" }}>
        {tiles.filter((tile) => tile.visible).map((tile) => {
          const resizing = interaction?.kind === "resize" && interaction.tileId === tile.id && draft?.tile.id === tile.id
          const frame = resizing && draft ? draft : tile
          const count = Math.min(6, thoughtCountByTile.get(tile.id) ?? 0)
          const isDropTarget = dragFeedback.targetTileId === tile.id
          const isFocused = focusedTileId === tile.id
          const isDragging = dragFeedback.tileDraggingId === tile.id
          const isDropped = droppedTile?.id === tile.id && droppedTile.x === frame.x && droppedTile.y === frame.y
          return <div key={optimisticIdentityKey(tile, "tile")} data-mobile-tile-id={tile.id} onPointerDown={(event) => beginTileGesture(event, tile)} onContextMenu={(event) => event.preventDefault()} style={{ position: "absolute", left: frame.x, top: frame.y, width: frame.width, height: frame.height, boxSizing: "border-box", background: isDropTarget || isFocused ? "#f5f3ff" : "rgba(255,255,255,.94)", border: `2px solid ${isDropTarget || isFocused ? "#7c3aed" : "#d4d4d4"}`, borderRadius: 9, overflow: "hidden", boxShadow: isDropTarget ? "0 0 0 8px rgba(124,58,237,.2)" : isFocused ? "0 0 0 5px rgba(124,58,237,.12)" : "0 3px 12px rgba(0,0,0,.05)", pointerEvents: "auto", touchAction: "none", userSelect: "none", WebkitUserSelect: "none", WebkitTouchCallout: "none", opacity: isDragging ? 0 : 1, transition: resizing ? "none" : `${isDropped ? "" : "left 160ms ease, top 160ms ease, opacity 140ms ease, "}width 160ms ease, height 160ms ease, background-color 160ms ease, border-color 160ms ease, box-shadow 160ms ease` }}>
            <div style={{ height: Math.max(44, Math.min(68, frame.height * .24)), borderBottom: "1px solid #ddd", padding: "9px 12px", fontWeight: 700, fontSize: 44, lineHeight: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: "#222", userSelect: "none", WebkitUserSelect: "none" }}>{tile.title}</div>
            <div style={{ padding: 10, display: "flex", flexDirection: "column", gap: 8 }}>
              {Array.from({ length: count }).map((_, index) => <div key={index} style={{ height: 15, width: `${78 - index % 3 * 9}%`, borderRadius: 5, background: "linear-gradient(90deg,#e8e8e8,#f2f2f2,#e8e8e8)" }} />)}
            </div>
          </div>
        })}
        {interaction?.kind === "drag" && draft && <div data-mobile-tile-drag-preview style={{ position: "absolute", left: draft.x, top: draft.y, width: draft.width, height: draft.height, zIndex: 20, boxSizing: "border-box", border: "3px solid #7c3aed", borderRadius: 9, overflow: "hidden", background: "rgba(255,255,255,.96)", boxShadow: "0 0 0 7px rgba(124,58,237,.12), 0 8px 24px rgba(88,28,135,.18)", pointerEvents: "none" }}>
          <div style={{ height: Math.max(44, Math.min(68, draft.height * .24)), borderBottom: "1px solid #ddd", padding: "9px 12px", fontWeight: 700, fontSize: 44, lineHeight: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: "#222", userSelect: "none", WebkitUserSelect: "none" }}>{draft.tile.title}</div>
          <div style={{ padding: 10, display: "flex", flexDirection: "column", gap: 8 }}>
            {Array.from({ length: dragPreviewThoughtCount }).map((_, index) => <div key={index} style={{ height: 15, width: `${78 - index % 3 * 9}%`, borderRadius: 5, background: "linear-gradient(90deg,#e8e8e8,#f2f2f2,#e8e8e8)" }} />)}
          </div>
        </div>}
      </div>
      {dragFeedback.thoughtDragging && <div style={{ position: "absolute", right: 9, bottom: 7, padding: "3px 7px", background: "rgba(109,40,217,.86)", color: "#fff", borderRadius: 99, fontSize: 10, pointerEvents: "none", userSelect: "none", WebkitUserSelect: "none" }}>Drop onto a tile</div>}
      {!draggingCanvas && <button type="button" onPointerDown={(event) => event.stopPropagation()} onClick={addDefaultTile} aria-label="Add tile" style={{ position: "absolute", right: 10, bottom: 9, zIndex: 8, width: 38, height: 38, borderRadius: 20, border: 0, background: "#1a1a1a", color: "#fff", fontSize: 24, lineHeight: 1, display: "grid", placeItems: "center", boxShadow: "0 5px 16px rgba(0,0,0,.2)" }}>+</button>}
      {undo && <MobileUndoToast onDismiss={() => setUndo(null)} onUndo={undoLastChange} />}
    </div>
  )
}

function MobileUndoToast({ onDismiss, onUndo }: { onDismiss: () => void; onUndo: () => void }) {
  const pointerRef = useRef<{ id: number; startX: number; startY: number } | null>(null)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [dismissing, setDismissing] = useState(false)

  function begin(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || (event.target as HTMLElement).closest("button")) return
    event.preventDefault()
    pointerRef.current = { id: event.pointerId, startX: event.clientX, startY: event.clientY }
    try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* Window-level fallback is unnecessary for a non-critical dismissal. */ }
  }

  function move(event: ReactPointerEvent<HTMLDivElement>) {
    const pointer = pointerRef.current
    if (!pointer || pointer.id !== event.pointerId) return
    event.preventDefault()
    setOffset({ x: event.clientX - pointer.startX, y: event.clientY - pointer.startY })
  }

  function finish(event: ReactPointerEvent<HTMLDivElement>, cancelled = false) {
    const pointer = pointerRef.current
    if (!pointer || pointer.id !== event.pointerId) return
    pointerRef.current = null
    const delta = { x: event.clientX - pointer.startX, y: event.clientY - pointer.startY }
    if (cancelled || !shouldDismissMobileToast(delta.x, delta.y)) {
      setOffset({ x: 0, y: 0 })
      return
    }
    const horizontal = Math.abs(delta.x) >= Math.abs(delta.y)
    setDismissing(true)
    setOffset(horizontal
      ? { x: Math.sign(delta.x || 1) * window.innerWidth, y: delta.y }
      : { x: delta.x, y: Math.sign(delta.y || 1) * 120 })
    window.setTimeout(onDismiss, 150)
  }

  return (
    <div data-mobile-tile-undo style={{ position: "absolute", left: "50%", bottom: 9, zIndex: 9, transform: "translateX(-50%)", touchAction: "none" }}>
      <div onPointerDown={begin} onPointerMove={move} onPointerUp={(event) => finish(event)} onPointerCancel={(event) => finish(event, true)} style={{ transform: `translate3d(${offset.x}px,${offset.y}px,0)`, opacity: Math.max(0.2, 1 - Math.hypot(offset.x, offset.y) / 150), transition: pointerRef.current && !dismissing ? "none" : "transform 150ms ease, opacity 150ms ease", display: "flex", alignItems: "center", gap: 10, padding: "7px 8px 7px 11px", background: "#262626", color: "#fff", borderRadius: 9, boxShadow: "0 6px 18px rgba(0,0,0,.2)", fontSize: 11, whiteSpace: "nowrap", userSelect: "none", WebkitUserSelect: "none", WebkitTouchCallout: "none" }}>
        <span>Tile updated</span>
        <button type="button" onPointerDown={(event) => event.stopPropagation()} onClick={onUndo} style={{ border: 0, borderRadius: 6, padding: "4px 7px", background: "#fff", color: "#222", fontWeight: 750 }}>Undo</button>
      </div>
    </div>
  )
}
