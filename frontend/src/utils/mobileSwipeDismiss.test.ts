import { describe, expect, test } from "bun:test"
import { shouldDismissMobileToast } from "./mobileSwipeDismiss"

describe("mobile toast swipe dismissal", () => {
  test("keeps taps and small drags but accepts deliberate swipes in any direction", () => {
    expect(shouldDismissMobileToast(0, 0)).toBe(false)
    expect(shouldDismissMobileToast(24, 18)).toBe(false)
    expect(shouldDismissMobileToast(52, 0)).toBe(true)
    expect(shouldDismissMobileToast(0, -52)).toBe(true)
    expect(shouldDismissMobileToast(-40, 30)).toBe(true)
  })
})
