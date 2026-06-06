import { type CSSProperties, type ReactNode, useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"

type TooltipPlacement = "top" | "bottom"
type TooltipAlign = "start" | "center" | "end"

type TooltipPosition = {
  top: number
  left: number
  ready: boolean
}

type TooltipProps = {
  label: string
  children: ReactNode
  placement?: TooltipPlacement
  align?: TooltipAlign
  disabled?: boolean
  triggerStyle?: CSSProperties
}

const GAP = 8
const EDGE_PADDING = 8
const SHOW_DELAY_MS = 500
const FADE_OUT_MS = 160

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

export function Tooltip({ label, children, placement = "bottom", align = "center", disabled = false, triggerStyle }: TooltipProps) {
  const id = useId()
  const triggerRef = useRef<HTMLSpanElement>(null)
  const tooltipRef = useRef<HTMLSpanElement>(null)
  const showTimerRef = useRef<number | null>(null)
  const hideTimerRef = useRef<number | null>(null)
  const [visible, setVisible] = useState(false)
  const [position, setPosition] = useState<TooltipPosition | null>(null)

  const clearShowTimer = useCallback(() => {
    if (showTimerRef.current === null) return
    window.clearTimeout(showTimerRef.current)
    showTimerRef.current = null
  }, [])

  const clearHideTimer = useCallback(() => {
    if (hideTimerRef.current === null) return
    window.clearTimeout(hideTimerRef.current)
    hideTimerRef.current = null
  }, [])

  const updatePosition = useCallback((ready = true) => {
    const trigger = triggerRef.current
    if (!trigger) return

    const triggerRect = trigger.getBoundingClientRect()
    const tooltipRect = tooltipRef.current?.getBoundingClientRect()
    const tooltipWidth = tooltipRect?.width ?? 0
    const tooltipHeight = tooltipRect?.height ?? 0
    const maxLeft = Math.max(EDGE_PADDING, window.innerWidth - tooltipWidth - EDGE_PADDING)
    const maxTop = Math.max(EDGE_PADDING, window.innerHeight - tooltipHeight - EDGE_PADDING)
    const top = placement === "bottom"
      ? triggerRect.bottom + GAP
      : triggerRect.top - tooltipHeight - GAP

    let left = triggerRect.left + triggerRect.width / 2 - tooltipWidth / 2
    if (align === "start") left = triggerRect.left
    if (align === "end") left = triggerRect.right - tooltipWidth

    setPosition({
      top: clamp(top, EDGE_PADDING, maxTop),
      left: clamp(left, EDGE_PADDING, maxLeft),
      ready,
    })
  }, [align, placement])

  const updateReadyPosition = useCallback(() => {
    updatePosition()
  }, [updatePosition])

  useEffect(() => {
    if (!visible || disabled) return
    updatePosition()
    window.addEventListener("resize", updateReadyPosition)
    window.addEventListener("scroll", updateReadyPosition, true)
    return () => {
      window.removeEventListener("resize", updateReadyPosition)
      window.removeEventListener("scroll", updateReadyPosition, true)
    }
  }, [disabled, updatePosition, updateReadyPosition, visible])

  useLayoutEffect(() => {
    if (!visible || disabled) return
    updatePosition(false)
  }, [disabled, label, updatePosition, visible])

  useEffect(() => {
    if (!disabled) return
    clearShowTimer()
    setPosition((current) => current ? { ...current, ready: false } : current)
    clearHideTimer()
    hideTimerRef.current = window.setTimeout(() => {
      setVisible(false)
      setPosition(null)
      hideTimerRef.current = null
    }, FADE_OUT_MS)
  }, [clearHideTimer, clearShowTimer, disabled])

  useEffect(() => () => {
    clearShowTimer()
    clearHideTimer()
  }, [clearHideTimer, clearShowTimer])

  const showNow = () => {
    if (disabled) return
    clearShowTimer()
    clearHideTimer()
    updatePosition(false)
    setVisible(true)
  }

  const scheduleShow = () => {
    if (disabled || visible) return
    clearShowTimer()
    showTimerRef.current = window.setTimeout(showNow, SHOW_DELAY_MS)
  }

  const hide = () => {
    clearShowTimer()
    setPosition((current) => current ? { ...current, ready: false } : current)
    clearHideTimer()
    hideTimerRef.current = window.setTimeout(() => {
      setVisible(false)
      setPosition(null)
      hideTimerRef.current = null
    }, FADE_OUT_MS)
  }

  return (
    <span
      ref={triggerRef}
      aria-describedby={visible ? id : undefined}
      onFocus={showNow}
      onBlur={hide}
      onPointerEnter={scheduleShow}
      onPointerMove={scheduleShow}
      onPointerLeave={hide}
      style={{ display: "inline-flex", ...triggerStyle }}
    >
      {children}
      {visible && position && createPortal(
        <span
          ref={tooltipRef}
          id={id}
          role="tooltip"
          style={{
            position: "fixed",
            top: position.top,
            left: position.left,
            zIndex: 1000,
            maxWidth: 260,
            padding: "6px 9px",
            borderRadius: 6,
            border: "1px solid #e0e0e0",
            background: "#fff",
            color: "#1a1a1a",
            boxShadow: "0 4px 16px rgba(0,0,0,0.1)",
            fontSize: 11,
            fontWeight: 600,
            lineHeight: 1.25,
            letterSpacing: 0,
            whiteSpace: "nowrap",
            pointerEvents: "none",
            opacity: position.ready ? 1 : 0,
            transition: "opacity 0.16s ease",
          }}
        >
          {label}
        </span>,
        document.body,
      )}
    </span>
  )
}
