import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"
import { StaleSyncAccountError } from "../sync/accountScope"
import { startWorkspaceBootRetry } from "./workspaceBootRetry"

const timers = new Map<number, { callback: () => Promise<void>; delay: number }>()
const stops: Array<() => void> = []
let nextTimer = 0

beforeEach(() => {
  timers.clear()
  nextTimer = 0
  spyOn(console, "error").mockImplementation(() => {})
  spyOn(globalThis, "setTimeout").mockImplementation((callback, delay) => {
    const id = ++nextTimer
    timers.set(id, { callback: callback as () => Promise<void>, delay: delay ?? 0 })
    return id as unknown as ReturnType<typeof setTimeout>
  })
  spyOn(globalThis, "clearTimeout").mockImplementation((id) => {
    timers.delete(Number(id))
  })
})

afterEach(() => {
  for (const stop of stops.splice(0)) stop()
  mock.restore()
})

async function settleInitialAttempt() {
  await Promise.resolve()
  await Promise.resolve()
}

async function runNextTimer() {
  const [id, timer] = timers.entries().next().value!
  timers.delete(id)
  await timer.callback()
}

describe("workspace startup retries", () => {
  test("initial failure is silent, first retry failure shows status, and success stops retries", async () => {
    let attempts = 0
    const boot = mock(async () => {
      attempts += 1
      if (attempts < 3) throw new Error("Database temporarily unavailable")
    })
    const showStatus = mock(() => {})
    stops.push(startWorkspaceBootRetry(boot, showStatus))
    await settleInitialAttempt()
    expect(boot).toHaveBeenCalledTimes(1)
    expect(showStatus).not.toHaveBeenCalled()
    expect([...timers.values()].map(timer => timer.delay)).toEqual([1000])

    await runNextTimer()
    expect(showStatus).toHaveBeenCalledTimes(1)
    expect([...timers.values()].map(timer => timer.delay)).toEqual([2000])

    await runNextTimer()
    expect(boot).toHaveBeenCalledTimes(3)
    expect(timers.size).toBe(0)
  })

  test("repeated failures back off to 15 seconds and announce retrying once", async () => {
    const showStatus = mock(() => {})
    stops.push(startWorkspaceBootRetry(async () => { throw new Error("Storage unavailable") }, showStatus))
    await settleInitialAttempt()
    const delays: number[] = []
    for (let retry = 0; retry < 7; retry += 1) {
      delays.push([...timers.values()][0].delay)
      await runNextTimer()
    }
    expect(delays).toEqual([1000, 2000, 4000, 8000, 15000, 15000, 15000])
    expect(showStatus).toHaveBeenCalledTimes(1)
  })

  test("cancelling clears scheduled retries and even an already queued callback cannot boot", async () => {
    const boot = mock(async () => { throw new Error("Storage unavailable") })
    const showStatus = mock(() => {})
    const stop = startWorkspaceBootRetry(boot, showStatus)
    stops.push(stop)
    await settleInitialAttempt()
    const callback = [...timers.values()][0].callback
    stop()
    expect(timers.size).toBe(0)
    await callback()
    expect(boot).toHaveBeenCalledTimes(1)
    expect(showStatus).not.toHaveBeenCalled()
  })

  test("cancelling an in-flight attempt suppresses its failure and retries", async () => {
    let reject!: (error: Error) => void
    const pending = new Promise<void>((_resolve, fail) => { reject = fail })
    const showStatus = mock(() => {})
    const stop = startWorkspaceBootRetry(() => pending, showStatus)
    stops.push(stop)
    expect(timers.size).toBe(0)
    stop()
    reject(new Error("Old account setup failed"))
    await settleInitialAttempt()
    expect(timers.size).toBe(0)
    expect(showStatus).not.toHaveBeenCalled()
    expect(console.error).not.toHaveBeenCalled()
  })

  test("a stale account setup is never retried or announced", async () => {
    const showStatus = mock(() => {})
    stops.push(startWorkspaceBootRetry(async () => { throw new StaleSyncAccountError() }, showStatus))
    await settleInitialAttempt()
    expect(timers.size).toBe(0)
    expect(showStatus).not.toHaveBeenCalled()
    expect(console.error).not.toHaveBeenCalled()
  })

  test("successful startup does not schedule a retry", async () => {
    const showStatus = mock(() => {})
    stops.push(startWorkspaceBootRetry(async () => {}, showStatus))
    await settleInitialAttempt()
    expect(timers.size).toBe(0)
    expect(showStatus).not.toHaveBeenCalled()
  })
})
