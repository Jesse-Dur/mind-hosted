import { describe, expect, test } from "bun:test"
import { getManualInstallKind } from "./installPrompt"

describe("manual PWA installation support", () => {
  test("recognises iPhones and touch-mode iPads", () => {
    expect(getManualInstallKind("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)", "iPhone", 5)).toBe("ios")
    expect(getManualInstallKind("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)", "MacIntel", 5)).toBe("ios")
  })

  test("recognises modern macOS Safari without treating Chrome as Safari", () => {
    expect(getManualInstallKind("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) Version/17.2 Safari/605.1.15", "MacIntel", 0)).toBe("mac-safari")
    expect(getManualInstallKind("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 Chrome/128.0 Safari/537.36", "MacIntel", 0)).toBe("chromium")
  })

  test("offers Chromium browsers such as Brave a manual installation fallback", () => {
    expect(getManualInstallKind("Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36", "Linux armv8l", 5)).toBe("chromium")
  })

  test("does not advertise manual installation on unsupported devices", () => {
    expect(getManualInstallKind("Mozilla/5.0 (X11; Linux x86_64) Firefox/130.0", "Linux x86_64", 0)).toBeNull()
    expect(getManualInstallKind("Mozilla/5.0 (Macintosh) Version/16.6 Safari/605.1.15", "MacIntel", 0)).toBeNull()
  })
})
