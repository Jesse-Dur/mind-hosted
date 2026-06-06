import { useEffect, useRef, useState } from "react"
import { useStore } from "../store"
import { AiStatusPill } from "./AiStatusPill"
import { CanvasDeleteDialog } from "./CanvasDeleteDialog"
import { TabBarOutline } from "./TabBarOutline"
import { Tooltip } from "./Tooltip"
import { getTabShortcutAction, newCanvasShortcutLabel, tabShortcutLabel } from "../utils/tabShortcuts"
import { getCrossCanvasDrag, moveCrossCanvasDrag, setCrossCanvasDragEnteredCanvas, subscribeCrossCanvasDrag, subscribeCrossCanvasDragPointer } from "../utils/crossCanvasDrag"
import type { Canvas } from "../types"
import type { CanvasDeleteOptions } from "../api/client"

const BAR_H = 14
const JUT_H = 28
const JUT_H_INACTIVE = 24
const DRAG_THRESHOLD = 4
const FAVOURITE_BOUNDARY_HYSTERESIS = 10
const DRAG_STAR_SLOT_W = 12
const CROSS_CANVAS_TAB_DWELL_MS = 450

type DragState = {
  id: number
  pointerId: number
  startX: number
  startY: number
  centerOffsetX: number
  isDragging: boolean
  target: InsertTarget | null
  preview: Canvas[] | null
}

type InsertTarget = {
  index: number
  isFavourite: boolean
}

type DragPreview = {
  left: number
  top: number
  width: number
  height: number
}

type CanvasOrderUpdate = Pick<Canvas, "id" | "sort_order" | "is_favourite">

