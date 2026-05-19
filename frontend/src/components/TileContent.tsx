import { useRef } from "react"
import { Thought } from "./Thought"
import { ThoughtInput } from "./ThoughtInput"
import { dragState } from "../utils/dragState"
import { useTileThoughts } from "../hooks/useTileThoughts"
import type { Thought as ThoughtType } from "../types"

export function TileContent({ tileId, tileThoughts }: { tileId: number; tileThoughts: ThoughtType[] }) {
  const thoughtInputRef = useRef<HTMLInputElement>(null)
  const { draggingId, dropTarget, setDropTarget, onThoughtDragStart, onThoughtDragOver, onThoughtDrop, onTileContentDrop } = useTileThoughts(tileId, tileThoughts)

  return (
    <div
      style={{ padding: "6px 10px", flex: 1, overflowY: "auto", userSelect: "text", cursor: "text", background: dropTarget ? "rgba(124,58,237,0.04)" : undefined, transition: "background 0.15s ease" }}
      onClick={(e) => { if (window.getSelection()?.toString()) return; thoughtInputRef.current?.focus() }}
      onDragOver={(e) => { e.preventDefault(); if (dragState.sourceTileId !== tileId) setDropTarget(true) }}
      onDragLeave={() => setDropTarget(false)}
      onDrop={onTileContentDrop}
    >
      {tileThoughts.map((t) => (
        <Thought
          key={t.id}
          thought={t}
          onDragStart={onThoughtDragStart}
          onDragOver={onThoughtDragOver}
          onDrop={onThoughtDrop}
          dragging={draggingId === t.id}
        />
      ))}
      <ThoughtInput tileId={tileId} inputRef={thoughtInputRef} />
    </div>
  )
}
