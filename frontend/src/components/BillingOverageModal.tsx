import { useEffect } from "react"
import type { BillingOverage, BillingOverageItem } from "../types"
import { startBillingWarmupOnPlans } from "../startup/workspaceStartup"
import { ModalShell } from "./ModalShell"

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

type BillingOverageModalProps = {
  overage: BillingOverage
  dismissReady: boolean
  dismissSeconds: number
  onClose: () => void
}

export function BillingOverageModal({ overage, dismissReady, dismissSeconds, onClose }: BillingOverageModalProps) {
  const suspended = suspendedText(overage)
  const dismissLabel = dismissReady ? "Dismiss" : `Dismiss in ${dismissSeconds}s`

  useEffect(() => {
    void startBillingWarmupOnPlans()
  }, [])

  return (
    <ModalShell
      titleId="billing-overage-title"
      title="Over plan limits"
      subtitle="Editing is frozen until you delete enough items to get back under your plan."
      onClose={onClose}
      closeOnBackdrop={dismissReady}
      footer={(
        <>
          <button
            type="button"
            onClick={() => { window.location.hash = "plans" }}
            style={{ height: 34, padding: "0 12px", borderRadius: 7, border: "none", background: "#1a1a1a", color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer" }}
          >
            Resubscribe
          </button>
          <button
            type="button"
            disabled={!dismissReady}
            onClick={onClose}
            style={{ height: 34, padding: "0 12px", borderRadius: 7, border: "1px solid #d4d4d8", background: "#ffffff", color: "#333", fontSize: 13, fontWeight: 700, opacity: dismissReady ? 1 : 0.52, cursor: dismissReady ? "pointer" : "default" }}
          >
            {dismissLabel}
          </button>
        </>
      )}
    >
      <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 7, color: "#333", fontSize: 13, lineHeight: 1.4 }}>
        {overage.overages.map((item) => (
          <li key={item.id}>
            You are using {item.used} {resourceWord(item.id, item.used)}, but your plan has a maximum of {item.limit}. Delete {item.over_by} {resourceWord(item.id, item.over_by)}.
          </li>
        ))}
      </ul>

      <p style={{ margin: 0, color: "#555", fontSize: 13, lineHeight: 1.45 }}>
        Editing and creation are paused. You can still delete canvases, tiles, and thoughts so you can get back under the plan limits.
      </p>
      <p style={{ margin: 0, color: "#333", fontSize: 13, lineHeight: 1.45, fontWeight: 700 }}>
        We will never delete any of your data.
      </p>
      <p style={{ margin: 0, color: "#555", fontSize: 13, lineHeight: 1.45 }}>
        To delete a canvas while keeping its contents, use these steps.
      </p>
      <CanvasDeleteGraphic />
      <p style={{ margin: 0, color: "#777", fontSize: 11, lineHeight: 1.45 }}>
        If you are experiencing financial hardship, email us anonymously at MindSupportTeam@pm.me and we can discuss options.
      </p>
    </ModalShell>
  )
}
