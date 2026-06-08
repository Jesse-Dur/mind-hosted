import { useEffect, useState } from "react"
import { useStore } from "../store"
import { CloseButton } from "./CloseButton"
import { SavingSpinner } from "./SavingSpinner"
import { isTemporaryId } from "../utils/optimisticIdentity"
import type { Tile } from "../types"

export function TileHeader({ tile, onDragDown, editing, setEditing }: { tile: Tile; onDragDown: (e: React.MouseEvent) => void; editing: boolean; setEditing: (v: boolean) => void }) {
  const { updateTile, removeTile } = useStore()
  const [saving, setSaving] = useState(false)
  const [title, setTitle] = useState(tile.title)

  useEffect(() => {
    if (!editing) setTitle(tile.title)
  }, [editing, tile.title])

  function commitTitle(value: string) {
    const nextTitle = value
    setTitle(nextTitle)
    if (nextTitle === tile.title) return

    const save = updateTile(tile.id, { title: nextTitle })
    if (isTemporaryId(tile.id)) return

    setSaving(true)
    const start = Date.now()
    save.finally(() => {
      const elapsed = Date.now() - start
      setTimeout(() => setSaving(false), Math.max(0, 500 - elapsed))
    })
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
            fontSize: 13, fontWeight: 600, color: "#1a1a1a",
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
        {saving && <SavingSpinner />}
        <CloseButton onClick={() => removeTile(tile.id)} size={22} />
      </div>
    </div>
  )
}
