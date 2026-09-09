import type { SyncActivityState, SyncVisualState } from "./types"

export const SYNC_STATE_LABEL: Record<SyncActivityState, string> = {
  pending: "Saved locally",
  synced: "Synced",
  error: "Failed to sync",
  local_only: "Only on this device",
  discarded: "Discarded",
}

export type SyncIndicatorKind = "spinner" | "synced_fade" | "error" | "local_only"

export function syncIndicatorKind(state: SyncVisualState): SyncIndicatorKind {
  if (state === "pending") return "spinner"
  if (state === "synced") return "synced_fade"
  if (state === "error") return "error"
  return "local_only"
}

export function syncStateColor(state: SyncActivityState) {
  if (state === "error") return "#c47f7f"
  if (state === "synced") return "#78a98a"
  if (state === "local_only") return "#b48a52"
  if (state === "discarded") return "#9a9a9a"
  return "#9298a0"
}
