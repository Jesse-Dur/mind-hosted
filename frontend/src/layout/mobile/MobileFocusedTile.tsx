import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { useStore } from "../../store"
import { SyncStatusDot } from "../../components/SyncStatusDot"
import { ThoughtInput } from "../../components/ThoughtInput"
import { ThoughtTags } from "../../components/ThoughtTags"
import { TagMenu } from "../../components/TagMenu"
import { TileDeleteDialog } from "../../components/TileDeleteDialog"
import { useThoughtEdit } from "../../hooks/useThoughtEdit"
import { beginCrossCanvasDrag, endCrossCanvasDrag, getCrossCanvasDrag, moveCrossCanvasDrag, setThoughtDragTarget, subscribeCrossCanvasDrag, type CrossCanvasDragSession } from "../../utils/crossCanvasDrag"
import { mobileThoughtInsertionIndex, mobileThoughtOrderIds, sameThoughtOrder } from "../../utils/mobileThoughtOrder"
import type { Thought, Tile } from "../../types"

type FocusTarget = (tileId: number, canvasId?: number | null) => void

export function MobileFocusedTile({ tile, thoughts, onFocusTarget }: { tile: Tile | null; thoughts: Thought[]; onFocusTarget: FocusTarget }) {
  const { updateTile, removeTile, canvasFontSize } = useStore()
  const [title, setTitle] = useState(tile?.title ?? "")
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [dragSession, setDragSession] = useState<CrossCanvasDragSession | null>(() => getCrossCanvasDrag())
  useEffect(() => setTitle(tile?.title ?? ""), [tile?.id, tile?.title])
  useEffect(() => subscribeCrossCanvasDrag(setDragSession), [])

  if (!tile) return <div style={{ height: "100%", display: "grid", placeItems: "center", color: "#aaa", textAlign: "center", padding: 24 }}><div><p style={{ fontSize: 15, marginBottom: 6 }}>This canvas is empty</p><p style={{ fontSize: 12 }}>Tap + in the canvas preview to add a tile.</p></div></div>
  const tileThoughts = thoughts.filter((thought) => thought.tile_id === tile.id).sort((a, b) => a.sort_order - b.sort_order)
  const thoughtDropTarget = dragSession?.kind === "thought" && dragSession.targetTileId === tile.id
  const displayedThoughts = thoughtDropTarget && dragSession.targetIndex !== null
    ? mobileThoughtOrderIds([...tileThoughts.map((thought) => thought.id), dragSession.thought.id], dragSession.thought.id, dragSession.targetIndex)
        .map((id) => id === dragSession.thought.id ? dragSession.thought : tileThoughts.find((thought) => thought.id === id))
        .filter((thought): thought is Thought => Boolean(thought))
    : tileThoughts

  function commitTitle() {
    const next = title.trim() || tile!.title
    setTitle(next)
    if (next !== tile!.title) void updateTile(tile!.id, { title: next })
  }

  return (
    <section data-mobile-tile-id={tile.id} style={{ height: "100%", background: thoughtDropTarget ? "#faf7ff" : "#fff", display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: thoughtDropTarget ? "inset 0 0 0 3px rgba(124,58,237,.42)" : "inset 0 0 0 0 rgba(124,58,237,0)", transition: "background-color 160ms ease, box-shadow 160ms ease" }}>
      <div style={{ height: 46, flexShrink: 0, display: "flex", alignItems: "center", borderBottom: "1px solid #e9e9e9", padding: "0 10px", gap: 8 }}>
        <input value={title} onChange={(event) => setTitle(event.target.value)} onBlur={commitTitle} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); if (event.key === "Escape") { setTitle(tile.title); event.currentTarget.blur() } }} aria-label="Tile title" style={{ flex: 1, minWidth: 0, border: 0, outline: 0, background: "transparent", fontSize: canvasFontSize + 2, fontWeight: 700, color: "#171717" }} />
        <SyncStatusDot entities={[{ entityType: "tile", id: tile.id, clientId: tile.client_id }, ...tileThoughts.map((thought) => ({ entityType: "thought" as const, id: thought.id, clientId: thought.client_id }))]} />
        <button onClick={() => setConfirmDelete(true)} aria-label="Delete tile" style={smallButton}>×</button>
      </div>
      <div data-mobile-thought-list style={{ flex: 1, overflowY: "auto", overscrollBehavior: "contain", padding: "8px 9px max(12px,env(safe-area-inset-bottom))", display: "flex", flexDirection: "column", gap: 5 }}>
        {displayedThoughts.map((thought) => <MobileThought key={thought.stableKey ?? thought.id} thought={thought} onFocusTarget={onFocusTarget} />)}
        <ThoughtInput tileId={tile.id} fontSize={canvasFontSize + 1} />
      </div>
      {confirmDelete && <TileDeleteDialog tile={tile} thoughtCount={tileThoughts.length} onClose={() => setConfirmDelete(false)} onDelete={() => { setConfirmDelete(false); void removeTile(tile.id) }} />}
    </section>
  )
}

