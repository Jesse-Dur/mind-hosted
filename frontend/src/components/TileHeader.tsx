import { useEffect, useState } from "react"
import { useStore } from "../store"
import { CloseButton } from "./CloseButton"
import { SyncStatusDot } from "./SyncStatusDot"
import { DEFAULT_CANVAS_FONT_SIZE } from "../utils/canvasFontSize"
import type { Tile } from "../types"

export function TileHeader({ tile, fontSize, thoughtIdentities, onDragDown, editing, setEditing }: { tile: Tile; fontSize: number; thoughtIdentities?: Array<{ id: number; clientId?: string | null }>; onDragDown: (e: React.MouseEvent) => void; editing: boolean; setEditing: (v: boolean) => void }) {
  const { updateTile, removeTile } = useStore()
  const [title, setTitle] = useState(tile.title)
  const closeScale = fontSize / DEFAULT_CANVAS_FONT_SIZE
  const closeSize = fontSize < DEFAULT_CANVAS_FONT_SIZE
    ? Math.max(14, Math.round(22 * closeScale))
    : Math.max(22, Math.round(fontSize * 1.1))
  const closeIconSize = Math.max(6, Math.round(8 * closeScale))

  useEffect(() => {
    if (!editing) setTitle(tile.title)
  }, [editing, tile.title])

  function commitTitle(value: string) {
    const nextTitle = value
    setTitle(nextTitle)
    if (nextTitle === tile.title) return

    void updateTile(tile.id, { title: nextTitle })
  }

  return (
    <div style={{ display: "flex", alignItems: "center", borderBottom: "1px solid #ebebeb", flexShrink: 0 }}>
      <div
        onMouseDown={(e) => {
          if (editing) (e.currentTarget.querySelector("input") as HTMLInputElement)?.blur()
          if (e.target === e.currentTarget) onDragDown(e)
        }}
        style={{ padding: "8px 10px", cursor: "grab", flex: 1, display: "flex", alignItems: "center", overflow: "hidden", gap: 6 }}
      >
        <span onMouseDown={(e) => { if (editing) (document.activeElement as HTMLElement)?.blur(); onDragDown(e) }} style={{ color: "#ccc", fontSize: 11, flexShrink: 0, cursor: "grab", userSelect: "none" }}>⠿</span>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onFocus={() => setEditing(true)}
          onBlur={(e) => {
            commitTitle(e.currentTarget.value)
            setEditing(false)
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); e.currentTarget.blur() }
            if (e.key === "Escape") { e.currentTarget.blur() }
          }}
          ref={(el) => { if (el) el.addEventListener("scroll", () => { el.scrollLeft = 0 }) }}
          onMouseDown={(e) => e.stopPropagation()}
          style={{
            fontSize, lineHeight: 1.25, fontWeight: 600, color: "#1a1a1a",
            outline: "none", border: "none", background: "transparent",
            padding: 0, fontFamily: "inherit",
            cursor: "text",
            userSelect: editing ? "text" : "none",
            fieldSizing: "content",
            minWidth: 4, maxWidth: "100%",
          } as React.CSSProperties}
        />
      </div>
      <div style={{ marginRight: 6, display: "flex", alignItems: "center", gap: 4 }}>
        <SyncStatusDot entities={[
          { entityType: "tile", id: tile.id, clientId: tile.client_id },
          ...(thoughtIdentities ?? []).map((thought) => ({ entityType: "thought" as const, id: thought.id, clientId: thought.clientId })),
        ]} />
        <CloseButton onClick={() => removeTile(tile.id)} size={closeSize} iconSize={closeIconSize} />
      </div>
    </div>
  )
}
