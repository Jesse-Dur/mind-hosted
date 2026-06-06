import { useRef } from "react"
import { useStore } from "../store"
import { Thought } from "./Thought"
import { ThoughtInput } from "./ThoughtInput"
import { dragState } from "../utils/dragState"
import { setThoughtDragTargetTile } from "../utils/crossCanvasDrag"
import { useTileThoughts } from "../hooks/useTileThoughts"
import type { Thought as ThoughtType } from "../types"

export function TileContent({ tileId, tileThoughts }: { tileId: number; tileThoughts: ThoughtType[] }) {
  const thoughtInputRef = useRef<HTMLInputElement>(null)
  const {
    orderedIds,
    draggingId,
    dropTarget,
    hiddenThoughtId,
    previewThought,
    setDropTarget,
    onThoughtDragStart,
    onThoughtDragMove,
    onThoughtDragOver,
    onThoughtDrop,
    onTileContentDragOver,
    onTileContentDrop,
  } = useTileThoughts(tileId, tileThoughts)
  const { thoughtStableKeys } = useStore()

  const thoughtById = new Map(tileThoughts.map((thought) => [thought.id, thought]))
  if (previewThought) thoughtById.set(previewThought.id, previewThought)
  const displayed = orderedIds.length
    ? [
        ...orderedIds.map((id) => thoughtById.get(id)).filter((thought): thought is ThoughtType => Boolean(thought)),
        ...tileThoughts.filter((t) => !orderedIds.includes(t.id)),
      ]
    : tileThoughts
  const visibleThoughts = hiddenThoughtId === null
    ? displayed
    : displayed.filter((thought) => thought.id !== hiddenThoughtId)

  return (
    <div
      style={{ padding: "6px 10px", flex: 1, overflowY: "auto", userSelect: "text", cursor: "text", background: dropTarget ? "rgba(124,58,237,0.04)" : undefined, transition: "background 0.15s ease", display: "flex", flexDirection: "column", gap: 2 }}
      onClick={() => { if (window.getSelection()?.toString()) return; thoughtInputRef.current?.focus() }}
      onDragOver={(e) => {
        e.preventDefault()
        if (dragState.thoughtId === null) return
        onTileContentDragOver()
        if (dragState.sourceTileId !== tileId) setDropTarget(true)
      }}
      onDragLeave={(e) => {
        setDropTarget(false)
        if (dragState.thoughtId === null) return
        const rect = e.currentTarget.getBoundingClientRect()
        const outside = e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom
        if (outside) setThoughtDragTargetTile(null)
      }}
      onDrop={onTileContentDrop}
    >
      {visibleThoughts.map((t) => (
        <Thought
          key={thoughtStableKeys.get(t.id) ?? t.id}
          thought={t}
          onDragStart={onThoughtDragStart}
          onDragMove={onThoughtDragMove}
          onDragOver={onThoughtDragOver}
          onDrop={onThoughtDrop}
          dragging={draggingId === t.id}
        />
      ))}
      <ThoughtInput tileId={tileId} inputRef={thoughtInputRef} />
    </div>
  )
}
