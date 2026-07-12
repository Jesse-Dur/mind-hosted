import { useEffect, useState } from "react"
import { useStore } from "../store"
import type { BillingLimitFeature, BillingLimitNotice } from "../types"

const AUTO_DISMISS_MS = 6000
const FADE_OUT_MS = 240
const HOUR_MS = 60 * 60 * 1000

function formatResetWindow(resetAt: BillingLimitNotice["resetAt"]) {
  if (!resetAt) return null
  const remainingMs = new Date(resetAt).getTime() - Date.now()
  if (!Number.isFinite(remainingMs)) return null
  const totalHours = Math.max(0, Math.ceil(remainingMs / HOUR_MS))
  const days = Math.floor(totalHours / 24)
  const hours = totalHours % 24
  return `${days}d ${hours}h`
}

function limitCopy(feature: BillingLimitFeature) {
  switch (feature) {
    case "canvases":
      return "At limit, delete a canvas before creating more or consider upgrading."
    case "tiles":
      return "At limit, delete tiles before creating more or consider upgrading."
    case "thoughts":
      return "At limit, delete thoughts before creating more or consider upgrading."
    case "ai_processing_requests":
      return "AI requests are at limit. Try again later, or consider upgrading."
    case "transcription_seconds":
      return "Transcription is at limit. Try again later, or consider upgrading."
    case "storage":
      return "Storage is at limit. Free up space before continuing or consider upgrading."
  }
}

const ACTION_BUTTON_STYLE = {
  width: 102,
  height: 32,
  borderRadius: 6,
  border: "1px solid #e5e5e5",
  background: "#f5f5f5",
  color: "#1a1a1a",
  fontSize: 11,
  fontWeight: 700,
  cursor: "pointer",
  padding: "0 9px",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
  flexShrink: 0,
  transition: "background 0.15s ease, border-color 0.15s ease",
} as const

function CloseIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true" focusable="false">
      <path d="M2 2L10 10M10 2L2 10" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  )
}

export function CreationLimitNotice({ tabsVisible }: { tabsVisible: boolean }) {
  const notice = useStore((state) => state.billingCreationLimitNotice)
  const dismissNotice = useStore((state) => state.dismissBillingCreationLimitNotice)
  const [isAutoDismissing, setIsAutoDismissing] = useState(false)
  const resetWindow = formatResetWindow(notice?.resetAt)

  useEffect(() => {
    if (!notice) return
    setIsAutoDismissing(false)
    // Keep the banner mounted briefly after timeout so the fade-out can play.
    const fadeTimer = window.setTimeout(() => {
      setIsAutoDismissing(true)
    }, AUTO_DISMISS_MS)
    const dismissTimer = window.setTimeout(() => {
      dismissNotice()
      setIsAutoDismissing(false)
    }, AUTO_DISMISS_MS + FADE_OUT_MS)
    return () => {
      window.clearTimeout(fadeTimer)
      window.clearTimeout(dismissTimer)
      setIsAutoDismissing(false)
    }
  }, [dismissNotice, notice?.shownAt])

  if (!notice) return null

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "fixed",
        top: tabsVisible ? 72 : 48,
        left: "50%",
        transform: isAutoDismissing ? "translateX(-50%) translateY(-4px)" : "translateX(-50%)",
        opacity: isAutoDismissing ? 0 : 1,
        zIndex: 66,
        width: "min(560px, calc(100vw - 32px))",
        padding: "10px 12px",
        borderRadius: 10,
        border: "1px solid rgba(196, 181, 253, 0.9)",
        background: "linear-gradient(180deg, #ffffff 0%, #fbfaff 100%)",
        color: "#4c1d95",
        boxShadow: "0 4px 14px rgba(124, 58, 237, 0.14)",
        display: "flex",
        alignItems: "center",
        gap: 10,
        transition: "opacity 0.24s ease, transform 0.24s ease",
        pointerEvents: isAutoDismissing ? "none" : "auto",
      }}
    >
      <div style={{ minWidth: 0, flex: 1, display: "flex", flexDirection: "column", gap: 2 }}>
        <div style={{ fontSize: 12.5, fontWeight: 700, lineHeight: 1.35, color: "#1a1a1a" }}>
          {limitCopy(notice.feature)}
        </div>
        {resetWindow ? (
          <div style={{ fontSize: 11, fontWeight: 600, lineHeight: 1.2, color: "#6b7280" }}>
            Resets in {resetWindow}
          </div>
        ) : null}
      </div>
      <button
        type="button"
        onClick={() => {
          dismissNotice()
          // The app already watches the `#plans` hash, so reusing it opens the existing plans modal.
          window.location.hash = "plans"
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "#ebebeb"
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "#f5f5f5"
        }}
        style={ACTION_BUTTON_STYLE}
      >
        View Plans
      </button>
      <button
        type="button"
        onClick={() => dismissNotice()}
        aria-label="Dismiss creation limit notice"
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "#ebebeb"
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "#f5f5f5"
        }}
        style={ACTION_BUTTON_STYLE}
      >
        <CloseIcon />
        <span>Dismiss</span>
      </button>
    </div>
  )
}
