import { useEffect, useState } from "react"
import { useAuth } from "@clerk/clerk-react"
import { preloadBillingUsage, refreshBillingUsage } from "./UsagePanel"
import { setBillingOverage } from "../billing/access"
import type { BillingOverage, BillingOverageItem, BillingUsage } from "../types"

const RESOURCE_WORDS: Record<BillingOverageItem["id"], { singular: string; plural: string }> = {
  canvases: { singular: "canvas", plural: "canvases" },
  tiles: { singular: "tile", plural: "tiles" },
  thoughts: { singular: "thought", plural: "thoughts" },
}

function resourceWord(id: BillingOverageItem["id"], value: number) {
  const words = RESOURCE_WORDS[id]
  return value === 1 ? words.singular : words.plural
}

function suspendedText(overage: BillingOverage) {
  const labels = overage.overages.map((item) => RESOURCE_WORDS[item.id].plural)
  if (labels.length === 0) return "items"
  if (labels.length === 1) return labels[0]!
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`
}

function CanvasDeleteGraphic() {
  return (
    <div style={{ border: "1px solid #e5e5e5", borderRadius: 8, background: "#ffffff", padding: 12 }}>
      <ol style={{ margin: "0 0 12px", paddingLeft: 18, display: "flex", flexDirection: "column", gap: 5, color: "#333", fontSize: 12, lineHeight: 1.4 }}>
        <li>Right click on the canvas tab.</li>
        <li>Click Delete.</li>
        <li>Choose Move tiles and thoughts to another canvas.</li>
        <li>Select the destination canvas.</li>
        <li>Click Move and delete.</li>
      </ol>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10, alignItems: "stretch" }}>
        <div style={{ borderRadius: 7, border: "1px solid #e5e5e5", background: "#fafafa", padding: 6, boxShadow: "0 6px 18px rgba(24,24,27,0.08)" }}>
          <div style={{ padding: "7px 10px", borderRadius: 5, color: "#1a1a1a", fontSize: 12 }}>Favourite</div>
          <div style={{ padding: "7px 10px", borderRadius: 5, color: "#1a1a1a", fontSize: 12 }}>Rename</div>
          <div style={{ padding: "7px 10px", borderRadius: 5, background: "#f5f5f5", color: "#ef4444", fontSize: 12 }}>Delete</div>
        </div>

        <div style={{ borderRadius: 7, border: "1px solid #ddd6fe", background: "#fbfbfd", overflow: "hidden" }}>
          <div style={{ padding: "10px 12px", background: "#ede9fe", borderBottom: "1px solid #ddd6fe" }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#1a1a1a" }}>Delete "My Canvas"?</div>
            <div style={{ marginTop: 3, fontSize: 10, color: "#555" }}>Choose what happens to this canvas.</div>
          </div>
          <div style={{ padding: 10, display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ border: "1px solid #e5e5e5", borderRadius: 7, background: "#ffffff", padding: "8px 10px", fontSize: 11, color: "#991b1b", fontWeight: 700 }}>
              Delete all tiles and thoughts
            </div>
            <div style={{ border: "1px solid #c4b5fd", borderRadius: 7, background: "#f5f3ff", padding: "8px 10px", fontSize: 11, color: "#4c1d95", fontWeight: 700 }}>
              Move tiles and thoughts to another canvas
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <div style={{ borderRadius: 7, background: "#1a1a1a", color: "#fff", padding: "7px 10px", fontSize: 11, fontWeight: 700 }}>Move and delete</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function OverageModal({ overage, onClose }: { overage: BillingOverage; onClose: () => void }) {
  const suspended = suspendedText(overage)

  return (
    <div
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 700,
        minHeight: "100dvh",
        background: "rgba(24, 24, 27, 0.34)",
        backdropFilter: "blur(7px)",
        display: "grid",
        placeItems: "center",
        padding: 24,
        boxSizing: "border-box",
        overflowY: "auto",
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="billing-overage-title"
        style={{
          width: "min(540px, calc(100vw - 32px))",
          maxHeight: "calc(100dvh - 48px)",
          borderRadius: 8,
          background: "#fbfbfd",
          border: "1px solid #ddd6fe",
          boxShadow: "0 18px 42px rgba(24, 24, 27, 0.16)",
          color: "#1a1a1a",
          overflow: "auto",
        }}
      >
        <div style={{ padding: "18px 20px 14px", background: "#ede9fe", borderBottom: "1px solid #ddd6fe" }}>
          <h2 id="billing-overage-title" style={{ margin: 0, fontSize: 17, lineHeight: 1.25, fontWeight: 700, letterSpacing: 0 }}>
            Over plan limits
          </h2>
          <p style={{ margin: "8px 0 0", color: "#555", fontSize: 13, lineHeight: 1.45 }}>
            Editing is frozen until you delete enough items to get back under your plan.
          </p>
        </div>

        <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 14, background: "#fbfbfd" }}>
          <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 7, color: "#333", fontSize: 13, lineHeight: 1.4 }}>
            {overage.overages.map((item) => (
              <li key={item.id}>
                You are using {item.used} {resourceWord(item.id, item.used)}, but your plan has a maximum of {item.limit}. Delete {item.over_by} {resourceWord(item.id, item.over_by)}.
              </li>
            ))}
          </ul>

          <p style={{ margin: 0, color: "#555", fontSize: 13, lineHeight: 1.45 }}>
            Creation and editing are suspended for {suspended}. Deleting canvases, tiles, and thoughts is still available so you can clean up.
          </p>
          <p style={{ margin: 0, color: "#555", fontSize: 13, lineHeight: 1.45 }}>
            To delete a canvas while keeping its contents, use these steps.
          </p>
          <CanvasDeleteGraphic />
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, padding: "14px 20px 18px", background: "#ffffff", borderTop: "1px solid #eee" }}>
          <button
            type="button"
            onClick={() => { window.location.hash = "plans" }}
            style={{ height: 34, padding: "0 12px", borderRadius: 7, border: "none", background: "#1a1a1a", color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer" }}
          >
            Resubscribe
          </button>
          <button
            type="button"
            onClick={onClose}
            style={{ height: 34, padding: "0 12px", borderRadius: 7, border: "1px solid #d4d4d8", background: "#ffffff", color: "#333", fontSize: 13, fontWeight: 700, cursor: "pointer" }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

export function OverageNotice({ tabsVisible }: { tabsVisible: boolean }) {
  const { getToken } = useAuth()
  const [usage, setUsage] = useState<BillingUsage | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const overage = usage?.overage ?? null

  useEffect(() => {
    let cancelled = false

    async function load(forceRefresh: boolean) {
      const next = forceRefresh ? await refreshBillingUsage(getToken) : await preloadBillingUsage(getToken)
      if (cancelled) return
      setUsage(next)
      setBillingOverage(next.overage)
    }

    void load(true).catch(console.error)
    const refresh = window.setInterval(() => { void load(true).catch(console.error) }, 60000)
    return () => {
      cancelled = true
      window.clearInterval(refresh)
      setBillingOverage(null)
    }
  }, [getToken])

  if (!overage?.is_over_limit) return null

  return (
    <>
      <button
        type="button"
        onClick={() => setModalOpen(true)}
        style={{
          position: "fixed",
          top: tabsVisible ? 34 : 12,
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 90,
          minHeight: 28,
          maxWidth: "calc(100vw - 32px)",
          padding: "0 12px",
          borderRadius: 7,
          border: "1px solid #c4b5fd",
          background: "#fbfbfd",
          color: "#4c1d95",
          fontSize: 12,
          fontWeight: 700,
          cursor: "pointer",
          boxShadow: "0 4px 14px rgba(24, 24, 27, 0.12)",
          whiteSpace: "nowrap",
        }}
      >
        Over plan limits, editing frozen. Click here for details.
      </button>

      {modalOpen && <OverageModal overage={overage} onClose={() => setModalOpen(false)} />}
    </>
  )
}
