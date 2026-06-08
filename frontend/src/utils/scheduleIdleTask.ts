type IdleCallbackWindow = Omit<Window, "requestIdleCallback" | "cancelIdleCallback"> & {
  requestIdleCallback?: Window["requestIdleCallback"]
  cancelIdleCallback?: Window["cancelIdleCallback"]
}

export function scheduleIdleTask(task: () => void, timeout = 1000): () => void {
  const idleWindow = window as IdleCallbackWindow
  const requestIdleCallback = idleWindow.requestIdleCallback?.bind(window)
  const cancelIdleCallback = idleWindow.cancelIdleCallback?.bind(window)

  // Some browsers omit requestIdleCallback even though TypeScript's DOM lib models it as present.
  if (requestIdleCallback && cancelIdleCallback) {
    const idleId = requestIdleCallback(task, { timeout })
    return () => cancelIdleCallback(idleId)
  }

  const fallbackTimer = window.setTimeout(task, 0)
  return () => window.clearTimeout(fallbackTimer)
}
