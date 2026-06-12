import { flushSyncQueue, scheduleFlush } from "./flush"
import { pullSync } from "./pull"

let activeCanvasId: number | null = null

export function setSyncActiveCanvas(canvasId: number | null) {
  activeCanvasId = canvasId
  if (canvasId !== null && canvasId > 0) syncActiveCanvas(canvasId).catch(console.error)
}

export async function syncActiveCanvas(canvasId = activeCanvasId) {
  await flushSyncQueue()
  if (canvasId !== null && canvasId > 0) await pullSync(canvasId)
}

export async function syncInBackground() {
  await flushSyncQueue()
  if (activeCanvasId !== null && activeCanvasId > 0) await pullSync(activeCanvasId)
  await pullSync()
}

export function startSyncRuntime() {
  window.addEventListener("online", () => scheduleFlush())
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") syncInBackground().catch(console.error)
  })
  scheduleFlush()
}
