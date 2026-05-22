import { useState, useRef } from "react"
import { useAuth } from "@clerk/clerk-react"
import { useStore } from "../store"
import { createApi } from "../api/client"
import { dragState } from "../utils/dragState"
import type { Thought } from "../types"

export function useTileThoughts(tileId: number, tileThoughts: Thought[]) {
  const [orderedIds, setOrderedIds] = useState<number[]>([])
  const [draggingId, setDraggingId] = useState<number | null>(null)
  const [dropTarget, setDropTarget] = useState(false)
  const dragThought = useRef<number | null>(null)
  const { getToken } = useAuth()

  function onThoughtDragStart(id: number) {
    dragThought.current = id
    dragState.thoughtId = id
    dragState.sourceTileId = tileId
    dragState.clearDragging = () => { setDraggingId(null); setOrderedIds([]); dragState.clearDragging = null }
    setDraggingId(id)
    setOrderedIds(tileThoughts.map((t) => t.id))
  }

  function onThoughtDragOver(overId: number) {
    if (!dragThought.current || dragThought.current === overId) return
    setOrderedIds((ids) => {
      const arr = [...ids]
      const from = arr.indexOf(dragThought.current!)
      const to = arr.indexOf(overId)
      if (from === -1 || to === -1) return ids
      arr.splice(from, 1)
      arr.splice(to, 0, dragThought.current!)
      return arr
    })
  }

  function moveToTile(id: number, destTileId: number) {
    useStore.setState((s) => {
      const maxOrder = Math.max(-1, ...s.thoughts.filter((t) => t.tile_id === destTileId && t.id !== id).map((t) => t.sort_order))
      return {
        thoughts: s.thoughts.map((t) => t.id === id ? { ...t, tile_id: destTileId, sort_order: maxOrder + 1 } : t),
        inFlightMoves: new Set(s.inFlightMoves).add(id),
      }
    })
    createApi(getToken).thoughts.move(id, destTileId)
      .finally(() => {
        useStore.setState((s) => { const m = new Set(s.inFlightMoves); m.delete(id); return { inFlightMoves: m } })
        if (useStore.getState().inFlightMoves.size === 0) useStore.getState().loadThoughts()
      })
  }

  function onThoughtDrop() {
    const srcTile = dragState.sourceTileId
    const id = dragState.thoughtId
    const wasCrossTile = srcTile !== null && srcTile !== tileId
    dragThought.current = null
    dragState.thoughtId = null
    dragState.sourceTileId = null
    setDraggingId(null)
    setOrderedIds([])
    if (wasCrossTile && id) {
      moveToTile(id, tileId)
      return
    }
    if (!orderedIds.length) return
    const ids = [...orderedIds]
    useStore.setState((s) => {
      const notInTile = s.thoughts.filter((t) => t.tile_id !== tileId)
      const inTile = s.thoughts.filter((t) => t.tile_id === tileId)
      const reordered = ids.map((id, i) => ({ ...inTile.find((t) => t.id === id)!, sort_order: i })).filter(Boolean)
      const untouched = inTile.filter((t) => !ids.includes(t.id))
      return { thoughts: [...notInTile, ...reordered, ...untouched] }
    })
    Promise.all(ids.map((id, i) => createApi(getToken).thoughts.reorder(id, i))).catch(console.error)
  }

  async function onTileContentDrop(e: React.DragEvent) {
    e.preventDefault()
    setDropTarget(false)
    const id = dragState.thoughtId
    const srcTile = dragState.sourceTileId
    if (!id || srcTile === tileId || srcTile === null) return
    dragState.thoughtId = null
    dragState.sourceTileId = null
    dragState.clearDragging?.()
    moveToTile(id, tileId)
  }

  return { orderedIds, draggingId, dropTarget, setDropTarget, onThoughtDragStart, onThoughtDragOver, onThoughtDrop, onTileContentDrop }
}
