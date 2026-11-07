import { useState, useRef, useEffect, useLayoutEffect } from "react"
import { createPortal } from "react-dom"
import { useStore } from "../store"
import { TagMenu } from "./TagMenu"
import { CloseButton } from "./CloseButton"
import { ThoughtTags } from "./ThoughtTags"
import { useThoughtEdit } from "../hooks/useThoughtEdit"
import { SyncStatusDot } from "./SyncStatusDot"
import { getThoughtControlMetrics, getThoughtSyncMetrics } from "../utils/canvasFontSize"
import type { Thought as ThoughtType } from "../types"

interface Props {
  thought: ThoughtType
  fontSize: number
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
`

export function Thought({ thought, fontSize, onDragStart, onDragMove, onDragOver, onDrop, dragging }: Props) {
  const { highlightedId, removeThought, updateThoughtTags } = useStore()
  const isHighlighted = highlightedId?.type === "thought" && Number(highlightedId.id) === Number(thought.id)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [localTags, setLocalTags] = useState(thought.tags)
  const [syncVisible, setSyncVisible] = useState(false)
  const [tagPopoverOpen, setTagPopoverOpen] = useState(false)
  const [tagsShifted, setTagsShifted] = useState(false)
  useLayoutEffect(() => {
    // Keep the source dots still until the popover has returned to them.
    if (!tagPopoverOpen) setTagsShifted(syncVisible)
  }, [syncVisible, tagPopoverOpen])

  useEffect(() => { setLocalTags(thought.tags) }, [thought.tags])
  const { editing, content, saveEditing, startEditing, setIntent, cancelEditing } = useThoughtEdit(thought)
  const spanRef = useRef<HTMLSpanElement>(null)
  const { controlSize, handleSize, closeIconSize } = getThoughtControlMetrics(fontSize)
  const syncMetrics = getThoughtSyncMetrics(fontSize)

  function remove(e: React.MouseEvent) {
    e.stopPropagation()
    removeThought(thought.id)
  }

  async function onTagUpdate(tags: string[]) {
    setLocalTags(tags)
    await updateThoughtTags(thought.id, tags)
  }

  function removeTag(tag: string) {
    void onTagUpdate(localTags.filter((item) => item !== tag)).catch(console.error)
  }

  return (
    <>
      {isHighlighted && <style>{thoughtAnimationStyles}</style>}
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
          padding: "5px 8px", fontSize, lineHeight: 1.3,
          background: dragging ? "#f5f5f5" : "#fafafa",
          border: "1px solid #ebebeb", borderRadius: 6, cursor: "grab",
          boxSizing: "border-box",
          minHeight: 28,
          flexShrink: 0,
          opacity: dragging ? 0.4 : 1,
          transition: "opacity 0.15s ease, transform 0.12s ease",
          transform: dragging ? "scale(0.98)" : "scale(1)",
          animation: !dragging
            ? isHighlighted
              ? "thoughtHighlight 3s linear forwards"
              : undefined
            : undefined,
        }}
      >
        <span style={{ color: "#ccc", flexShrink: 0, width: controlSize, height: controlSize, fontSize: handleSize, lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>⠿</span>
        <div style={{ flex: 1, minWidth: 0, overflowWrap: "anywhere", wordBreak: "break-word" }}>
          <span
            ref={spanRef}
            contentEditable={editing || undefined}
            suppressContentEditableWarning
            onBlur={(e) => saveEditing(e.currentTarget.textContent ?? "")}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur() }
              if (e.key === "Escape") {
                e.currentTarget.textContent = thought.content
                cancelEditing()
                e.currentTarget.blur()
              }
            }}
            onMouseDown={(e) => { e.stopPropagation(); setIntent(); startEditing(); requestAnimationFrame(() => spanRef.current?.focus()) }}
            style={{ color: "#1a1a1a", outline: "none", cursor: "text", userSelect: "text", fontSize: "inherit", lineHeight: "inherit" }}
          >{content}</span>
        </div>
        <div data-thought-controls style={{ position: "relative", display: "flex", alignItems: "center", gap: localTags.length ? 6 : 0, flexShrink: 0, height: controlSize, paddingLeft: syncMetrics.reserve }}>
          <style>{`@media (prefers-reduced-motion: reduce) { [data-thought-tag-slot] { transition: none !important; } }`}</style>
          <div data-thought-tag-slot style={{ display: "flex", alignItems: "center", transform: tagsShifted ? `translateX(-${syncMetrics.reserve}px)` : "translateX(0)", transition: "transform 220ms cubic-bezier(.2,.8,.2,1)" }}>
            <ThoughtTags tags={localTags} fontSize={fontSize} onRemove={removeTag} onOpenChange={setTagPopoverOpen} />
          </div>
          <span style={{ position: "absolute", right: controlSize + 6, top: "50%", width: syncMetrics.controlSize, height: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <SyncStatusDot entities={[{ entityType: "thought", id: thought.id, clientId: thought.client_id }]} fontSize={fontSize} onVisibilityChange={setSyncVisible} />
          </span>
          <CloseButton onClick={remove} size={controlSize} iconSize={closeIconSize} />
        </div>
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
