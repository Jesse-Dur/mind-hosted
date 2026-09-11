import { useEffect, useMemo, useState } from "react"
import { createPortal } from "react-dom"
import { useStore } from "../store"
import { serverClientId } from "../sync/ids"
import { syncEntityKey } from "../sync/status"
import { SYNC_STATE_LABEL, syncIndicatorKind, syncStateColor } from "../sync/statusPresentation"
import type { SyncActivityRecord, SyncActivityState, SyncEntityStatus, SyncEntityType, SyncVisualState } from "../sync/types"
import { SavingSpinner } from "./SavingSpinner"

type EntityIdentity = {
  entityType: SyncEntityType
  id: number
  clientId?: string | null
}

const STATE_PRIORITY: Record<SyncVisualState, number> = {
  synced: 0,
  pending: 1,
  local_only: 2,
  error: 3,
}

function identityClientId(identity: EntityIdentity) {
  return identity.clientId ?? serverClientId(identity.entityType, identity.id)
}

function SyncResolutionDialog({ statuses, onClose }: { statuses: SyncEntityStatus[]; onClose: () => void }) {
  const { retrySyncOperation, keepSyncOperationLocal, discardSyncOperation } = useStore()
  const [busy, setBusy] = useState<string | null>(null)

  async function run(opId: string | null, action: (id: string) => Promise<void>) {
    if (!opId) return
    setBusy(opId)
    try {
      await action(opId)
      onClose()
    } finally {
      setBusy(null)
    }
  }

  return createPortal(
    <div
      role="presentation"
      onPointerDown={(event) => { if (event.target === event.currentTarget) onClose() }}
      style={{ position: "fixed", inset: 0, zIndex: 400, background: "rgba(0,0,0,0.28)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
    >
      <section role="dialog" aria-modal="true" aria-label="Sync status" style={{ width: "min(440px, 100%)", maxHeight: "min(620px, 85dvh)", overflowY: "auto", background: "#fff", borderRadius: 14, padding: 18, boxShadow: "0 20px 60px rgba(0,0,0,0.2)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 14 }}>
          <h2 style={{ fontSize: 16, margin: 0 }}>Sync status</h2>
          <button type="button" onClick={onClose} aria-label="Close sync status" style={{ width: 30, height: 30, borderRadius: 99, border: "none", background: "#f3f3f3", cursor: "pointer" }}>×</button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {statuses.map((status) => {
            const disabled = busy === status.opId
            return (
              <div key={status.key} style={{ border: "1px solid #e8e8e8", borderRadius: 10, padding: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <SyncStateVisual state={status.state} />
                  <strong style={{ fontSize: 13 }}>{status.entityType} · {status.action ?? "saved"}</strong>
                  <span style={{ marginLeft: "auto", fontSize: 11, color: "#888" }}>{SYNC_STATE_LABEL[status.state]}</span>
                </div>
                {status.error && (
                  <pre style={{ margin: "9px 0 0", padding: 9, borderRadius: 7, background: "#fff5f5", color: "#b42318", whiteSpace: "pre-wrap", wordBreak: "break-word", font: "11px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace" }}>{status.error}</pre>
                )}
                {status.state === "local_only" && <p style={{ margin: "9px 0 0", color: "#8a5a00", fontSize: 12, lineHeight: 1.4 }}>This version stays on this device and will not appear on your other devices until you try syncing it.</p>}
                {status.state === "pending" && <p style={{ margin: "9px 0 0", color: "#777", fontSize: 12 }}>The change is safe locally and will retry automatically when Mind can connect.</p>}
                {status.opId && status.state !== "synced" && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginTop: 11 }}>
                    <button type="button" disabled={disabled} onClick={() => void run(status.opId, retrySyncOperation)} style={actionButtonStyle("primary")}>{status.state === "local_only" ? "Try syncing" : "Retry now"}</button>
                    {status.state === "error" && <button type="button" disabled={disabled} onClick={() => { if (window.confirm("Keep this version only on this device? It will stop retrying and will not appear on your other devices unless you choose Try syncing later.")) void run(status.opId, keepSyncOperationLocal) }} style={actionButtonStyle("neutral")}>Keep locally</button>}
                    <button type="button" disabled={disabled} onClick={() => { if (window.confirm("Discard this local change? Mind will restore the last server-confirmed version. A never-synced creation will be removed, and a failed deletion will be restored. This cannot be undone.")) void run(status.opId, discardSyncOperation) }} style={actionButtonStyle("danger")}>Discard local change</button>
                  </div>
                )}
                {status.state !== "synced" && <p style={{ margin: "9px 0 0", color: "#aaa", fontSize: 10.5, lineHeight: 1.4 }}>Discard restores the last confirmed server version. A never-synced creation is removed; a failed deletion is restored.</p>}
              </div>
            )
          })}
        </div>
      </section>
    </div>,
    document.body,
  )
}

function actionButtonStyle(kind: "primary" | "neutral" | "danger"): React.CSSProperties {
  return {
    border: kind === "neutral" ? "1px solid #ddd" : "none",
    background: kind === "primary" ? "#1a1a1a" : kind === "danger" ? "#fff0f0" : "#fff",
    color: kind === "primary" ? "#fff" : kind === "danger" ? "#c62828" : "#444",
    borderRadius: 7,
    padding: "6px 9px",
    fontSize: 11,
    fontWeight: 650,
    cursor: "pointer",
  }
}

function SyncStateVisual({ state }: { state: SyncVisualState }) {
  const kind = syncIndicatorKind(state)
  if (kind === "spinner") return <SavingSpinner />
  if (kind === "synced_fade") return <SavingSpinner fading />
  if (kind === "error") {
    return <><style>{`@keyframes syncAttentionIn { from { opacity: 0; transform: scale(.68) } to { opacity: 1; transform: scale(1) } }`}</style><span aria-hidden style={{ width: 14, height: 14, flexShrink: 0, display: "inline-flex", alignItems: "center", justifyContent: "center", borderRadius: "50%", border: "1px solid #e8bcbc", background: "#fff8f8", color: syncStateColor("error"), fontSize: 10, lineHeight: 1, fontWeight: 750, boxSizing: "border-box", animation: "syncAttentionIn 180ms cubic-bezier(.2,.8,.2,1)" }}>!</span></>
  }
  return <><style>{`@keyframes syncLocalOnlyIn { from { opacity: 0; transform: scale(.7) } to { opacity: 1; transform: scale(1) } }`}</style><span aria-hidden style={{ width: 9, height: 9, flexShrink: 0, borderRadius: "50%", background: "transparent", border: `1.5px solid ${syncStateColor("local_only")}`, boxSizing: "border-box", animation: "syncLocalOnlyIn 180ms cubic-bezier(.2,.8,.2,1)" }} /></>
}

export function SyncStatusDot({ entities, appearance = "indicator", fallbackState, activity }: { entities: EntityIdentity[]; appearance?: "indicator" | "text"; fallbackState?: SyncActivityState; activity?: SyncActivityRecord }) {
  const statusMap = useStore((state) => state.syncEntityStatuses)
  const [open, setOpen] = useState(false)
  const entityStatuses = useMemo(() => entities
    .map((identity) => statusMap.get(syncEntityKey(identity.entityType, identityClientId(identity))))
    .filter((status): status is SyncEntityStatus => Boolean(status))
    .sort((left, right) => STATE_PRIORITY[right.state] - STATE_PRIORITY[left.state] || right.updatedAt - left.updatedAt), [entities, statusMap])
  const statuses = useMemo(() => {
    if (!activity || activity.state === "discarded" || activity.state === "synced") return activity ? [] : entityStatuses
    return [{
      key: `operation:${activity.opId}`,
      entityType: activity.entityType,
      clientId: activity.clientId,
      state: activity.state,
      opId: activity.opId,
      action: activity.action,
      error: activity.error,
      updatedAt: activity.updatedAt,
    } satisfies SyncEntityStatus]
  }, [activity, entityStatuses])
  const status = statuses[0]
  const visibleState = activity?.state ?? status?.state ?? fallbackState
  const interactive = Boolean(status?.opId && (status.state === "error" || status.state === "local_only"))
  useEffect(() => {
    if (open && !interactive) setOpen(false)
  }, [interactive, open])
  if (!visibleState) return null
  const label = SYNC_STATE_LABEL[visibleState]

  const trigger = appearance === "text"
    ? interactive
      ? (
        <button
          type="button"
          aria-label={`${label}. Tap for sync options.`}
          onClick={(event) => { event.stopPropagation(); setOpen(true) }}
          style={{ border: "none", padding: "3px 0", background: "transparent", color: syncStateColor(visibleState), fontSize: 10, lineHeight: 1.2, fontWeight: 600, cursor: "pointer", flexShrink: 0 }}
        >{label}</button>
      )
      : <span style={{ color: syncStateColor(visibleState), fontSize: 10, lineHeight: 1.2, fontWeight: 550, flexShrink: 0 }}>{label}</span>
    : (
      <button
        type="button"
        aria-label={label}
        title={label}
        onClick={(event) => { event.stopPropagation(); if (interactive) setOpen(true) }}
        style={{ width: 20, height: 20, display: "inline-flex", alignItems: "center", justifyContent: "center", border: "none", padding: 0, background: "transparent", borderRadius: 99, cursor: interactive ? "pointer" : "default" }}
      >
        <SyncStateVisual state={visibleState as SyncVisualState} />
      </button>
    )

  return (
    <>
      {trigger}
      {open && interactive && statuses.length > 0 && <SyncResolutionDialog statuses={statuses} onClose={() => setOpen(false)} />}
    </>
  )
}
