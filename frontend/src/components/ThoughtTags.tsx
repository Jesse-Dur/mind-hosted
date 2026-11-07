import { useEffect, useId, useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { useStore } from "../store"
import { CloseButton } from "./CloseButton"
import { TagDot } from "./TagPill"
import { tagRowStyle, tagPopoverSurface, useTagPopoverStyles } from "./tagPopoverStyles"
import { TagLabel } from "./TagLabel"
import { getThoughtTagMetrics } from "../utils/canvasFontSize"

type Position = {
  left: number
  top: number
  placement: "above" | "below"
  width: number
  height: number
}

type Offset = {
  x: number
  y: number
  width: number
}

const PANEL_GAP = 7
const EDGE_PADDING = 8
const MOVE_MS = 220
const STAGGER_MS = 35
const CLOSE_DELAY_MS = 120
const REMOVE_MS = 150

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum)
}

export function ThoughtTags({ tags: currentTags, onRemove, expandOnHover = true, onOpenChange, onRestoreFocus, fontSize }: { tags: string[]; onRemove?: (tag: string) => void; expandOnHover?: boolean; onOpenChange?: (open: boolean) => void; onRestoreFocus?: () => void; fontSize?: number }) {
  const preferredFontSize = useStore((state) => state.canvasFontSize)
  const tagFontSize = fontSize ?? preferredFontSize
  const { size: dotSize, width: dotWidth, height: dotHeight, trailingOffset } = getThoughtTagMetrics(tagFontSize)
  const { itemHeight, removeSize, labelSize, labelPadding, labelGap, panelPadding, iconSize, pillGap, listPadding, headingStyle } = useTagPopoverStyles()
  const [removal, setRemoval] = useState<{ tag: string; tags: string[] } | null>(null)
  // Save immediately; only retain the old rows for their exit animation. Leaving
  // the canvas during that animation must not cancel the user's tag removal.
  const tags = removal?.tags ?? currentTags
  const latestTags = useRef(currentTags)
  latestTags.current = currentTags
  const knownTags = useStore((state) => state.tags)
  const anchorRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [exitScroll, setExitScroll] = useState(0)
  const dotRefs = useRef<Array<HTMLDivElement | null>>([])
  const rowRefs = useRef<Array<HTMLDivElement | null>>([])
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const finishTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const removeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [visible, setVisible] = useState(false)
  useLayoutEffect(() => { onOpenChange?.(visible) }, [visible, onOpenChange])
  const [position, setPosition] = useState<Position | null>(null)
  const [offsets, setOffsets] = useState<Record<string, Offset>>({})
  const [closing, setClosing] = useState(false)
  const [settled, setSettled] = useState(false)
  const motionStarted = useRef(false)
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pointerType = useRef("mouse")
  const focusPanel = useRef(false)
  const restoringFocus = useRef(false)
  const pendingFocusIndex = useRef<number | null>(null)
  const panelId = useId()
  const reducedMotion = typeof window !== "undefined" && Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches)
  const [expanded, setExpanded] = useState(false)
  const tagKey = tags.join("\u0000")
  const prepared = position !== null && tags.length > 0 && tags.every((tag) => Object.prototype.hasOwnProperty.call(offsets, tag))
  const motionDuration = reducedMotion ? 0 : MOVE_MS + Math.min(5, Math.max(0, tags.length - 1)) * STAGGER_MS

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
    setClosing(false)
    if (visible) {
      if (exitScroll > 0) setSettled(true)
      setExpanded(true)
      return
    }
    motionStarted.current = false
    setPosition(null)
    setOffsets({})
    setExpanded(false)
    setSettled(false)
    setExitScroll(0)
    setVisible(true)
  }

  function closePanel() {
    if (!visible) return
    clearCloseTimer()
    clearFinishTimer()
    if (settleTimer.current !== null) clearTimeout(settleTimer.current)
    setOffsets(measureOffsets())
    setExitScroll(scrollRef.current?.scrollTop ?? 0)
    setClosing(true)
    setSettled(false)
    setExpanded(false)
    finishTimer.current = setTimeout(() => {
      setVisible(false)
      setPosition(null)
      setOffsets({})
      finishTimer.current = null
    }, motionDuration)
  }

  function scheduleClose() {
    clearCloseTimer()
    closeTimer.current = setTimeout(closePanel, CLOSE_DELAY_MS)
  }

  function remove(tag: string) {
    if (removal !== null) return
    clearCloseTimer()
    setRemoval({ tag, tags })
    onRemove?.(tag)
    removeTimer.current = setTimeout(() => {
      const hadFocus = panelRef.current?.contains(document.activeElement)
      if (hadFocus) {
        pendingFocusIndex.current = Math.min(tags.indexOf(tag), latestTags.current.length - 1)
      }
      setRemoval(null)
      removeTimer.current = null
      if (latestTags.current.length === 0) {
        setVisible(false)
        setPosition(null)
        setOffsets({})
        setExpanded(false)
        if (hadFocus) onRestoreFocus?.()
      }
    }, reducedMotion ? 0 : REMOVE_MS)
  }

  function measureOffsets() {
    return Object.fromEntries(tags.map((tag, index) => {
      const sourceRect = dotRefs.current[index]?.querySelector("[data-tag-dot]")?.getBoundingClientRect()
      const rowRect = rowRefs.current[index]?.getBoundingClientRect()
      return [tag, sourceRect && rowRect ? {
        x: sourceRect.left - rowRect.left,
        y: sourceRect.top - rowRect.top,
        width: rowRect.width,
      } : { x: 0, y: 0, width: dotSize }]
    }))
  }

  useLayoutEffect(() => {
    if (!closing && exitScroll > 0 && scrollRef.current) scrollRef.current.scrollTop = exitScroll
  }, [closing, exitScroll])

  useLayoutEffect(() => {
    // Preferences may update while open. Measure the new natural dimensions
    // before fixing the panel's position and each pill's animation geometry.
    setPosition(null)
  }, [labelSize, itemHeight])

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
      width: panelRect.width,
      height: panelRect.height,
    })
  }, [position, tagKey, visible])

  useLayoutEffect(() => {
    if (!visible || position === null || tags.length === 0) return
    setOffsets(measureOffsets())
    if (pendingFocusIndex.current !== null) {
      rowRefs.current[pendingFocusIndex.current]?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true })
      pendingFocusIndex.current = null
    }
  }, [position, tagKey, visible, dotSize, dotWidth, dotHeight])

  useLayoutEffect(() => {
    if (!prepared || closing || motionStarted.current) return
    // Commit the measured source geometry before enabling transitions. Otherwise
    // the browser coalesces both styles and the dots jump straight to the panel.
    panelRef.current?.querySelectorAll<HTMLElement>("[data-tag-pill]").forEach((pill) => {
      void pill.getBoundingClientRect()
    })
    const frame = requestAnimationFrame(() => {
      motionStarted.current = true
      setExpanded(true)
    })
    return () => cancelAnimationFrame(frame)
  }, [prepared, closing])

  useEffect(() => {
    if (!expanded) return
    if (focusPanel.current) {
      panelRef.current?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true })
      focusPanel.current = false
    }
    settleTimer.current = setTimeout(() => setSettled(true), motionDuration)
    return () => { if (settleTimer.current !== null) clearTimeout(settleTimer.current) }
  }, [expanded, motionDuration])

  useEffect(() => {
    if (!visible) return
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node
      if (anchorRef.current?.contains(target) || panelRef.current?.contains(target)) return
      closePanel()
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return
      if (panelRef.current?.contains(document.activeElement)) {
        restoringFocus.current = true
        anchorRef.current?.focus({ preventScroll: true })
        restoringFocus.current = false
      }
      closePanel()
    }
    document.addEventListener("pointerdown", onPointerDown, true)
    window.addEventListener("keydown", onKeyDown)
    window.addEventListener("resize", closePanel)
    function onScroll(event: Event) {
      if (event.target instanceof Node && panelRef.current?.contains(event.target)) return
      closePanel()
    }
    window.addEventListener("scroll", onScroll, true)
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true)
      window.removeEventListener("keydown", onKeyDown)
      window.removeEventListener("resize", closePanel)
      window.removeEventListener("scroll", onScroll, true)
    }
  }, [visible, tagKey])

  useEffect(() => () => {
    clearCloseTimer()
    clearFinishTimer()
    if (removeTimer.current !== null) clearTimeout(removeTimer.current)
    if (settleTimer.current !== null) clearTimeout(settleTimer.current)
  }, [])

  if (tags.length === 0 && !visible) return null

  return (
    <>
      <style>{`[data-thought-tags-trigger]:focus-visible { outline: 2px solid #a78bfa !important; outline-offset: 2px; border-radius: 4px; }`}</style>
      <div
        ref={anchorRef}
        data-thought-tags-trigger
        role={expandOnHover ? "button" : undefined}
        tabIndex={expandOnHover ? 0 : undefined}
        aria-label={expandOnHover ? "Show thought tags" : tags.join(", ")}
        aria-expanded={expandOnHover ? visible : undefined}
        aria-controls={visible ? panelId : undefined}
        onPointerEnter={(event) => { if (expandOnHover && event.pointerType === "mouse") openPanel() }}
        onPointerLeave={(event) => { if (event.pointerType === "mouse") scheduleClose() }}
        onPointerDown={(event) => { pointerType.current = event.pointerType; event.stopPropagation() }}
        onClick={(event) => event.stopPropagation()}
        onDragStart={(event) => { event.preventDefault(); event.stopPropagation() }}
        onPointerUp={(event) => {
          if (!expandOnHover || event.pointerType === "mouse") return
          event.stopPropagation()
          if (visible && !closing) closePanel()
          else openPanel()
        }}
        onFocus={(event) => {
          if (!restoringFocus.current && expandOnHover && (pointerType.current === "mouse" || event.currentTarget.matches(":focus-visible"))) openPanel()
        }}
        onBlur={scheduleClose}
        onKeyDown={(event) => {
          pointerType.current = "mouse"
          if (expandOnHover && ["Enter", " ", "ArrowDown"].includes(event.key)) {
            event.preventDefault()
            if (expanded) panelRef.current?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true })
            else focusPanel.current = true
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
          height: dotHeight,
          lineHeight: 0,
          marginRight: -trailingOffset,
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
              width: dotWidth,
              height: dotHeight,
              opacity: prepared ? 0 : 1,
            }}
          >
            <TagDot tag={tag} fontSize={tagFontSize} />
          </div>
        ))}
      </div>

      {visible && createPortal(
        <div
          ref={panelRef}
          id={panelId}
          role="group"
          aria-label="Thought tags"
          onPointerEnter={() => { if (closing) openPanel(); else clearCloseTimer() }}
          onPointerLeave={(event) => { if (event.pointerType === "mouse") scheduleClose() }}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          onDragStart={(event) => { event.preventDefault(); event.stopPropagation() }}
          onFocusCapture={clearCloseTimer}
          onBlurCapture={scheduleClose}
          style={{
            position: "fixed",
            left: position?.left ?? 0,
            top: position?.placement === "above" ? undefined : position?.top ?? 0,
            bottom: position?.placement === "above" ? window.innerHeight - position.top - position.height : undefined,
            width: position?.width,
            zIndex: 1000,
            display: "flex",
            flexDirection: "column",
            padding: `${panelPadding + 1}px 1px`,
            minWidth: 160,
            maxWidth: "calc(100vw - 16px)",
            maxHeight: "calc(100dvh - 16px)",
            boxSizing: "border-box",
            borderRadius: 8,
            fontFamily: "inherit",
            visibility: prepared ? "visible" : "hidden",
          }}
        >
          <div
            aria-hidden
            style={{
              position: "absolute",
              inset: 0,
              zIndex: 0,
              ...tagPopoverSurface,
              opacity: expanded ? 1 : 0,
              transform: expanded ? "scale(1)" : "scale(0.96)",
              transformOrigin: position?.placement === "above" ? "bottom right" : "top right",
              transition: reducedMotion ? "none" : "opacity 160ms ease, transform 180ms cubic-bezier(0.2,0.8,0.2,1)",
              transitionDelay: expanded ? "0ms" : `${Math.max(0, motionDuration - 180)}ms`,
              pointerEvents: "none",
            }}
          />
          <p style={{
            ...headingStyle,
            position: "relative",
            zIndex: 1,
            flexShrink: 0,
            opacity: expanded ? 1 : 0,
            transition: reducedMotion ? "none" : "opacity 160ms ease",
            transitionDelay: expanded ? "0ms" : `${Math.max(0, motionDuration - 180)}ms`,
          }}>Tags</p>
          {/* Returning pills must not hover themselves open as they cross the cursor. */}
          <div ref={scrollRef} style={{ pointerEvents: closing ? "none" : undefined, padding: `1px ${listPadding}px`, flexShrink: 1, minHeight: 0, transform: closing && exitScroll > 0 ? `translateY(${-exitScroll}px)` : undefined, maxHeight: `calc(100dvh - ${16 + (panelPadding + 1) * 2}px)`, overflowY: settled ? "auto" : "visible", overscrollBehavior: "contain" }}>
            {tags.map((tag, index) => {
              const color = knownTags.find((item) => item.name === tag)?.color ?? "#888"
              const offset = prepared ? offsets[tag]! : { x: 0, y: 0, width: dotSize }
              const removing = removal?.tag === tag
              const delay = reducedMotion ? 0 : Math.min(5, expanded ? index : tags.length - index - 1) * STAGGER_MS
              return (
                <div
                  key={tag}
                  ref={(element) => { rowRefs.current[index] = element }}
                  style={{
                    position: "relative",
                    zIndex: 1,
                    height: removing ? 0 : itemHeight,
                    width: "max-content",
                    maxWidth: "100%",
                    flexShrink: 0,
                    marginBottom: removing || index === tags.length - 1 ? 0 : pillGap,
                    opacity: removing ? 0 : 1,
                    transform: removing ? "scale(0.9)" : "scale(1)",
                    transition: reducedMotion ? "none" : `height ${REMOVE_MS}ms ease, margin-bottom ${REMOVE_MS}ms ease, opacity ${REMOVE_MS}ms ease, transform ${REMOVE_MS}ms ease`,
                  }}
                >
                  <div aria-hidden style={{ ...tagRowStyle(color), display: "flex", alignItems: "center", gap: labelGap, height: itemHeight, padding: `0 ${labelPadding}px`, fontSize: labelSize, visibility: "hidden" }}>
                    <TagLabel name={tag} color={color} fontSize={labelSize} />
                    {onRemove && <span style={{ width: removeSize, height: removeSize, flexShrink: 0 }} />}
                  </div>
                  <div
                    data-tag-pill={tag}
                    style={{
                      ...tagRowStyle(color),
                      position: "absolute",
                      // Keep return movement and resizing on the same layout
                      // timeline; WebKit can advance 3D transforms separately.
                      left: closing ? offset.x : 0,
                      top: closing ? offset.y : 0,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "flex-start",
                      width: expanded ? offset.width : dotSize,
                      height: expanded ? itemHeight : dotSize,
                      fontSize: labelSize,
                      borderRadius: 99,
                      background: expanded ? `${color}22` : color,
                      outline: expanded ? `1px solid ${color}55` : "1px solid transparent",
                      overflow: "hidden",
                      transform: closing ? "none" : expanded ? "translate3d(0,0,0)" : `translate3d(${offset.x}px,${offset.y}px,0)`,
                      transformOrigin: "left center",
                      transition: reducedMotion || !motionStarted.current ? "none" : `left ${MOVE_MS}ms cubic-bezier(0.2,0.8,0.2,1), top ${MOVE_MS}ms cubic-bezier(0.2,0.8,0.2,1), transform ${MOVE_MS}ms cubic-bezier(0.2,0.8,0.2,1), width ${MOVE_MS}ms cubic-bezier(0.2,0.8,0.2,1), height ${MOVE_MS}ms cubic-bezier(0.2,0.8,0.2,1), background ${MOVE_MS}ms ease, outline-color ${MOVE_MS}ms ease`,
                      transitionDelay: `${delay}ms`,
                    }}
                  >
                    <span style={{ display: "flex", flex: 1, minWidth: 0, paddingLeft: labelPadding, paddingRight: labelGap, opacity: expanded ? 1 : 0, transition: reducedMotion ? "none" : "opacity 110ms ease", transitionDelay: expanded && !reducedMotion ? `${delay + 80}ms` : "0ms" }}>
                      <TagLabel name={tag} color={color} fontSize={labelSize} />
                    </span>
                    {onRemove && <span style={{ flexShrink: 0, paddingRight: labelPadding, opacity: expanded ? 1 : 0, transition: reducedMotion ? "none" : "opacity 100ms ease", transitionDelay: expanded && !reducedMotion ? `${delay + 105}ms` : "0ms" }}>
                      <CloseButton
                        size={removeSize}
                        iconSize={iconSize}
                        ariaLabel={`Remove ${tag} tag`}
                        onClick={(event) => {
                          event.preventDefault()
                          event.stopPropagation()
                          remove(tag)
                        }}
                      />
                    </span>}
                  </div>
                </div>
              )
            })}
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}
