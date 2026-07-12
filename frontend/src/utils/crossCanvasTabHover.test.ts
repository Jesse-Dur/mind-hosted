import { describe, expect, test } from "bun:test"
import { createCrossCanvasTabHoverController, type CrossCanvasTabHoverScheduler } from "./crossCanvasTabHover"

type ScheduledTimer = {
  callback: () => void
  delayMs: number
}

function createFakeScheduler() {
  let nextHandle = 1
  const timers = new Map<number, ScheduledTimer>()
  function run(handle: number) {
    const timer = timers.get(handle)
    if (!timer) return
    timers.delete(handle)
    timer.callback()
  }

  const scheduler: CrossCanvasTabHoverScheduler<number> = {
    setTimeout: (callback, delayMs) => {
      const handle = nextHandle
      nextHandle += 1
      timers.set(handle, { callback, delayMs })
      return handle
    },
    clearTimeout: (handle) => {
      timers.delete(handle)
    },
  }

  return {
    scheduler,
    timers,
    run,
    runAll: () => {
      for (const handle of [...timers.keys()]) run(handle)
    },
  }
}

describe("cross canvas tab hover", () => {
  test("hover feedback is immediate and activation waits for the dwell window", () => {
    const fake = createFakeScheduler()
    const events: string[] = []

    const controller = createCrossCanvasTabHoverController({
      dwellMs: 450,
      scheduler: fake.scheduler,
      onHoverChange: (canvasId) => {
        events.push(canvasId === null ? "hover:none" : `hover:${canvasId}`)
      },
      onDwell: (canvasId) => {
        events.push(`dwell:${canvasId}`)
      },
    })

    controller.requestHover(2)

    expect(events).toEqual(["hover:2"])
    expect(controller.getHoverCanvasId()).toBe(2)
    expect(controller.getPendingCanvasId()).toBe(2)
    expect(fake.timers.size).toBe(1)
    expect(fake.timers.values().next().value?.delayMs).toBe(450)

    fake.runAll()

    expect(events).toEqual(["hover:2", "dwell:2"])
    expect(controller.getHoverCanvasId()).toBe(2)
    expect(controller.getPendingCanvasId()).toBeNull()
  })

  test("moving to another tab cancels the first dwell and keeps the latest hover", () => {
    const fake = createFakeScheduler()
    const events: string[] = []

    const controller = createCrossCanvasTabHoverController({
      dwellMs: 450,
      scheduler: fake.scheduler,
      onHoverChange: (canvasId) => {
        events.push(canvasId === null ? "hover:none" : `hover:${canvasId}`)
      },
      onDwell: (canvasId) => {
        events.push(`dwell:${canvasId}`)
      },
    })

    controller.requestHover(2)
    controller.requestHover(3)

    expect(events).toEqual(["hover:2", "hover:none", "hover:3"])
    expect(controller.getHoverCanvasId()).toBe(3)
    expect(controller.getPendingCanvasId()).toBe(3)
    expect(fake.timers.size).toBe(1)

    fake.runAll()

    expect(events).toEqual(["hover:2", "hover:none", "hover:3", "dwell:3"])
  })

  test("clearing hover stops the dwell and removes the visual state", () => {
    const fake = createFakeScheduler()
    const events: string[] = []

    const controller = createCrossCanvasTabHoverController({
      dwellMs: 450,
      scheduler: fake.scheduler,
      onHoverChange: (canvasId) => {
        events.push(canvasId === null ? "hover:none" : `hover:${canvasId}`)
      },
      onDwell: (canvasId) => {
        events.push(`dwell:${canvasId}`)
      },
    })

    controller.requestHover(2)
    controller.clearHover()
    fake.runAll()

    expect(events).toEqual(["hover:2", "hover:none"])
    expect(controller.getHoverCanvasId()).toBeNull()
    expect(controller.getPendingCanvasId()).toBeNull()
  })
})
