import { useState } from "react"
import { useClerk } from "@clerk/clerk-react"
import { forgetOfflineIdentity, markExplicitSignOut, rememberAuthenticatedUser } from "../auth/offlineIdentity"
import { useStore } from "../store"
import { configureAccountDatabase, deleteAccountDatabase, getActiveSyncUserId, syncDb } from "../sync/localDb"
import { quiesceSyncAccount } from "../sync/accountScope"
import type { SyncActivityRecord } from "../sync/types"
import { startSyncRuntime, stopSyncRuntime, waitForSyncIdle } from "../sync/engine"

const CLEAR_LOCAL_DATA_PREFERENCE = "mind:clear-local-data-on-sign-out"

function readClearPreference() {
  return localStorage.getItem(CLEAR_LOCAL_DATA_PREFERENCE) === "true"
}

async function unsyncedCount() {
  return syncDb.outbox.where("status").anyOf(["pending", "flushing", "error", "local_only"]).count()
}

async function unsyncedReview() {
  const operations = await syncDb.outbox.where("status").anyOf(["pending", "flushing", "error", "local_only"]).toArray()
  const activities = await syncDb.syncActivity.bulkGet(operations.map((operation) => operation.opId))
  return operations.map((operation, index): SyncActivityRecord => activities[index] ?? {
    opId: operation.opId,
    entityType: operation.entityType,
    clientId: operation.clientId,
    action: operation.action,
    state: operation.status === "error" ? "error" : operation.status === "local_only" ? "local_only" : "pending",
    summary: `${operation.action === "delete" ? "Delete" : "Save"} ${operation.entityType}`,
    error: operation.error ?? null,
    createdAt: operation.createdAt,
    updatedAt: operation.updatedAt,
  })
}