function MobileThought({ thought, onFocusTarget }: { thought: Thought; onFocusTarget: FocusTarget }) {
  const { activeCanvasId, canvases, canvasFontSize, removeThought, updateThoughtTags, moveThoughtToTile, setActiveCanvas } = useStore()
  const { editing, content, saveEditing, startEditing, setIntent, cancelEditing } = useThoughtEdit(thought)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [localTags, setLocalTags] = useState(thought.tags)
  const [dragging, setDragging] = useState(false)
  const dragEndedAt = useRef(0)
  const textRef = useRef<HTMLSpanElement>(null)
  const tagMenuOpenedAt = useRef(0)
  const longPress = useRef<{ timer: number; x: number; y: number; pointerId: number } | null>(null)
  useEffect(() => setLocalTags(thought.tags), [thought.tags])
  useEffect(() => () => cancelLongPress(), [])

  function cancelLongPress() {
    if (longPress.current) window.clearTimeout(longPress.current.timer)
    longPress.current = null
  }

  function beginDrag(event: React.PointerEvent) {
    if (editing || event.button !== 0) return
    event.preventDefault()
    const sourceCanvasId = activeCanvasId
    const sourceTileId = thought.tile_id
    let previewedTarget = `${sourceCanvasId ?? "none"}:${sourceTileId}`
    cancelLongPress()
    setDragging(true)
    navigator.vibrate?.(15)
    const sourceThoughts = useStore.getState().thoughts
      .filter((item) => item.tile_id === sourceTileId)
      .sort((a, b) => a.sort_order - b.sort_order)
    beginCrossCanvasDrag({ kind: "thought", thought, sourceTileId, sourceCanvasId, targetTileId: sourceTileId, targetIndex: Math.max(0, sourceThoughts.findIndex((item) => item.id === thought.id)), clientX: event.clientX, clientY: event.clientY, enteredCanvasId: null })

    const move = (pointerEvent: PointerEvent) => {
      moveCrossCanvasDrag(pointerEvent.clientX, pointerEvent.clientY)
      const target = document.elementFromPoint(pointerEvent.clientX, pointerEvent.clientY)?.closest<HTMLElement>("[data-mobile-tile-id]")
      const id = Number(target?.dataset.mobileTileId)
      if (!Number.isFinite(id) || !target) {
        setThoughtDragTarget(null, null)
        return
      }
      const thoughtList = target.querySelector<HTMLElement>("[data-mobile-thought-list]")
      const rows = Array.from(thoughtList?.querySelectorAll<HTMLElement>("[data-mobile-thought-id]") ?? [])
        .map((row) => {
          const rect = row.getBoundingClientRect()
          return { id: Number(row.dataset.mobileThoughtId), top: rect.top, bottom: rect.bottom }
        })
        .filter((row) => Number.isFinite(row.id))
      setThoughtDragTarget(id, thoughtList ? mobileThoughtInsertionIndex(rows, thought.id, pointerEvent.clientY) : null)
      const targetCanvasId = useStore.getState().activeCanvasId
      const targetKey = `${targetCanvasId ?? "none"}:${id}`
      if (targetKey !== previewedTarget) {
        previewedTarget = targetKey
        onFocusTarget(id, targetCanvasId)
      }
    }
    const finish = (pointerEvent: PointerEvent, cancelled: boolean) => {
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", up)
      window.removeEventListener("pointercancel", cancel)
      const session = getCrossCanvasDrag()
      const targetTileId = session?.kind === "thought" ? session.targetTileId : null
      const targetIndex = session?.kind === "thought" ? session.targetIndex : null
      const targetCanvasId = useStore.getState().activeCanvasId
      endCrossCanvasDrag()
      dragEndedAt.current = Date.now()
      setDragging(false)
      if (!cancelled && targetTileId !== null) {
        const targetThoughts = useStore.getState().thoughts
          .filter((item) => item.tile_id === targetTileId)
          .sort((a, b) => a.sort_order - b.sort_order)
        const currentIds = targetThoughts.map((item) => item.id)
        const orderedIds = mobileThoughtOrderIds(currentIds, thought.id, targetIndex ?? currentIds.filter((id) => id !== thought.id).length)
        if (targetTileId !== sourceTileId || targetCanvasId !== sourceCanvasId || !sameThoughtOrder(orderedIds, currentIds)) {
          void moveThoughtToTile(thought.id, targetTileId, { sourceCanvasId, targetCanvasId, orderedIds })
        }
        onFocusTarget(targetTileId, targetCanvasId)
      } else {
        if (sourceCanvasId !== null && useStore.getState().activeCanvasId !== sourceCanvasId) setActiveCanvas(sourceCanvasId)
        onFocusTarget(sourceTileId, sourceCanvasId)
      }
      pointerEvent.preventDefault()
    }
    const up = (pointerEvent: PointerEvent) => finish(pointerEvent, false)
    const cancel = (pointerEvent: PointerEvent) => finish(pointerEvent, true)
    window.addEventListener("pointermove", move, { passive: false })
    window.addEventListener("pointerup", up, { once: true })
    window.addEventListener("pointercancel", cancel, { once: true })
  }

  function beginTagLongPress(event: React.PointerEvent<HTMLDivElement>) {
    if (editing || event.button !== 0) return
    cancelLongPress()
    const rect = event.currentTarget.getBoundingClientRect()
    const menuWidth = Math.min(210, window.innerWidth - 20)
    const x = Math.max(10, Math.min(window.innerWidth - menuWidth - 10, event.clientX - menuWidth / 2))
    const y = rect.bottom + 6
    longPress.current = {
      timer: window.setTimeout(() => {
        longPress.current = null
        tagMenuOpenedAt.current = Date.now()
        navigator.vibrate?.(10)
        textRef.current?.blur()
        setMenu({ x, y })
      }, 430),
      x: event.clientX,
      y: event.clientY,
      pointerId: event.pointerId,
    }
  }

  function movePending(event: React.PointerEvent) {
    const pending = longPress.current
    if (pending && Math.hypot(event.clientX - pending.x, event.clientY - pending.y) > 9) cancelLongPress()
  }

  function beginTextEditing(event: React.PointerEvent<HTMLSpanElement>) {
    if (event.button !== 0 || editing) return
    if (Date.now() - dragEndedAt.current < 350 || Date.now() - tagMenuOpenedAt.current < 500) return
    setIntent()
    const node = textRef.current
    if (node) {
      // The element must become editable during the trusted pointer gesture so
      // mobile browsers can place the caret and open the keyboard on this tap.
      node.contentEditable = "true"
      node.focus({ preventScroll: true })
    }
    startEditing()
  }

  const canvasName = canvases.find((canvas) => canvas.id === activeCanvasId)?.name
  return (
    <div data-mobile-thought-id={thought.id} style={{ position: "relative", display: "flex", alignItems: "center", gap: 7, padding: "8px 7px", minHeight: 38, boxSizing: "border-box", background: dragging ? "#f5f3ff" : "#fafafa", border: `1px solid ${dragging ? "#a78bfa" : "#e9e9e9"}`, borderRadius: 8, opacity: dragging ? .38 : 1, touchAction: "pan-y", transition: "opacity 150ms ease, border-color 150ms ease, transform 150ms ease", transform: dragging ? "scale(.985)" : "scale(1)" }} onPointerDown={beginTagLongPress} onPointerMove={movePending} onPointerUp={cancelLongPress} onPointerCancel={cancelLongPress} onContextMenu={(event) => event.preventDefault()}>
      <button onPointerDown={(event) => { event.stopPropagation(); beginDrag(event) }} aria-label={`Move thought${canvasName ? ` from ${canvasName}` : ""}`} style={{ width: 27, height: 27, flexShrink: 0, border: 0, background: "transparent", color: "#bbb", fontSize: 14, lineHeight: 1, touchAction: "none", display: "grid", placeItems: "center", userSelect: "none", WebkitUserSelect: "none" }}>⠿</button>
      <span ref={textRef} contentEditable={editing || undefined} suppressContentEditableWarning onPointerDown={beginTextEditing} onClick={(event) => event.stopPropagation()} onBlur={(event) => saveEditing(event.currentTarget.textContent ?? "")} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur() } if (event.key === "Escape") { cancelEditing(); event.currentTarget.blur() } }} style={{ flex: 1, minWidth: 0, fontSize: canvasFontSize + 1, lineHeight: 1.45, color: "#222", outline: 0, cursor: "text", userSelect: "text" }}>{content}</span>
      <div style={{ height: 28, display: "flex", alignItems: "center", flexShrink: 0, alignSelf: "center" }}>
        <ThoughtTags tags={localTags} expandOnHover={false} />
        <span onPointerDown={(event) => event.stopPropagation()} style={{ width: 20, height: 20, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><SyncStatusDot entities={[{ entityType: "thought", id: thought.id, clientId: thought.client_id }]} /></span>
        <button onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); if (window.confirm("Delete this thought? It will be removed locally now and from other devices after sync. A failed server deletion remains recoverable in History.")) removeThought(thought.id) }} aria-label="Delete thought" style={{ ...smallButton, fontSize: 18 }}>×</button>
      </div>
      {menu && createPortal(<TagMenu thought={{ ...thought, tags: localTags }} x={menu.x} y={menu.y} onClose={() => setMenu(null)} onUpdate={async (tags) => { setLocalTags(tags); await updateThoughtTags(thought.id, tags) }} />, document.body)}
    </div>
  )
}

const smallButton: React.CSSProperties = { width: 28, height: 28, flexShrink: 0, border: 0, borderRadius: 14, background: "transparent", color: "#aaa", fontSize: 20, lineHeight: 1, display: "grid", placeItems: "center", userSelect: "none", WebkitUserSelect: "none" }
