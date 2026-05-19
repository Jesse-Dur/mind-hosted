import { useState, useRef } from "react"
import { useStore } from "../store"

export function TagDot({ tag }: { tag: string }) {
  const { tags } = useStore()
  const [hovered, setHovered] = useState(false)
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const match = tags.find((t) => t.name === tag)
  const color = match?.color ?? "#888"

  function onEnter() {
    if (leaveTimer.current) clearTimeout(leaveTimer.current)
    setHovered(true)
  }

  function onLeave() {
    leaveTimer.current = setTimeout(() => setHovered(false), 300)
  }

  return (
    <div
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        cursor: "default",
        height: 18,
        width: hovered ? "auto" : 12,
        minWidth: 12,
      }}
    >
      <div style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        height: 18,
        width: hovered ? "auto" : 18,
        minWidth: 18,
        borderRadius: 99,
        background: hovered ? color + "22" : color,
        outline: hovered ? `1px solid ${color}55` : "none",
        overflow: "hidden",
        transformOrigin: "right center",
        transform: hovered ? "scale(1)" : "scale(0.44)",
        transition: "transform 0.22s cubic-bezier(0.4,0,0.2,1), background 0.18s ease, outline 0.18s ease",
      }}>
        <span style={{
          fontSize: 10,
          color,
          fontWeight: 500,
          whiteSpace: "nowrap",
          padding: "0 6px",
          lineHeight: 1,
          opacity: hovered ? 1 : 0,
          transition: "opacity 0.12s ease",
          pointerEvents: "none",
        }}>
          {tag}
        </span>
      </div>
    </div>
  )
}