export function SignOutSection() {
  const { signOut } = useClerk()
  const syncNow = useStore((state) => state.syncNow)
  const [clearLocalData, setClearLocalData] = useState(readClearPreference)
  const [confirmCount, setConfirmCount] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reviewOpen, setReviewOpen] = useState(false)
  const [reviewItems, setReviewItems] = useState<SyncActivityRecord[]>([])

  function updateClearPreference(value: boolean) {
    setClearLocalData(value)
    localStorage.setItem(CLEAR_LOCAL_DATA_PREFERENCE, String(value))
  }

  async function finishSignOut({ clear }: { clear: boolean }) {
    setBusy(true)
    setError(null)
    let stoppedSync = false
    let signedOut = false
    const accountId = getActiveSyncUserId()
    try {
      if (clear) {
        stopSyncRuntime()
        stoppedSync = true
        await quiesceSyncAccount()
        await waitForSyncIdle()
      }
      // Set this before Clerk publishes its signed-out state so App never treats
      // an intentional sign-out as an expired session for even one render.
      markExplicitSignOut()
      await signOut()
      signedOut = true
      if (clear) {
        forgetOfflineIdentity()
        if (accountId) await deleteAccountDatabase(accountId)
      }
    } catch (reason) {
      if (!signedOut && accountId) rememberAuthenticatedUser(accountId)
      if (stoppedSync && accountId) {
        await configureAccountDatabase(accountId)
        startSyncRuntime()
      }
      setError(reason instanceof Error ? reason.message : "Could not sign out")
    } finally {
      setBusy(false)
    }
  }

  async function requestSignOut() {
    const pending = await unsyncedCount()
    if (pending > 0) {
      setReviewItems(await unsyncedReview())
      setConfirmCount(pending)
      return
    }
    await finishSignOut({ clear: clearLocalData })
  }

  async function syncThenSignOut() {
    setBusy(true)
    setError(null)
    try {
      await syncNow()
      const remaining = await unsyncedCount()
      if (remaining > 0) {
        setReviewItems(await unsyncedReview())
        setConfirmCount(remaining)
        setError(`${remaining} change${remaining === 1 ? " is" : "s are"} still not confirmed by the server.`)
        return
      }
      await finishSignOut({ clear: clearLocalData })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Mind could not finish syncing")
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <section style={{ borderTop: "1px solid #eee", paddingTop: 18 }}>
        <p style={{ fontSize: 11, fontWeight: 700, color: "#aaa", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 12 }}>This device</p>
        <label style={{ display: "flex", alignItems: "flex-start", gap: 9, color: "#444", fontSize: 12, lineHeight: 1.4, cursor: "pointer" }}>
          <input type="checkbox" checked={clearLocalData} onChange={(event) => updateClearPreference(event.target.checked)} style={{ marginTop: 2 }} />
          <span><strong style={{ display: "block", fontSize: 13 }}>Clear local data when signing out</strong>Mind remembers this preference. Unsynced or local-only changes always require confirmation before deletion.</span>
        </label>
        <button type="button" disabled={busy} onClick={() => void requestSignOut()} style={{ marginTop: 14, width: "100%", border: "1px solid #ddd", background: "#fff", color: "#333", borderRadius: 8, padding: "8px 10px", fontSize: 12, fontWeight: 650, cursor: busy ? "default" : "pointer", opacity: busy ? 0.55 : 1 }}>Sign out</button>
        {error && confirmCount === null && <p style={{ color: "#b42318", fontSize: 11, marginTop: 8 }}>{error}</p>}
      </section>

      {confirmCount !== null && (
        <div role="presentation" style={{ position: "fixed", inset: 0, zIndex: 450, background: "rgba(0,0,0,0.3)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <section role="dialog" aria-modal="true" aria-label="Unsynced changes" style={{ width: "min(430px, 100%)", background: "#fff", borderRadius: 14, padding: 18, boxShadow: "0 20px 60px rgba(0,0,0,0.22)" }}>
            <h2 style={{ fontSize: 16, marginBottom: 8 }}>{confirmCount} change{confirmCount === 1 ? " is" : "s are"} only on this device</h2>
            <p style={{ fontSize: 12.5, color: "#666", lineHeight: 1.5 }}>You can try syncing first, keep the changes safely partitioned for this account, or permanently discard them. Discarding cannot be undone and may remove unsynced tiles and thoughts.</p>
            <button type="button" onClick={() => setReviewOpen((value) => !value)} style={{ marginTop: 10, border: 0, background: "transparent", color: "#555", padding: 0, fontSize: 12, fontWeight: 650, cursor: "pointer" }}>{reviewOpen ? "Hide changes" : "Review changes"}</button>
            {reviewOpen && <div style={{ marginTop: 8, maxHeight: 150, overflowY: "auto", border: "1px solid #eee", borderRadius: 8, padding: "4px 9px" }}>{reviewItems.length ? reviewItems.map((item) => <div key={item.opId} style={{ padding: "7px 0", borderBottom: "1px solid #f3f3f3", fontSize: 11.5, color: "#555" }}><span style={{ color: item.state === "error" ? "#b42318" : item.state === "local_only" ? "#b26a00" : "#777", fontWeight: 700 }}>{item.state === "local_only" ? "Only on device" : item.state === "error" ? "Failed" : "Waiting"}</span><span> · {item.summary}</span></div>) : <p style={{ padding: "7px 0", fontSize: 11.5, color: "#999" }}>Unsynced records are present, but no readable summaries are available.</p>}</div>}
            {error && <p style={{ marginTop: 9, color: "#b42318", fontSize: 11.5 }}>{error}</p>}
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 15 }}>
              <button type="button" disabled={busy} onClick={() => void syncThenSignOut()} style={dialogButton("primary")}>Sync, then sign out</button>
              <button type="button" disabled={busy} onClick={() => void finishSignOut({ clear: false })} style={dialogButton("neutral")}>Keep on this device and sign out</button>
              <button type="button" disabled={busy} onClick={() => void finishSignOut({ clear: true })} style={dialogButton("danger")}>Permanently discard and clear local data</button>
              <button type="button" disabled={busy} onClick={() => { setConfirmCount(null); setError(null); setReviewOpen(false) }} style={dialogButton("quiet")}>Cancel</button>
            </div>
          </section>
        </div>
      )}
    </>
  )
}

function dialogButton(kind: "primary" | "neutral" | "danger" | "quiet"): React.CSSProperties {
  return {
    border: kind === "neutral" || kind === "quiet" ? "1px solid #ddd" : "none",
    background: kind === "primary" ? "#1a1a1a" : kind === "danger" ? "#fff0f0" : "#fff",
    color: kind === "primary" ? "#fff" : kind === "danger" ? "#b42318" : "#444",
    borderRadius: 8,
    padding: "8px 10px",
    fontSize: 12,
    fontWeight: 650,
    cursor: "pointer",
  }
}
