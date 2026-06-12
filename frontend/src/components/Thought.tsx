import { useState, useRef, useEffect } from "react"
import { createPortal } from "react-dom"
import { useStore } from "../store"
import { TagMenu } from "./TagMenu"
import { CloseButton } from "./CloseButton"
import { ThoughtTags } from "./ThoughtTags"
import { useThoughtEdit } from "../hooks/useThoughtEdit"
import type { Thought as ThoughtType } from "../types"

interface Props {
  thought: ThoughtType
  onDragStart: (id: number, point: { clientX: number; clientY: number }) => void
  onDragMove: (clientX: number, clientY: number) => void
  onDragOver: (id: number, placement: "before" | "after") => void
  onDrop: () => void
  dragging: boolean
}

const thoughtAnimationStyles = `
@keyframes thoughtHighlight {
  0% { box-shadow: inset 0 0 0 9999px rgba(124,58,237,0); }
  15% { box-shadow: inset 0 0 0 9999px rgba(124,58,237,0.03), 0 0 0 2px rgba(124,58,237,0.4); }
  50% { box-shadow: inset 0 0 0 9999px rgba(124,58,237,0.03), 0 0 0 2px rgba(124,58,237,0.5); }
  80% { box-shadow: inset 0 0 0 9999px rgba(124,58,237,0.03), 0 0 0 2px rgba(124,58,237,0.4); }
  100% { box-shadow: inset 0 0 0 9999px rgba(124,58,237,0); }
}
@keyframes remoteThoughtUpdate {
  0% { background: #eff6ff; border-color: #60a5fa; box-shadow: 0 0 0 2px rgba(59,130,246,0.24); }
  60% { background: #f8fbff; border-color: #bfdbfe; box-shadow: 0 0 0 2px rgba(59,130,246,0.12); }
  100% { background: #fafafa; border-color: #ebebeb; box-shadow: 0 0 0 0 rgba(59,130,246,0); }
}
`

export function Thought({ thought, onDragStart, onDragMove, onDragOver, onDrop, dragging }: Props) {
  const { highlightedId, remoteChangedThoughtIds, removeThought, updateThoughtTags } = useStore()
  const isHighlighted = highlightedId?.type === "thought" && Number(highlightedId.id) === Number(thought.id)
  const isRemoteChanged = remoteChangedThoughtIds.has(thought.id)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [localTags, setLocalTags] = useState(thought.tags)

  useEffect(() => { setLocalTags(thought.tags) }, [thought.tags])
  const { editing, content, saveEditing, startEditing, setIntent, cancelEditing } = useThoughtEdit(thought)
  const spanRef = useRef<HTMLSpanElement>(null)

  function remove(e: React.MouseEvent) {
    e.stopPropagation()
    removeThought(thought.id)
  }

  async function onTagUpdate(tags: string[]) {
    setLocalTags(tags)
    await updateThoughtTags(thought.id, tags)
  }

  return (
    <>
      {(isHighlighted || isRemoteChanged) && <style>{thoughtAnimationStyles}</style>}
      <div
        draggable={!editing}
        onDragStart={(e) => {
          if (editing) return
          e.dataTransfer.effectAllowed = "move"
          onDragStart(thought.id, { clientX: e.clientX, clientY: e.clientY })
        }}
        onDrag={(e) => {
          if (e.clientX === 0 && e.clientY === 0) return
          onDragMove(e.clientX, e.clientY)
        }}
        onDragEnd={onDrop}
        onDragOver={(e) => {
          e.preventDefault()
          e.stopPropagation()
          const rect = e.currentTarget.getBoundingClientRect()
          onDragOver(thought.id, e.clientY < rect.top + rect.height / 2 ? "before" : "after")
        }}
        onDrop={(e) => {
          e.preventDefault()
          e.stopPropagation()
          onDrop()
        }}
        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setMenu({ x: e.clientX, y: e.clientY }) }}
        onClick={(e) => e.stopPropagation()}
        style={{
          display: "flex", alignItems: "center", gap: 6,
          padding: "5px 8px", fontSize: 13,
          background: dragging ? "#f5f5f5" : "#fafafa",
          border: "1px solid #ebebeb", borderRadius: 6, cursor: "grab",
          boxSizing: "border-box",
          minHeight: 28,
          opacity: dragging ? 0.4 : 1,
          transition: "opacity 0.15s ease, transform 0.12s ease",
          transform: dragging ? "scale(0.98)" : "scale(1)",
          animation: !dragging
            ? isHighlighted
              ? "thoughtHighlight 3s linear forwards"
              : isRemoteChanged
                ? "remoteThoughtUpdate 850ms ease-out forwards"
                : undefined
            : undefined,
        }}
      >
        <span style={{ color: "#ccc", flexShrink: 0, fontSize: 11 }}>⠿</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <span
            ref={spanRef}
            contentEditable={editing || undefined}
            suppressContentEditableWarning
            onBlur={(e) => saveEditing(e.currentTarget.textContent ?? "")}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur() }
              if (e.key === "Escape") { e.currentTarget.blur(); cancelEditing() }
            }}
            onMouseDown={(e) => { e.stopPropagation(); setIntent(); startEditing(); requestAnimationFrame(() => spanRef.current?.focus()) }}
            style={{ color: "#1a1a1a", outline: "none", cursor: "text", userSelect: "text", fontSize: 13 }}
          >{content}</span>
        </div>
        <ThoughtTags tags={localTags} />
        <CloseButton onClick={remove} size={18} />
      </div>

      {menu && createPortal(
        <TagMenu
          thought={{ ...thought, tags: localTags }}
          x={menu.x} y={menu.y}
          onClose={() => setMenu(null)}
          onUpdate={onTagUpdate}
        />,
        document.body
      )}
    </>
  )
}
