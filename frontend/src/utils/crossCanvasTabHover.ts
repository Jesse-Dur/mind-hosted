export type CrossCanvasTabHoverScheduler<THandle> = {
  setTimeout: (callback: () => void, delayMs: number) => THandle
  clearTimeout: (handle: THandle) => void
}

export type CrossCanvasTabHoverController = {
  requestHover: (canvasId: number) => void
  clearHover: () => void
  getHoverCanvasId: () => number | null
  getPendingCanvasId: () => number | null
}

export type CrossCanvasTabHoverOptions<THandle> = {
  dwellMs: number
  scheduler: CrossCanvasTabHoverScheduler<THandle>
  onHoverChange: (canvasId: number | null) => void
  onDwell: (canvasId: number) => void
}

export function createCrossCanvasTabHoverController<THandle>({
  dwellMs,
  scheduler,
  onHoverChange,
  onDwell,
}: CrossCanvasTabHoverOptions<THandle>): CrossCanvasTabHoverController {
  let hoverCanvasId: number | null = null
  let pendingCanvasId: number | null = null
  let timerHandle: THandle | null = null

  function clearTimer() {
    if (timerHandle === null) return
    scheduler.clearTimeout(timerHandle)
    timerHandle = null
  }

  function clearHover() {
    clearTimer()
    pendingCanvasId = null
    if (hoverCanvasId === null) return
    hoverCanvasId = null
    onHoverChange(null)
  }

  function requestHover(canvasId: number) {
    if (hoverCanvasId === canvasId || pendingCanvasId === canvasId) return

    clearHover()
    pendingCanvasId = canvasId
    hoverCanvasId = canvasId
    onHoverChange(canvasId)

    // Hover should appear immediately, but switching only happens if the drag stays put for the dwell window.
    timerHandle = scheduler.setTimeout(() => {
      timerHandle = null
      if (pendingCanvasId !== canvasId) return
      pendingCanvasId = null
      onDwell(canvasId)
    }, dwellMs)
  }

  return {
    requestHover,
    clearHover,
    getHoverCanvasId: () => hoverCanvasId,
    getPendingCanvasId: () => pendingCanvasId,
  }
}
