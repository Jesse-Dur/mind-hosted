import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react"
import { useStore } from "../store"
import type { Thought } from "../types"
import { tagPillStyle, tagPopoverSurface, useTagPopoverStyles } from "./tagPopoverStyles"

interface Props {
  thought: Thought
  x: number
  y: number
  onClose: () => void
  onUpdate: (tags: string[]) => void
}

export function TagMenu({ thought, x, y, onClose, onUpdate }: Props) {
  const tags = useStore((state) => state.tags)
  const { mobile, labelSize, itemHeight, removeSize, iconSize, labelPadding, labelGap, panelPadding } = useTagPopoverStyles()
  const menuRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ x, y })

  useLayoutEffect(() => {
    const menu = menuRef.current
    if (!menu) return
    function reposition() {
      const rect = menu!.getBoundingClientRect()
      setPosition({
        x: Math.max(8, Math.min(x, window.innerWidth - rect.width - 8)),
        y: Math.max(8, Math.min(y, window.innerHeight - rect.height - 8)),
      })
    }
    reposition()
    window.addEventListener("resize", reposition)
    return () => window.removeEventListener("resize", reposition)
  }, [x, y, tags, mobile, labelSize])

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
        padding: panelPadding, boxSizing: "border-box", fontFamily: "inherit",
        zIndex: 200, minWidth: mobile ? 200 : 160, width: "max-content", maxWidth: "calc(100vw - 16px)", maxHeight: "min(400px, calc(100dvh - 16px))", overflowY: "auto", overscrollBehavior: "contain",
        animation: "tagMenuIn 120ms ease",
      }} onPointerDown={(event) => event.stopPropagation()} onContextMenu={(event) => { event.preventDefault(); event.stopPropagation() }}>
        <style>{`
          @keyframes tagMenuIn { from { opacity: 0; } to { opacity: 1; } }
          [data-tag-option]:hover { background: var(--tag-hover) !important; }
          [data-tag-option]:focus-visible { outline: 2px solid #a78bfa !important; outline-offset: 2px; }
          @media (prefers-reduced-motion: reduce) { [aria-label="Tag as"] { animation: none !important; } }
        `}</style>
        <p style={{ margin: 0, fontSize: labelSize, lineHeight: 1.3, fontWeight: 600, color: "#777", padding: `2px ${labelPadding}px ${labelGap + 4}px` }}>Tag as</p>
        {tags.length === 0 && <p style={{ margin: 0, fontSize: labelSize, lineHeight: 1.4, color: "#999", padding: `4px ${labelPadding}px` }}>No tags — add in sidebar</p>}
        {tags.map((tag) => {
          const active = thought.tags.includes(tag.name)
          return (
            <button key={tag.id} type="button" data-tag-option aria-pressed={active}
              onClick={(event) => { event.stopPropagation(); toggle(tag.name) }}
              style={{
                ...tagPillStyle(tag.color),
                // Use the same pill treatment as the expanded tags. Selection
                // stays explicit through both the fill and the SVG check.
                "--tag-hover": `${tag.color}22`,
                display: "flex", alignItems: "center", width: "100%", minHeight: itemHeight,
                margin: 0, marginBottom: tag === tags[tags.length - 1] ? 0 : labelGap,
                padding: `0 0 0 ${labelPadding}px`, border: 0, boxSizing: "border-box",
                cursor: "pointer", textAlign: "left", fontFamily: "inherit", fontSize: labelSize,
                fontWeight: 600, lineHeight: 1, background: active ? `${tag.color}22` : "transparent",
              } as CSSProperties}
            >
              <span style={{ flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", paddingRight: labelGap }}>{tag.name}</span>
              <span aria-hidden style={{ width: removeSize, height: itemHeight, flexShrink: 0, display: "grid", placeItems: "center" }}>
                {active && <svg width={iconSize} height={iconSize} viewBox="0 0 12 12" fill="none"><path d="m2 6 2.5 2.5L10 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>}
              </span>
            </button>
          )
        })}
      </div>
    </>
  )
}
