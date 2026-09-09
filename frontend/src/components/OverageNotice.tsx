import { useEffect, useRef } from "react"
import { useStore } from "../store"
import { BillingOverageModal } from "./BillingOverageModal"
import { startBillingWarmupOnPlans } from "../startup/workspaceStartup"

const DISMISS_DELAY_MS = 10000

export function OverageNotice({ tabsVisible }: { tabsVisible: boolean }) {
  const usage = useStore((state) => state.billingUsage)
  const openOverageModal = useStore((state) => state.openBillingOverageModal)
  const closeOverageModal = useStore((state) => state.closeBillingOverageModal)
  const setDismissState = useStore((state) => state.setBillingOverageDismissState)
  const modalOpen = useStore((state) => state.billingOverageModalOpen)
  const dismissReady = useStore((state) => state.billingOverageDismissReady)
  const dismissSeconds = useStore((state) => state.billingOverageDismissSeconds)
  const forcedModalShown = useRef(false)
  const overage = usage?.overage ?? null

  useEffect(() => {
    if (!overage?.editing_frozen) return
    void startBillingWarmupOnPlans()
    if (forcedModalShown.current) return
    forcedModalShown.current = true
    openOverageModal()
    const timer = window.setTimeout(() => {
      setDismissState({ ready: true, seconds: 0 })
    }, DISMISS_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [openOverageModal, overage?.editing_frozen, setDismissState])

  useEffect(() => {
    if (!modalOpen || dismissReady) return
    const timer = window.setInterval(() => {
      setDismissState({ ready: false, seconds: Math.max(0, dismissSeconds - 1) })
    }, 1000)
    return () => window.clearInterval(timer)
  }, [dismissReady, dismissSeconds, modalOpen, setDismissState])

  if (!overage?.editing_frozen) return null

  return (
    <>
      <button
        type="button"
        onClick={() => {
          openOverageModal({ immediateDismiss: true })
        }}
        style={{
          position: "fixed",
          top: tabsVisible ? 34 : 12,
          left: 0,
          right: 0,
          margin: "0 auto",
          // Stay above the canvas, but keep the sidebar on top so its controls remain usable.
          zIndex: 65,
          minHeight: 28,
          maxWidth: "calc(100vw - 32px)",
          padding: "0 12px",
          borderRadius: 7,
          border: "1px solid #fecaca",
          background: "#fee2e2",
          color: "#991b1b",
          fontSize: 12,
          fontWeight: 700,
          cursor: "pointer",
          boxShadow: "0 4px 14px rgba(127, 29, 29, 0.14)",
          whiteSpace: "nowrap",
        }}
      >
        Over plan limits, editing frozen. Click here for details.
      </button>

      {modalOpen && (
        <BillingOverageModal
          overage={overage}
          dismissReady={dismissReady}
          dismissSeconds={dismissSeconds}
          onClose={() => {
            closeOverageModal()
          }}
        />
      )}
    </>
  )
}
