import { useState, useRef } from "react"
import { useAuth } from "@clerk/clerk-react"
import { useStore } from "../store"
import { createApi } from "../api/client"
import { dragState } from "../utils/dragState"
import type { Thought } from "../types"

export function useTileThoughts(tileId: number, tileThoughts: Thought[]) {
  const [draggingId, setDraggingId] = useState<number | null>(null)
  const [dropTarget, setDropTarget] = useState(false)
  const [currentIndex, setCurrentIndex] = useState<number | null>(null)
  const originIndex = useRef<number | null>(null)
  const orderedIds = useRef<number[]>([])
  const itemRefs = useRef<(HTMLDivElement | null)[]>([])
  const { getToken } = useAuth()

  function getMidpoints() {
    return itemRefs.current.map((el) => {
      if (!el) return 0
      const rect = el.getBoundingClientRect()
      return rect.top + rect.height / 2
    })
  }

  function getIndexFromY(clientY: number, excludeIndex: number): number {
    const midpoints = getMidpoints().filter((_, i) => i !== excludeIndex)
    let idx = midpoints.findIndex((mid) => clientY < mid)
    if (idx === -1) idx = midpoints.length
    // adjust for the excluded (dragging) item
    if (excludeIndex !== null && idx >= excludeIndex) idx++
    return Math.max(0, Math.min(idx, orderedIds.current.length - 1))
  }

  function onDragHandleMouseDown(id: number, e: React.MouseEvent) {
    if ((e.target as HTMLElement).closest("[contenteditable]")) return
    e.preventDefault()
    e.stopPropagation()

    const ids = tileThoughts.map((t) => t.id)
    orderedIds.current = ids
    const oIdx = ids.indexOf(id)
    originIndex.current = oIdx
    dragState.thoughtId = id
    dragState.sourceTileId = tileId
    setDraggingId(id)
    setCurrentIndex(oIdx)

    function onMouseMove(e: MouseEvent) {
      if (originIndex.current === null) return
      const idx = getIndexFromY(e.clientY, originIndex.current)
      setCurrentIndex(idx)
    }

    function onMouseUp() {
      window.removeEventListener("mousemove", onMouseMove)
      window.removeEventListener("mouseup", onMouseUp)

      const oIdx = originIndex.current
      setCurrentIndex((ci) => {
        if (oIdx !== null && ci !== null && ci !== oIdx) {
          const ids = [...orderedIds.current]
          ids.splice(oIdx, 1)
          ids.splice(ci, 0, id)
          orderedIds.current = ids
          useStore.setState((s) => ({
            thoughts: [
              ...s.thoughts.filter((t) => t.tile_id !== tileId),
              ...ids.map((rid, i) => ({ ...s.thoughts.find((t) => t.id === rid)!, sort_order: i })),
            ],
          }))
          Promise.all(ids.map((rid, i) => createApi(getToken).thoughts.reorder(rid, i))).catch(console.error)
        }
        return null
      })

      originIndex.current = null
      dragState.thoughtId = null
      dragState.sourceTileId = null
      setDraggingId(null)
    }

    window.addEventListener("mousemove", onMouseMove)
    window.addEventListener("mouseup", onMouseUp)
  }

  function getOffset(index: number, id: number): number {
    if (draggingId === null || originIndex.current === null || currentIndex === null) return 0
    if (id === draggingId) return 0 // dragging thought is absolutely positioned, no offset needed

    const from = originIndex.current
    const to = currentIndex

    // get height of the dragging thought to shift others by its actual size
    const dragEl = itemRefs.current[from]
    const dragHeight = dragEl ? dragEl.getBoundingClientRect().height + 2 : 34 // 2 = marginBottom

    if (from < to) {
      // dragging down — thoughts between from+1 and to shift up
      if (index > from && index <= to) return -dragHeight
    } else if (from > to) {
      // dragging up — thoughts between to and from-1 shift down
      if (index >= to && index < from) return dragHeight
    }
    return 0
  }

  async function onTileContentDrop(e: React.DragEvent) {
    e.preventDefault()
    setDropTarget(false)
    const id = dragState.thoughtId
    const srcTile = dragState.sourceTileId
    if (!id || srcTile === tileId) return
    dragState.thoughtId = null
    dragState.sourceTileId = null
    useStore.setState((s) => ({ thoughts: s.thoughts.map((t) => t.id === id ? { ...t, tile_id: tileId } : t) }))
    createApi(getToken).thoughts.move(id, tileId).catch(console.error)
  }

  return { itemRefs, draggingId, currentIndex, originIndex, dropTarget, setDropTarget, onDragHandleMouseDown, getOffset, onTileContentDrop }
}
