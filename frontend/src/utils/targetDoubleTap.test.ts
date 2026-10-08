import { describe, expect, test } from "bun:test"
import { resolveTargetTap } from "./targetDoubleTap"

describe("target-specific double taps", () => {
  test("two quick taps on different tabs are two single taps", () => {
    const first = resolveTargetTap(null, "canvas-a", 1000)
    const second = resolveTargetTap(first.next, "canvas-b", 1200)

    expect(first.isDoubleTap).toBe(false)
    expect(second.isDoubleTap).toBe(false)
    expect(second.next).toEqual({ targetKey: "canvas-b", at: 1200 })
  })

  test("two quick taps on the same tab trigger rename", () => {
    const first = resolveTargetTap(null, "canvas-b", 1000)
    const second = resolveTargetTap(first.next, "canvas-b", 1200)

    expect(second.isDoubleTap).toBe(true)
    expect(second.next).toBeNull()
  })

  test("two taps outside the interval remain single taps", () => {
    const first = resolveTargetTap(null, "canvas-a", 1000)
    const second = resolveTargetTap(first.next, "canvas-a", 1600)

    expect(second.isDoubleTap).toBe(false)
  })
})
