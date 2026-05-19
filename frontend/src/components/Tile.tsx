import { useState } from "react"
import { useStore } from "../store"
import { TileHeader } from "./TileHeader"
import { TileContent } from "./TileContent"
import { useTileDrag } from "../hooks/useTileDrag"
import type { Tile as TileType } from "../types"

export function Tile({ tile, scale = 1 }: { tile: TileType; isNew?: boolean; scale?: number }) {
  const { thoughts } = useStore()
  const [editing, setEditing] = useState(false)

  const tileThoughts = thoughts
    .filter((t) => t.tile_id === tile.id)
    .sort((a, b) => a.sort_order - b.sort_order)

  const { onDragDown, onResizeDown } = useTileDrag(tile, scale)

  return (
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
  )
}
