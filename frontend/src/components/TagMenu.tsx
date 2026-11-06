import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { useStore } from "../store"
import type { Thought } from "../types"
import { tagRowStyle, tagPopoverSurface, useTagPopoverStyles } from "./tagPopoverStyles"
import { TagLabel } from "./TagLabel"

interface Props {
  thought: Thought
  x: number
  y: number
  onClose: () => void
  onUpdate: (tags: string[]) => void
}

export function TagMenu({ thought, x, y, onClose, onUpdate }: Props) {
  const tags = useStore((state) => state.tags)
  const { labelSize, labelPadding, labelGap, panelPadding, headingSize, headingStyle } = useTagPopoverStyles()
  const menuRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ x, y })

  useLayoutEffect(() => {
    const menu = menuRef.current
    if (!menu) return
    function reposition() {
      // Computed dimensions ignore the opening transform and retain fractions.
      const style = getComputedStyle(menu!)
      const width = Math.ceil(parseFloat(style.width))
      const height = Math.ceil(parseFloat(style.height))
      setPosition({
        x: Math.max(10, Math.min(x, window.innerWidth - width - 10)),
        y: Math.max(10, Math.min(y, window.innerHeight - height - 10)),
      })
    }
    reposition()
    window.addEventListener("resize", reposition)
    return () => window.removeEventListener("resize", reposition)
  }, [x, y, tags, labelSize])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [onClose])

  function toggle(tagName: string) {
    const next = thought.tags.includes(tagName)
      ? thought.tags.filter((t) => t !== tagName)
      : [...thought.tags, tagName]
    onUpdate(next)
  }

  return (
    <>
      <div onPointerDown={(event) => { event.stopPropagation(); onClose() }} onContextMenu={(event) => { event.preventDefault(); event.stopPropagation() }}
        style={{ position: "fixed", inset: 0, zIndex: 199 }} />
      <div ref={menuRef} role="group" aria-label="Tag as" style={{
        ...tagPopoverSurface,
        position: "fixed", left: position.x, top: position.y,
        padding: `${panelPadding}px 0`, boxSizing: "border-box", fontFamily: "inherit",
        zIndex: 200, minWidth: 160, width: "max-content", maxWidth: "calc(100vw - 20px)", maxHeight: "min(300px, calc(100dvh - 20px))", overflowY: "auto", overscrollBehavior: "contain",
        animation: "tagMenuIn 0.12s cubic-bezier(0.4,0,0.2,1)",
      }} onPointerDown={(event) => event.stopPropagation()} onContextMenu={(event) => { event.preventDefault(); event.stopPropagation() }}>
        <style>{`
          @keyframes tagMenuIn { from { opacity:0; transform:scale(0.95) translateY(-4px) } to { opacity:1; transform:scale(1) translateY(0) } }
          [data-tag-option][aria-pressed="false"]:hover { background: #f5f5f5 !important; }
          [data-tag-option]:focus-visible { outline: 2px solid #a78bfa !important; outline-offset: 2px; }
          @media (prefers-reduced-motion: reduce) { [aria-label="Tag as"] { animation: none !important; } }
        `}</style>
        <p style={headingStyle}>Tag as</p>
        {tags.length === 0 && <p style={{ margin: 0, fontSize: labelSize, color: "#ccc", padding: `${panelPadding}px ${labelPadding}px` }}>No tags — add in sidebar</p>}
        {tags.map((tag) => {
          const active = thought.tags.includes(tag.name)
          return (
            <button key={tag.id} type="button" data-tag-option aria-pressed={active}
              onClick={(event) => { event.stopPropagation(); toggle(tag.name) }}
              style={{
                ...tagRowStyle(tag.color, active),
                display: "flex", alignItems: "center", gap: labelGap, width: "100%",
                margin: 0, borderRadius: 0,
                padding: `${panelPadding}px ${labelPadding}px`, border: 0, boxSizing: "border-box",
                cursor: "pointer", textAlign: "left", fontFamily: "inherit", fontSize: labelSize,
                transition: "background 0.1s ease",
              }}
            >
              <TagLabel name={tag.name} color={tag.color} fontSize={labelSize} />
              {active && <span aria-hidden style={{ fontSize: headingSize, color: tag.color }}>✓</span>}
            </button>
          )
        })}
      </div>
    </>
  )
}
