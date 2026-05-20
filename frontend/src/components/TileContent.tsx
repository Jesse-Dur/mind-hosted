import { useRef } from "react"
import { Thought } from "./Thought"
import { ThoughtInput } from "./ThoughtInput"
import { dragState } from "../utils/dragState"
import { useTileThoughts } from "../hooks/useTileThoughts"
import type { Thought as ThoughtType } from "../types"

export function TileContent({ tileId, tileThoughts }: { tileId: number; tileThoughts: ThoughtType[] }) {
  const thoughtInputRef = useRef<HTMLInputElement>(null)
  const { itemRefs, draggingId, dropTarget, setDropTarget, onDragHandleMouseDown, getOffset, onTileContentDrop } = useTileThoughts(tileId, tileThoughts)

  return (
    <div
      style={{ padding: "6px 10px", flex: 1, overflowY: "auto", userSelect: "text", cursor: "text", background: dropTarget ? "rgba(124,58,237,0.04)" : undefined, transition: "background 0.15s ease" }}
      onClick={(e) => { if (window.getSelection()?.toString()) return; thoughtInputRef.current?.focus() }}
      onDragOver={(e) => { e.preventDefault(); if (dragState.sourceTileId !== tileId) setDropTarget(true) }}
      onDragLeave={() => setDropTarget(false)}
      onDrop={onTileContentDrop}
    >
      {tileThoughts.map((t, i) => (
        <Thought
          key={t.id}
          thought={t}
          itemRef={(el) => { itemRefs.current[i] = el }}
          offset={getOffset(i, t.id)}
          dragging={draggingId === t.id}
          onDragHandleMouseDown={(e) => onDragHandleMouseDown(t.id, e)}
        />
      ))}
      <ThoughtInput tileId={tileId} inputRef={thoughtInputRef} />
    </div>
  )
}
