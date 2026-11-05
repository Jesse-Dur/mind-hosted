import { describe, expect, test } from "bun:test"
import { pointInsideRect } from "./pointerRect"

describe("cross-canvas tab hit testing", () => {
  const tab = { left: 100, right: 220, top: 8, bottom: 42 }

  test("requires the pointer to remain inside both axes", () => {
    expect(pointInsideRect(150, 25, tab)).toBe(true)
    // Regression: the same horizontal position must not keep a canvas dwell
    // armed once the pointer moves vertically off the tab.
    expect(pointInsideRect(150, 80, tab)).toBe(false)
    expect(pointInsideRect(150, 0, tab)).toBe(false)
  })
})
