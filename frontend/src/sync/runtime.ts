import { cancelScheduledFlush, flushSyncQueue, scheduleFlush } from "./flush"
import { pullSync } from "./pull"
import { isApiUnauthorizedError } from "../api/errors"
import { assertSyncAccountScopeCurrent, isStaleSyncAccountError, runSyncAccountTask } from "./accountScope"

let activeCanvasId: number | null = null
let started = false
const onOnline = () => scheduleFlush()
const onVisibilityChange = () => {
  if (document.visibilityState === "visible") syncInBackground().catch(console.error)
}

async function runSyncWork(work: () => Promise<void>) {
  try {
    await work()
  } catch (error) {
    if (isApiUnauthorizedError(error) || isStaleSyncAccountError(error)) return
    throw error
  }
}

export function setSyncActiveCanvas(canvasId: number | null) {
  activeCanvasId = canvasId
  if (canvasId !== null && canvasId > 0) syncActiveCanvas(canvasId).catch(console.error)
}

export async function syncActiveCanvas(canvasId = activeCanvasId) {
  await runSyncAccountTask(async (scope) => {
    await runSyncWork(async () => {
      await flushSyncQueue()
      assertSyncAccountScopeCurrent(scope)
      if (canvasId !== null && canvasId > 0) await pullSync(canvasId)
    })
  })
}

export async function syncInBackground() {
  await runSyncAccountTask(async (scope) => {
    await runSyncWork(async () => {
      await flushSyncQueue()
      assertSyncAccountScopeCurrent(scope)
      if (activeCanvasId !== null && activeCanvasId > 0) await pullSync(activeCanvasId)
      assertSyncAccountScopeCurrent(scope)
      await pullSync()
    })
  })
}

export function startSyncRuntime() {
  if (started) return
  started = true
  window.addEventListener("online", onOnline)
  document.addEventListener("visibilitychange", onVisibilityChange)
  scheduleFlush()
}

export function stopSyncRuntime() {
  if (!started) return
  started = false
  activeCanvasId = null
  window.removeEventListener("online", onOnline)
  document.removeEventListener("visibilitychange", onVisibilityChange)
  cancelScheduledFlush()
}
