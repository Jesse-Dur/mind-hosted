import { useStore } from "../store"
import type { Thought } from "../types"

interface Props {
  thought: Thought
  x: number
  y: number
  onClose: () => void
  onUpdate: (tags: string[]) => void
}

export function TagMenu({ thought, x, y, onClose, onUpdate }: Props) {
  const { tags } = useStore()

  function toggle(tagName: string) {
    const next = thought.tags.includes(tagName)
      ? thought.tags.filter((t) => t !== tagName)
      : [...thought.tags, tagName]
    onUpdate(next)
  }

  return (
    <>
      <div onMouseDown={onClose} onContextMenu={(e) => { e.preventDefault(); onClose() }}
        style={{ position: "fixed", inset: 0, zIndex: 199 }} />
      <div style={{
        position: "fixed", left: x, top: y, background: "#fff",
        border: "1px solid #e8e8e8", borderRadius: 8,
        boxShadow: "0 4px 20px rgba(0,0,0,0.1)", padding: "6px 0",
        zIndex: 200, minWidth: 160,
        animation: "tagMenuIn 0.12s cubic-bezier(0.4,0,0.2,1)",
      }}>
        <style>{`@keyframes tagMenuIn { from { opacity:0; transform:scale(0.95) translateY(-4px) } to { opacity:1; transform:scale(1) translateY(0) } }`}</style>
        <p style={{ fontSize: 10, fontWeight: 700, color: "#aaa", letterSpacing: "0.08em", textTransform: "uppercase", padding: "2px 12px 6px" }}>Tag as</p>
        {tags.length === 0 && <p style={{ fontSize: 12, color: "#ccc", padding: "4px 12px" }}>No tags — add in sidebar</p>}
        {tags.map((tag) => {
          const active = thought.tags.includes(tag.name)
          return (
            <div key={tag.id} onMouseDown={(e) => { e.stopPropagation(); toggle(tag.name) }}
              style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 12px", cursor: "pointer", fontSize: 13, background: active ? tag.color + "11" : "transparent", transition: "background 0.1s ease" }}
              onMouseEnter={(e) => { if (!active) (e.currentTarget as HTMLDivElement).style.background = "#f5f5f5" }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = active ? tag.color + "11" : "transparent" }}
            >
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: tag.color, flexShrink: 0 }} />
              <span style={{ flex: 1, color: "#333" }}>{tag.name}</span>
              {active && <span style={{ fontSize: 10, color: tag.color }}>✓</span>}
            </div>
          )
        })}
      </div>
    </>
  )
}
