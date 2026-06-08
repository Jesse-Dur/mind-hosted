import { useEffect, useRef, useState } from "react"
import { useStore } from "../store"
import { dragState } from "../utils/dragState"
import {
  beginCrossCanvasDrag,
  endCrossCanvasDrag,
  getCrossCanvasDrag,
  moveCrossCanvasDrag,
  setThoughtDragTargetTile,
  subscribeCrossCanvasDrag,
} from "../utils/crossCanvasDrag"
import type { Thought } from "../types"

type ThoughtPlacement = "before" | "after"
type InsertTarget = { overId: number | null; placement: ThoughtPlacement }

function sameIds(a: number[], b: number[]) {
  return a.length === b.length && a.every((id, index) => id === b[index])
}

function hiddenThoughtIdForTile(tileId: number) {
  const session = getCrossCanvasDrag()
  return session?.kind === "thought" && session.sourceTileId === tileId && session.targetTileId !== tileId
    ? session.thought.id
    : null
}

export function useTileThoughts(tileId: number, tileThoughts: Thought[]) {
  const [orderedIds, setOrderedIds] = useState<number[]>([])
  const [draggingId, setDraggingId] = useState<number | null>(null)
  const [dropTarget, setDropTarget] = useState(false)
  const [hiddenThoughtId, setHiddenThoughtId] = useState<number | null>(() => hiddenThoughtIdForTile(tileId))
  const [previewThought, setPreviewThought] = useState<Thought | null>(() => {
    const session = getCrossCanvasDrag()
    return session?.kind === "thought" && session.targetTileId === tileId ? session.thought : null
  })
  const dragThought = useRef<number | null>(null)
  const nativeDragCleanup = useRef<(() => void) | null>(null)
  const moveThoughtToTile = useStore((s) => s.moveThoughtToTile)

  function clearPreview() {
    setDraggingId(null)
    setOrderedIds([])
    setDropTarget(false)
    setPreviewThought(null)
  }

  useEffect(() => subscribeCrossCanvasDrag((session) => {
    const nextHiddenThoughtId = hiddenThoughtIdForTile(tileId)
    setHiddenThoughtId((current) => current === nextHiddenThoughtId ? current : nextHiddenThoughtId)

    if (session?.kind === "thought" && session.targetTileId === tileId) return
    clearPreview()
  }), [tileId])

  function clearNativeDragFallback() {
    nativeDragCleanup.current?.()
    nativeDragCleanup.current = null
  }

  function clearDragSession() {
    const clearDragging = dragState.clearDragging
    dragThought.current = null
    dragState.thoughtId = null
    dragState.sourceTileId = null
    dragState.sourceCanvasId = null
    dragState.clearDragging = null
    clearDragging?.()
    clearNativeDragFallback()
    clearPreview()
    endCrossCanvasDrag()
  }

  function registerNativeDragFallback(id: number) {
    clearNativeDragFallback()
    const finish = () => {
      clearNativeDragFallback()
      if (dragState.thoughtId !== id) return
      clearDragSession()
    }
    window.addEventListener("dragend", finish, { once: true })
    window.addEventListener("drop", finish, { once: true })
    nativeDragCleanup.current = () => {
      window.removeEventListener("dragend", finish)
      window.removeEventListener("drop", finish)
    }
  }

  function onThoughtDragStart(id: number, point: { clientX: number; clientY: number }) {
    const sourceCanvasId = useStore.getState().activeCanvasId
    const thought = tileThoughts.find((item) => item.id === id)
    dragThought.current = id
    dragState.thoughtId = id
    dragState.sourceTileId = tileId
    dragState.sourceCanvasId = sourceCanvasId
    dragState.clearDragging = () => {
      setDraggingId(null)
      setOrderedIds([])
      setDropTarget(false)
      dragState.clearDragging = null
    }
    setDraggingId(id)
    setOrderedIds(tileThoughts.map((t) => t.id))
    registerNativeDragFallback(id)
    if (thought) {
      beginCrossCanvasDrag({
        kind: "thought",
        thought,
        sourceTileId: tileId,
        sourceCanvasId,
        targetTileId: tileId,
        clientX: point.clientX,
        clientY: point.clientY,
        enteredCanvasId: null,
      })
    }
  }

  function buildPreviewIds(currentIds: number[], id: number, insert: InsertTarget) {
    if (insert.overId === id) return currentIds.length > 0 ? currentIds : tileThoughts.map((thought) => thought.id)

    const base = (currentIds.length > 0 ? currentIds : tileThoughts.map((thought) => thought.id))
      .filter((thoughtId) => thoughtId !== id)
    const next = [...base]
    const overIndex = insert.overId === null ? -1 : next.indexOf(insert.overId)
    const insertIndex = overIndex === -1
      ? next.length
      : insert.placement === "before" ? overIndex : overIndex + 1
    next.splice(insertIndex, 0, id)
    return next
  }

  function activatePreview(insert: InsertTarget) {
    const id = dragState.thoughtId
    const session = getCrossCanvasDrag()
    if (!id || session?.kind !== "thought") return

    setThoughtDragTargetTile(tileId)
    setPreviewThought((current) => current?.id === session.thought.id ? current : session.thought)
    setDraggingId((current) => current === id ? current : id)
    setDropTarget(dragState.sourceTileId !== tileId)
    setOrderedIds((currentIds) => {
      const nextIds = buildPreviewIds(currentIds, id, insert)
      return sameIds(currentIds, nextIds) ? currentIds : nextIds
    })
  }

  function finalOrderedIds(id: number) {
    const ids = orderedIds.length > 0
      ? orderedIds
      : [...tileThoughts.map((thought) => thought.id).filter((thoughtId) => thoughtId !== id), id]
    return ids.includes(id) ? ids : [...ids, id]
  }

  function commitPlacement() {
    const srcTile = dragState.sourceTileId
    const id = dragState.thoughtId
    const sourceCanvasId = dragState.sourceCanvasId
    if (!id) {
      clearDragSession()
      return
    }

    const ids = finalOrderedIds(id)
    const currentIds = tileThoughts.map((thought) => thought.id)
    const changedOrder = !sameIds(ids, currentIds)
    clearDragSession()
    if (srcTile !== tileId || changedOrder) {
      void moveThoughtToTile(id, tileId, {
        sourceCanvasId,
        targetCanvasId: useStore.getState().activeCanvasId,
        orderedIds: ids,
      })
    }
  }

  function onThoughtDragOver(overId: number, placement: ThoughtPlacement) {
    activatePreview({ overId, placement })
  }

  function onTileContentDragOver() {
    activatePreview({ overId: null, placement: "after" })
  }

  function onThoughtDrop() {
    commitPlacement()
  }

  async function onTileContentDrop(e: React.DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    commitPlacement()
  }

  return {
    orderedIds,
    draggingId,
    dropTarget,
    hiddenThoughtId,
    previewThought,
    setDropTarget,
    onThoughtDragStart,
    onThoughtDragOver,
    onThoughtDrop,
    onTileContentDragOver,
    onTileContentDrop,
    onThoughtDragMove: moveCrossCanvasDrag,
  }
}