export function TabBar({ slidingOut }: { slidingOut?: boolean }) {
  const { canvases, activeCanvasId, setActiveCanvas, addCanvas, updateCanvas, removeCanvas, reorderCanvases, setSidebarOpen, sidebarOpen, aiStatus } = useStore()
  const aiExpanded = aiStatus !== "idle"
  const [renamingId, setRenamingId] = useState<number | null>(null)
  const [selectRenameText, setSelectRenameText] = useState(false)
  const [renameValue, setRenameValue] = useState("")
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; canvas: Canvas } | null>(null)
  const [deleteCanvas, setDeleteCanvas] = useState<Canvas | null>(null)
  const [newTabId, setNewTabId] = useState<number | null>(null)
  const [draggingId, setDraggingId] = useState<number | null>(null)
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 })
  const [dragPreview, setDragPreview] = useState<DragPreview | null>(null)
  const [insertTarget, setInsertTarget] = useState<InsertTarget | null>(null)
  const [previewCanvases, setPreviewCanvases] = useState<Canvas[] | null>(null)
  const [crossDragHoverId, setCrossDragHoverId] = useState<number | null>(null)
  const leftControlsRef = useRef<HTMLDivElement>(null)
  const [leftWidth, setLeftWidth] = useState(120)

  useEffect(() => {
    const el = leftControlsRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setLeftWidth(el.offsetWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const scrollRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const renameRef = useRef<HTMLInputElement>(null)
  const dragRef = useRef<DragState | null>(null)
  const dragCleanupRef = useRef<(() => void) | null>(null)
  const displayCanvasesRef = useRef<Canvas[]>([])
  const tabRefs = useRef(new Map<number, HTMLDivElement>())
  const crossDragHoverIdRef = useRef<number | null>(null)
  const crossDragTimerRef = useRef<number | null>(null)

  const sorted = [...canvases].sort((a, b) => {
    if (a.is_favourite !== b.is_favourite) return a.is_favourite ? -1 : 1
    return a.sort_order - b.sort_order
  })
  const displayCanvases = previewCanvases ?? sorted
  displayCanvasesRef.current = displayCanvases

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (contextMenu || renamingId) return
      const action = getTabShortcutAction(e)
      if (!action) return
      e.preventDefault()

      if (action.type === "newCanvas") {
        if (!e.repeat) void handleNewTab()
        return
      }
      if (action.type === "nextTab") { navigateTab(1); return }
      if (action.type === "previousTab") { navigateTab(-1); return }
      jumpToTab(action.index)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [activeCanvasId, canvases, contextMenu, renamingId])

  useEffect(() => {
    if (!contextMenu) return
    const close = () => setContextMenu(null)
    window.addEventListener("click", close)
    return () => window.removeEventListener("click", close)
  }, [contextMenu])

  useEffect(() => {
    if (renamingId === null) return
    renameRef.current?.focus()
    if (selectRenameText) renameRef.current?.select()
  }, [renamingId, selectRenameText])

  useEffect(() => () => dragCleanupRef.current?.(), [])

  useEffect(() => {
    const unsubscribeSnapshot = subscribeCrossCanvasDrag((session) => {
      if (!session) clearCrossDragHover()
    })
    const unsubscribePointer = subscribeCrossCanvasDragPointer((session) => {
      updateCrossDragHover(session.clientX, session.clientY)
    })
    return () => {
      unsubscribeSnapshot()
      unsubscribePointer()
      clearCrossDragHover()
    }
  }, [])

  useEffect(() => {
    if (!draggingId) return
    const previousUserSelect = document.body.style.userSelect
    const previousCursor = document.body.style.cursor
    document.body.style.userSelect = "none"
    document.body.style.cursor = "grabbing"
    return () => {
      document.body.style.userSelect = previousUserSelect
      document.body.style.cursor = previousCursor
    }
  }, [draggingId])

  function navigateTab(dir: 1 | -1) {
    // Keyboard shortcuts follow the same ordered list the tab strip renders.
    const tabs = displayCanvasesRef.current
    const idx = tabs.findIndex((c) => c.id === activeCanvasId)
    if (idx === -1) return
    const next = tabs[(idx + dir + tabs.length) % tabs.length]
    if (next) switchCanvas(next.id)
  }

  function jumpToTab(idx: number) {
    const canvas = displayCanvasesRef.current[idx]
    if (canvas) switchCanvas(canvas.id)
  }

  function switchCanvas(id: number) {
    if (id === activeCanvasId) return
    setActiveCanvas(id)
  }

  function clearCrossDragHover() {
    if (crossDragTimerRef.current !== null) {
      window.clearTimeout(crossDragTimerRef.current)
      crossDragTimerRef.current = null
    }
    if (crossDragHoverIdRef.current !== null) {
      crossDragHoverIdRef.current = null
      setCrossDragHoverId(null)
    }
  }

  function findCrossDragTab(clientX: number, clientY: number) {
    const session = getCrossCanvasDrag()
    if (!session) return null
    for (const canvas of displayCanvasesRef.current) {
      const rect = tabRefs.current.get(canvas.id)?.getBoundingClientRect()
      if (!rect) continue
      const inside = clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom
      if (inside) return canvas.id
    }
    return null
  }

  function armCrossDragHover(canvasId: number) {
    if (crossDragHoverIdRef.current === canvasId) return
    clearCrossDragHover()
    crossDragHoverIdRef.current = canvasId
    setCrossDragHoverId(canvasId)
    crossDragTimerRef.current = window.setTimeout(() => {
      const session = getCrossCanvasDrag()
      if (!session || crossDragHoverIdRef.current !== canvasId || useStore.getState().activeCanvasId === canvasId) return
      setCrossCanvasDragEnteredCanvas(canvasId)
      setActiveCanvas(canvasId)
      clearCrossDragHover()
    }, CROSS_CANVAS_TAB_DWELL_MS)
  }

  function updateCrossDragHover(clientX: number, clientY: number) {
    const canvasId = findCrossDragTab(clientX, clientY)
    if (canvasId === null || canvasId === useStore.getState().activeCanvasId) {
      clearCrossDragHover()
      return
    }
    armCrossDragHover(canvasId)
  }

  async function handleNewTab() {
    const tempId = -Date.now()
    setNewTabId(tempId)
    setTimeout(() => setNewTabId(null), 350)
    try {
      const canvas = await addCanvas("New Canvas")
      setActiveCanvas(canvas.id)
      setRenamingId(canvas.id)
      setSelectRenameText(true)
      setRenameValue("New Canvas")
      setTimeout(() => scrollRef.current?.scrollTo({ left: 0, behavior: "smooth" }), 50)
    } catch (error) {
      console.error(error)
    }
  }

  function startRename(canvas: Canvas) {
    setRenamingId(canvas.id)
    setSelectRenameText(false)
    setRenameValue(canvas.name)
    setContextMenu(null)
  }

  function commitRename() {
    if (renamingId !== null && renameValue.trim()) updateCanvas(renamingId, { name: renameValue.trim() })
    setRenamingId(null)
    setSelectRenameText(false)
  }

  function handleRemove(canvas: Canvas) {
    setContextMenu(null)
    if (canvases.length === 1) return
    setDeleteCanvas(canvas)
  }

  function confirmRemove(options: CanvasDeleteOptions) {
    if (!deleteCanvas) return
    const canvasId = deleteCanvas.id
    setDeleteCanvas(null)
    void removeCanvas(canvasId, options)
  }

  function handleFavourite(canvas: Canvas) {
    setContextMenu(null)
    updateCanvas(canvas.id, { is_favourite: !canvas.is_favourite })
  }

  function animateTabReshuffle(nextCanvases: Canvas[], draggingCanvasId: number) {
    const before = new Map<number, DOMRect>()
    for (const canvas of displayCanvasesRef.current) {
      const rect = tabRefs.current.get(canvas.id)?.getBoundingClientRect()
      if (rect) before.set(canvas.id, rect)
    }

    setPreviewCanvases(nextCanvases)

    requestAnimationFrame(() => {
      for (const canvas of nextCanvases) {
        if (canvas.id === draggingCanvasId) continue
        const el = tabRefs.current.get(canvas.id)
        const previous = before.get(canvas.id)
        if (!el || !previous) continue

        const current = el.getBoundingClientRect()
        const dx = previous.left - current.left
        const dy = previous.top - current.top
        if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue

        el.style.transition = "none"
        el.style.transform = `translate3d(${dx}px, ${dy}px, 0)`
        requestAnimationFrame(() => {
          el.style.transition = "height 0.2s cubic-bezier(0.4,0,0.2,1), opacity 0.15s ease, transform 0.18s cubic-bezier(0.4,0,0.2,1)"
          el.style.transform = "translate3d(0, 0, 0)"
        })
      }
    })
  }

  function keepZoneInsideHysteresis(clientX: number, boundaryX: number, previousIsFavourite: boolean | undefined) {
    if (previousIsFavourite === true && clientX < boundaryX + FAVOURITE_BOUNDARY_HYSTERESIS) return true
    if (previousIsFavourite === false && clientX > boundaryX - FAVOURITE_BOUNDARY_HYSTERESIS) return false
    return clientX <= boundaryX
  }

  function getInsertTarget(clientX: number, draggingCanvasId: number, previousIsFavourite?: boolean): InsertTarget | null {
    const scrollEl = scrollRef.current
    if (!scrollEl) return null

    const remaining = displayCanvasesRef.current.filter((canvas) => canvas.id !== draggingCanvasId)
    const rects = remaining
      .map((canvas) => {
        const rect = tabRefs.current.get(canvas.id)?.getBoundingClientRect()
        return rect ? { canvas, rect } : null
      })
      .filter((item): item is { canvas: Canvas; rect: DOMRect } => item !== null)

    if (rects.length === 0) {
      return { index: 0, isFavourite: true }
    }

    let index = rects.length
    for (let i = 0; i < rects.length; i++) {
      if (clientX < rects[i].rect.left + rects[i].rect.width / 2) {
        index = i
        break
      }
    }

    const favouriteCount = remaining.filter((canvas) => canvas.is_favourite).length
    const favouriteRects = rects.filter(({ canvas }) => canvas.is_favourite)
    const regularRects = rects.filter(({ canvas }) => !canvas.is_favourite)
    const lastFavouriteRect = favouriteRects[favouriteRects.length - 1]?.rect
    const firstRegularRect = regularRects[0]?.rect
    let isFavourite = index < favouriteCount
    if (index > favouriteCount) {
      isFavourite = false
    } else if (index === favouriteCount) {
      if (lastFavouriteRect && firstRegularRect) {
        isFavourite = keepZoneInsideHysteresis(clientX, (lastFavouriteRect.right + firstRegularRect.left) / 2, previousIsFavourite)
      } else if (lastFavouriteRect) {
        isFavourite = keepZoneInsideHysteresis(clientX, lastFavouriteRect.right + 24, previousIsFavourite)
      } else if (firstRegularRect) {
        isFavourite = keepZoneInsideHysteresis(clientX, firstRegularRect.left, previousIsFavourite)
      }
    }
    return { index, isFavourite }
  }

  function buildReorderedCanvases(draggingCanvasId: number, target: InsertTarget) {
    const currentCanvases = displayCanvasesRef.current
    const draggingCanvas = currentCanvases.find((canvas) => canvas.id === draggingCanvasId)
    if (!draggingCanvas) return null

    const ordered = currentCanvases.filter((canvas) => canvas.id !== draggingCanvasId)
    ordered.splice(target.index, 0, { ...draggingCanvas, is_favourite: target.isFavourite })

    let favouriteOrder = 0
    let regularOrder = 0
    return ordered.map((canvas) => {
      const sort_order = canvas.is_favourite ? favouriteOrder++ : regularOrder++
      return { ...canvas, sort_order }
    })
  }

  function getOrderUpdates(ordered: Canvas[]): CanvasOrderUpdate[] {
    return ordered.map(({ id, sort_order, is_favourite }) => ({ id, sort_order, is_favourite }))
  }

  function onTabPointerDown(e: React.PointerEvent<HTMLDivElement>, canvas: Canvas) {
    if (e.button !== 0 || renamingId === canvas.id) return
    // Tab clicks prevent native blur for drag support, so save an active rename before switching.
    if (renamingId !== null) commitRename()
    e.preventDefault()
    dragCleanupRef.current?.()
    const rect = tabRefs.current.get(canvas.id)?.getBoundingClientRect()
    const centerOffsetX = rect ? rect.left + rect.width / 2 - e.clientX : 0
    dragRef.current = { id: canvas.id, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, centerOffsetX, isDragging: false, target: null, preview: null }
    setDragOffset({ x: 0, y: 0 })
    setDragPreview(null)
    setPreviewCanvases(null)

    const onPointerMove = (event: PointerEvent) => updateDrag(event.pointerId, event.clientX, event.clientY, () => event.preventDefault())
    const onPointerUp = (event: PointerEvent) => finishDrag(event.pointerId, canvas)
    const onPointerCancel = (event: PointerEvent) => cancelDrag(event.pointerId)
    window.addEventListener("pointermove", onPointerMove, { passive: false })
    window.addEventListener("pointerup", onPointerUp)
    window.addEventListener("pointercancel", onPointerCancel)
    dragCleanupRef.current = () => {
      window.removeEventListener("pointermove", onPointerMove)
      window.removeEventListener("pointerup", onPointerUp)
      window.removeEventListener("pointercancel", onPointerCancel)
      dragCleanupRef.current = null
    }
  }

  function updateDrag(pointerId: number, clientX: number, clientY: number, preventDefault: () => void) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== pointerId) return

    const dx = clientX - drag.startX
    const dy = clientY - drag.startY
    if (!drag.isDragging && Math.hypot(dx, dy) < DRAG_THRESHOLD) return
    preventDefault()

    if (!drag.isDragging) {
      drag.isDragging = true
      const rect = tabRefs.current.get(drag.id)?.getBoundingClientRect()
      if (rect) setDragPreview({ left: rect.left, top: rect.top, width: rect.width, height: rect.height })
      setContextMenu(null)
      setDraggingId(drag.id)
    }

    const previousIsFavourite = drag.target?.isFavourite ?? displayCanvasesRef.current.find((canvas) => canvas.id === drag.id)?.is_favourite
    const target = getInsertTarget(clientX + drag.centerOffsetX, drag.id, previousIsFavourite)
    drag.target = target
    const preview = target ? buildReorderedCanvases(drag.id, target) : null
    drag.preview = preview
    setDragOffset({ x: dx, y: dy })
    setInsertTarget(target)
    if (preview) animateTabReshuffle(preview, drag.id)
  }

  function finishDrag(pointerId: number, canvas: Canvas) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== pointerId) return

    const wasDragging = drag.isDragging
    const target = drag.target ?? insertTarget
    const preview = drag.preview
    dragCleanupRef.current?.()
    dragRef.current = null
    setDraggingId(null)
    setDragOffset({ x: 0, y: 0 })
    setDragPreview(null)
    setInsertTarget(null)
    setPreviewCanvases(null)

    if (!wasDragging) {
      switchCanvas(canvas.id)
      return
    }

    if (!preview && !target) return
    const ordered = preview ?? (target ? buildReorderedCanvases(drag.id, target) : null)
    if (ordered) reorderCanvases(getOrderUpdates(ordered))
  }

  function cancelDrag(pointerId?: number) {
    const drag = dragRef.current
    if (drag && pointerId !== undefined && drag.pointerId !== pointerId) return
    dragCleanupRef.current?.()
    dragRef.current = null
    setDraggingId(null)
    setDragOffset({ x: 0, y: 0 })
    setDragPreview(null)
    setPreviewCanvases(null)
    setInsertTarget(null)
  }

  const draggingCanvas = draggingId ? displayCanvases.find((canvas) => canvas.id === draggingId) : undefined
  const originalDraggingCanvas = draggingId ? sorted.find((canvas) => canvas.id === draggingId) : undefined
  const dragPreviewFavourite = draggingCanvas ? (insertTarget?.isFavourite ?? draggingCanvas.is_favourite) : false
  const dragSlotW = dragPreviewFavourite ? DRAG_STAR_SLOT_W : 0
  const dragSlotGap = dragPreviewFavourite ? 4 : 0
  const dragPreviewExtraW = dragPreviewFavourite
    ? originalDraggingCanvas?.is_favourite ? DRAG_STAR_SLOT_W + dragSlotGap : DRAG_STAR_SLOT_W * 2 + dragSlotGap * 2
    : 0
  const dragGridColumns = `${dragSlotW}px minmax(max-content, 1fr) ${dragSlotW}px`
  return (
    <>
      <style>{`
        .tabbar-scroll::-webkit-scrollbar { display: none; }
        @keyframes tabSlideIn { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes tabBarSlideDown { from { transform: translateY(-100%); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
        @keyframes tabBarSlideUp { from { transform: translateY(0); opacity: 1; } to { transform: translateY(-100%); opacity: 0; } }
        .tab-new { animation: tabSlideIn 0.2s ease forwards; }
      `}</style>
      <div
        ref={containerRef}
        style={{ position: "fixed", top: 0, left: 0, right: 0, height: BAR_H, zIndex: 40, background: "#ede9fe", animation: `${slidingOut ? "tabBarSlideUp" : "tabBarSlideDown"} 0.18s cubic-bezier(0.4,0,0.2,1) forwards`, overflow: "visible" }}
      >
        {/* SVG outline — single continuous path, auto-measures all [data-tabbar-jut] elements */}
        <TabBarOutline containerRef={containerRef} barH={BAR_H} jutH={JUT_H} shallowH={JUT_H_INACTIVE} />

        {/* Left controls — sidebar button + AI pill, both jut below the bar */}
        <div ref={leftControlsRef} style={{ position: "absolute", top: 0, left: 0, display: "flex", alignItems: "flex-start", gap: 0, zIndex: 2 }}>
          <div
            data-tabbar-jut
            style={{ background: "#ede9fe", border: "none", borderRadius: "0 0 8px 0", display: "flex", alignItems: "center", height: aiExpanded ? JUT_H + 10 : JUT_H, padding: "0 10px", gap: 8, transition: "height 0.25s cubic-bezier(0.4,0,0.2,1)" }}
          >
            <Tooltip label="Sidebar" placement="bottom" align="start">
              <button
                onClick={() => setSidebarOpen(!sidebarOpen)}
                style={{ background: "none", border: "none", cursor: "pointer", width: 24, height: 24, borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center", color: "#1a1a1a", transition: "background 0.15s ease", flexShrink: 0, padding: 0 }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "#ddd6fe")}
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
        </div>

        {/* Tabs scroll area — bounded so it can't overlap left controls or + button */}
        <div ref={scrollRef} className="tabbar-scroll" style={{ position: "absolute", top: 0, left: leftWidth, right: 32, display: "flex", alignItems: "flex-start", overflowX: "auto", justifyContent: "flex-end", gap: 1, zIndex: 2, pointerEvents: "none" }}>
          {displayCanvases.map((canvas, index) => {
            const isActive = canvas.id === activeCanvasId
            const isNew = canvas.id === newTabId
            const isDragging = canvas.id === draggingId
            const isCrossDragHover = canvas.id === crossDragHoverId
            const dragPlaceholderFavourite = isDragging ? dragPreviewFavourite : canvas.is_favourite
            return (
              <Tooltip key={canvas.stableKey ?? canvas.id} label={tabShortcutLabel(index)} placement="bottom" disabled={contextMenu !== null || renamingId === canvas.id || isDragging}>
                <div
                  ref={(el) => {
                    if (el) tabRefs.current.set(canvas.id, el)
                    else tabRefs.current.delete(canvas.id)
                  }}
                  className={isNew ? "tab-new" : undefined}
                  {...(isActive ? { "data-tabbar-jut": "active" } : { "data-tabbar-jut": "inactive" })}
                  onPointerDown={(e) => onTabPointerDown(e, canvas)}
                  onDragOver={(e) => {
                    if (!getCrossCanvasDrag()) return
                    e.preventDefault()
                    moveCrossCanvasDrag(e.clientX, e.clientY)
                  }}
                  onDoubleClick={() => startRename(canvas)}
                  onContextMenu={(e) => { 
                  e.preventDefault()
                  const menuWidth = 160
                  const x = e.clientX + menuWidth > window.innerWidth ? e.clientX - menuWidth : e.clientX
                  setContextMenu({ x, y: e.clientY, canvas })
                }}
                  style={{
                    display: isDragging ? "grid" : "flex",
                    gridTemplateColumns: isDragging ? dragGridColumns : undefined,
                    columnGap: isDragging ? dragSlotGap : undefined,
                    alignItems: "center", gap: isDragging ? undefined : 4, padding: "0 12px",
                    width: isDragging && dragPreview ? dragPreview.width + dragPreviewExtraW : undefined,
                    minWidth: isDragging && dragPreview ? dragPreview.width + dragPreviewExtraW : undefined,
                    boxSizing: "border-box",
                    height: isActive ? JUT_H : JUT_H_INACTIVE,
                    overflow: "hidden",
                    borderRadius: isActive ? "0 0 8px 8px" : "0 0 6px 6px",
                    cursor: "pointer", flexShrink: 0, fontSize: 12,
                    fontWeight: isActive ? 600 : 400,
                    color: isActive ? "#1a1a1a" : "#555",
                    background: isCrossDragHover ? "#ddd6fe" : "#ede9fe",
                    border: "none",
                    boxShadow: isCrossDragHover ? "inset 0 -2px 0 rgba(124,58,237,0.35)" : undefined,
                    position: "relative",
                    transform: "translate3d(0, 0, 0) scale(1)",
                    transition: "height 0.2s cubic-bezier(0.4,0,0.2,1), opacity 0.15s ease, transform 0.18s cubic-bezier(0.4,0,0.2,1), width 0.16s ease, min-width 0.16s ease, grid-template-columns 0.16s ease, column-gap 0.16s ease",
                    userSelect: "none", WebkitUserSelect: "none", opacity: isDragging ? 0.28 : 1,
                    pointerEvents: "auto",
                    touchAction: "none",
                    zIndex: 1,
                  }}
                >
                  <span style={{ position: "absolute", right: 0, top: BAR_H, bottom: 0, width: 1, background: "#ddd6fe", pointerEvents: "none" }} />
                  {renamingId === canvas.id
                    ? <>
                        {canvas.is_favourite && <span style={{ fontSize: 9, color: "#f59e0b" }}>★</span>}
                        <span style={{ position: "relative", display: "inline-flex", alignItems: "center", minWidth: 40 }}>
                          <span aria-hidden style={{ visibility: "hidden", fontSize: 12, fontWeight: 600, whiteSpace: "pre", padding: "0 2px" }}>{renameValue || " "}</span>
                        <input ref={renameRef} value={renameValue} onChange={(e) => setRenameValue(e.target.value)} onBlur={commitRename} onKeyDown={(e) => { if (e.key === "Enter") commitRename(); if (e.key === "Escape") { setRenamingId(null); setSelectRenameText(false) } }} onClick={(e) => e.stopPropagation()} style={{ position: "absolute", inset: 0, border: "none", outline: "none", background: "transparent", fontSize: 12, fontWeight: 600, color: "#1a1a1a", width: "100%" }} />
                        </span>
                      </>
                    : isDragging
                      ? <>
                          <span style={{ fontSize: 9, color: "#f59e0b", opacity: dragPlaceholderFavourite ? 1 : 0, overflow: "hidden", textAlign: "center", transition: "opacity 0.12s ease" }}>★</span>
                          <span style={{ minWidth: 0, overflow: "visible", textAlign: "center", whiteSpace: "nowrap" }}>{canvas.name}</span>
                          <span aria-hidden style={{ width: dragSlotW }} />
                        </>
                      : <>
                          {canvas.is_favourite && <span style={{ fontSize: 9, color: "#f59e0b" }}>★</span>}
                          <span style={{ position: "relative", display: "inline-flex", alignItems: "center", whiteSpace: "nowrap", flexShrink: 0 }}>
                            <span aria-hidden style={{ fontWeight: 600, visibility: "hidden", whiteSpace: "nowrap" }}>{canvas.name}</span>
                            <span style={{ position: "absolute", left: 0, right: 0, textAlign: "center", whiteSpace: "nowrap" }}>{canvas.name}</span>
                          </span>
                        </>
                  }
                </div>
              </Tooltip>
            )
          })}
        </div>

        {draggingCanvas && dragPreview && (
          <div
            style={{
              position: "fixed",
              left: dragPreview.left,
              top: dragPreview.top,
              width: dragPreview.width + dragPreviewExtraW,
              minWidth: dragPreview.width + dragPreviewExtraW,
              height: dragPreview.height,
              display: "grid",
              gridTemplateColumns: dragGridColumns,
              alignItems: "center",
              columnGap: dragSlotGap,
              padding: "0 12px",
              borderRadius: draggingCanvas.id === activeCanvasId ? "0 0 8px 8px" : "0 0 6px 6px",
              fontSize: 12,
              fontWeight: draggingCanvas.id === activeCanvasId ? 600 : 400,
              color: draggingCanvas.id === activeCanvasId ? "#1a1a1a" : "#555",
              background: "#ede9fe",
              boxSizing: "border-box",
              overflow: "hidden",
              pointerEvents: "none",
              userSelect: "none",
              WebkitUserSelect: "none",
              transform: `translate3d(${dragOffset.x}px, ${dragOffset.y}px, 0) scale(1.03)`,
              transition: "width 0.16s ease, min-width 0.16s ease, grid-template-columns 0.16s ease, column-gap 0.16s ease",
              opacity: 0.76,
              boxShadow: "0 10px 24px rgba(88, 28, 135, 0.2)",
              zIndex: 100,
            }}
          >
            <span style={{ fontSize: 9, color: "#f59e0b", opacity: dragPreviewFavourite ? 1 : 0, overflow: "hidden", textAlign: "center", transition: "opacity 0.12s ease" }}>★</span>
            <span style={{ position: "absolute", right: 0, top: BAR_H, bottom: 0, width: 1, background: "#ddd6fe", pointerEvents: "none" }} />
            <span style={{ minWidth: 0, overflow: "visible", textAlign: "center", whiteSpace: "nowrap" }}>{draggingCanvas.name}</span>
            <span aria-hidden style={{ width: dragSlotW }} />
          </div>
        )}

        {/* + button anchored to right edge always */}
        <div style={{ position: "absolute", top: 0, right: 0, zIndex: 2 }}>
          <Tooltip label={newCanvasShortcutLabel()} placement="bottom" align="end">
            <button
              data-tabbar-jut
              onClick={handleNewTab}
              aria-label="New canvas"
              style={{ flexShrink: 0, width: 32, height: JUT_H, borderRadius: "0 0 0 8px", border: "none", background: "#ede9fe", cursor: "pointer", color: "#1a1a1a", display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "auto" }}
              onMouseEnter={(e) => { const s = e.currentTarget.querySelector("span") as HTMLElement; if (s) { s.style.background = "#ddd6fe" } }}
              onMouseLeave={(e) => { const s = e.currentTarget.querySelector("span") as HTMLElement; if (s) s.style.background = "transparent" }}>
              <span style={{ width: 22, height: 22, display: "flex", alignItems: "center", justifyContent: "center", transition: "background 0.15s ease", borderRadius: "50%" }}>
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ pointerEvents: "none" }}>
                  <path d="M6 1v10M1 6h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
              </span>
            </button>
          </Tooltip>
        </div>

        {contextMenu && (
          <div onClick={(e) => e.stopPropagation()} style={{ position: "fixed", top: contextMenu.y, left: contextMenu.x, background: "#fff", border: "1px solid #e0e0e0", borderRadius: 8, boxShadow: "0 4px 16px rgba(0,0,0,0.1)", zIndex: 200, minWidth: 160, padding: 4 }}>
            {[
              { label: contextMenu.canvas.is_favourite ? "Unfavourite" : "★ Favourite", action: () => handleFavourite(contextMenu.canvas) },
              { label: "Rename", action: () => startRename(contextMenu.canvas) },
              { label: "Delete", action: () => handleRemove(contextMenu.canvas), danger: true },
            ].map(({ label, action, danger }) => (
              <div key={label} onClick={action} style={{ padding: "7px 12px", fontSize: 13, cursor: "pointer", borderRadius: 5, color: danger ? "#ef4444" : "#1a1a1a" }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "#f5f5f5")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >{label}</div>
            ))}
          </div>
        )}
        {deleteCanvas && (
            <CanvasDeleteDialog
              canvas={deleteCanvas}
              canvases={canvases}
              onCancel={() => setDeleteCanvas(null)}
              onConfirm={confirmRemove}
            />
        )}
      </div>
    </>
  )
}
