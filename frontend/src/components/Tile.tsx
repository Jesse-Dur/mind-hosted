import { useEffect, useState } from "react"
import { useStore } from "../store"
import { TileHeader } from "./TileHeader"
import { TileContent } from "./TileContent"
import { useTileDrag } from "../hooks/useTileDrag"
import { getCrossCanvasDrag, subscribeCrossCanvasDrag } from "../utils/crossCanvasDrag"
import type { Thought, Tile as TileType } from "../types"

const tileAnimationStyles = `
@keyframes tileHighlight {
  0% { box-shadow: inset 0 0 0 9999px rgba(124,58,237,0); }
  15% { box-shadow: inset 0 0 0 9999px rgba(124,58,237,0.03), 0 0 0 2px rgba(124,58,237,0.4); }
  50% { box-shadow: inset 0 0 0 9999px rgba(124,58,237,0.03), 0 0 0 2px rgba(124,58,237,0.5); }
  80% { box-shadow: inset 0 0 0 9999px rgba(124,58,237,0.03), 0 0 0 2px rgba(124,58,237,0.4); }
  100% { box-shadow: inset 0 0 0 9999px rgba(124,58,237,0); }
}
@keyframes remoteTileUpdate {
  0% { background: rgba(239,246,255,0.98); border-color: #60a5fa; box-shadow: 0 0 0 2px rgba(59,130,246,0.28), 0 12px 28px rgba(59,130,246,0.14); }
  60% { background: rgba(239,246,255,0.98); border-color: #93c5fd; box-shadow: 0 0 0 2px rgba(59,130,246,0.18), 0 8px 18px rgba(59,130,246,0.10); }
  100% { background: rgba(255,255,255,0.95); border-color: #e0e0e0; box-shadow: 0 0 0 0 rgba(59,130,246,0); }
}
`

export function Tile({ tile, thoughts, scale = 1 }: { tile: TileType; thoughts: Thought[]; scale?: number }) {
  const { highlightedId, remoteChangedTileIds } = useStore()
  const [editing, setEditing] = useState(false)
  const isHighlighted = highlightedId?.type === "tile" && Number(highlightedId.id) === Number(tile.id)
  const isRemoteChanged = remoteChangedTileIds.has(tile.id)
  const [isDragging, setIsDragging] = useState(() => {
    const session = getCrossCanvasDrag()
    return session?.kind === "tile" && session.tile.id === tile.id
  })

  useEffect(() => subscribeCrossCanvasDrag((session) => {
    setIsDragging(session?.kind === "tile" && session.tile.id === tile.id)
  }), [tile.id])

  const tileThoughts = thoughts
    .filter((t) => t.tile_id === tile.id)
    .sort((a, b) => a.sort_order - b.sort_order)

  const { onDragDown, onResizeDown } = useTileDrag(tile, tileThoughts, scale)

  return (
    <>
      {(isHighlighted || isRemoteChanged) && <style>{tileAnimationStyles}</style>}
      <div
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          position: "absolute",
          left: tile.x, top: tile.y, width: tile.width, height: tile.height,
          background: "rgba(255,255,255,0.95)",
          border: "1px solid #e0e0e0",
          borderRadius: 8,
          display: "flex",
          flexDirection: "column",
          backdropFilter: "blur(8px)",
          userSelect: "none",
          opacity: isDragging ? 0.72 : 1,
          boxShadow: isDragging ? "0 14px 32px rgba(0,0,0,0.16)" : undefined,
          transition: "opacity 0.15s ease, box-shadow 0.15s ease",
          animation: !isDragging
            ? isHighlighted
              ? "tileHighlight 3s linear forwards"
              : isRemoteChanged
                ? "remoteTileUpdate 850ms ease-out forwards"
                : undefined
            : undefined,
          pointerEvents: "auto",
          zIndex: isDragging ? 20 : undefined,
        }}
      >
        <TileHeader tile={tile} onDragDown={onDragDown} editing={editing} setEditing={setEditing} />
        <TileContent tileId={tile.id} tileThoughts={tileThoughts} />
        <div
          onMouseDown={onResizeDown}
          style={{ position: "absolute", bottom: 0, right: 0, width: 16, height: 16, cursor: "nwse-resize", display: "flex", alignItems: "center", justifyContent: "center" }}
        >
          <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
            <path d="M7 1L1 7M7 4L4 7" stroke="#ccc" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        </div>
      </div>
    </>
  )
}
