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

  async function onThoughtDrop() {
    if (!orderedIds.length) return
    const ids = [...orderedIds]
    dragThought.current = null
    dragState.thoughtId = null
    dragState.sourceTileId = null
    setDraggingId(null)
    Promise.all(ids.map((id, i) => createApi(getToken).thoughts.reorder(id, i))).catch(console.error)
  }

  async function onTileContentDrop(e: React.DragEvent) {
    e.preventDefault()
    setDropTarget(false)
    const id = dragState.thoughtId
    const srcTile = dragState.sourceTileId
    if (!id || srcTile === tileId) return
    dragState.thoughtId = null
    dragState.sourceTileId = null
    useStore.getState().loadThoughts()
    createApi(getToken).thoughts.move(id, tileId).catch(console.error)
  }

  return { orderedIds, draggingId, dropTarget, setDropTarget, onThoughtDragStart, onThoughtDragOver, onThoughtDrop, onTileContentDrop }
}
