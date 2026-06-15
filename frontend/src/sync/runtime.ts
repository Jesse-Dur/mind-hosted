import { flushSyncQueue, scheduleFlush } from "./flush"
import { pullSync } from "./pull"
import { isApiUnauthorizedError } from "../api/errors"

let activeCanvasId: number | null = null

async function runSyncWork(work: () => Promise<void>) {
  try {
    await work()
  } catch (error) {
    if (isApiUnauthorizedError(error)) return
    throw error
  }
}

export function setSyncActiveCanvas(canvasId: number | null) {
  activeCanvasId = canvasId
  if (canvasId !== null && canvasId > 0) syncActiveCanvas(canvasId).catch(console.error)
}

export async function syncActiveCanvas(canvasId = activeCanvasId) {
  await runSyncWork(async () => {
    await flushSyncQueue()
    if (canvasId !== null && canvasId > 0) await pullSync(canvasId)
  })
}

export async function syncInBackground() {
  await runSyncWork(async () => {
    await flushSyncQueue()
    if (activeCanvasId !== null && activeCanvasId > 0) await pullSync(activeCanvasId)
    await pullSync()
  })
}

export function startSyncRuntime() {
  window.addEventListener("online", () => scheduleFlush())
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") syncInBackground().catch(console.error)
  })
  scheduleFlush()
}
