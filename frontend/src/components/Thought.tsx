import { useState } from "react"
import { createPortal } from "react-dom"
import { useAuth } from "@clerk/clerk-react"
import { createApi } from "../api/client"
import { useStore } from "../store"
import { TagMenu } from "./TagMenu"
import { CloseButton } from "./CloseButton"
import { SavingSpinner } from "./SavingSpinner"
import { ThoughtTags } from "./ThoughtTags"
import { useThoughtEdit } from "../hooks/useThoughtEdit"
import type { Thought as ThoughtType } from "../types"

interface Props {
  thought: ThoughtType
  itemRef: (el: HTMLDivElement | null) => void
  offset: number
  dragging: boolean
  onDragHandleMouseDown: (e: React.MouseEvent) => void
}

export function Thought({ thought, itemRef, offset, dragging, onDragHandleMouseDown }: Props) {
  const { newThoughtIds } = useStore()
  const { getToken } = useAuth()
  const isNew = newThoughtIds.has(thought.id)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [localTags, setLocalTags] = useState(thought.tags)
  const { editing, saving, content, saveEditing, startEditing, cancelEditing } = useThoughtEdit(thought)

  function remove(e: React.MouseEvent) {
    e.stopPropagation()
    useStore.setState((s) => ({ thoughts: s.thoughts.filter((t) => t.id !== thought.id) }))
    createApi(getToken).thoughts.remove(thought.id).catch(console.error)
  }

  async function onTagUpdate(tags: string[]) {
    setLocalTags(tags)
    await createApi(getToken).thoughts.updateTags(thought.id, tags)
  }

  return (
    <>
      <style>{`@keyframes thoughtIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }`}</style>
      <div
        ref={itemRef}
        draggable={false}
        onMouseDown={(e) => {
          if ((e.target as HTMLElement).closest("[contenteditable]")) return
          if ((e.target as HTMLElement).closest("button")) return
          onDragHandleMouseDown(e)
        }}
        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setMenu({ x: e.clientX, y: e.clientY }) }}
        onClick={(e) => e.stopPropagation()}
        style={{
          display: "flex", alignItems: "center", gap: 6,
          padding: "5px 8px", marginBottom: 2, fontSize: 13,
          background: dragging ? "#f0f0f0" : "#fafafa",
          border: "1px solid #ebebeb", borderRadius: 6,
          opacity: dragging ? 0.5 : 1,
          transform: `translateY(${offset}px)`,
          transition: dragging ? "opacity 0.1s ease" : "transform 0.15s ease, opacity 0.1s ease",
          position: "relative",
          zIndex: dragging ? 10 : 1,
          animation: isNew ? "thoughtIn 0.4s cubic-bezier(0.4,0,0.2,1)" : undefined,
        }}
      >
        <span
          onMouseDown={onDragHandleMouseDown}
          style={{ color: "#ccc", flexShrink: 0, fontSize: 11, cursor: "grab", padding: "2px 0" }}
        >⠿</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <span
            contentEditable
            suppressContentEditableWarning
            onFocus={startEditing}
            onBlur={(e) => saveEditing(e.currentTarget.textContent ?? "")}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur() }
              if (e.key === "Escape") { e.currentTarget.blur(); cancelEditing() }
            }}
            onMouseDown={(e) => { if (e.buttons === 1 && window.getSelection()?.toString()) return; e.stopPropagation() }}
            style={{ color: "#1a1a1a", outline: "none", cursor: "text", userSelect: "text", fontSize: 13 }}
          >{content}</span>
        </div>
        <ThoughtTags tags={localTags} />
        {saving && <SavingSpinner />}
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
