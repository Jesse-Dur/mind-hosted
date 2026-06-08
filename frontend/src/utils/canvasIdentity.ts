import type { Canvas } from "../types"

export function canvasIdentityKey(canvas: Canvas) {
  // Optimistic canvases swap their temporary id for a server id, so UI state
  // needs a stable key that survives that handoff.
  return canvas.stableKey ?? `canvas-${canvas.id}`
}

export function isTemporaryCanvasId(id: number) {
  return id < 0
}
