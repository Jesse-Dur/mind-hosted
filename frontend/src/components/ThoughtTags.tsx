import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { useStore } from "../store"
import { CloseButton } from "./CloseButton"
import { TagDot } from "./TagPill"

type Position = {
  left: number
  top: number
  placement: "above" | "below"
}

type Offset = {
  x: number
  y: number
  width: number
}

const PANEL_GAP = 7
const ITEM_HEIGHT = 22
const EDGE_PADDING = 8
const MOVE_MS = 220
const STAGGER_MS = 35
const CLOSE_DELAY_MS = 120
const REMOVE_MS = 150

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum)
}

export function ThoughtTags({ tags, onRemove }: { tags: string[]; onRemove: (tag: string) => void }) {
  const knownTags = useStore((state) => state.tags)
  const anchorRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const dotRefs = useRef<Array<HTMLDivElement | null>>([])
  const rowRefs = useRef<Array<HTMLDivElement | null>>([])
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const finishTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const removeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [visible, setVisible] = useState(false)
  const [position, setPosition] = useState<Position | null>(null)
  const [offsets, setOffsets] = useState<Offset[]>([])
  const [expanded, setExpanded] = useState(false)
  const [removingTag, setRemovingTag] = useState<string | null>(null)
  const tagKey = tags.join("\u0000")
  const prepared = position !== null && offsets.length === tags.length && tags.length > 0
  const motionDuration = MOVE_MS + Math.max(0, tags.length - 1) * STAGGER_MS

  function clearCloseTimer() {
    if (closeTimer.current === null) return
    clearTimeout(closeTimer.current)
    closeTimer.current = null
  }

  function clearFinishTimer() {
    if (finishTimer.current === null) return
    clearTimeout(finishTimer.current)
    finishTimer.current = null
  }

  function openPanel() {
    if (tags.length === 0) return
    clearCloseTimer()
    clearFinishTimer()
    if (visible) {
      setExpanded(true)
      return
    }
    setPosition(null)
    setOffsets([])
    setExpanded(false)
    setVisible(true)
  }

  function closePanel() {
    if (!visible) return
    clearCloseTimer()
    clearFinishTimer()
    setExpanded(false)
    finishTimer.current = setTimeout(() => {
      setVisible(false)
      setPosition(null)
      setOffsets([])
      finishTimer.current = null
    }, motionDuration)
  }

  function scheduleClose() {
    clearCloseTimer()
    closeTimer.current = setTimeout(closePanel, CLOSE_DELAY_MS)
  }

  function remove(tag: string) {
    if (removingTag !== null) return
    setRemovingTag(tag)
    removeTimer.current = setTimeout(() => {
      onRemove(tag)
      setRemovingTag(null)
      removeTimer.current = null
      if (tags.length === 1) {
        setVisible(false)
        setPosition(null)
        setOffsets([])
        setExpanded(false)
      }
    }, REMOVE_MS)
  }

  useLayoutEffect(() => {
    if (!visible || position !== null) return
    const anchor = anchorRef.current
    const panel = panelRef.current
    if (!anchor || !panel) return

    const anchorRect = anchor.getBoundingClientRect()
    const panelRect = panel.getBoundingClientRect()
    const roomBelow = window.innerHeight - anchorRect.bottom
    const roomAbove = anchorRect.top
    const placement = roomBelow >= panelRect.height + PANEL_GAP || roomBelow >= roomAbove ? "below" : "above"
    const idealTop = placement === "below"
      ? anchorRect.bottom + PANEL_GAP
      : anchorRect.top - panelRect.height - PANEL_GAP
    const maximumLeft = Math.max(EDGE_PADDING, window.innerWidth - panelRect.width - EDGE_PADDING)
    const maximumTop = Math.max(EDGE_PADDING, window.innerHeight - panelRect.height - EDGE_PADDING)

    setPosition({
      left: clamp(anchorRect.right - panelRect.width, EDGE_PADDING, maximumLeft),
      top: clamp(idealTop, EDGE_PADDING, maximumTop),
      placement,
    })
  }, [position, tagKey, visible])

  useLayoutEffect(() => {
    if (!visible || position === null || tags.length === 0) return
    const nextOffsets = tags.map((_, index) => {
      const sourceRect = dotRefs.current[index]?.getBoundingClientRect()
      const rowRect = rowRefs.current[index]?.getBoundingClientRect()
      if (!sourceRect || !rowRect) return { x: 0, y: 0, width: 12 }
      return {
        x: sourceRect.left + 2 - rowRect.left,
        y: sourceRect.top + 5 - rowRect.top,
        width: rowRect.width,
      }
    })
    setOffsets(nextOffsets)
    const frame = requestAnimationFrame(() => setExpanded(true))
    return () => cancelAnimationFrame(frame)
  }, [position, tagKey, visible])

  useEffect(() => {
    if (!visible) return
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node
      if (anchorRef.current?.contains(target) || panelRef.current?.contains(target)) return
      closePanel()
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") closePanel()
    }
    document.addEventListener("pointerdown", onPointerDown, true)
    window.addEventListener("keydown", onKeyDown)
    window.addEventListener("resize", closePanel)
    window.addEventListener("scroll", closePanel, true)
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true)
      window.removeEventListener("keydown", onKeyDown)
      window.removeEventListener("resize", closePanel)
      window.removeEventListener("scroll", closePanel, true)
    }
  }, [visible, tagKey])

  useEffect(() => () => {
    clearCloseTimer()
    clearFinishTimer()
    if (removeTimer.current !== null) clearTimeout(removeTimer.current)
  }, [])

  if (tags.length === 0 && !visible) return null

  return (
    <>
      <style>{`@keyframes tagIn { from { opacity: 0; transform: scale(0.7); } to { opacity: 1; transform: scale(1); } }`}</style>
      <div
        ref={anchorRef}
        role="button"
        tabIndex={0}
        aria-label="Show thought tags"
        aria-expanded={visible}
        onPointerEnter={openPanel}
        onPointerLeave={scheduleClose}
        onPointerUp={(event) => {
          if (event.pointerType === "mouse") return
          if (visible) closePanel()
          else openPanel()
        }}
        onFocus={openPanel}
        onBlur={scheduleClose}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault()
            openPanel()
          }
          if (event.key === "Escape") closePanel()
        }}
        style={{
          display: "flex",
          gap: 0,
          alignItems: "center",
          alignSelf: "center",
          flexShrink: 0,
          height: 18,
          lineHeight: 0,
          marginRight: -4,
          cursor: "default",
          outline: "none",
        }}
      >
        {tags.map((tag, index) => (
          <div
            key={tag}
            ref={(element) => { dotRefs.current[index] = element }}
            style={{
              display: "flex",
              alignItems: "center",
              width: 12,
              height: 18,
              opacity: prepared ? 0 : 1,
              animation: prepared ? undefined : "tagIn 0.15s cubic-bezier(0.4,0,0.2,1)",
            }}
          >
            <TagDot tag={tag} />
          </div>
        ))}
      </div>

      {visible && createPortal(
        <div
          ref={panelRef}
          onPointerEnter={clearCloseTimer}
          onPointerLeave={scheduleClose}
          onPointerDown={(event) => event.stopPropagation()}
          onFocusCapture={clearCloseTimer}
          onBlurCapture={scheduleClose}
          style={{
            position: "fixed",
            left: position?.left ?? 0,
            top: position?.top ?? 0,
            zIndex: 1000,
            display: "flex",
            flexDirection: "column",
            gap: 4,
            padding: 8,
            visibility: prepared ? "visible" : "hidden",
          }}
        >
          <div
            aria-hidden
            style={{
              position: "absolute",
              inset: 0,
              zIndex: 0,
              border: "1px solid #e3e3e3",
              borderRadius: 9,
              background: "rgba(255,255,255,0.98)",
              boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
              backdropFilter: "blur(10px)",
              opacity: expanded ? 1 : 0,
              transform: expanded ? "scale(1)" : "scale(0.96)",
              transformOrigin: position?.placement === "above" ? "bottom right" : "top right",
              transition: "opacity 160ms ease, transform 180ms cubic-bezier(0.2,0.8,0.2,1)",
              transitionDelay: expanded ? "0ms" : `${Math.max(0, motionDuration - 180)}ms`,
              pointerEvents: "none",
            }}
          />
          {tags.map((tag, index) => {
            const color = knownTags.find((item) => item.name === tag)?.color ?? "#888"
            const offset = offsets[index] ?? { x: 0, y: 0, width: 8 }
            const removing = removingTag === tag
            const delay = expanded ? index * STAGGER_MS : (tags.length - index - 1) * STAGGER_MS
            return (
              <div
                key={tag}
                ref={(element) => { rowRefs.current[index] = element }}
                style={{
                  position: "relative",
                  zIndex: 1,
                  height: removing ? 0 : ITEM_HEIGHT,
                  width: "max-content",
                  opacity: removing ? 0 : 1,
                  transform: removing ? "scale(0.9)" : "scale(1)",
                  transition: `height ${REMOVE_MS}ms ease, opacity ${REMOVE_MS}ms ease, transform ${REMOVE_MS}ms ease`,
                }}
              >
                <div aria-hidden style={{ display: "flex", alignItems: "center", height: ITEM_HEIGHT, paddingLeft: 7, visibility: "hidden" }}>
                  <span style={{ fontSize: 10, fontWeight: 600, whiteSpace: "nowrap", paddingRight: 4 }}>{tag}</span>
                  <span style={{ width: 14, height: 14 }} />
                </div>
                <div
                  style={{
                    position: "absolute",
                    left: 0,
                    top: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "flex-start",
                    width: expanded ? offset.width : 8,
                    height: expanded ? ITEM_HEIGHT : 8,
                    borderRadius: 99,
                    background: expanded ? `${color}22` : color,
                    outline: expanded ? `1px solid ${color}55` : "1px solid transparent",
                    overflow: "hidden",
                    transform: expanded ? "translate3d(0,0,0)" : `translate3d(${offset.x}px,${offset.y}px,0)`,
                    transformOrigin: "left center",
                    transition: `transform ${MOVE_MS}ms cubic-bezier(0.2,0.8,0.2,1), width ${MOVE_MS}ms cubic-bezier(0.2,0.8,0.2,1), height ${MOVE_MS}ms cubic-bezier(0.2,0.8,0.2,1), background ${MOVE_MS}ms ease, outline-color ${MOVE_MS}ms ease`,
                    transitionDelay: `${delay}ms`,
                  }}
                >
                  <span style={{ color, fontSize: 10, fontWeight: 600, lineHeight: 1, whiteSpace: "nowrap", paddingLeft: 7, paddingRight: 4, opacity: expanded ? 1 : 0, transition: "opacity 110ms ease", transitionDelay: expanded ? `${delay + 80}ms` : "0ms" }}>
                    {tag}
                  </span>
                  <span style={{ opacity: expanded ? 1 : 0, transition: "opacity 100ms ease", transitionDelay: expanded ? `${delay + 105}ms` : "0ms" }}>
                    <CloseButton
                      size={14}
                      iconSize={6}
                      ariaLabel={`Remove ${tag} tag`}
                      onClick={(event) => {
                        event.preventDefault()
                        event.stopPropagation()
                        remove(tag)
                      }}
                    />
                  </span>
                </div>
              </div>
            )
          })}
        </div>,
        document.body,
      )}
    </>
  )
}
