import { describe, expect, test } from "bun:test"
import { normalizeDevicePreferences } from "./devicePreferences"

describe("device preferences", () => {
  test("validates inherited profiles and keeps per-canvas focus keys", () => {
    expect(normalizeDevicePreferences({
      tabsVisible: false,
      canvasHeight: 2160,
      canvasFontSize: 24,
      mobilePortraitSplit: 0.42,
      mobileLandscapeSplit: 0.51,
      focusedTileByCanvas: { "canvas-1": "tile-device-key", invalid: 4 },
    })).toEqual({
      tabsVisible: false,
      canvasHeight: 2160,
      canvasFontSize: 24,
      mobilePortraitSplit: 0.42,
      mobileLandscapeSplit: 0.51,
      focusedTileByCanvas: { "canvas-1": "tile-device-key" },
    })
  })

  test("clamps malformed split ratios to usable mobile bounds", () => {
    const preferences = normalizeDevicePreferences({ mobilePortraitSplit: 0.99, mobileLandscapeSplit: -2 })
    expect(preferences.mobilePortraitSplit).toBe(0.72)
    expect(preferences.mobileLandscapeSplit).toBe(0)
  })
})
