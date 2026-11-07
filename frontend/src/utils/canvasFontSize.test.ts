import { describe, expect, test } from "bun:test"
import {
  getEffectiveCanvasFontSize,
  getThoughtControlMetrics,
  getThoughtRequiredTileWidth,
  getThoughtSyncMetrics,
  getThoughtTagMetrics,
} from "./canvasFontSize"

describe("thought control sizing", () => {
  test("scales fully in a normal tile", () => {
    expect(getThoughtControlMetrics(36)).toEqual({
      controlSize: 40,
      handleSize: 30,
      closeIconSize: 22,
    })
    expect(getThoughtControlMetrics(8)).toEqual({
      controlSize: 13,
      handleSize: 7,
      closeIconSize: 7,
    })
  })

  test("reduces the whole tile font when the preferred size cannot fit", () => {
    expect(getEffectiveCanvasFontSize(36, 144, 0)).toBe(24)
    expect(getEffectiveCanvasFontSize(36, 144, 1)).toBe(18)
    expect(getEffectiveCanvasFontSize(36, 144, 2)).toBe(13)
    expect(getEffectiveCanvasFontSize(36, 168, 2)).toBe(20)
    for (const tileWidth of [144, 168, 240, 400]) {
      for (const tagCount of [0, 1, 2, 3]) {
        const fitted = getEffectiveCanvasFontSize(36, tileWidth, tagCount)
        expect(getThoughtRequiredTileWidth(fitted, tagCount)).toBeLessThanOrEqual(tileWidth)
        if (fitted < 36) expect(getThoughtRequiredTileWidth(fitted + 1, tagCount)).toBeGreaterThan(tileWidth)
      }
    }
  })

  test("reserves every tag dot and a stable sync control area", () => {
    expect(getThoughtRequiredTileWidth(8, 1)).toBe(119)
    expect(getThoughtRequiredTileWidth(8, 2)).toBe(127)
    expect(getThoughtRequiredTileWidth(8, 3)).toBe(135)
  })

  test("scales tag circles and spacing with the displayed thought font", () => {
    expect(getThoughtTagMetrics(8)).toEqual({ size: 5, width: 8, height: 13, trailingOffset: 3 })
    expect(getThoughtTagMetrics(13)).toEqual({ size: 8, width: 12, height: 18, trailingOffset: 4 })
    expect(getThoughtTagMetrics(36)).toEqual({ size: 22, width: 33, height: 40, trailingOffset: 11 })
    for (const fontSize of [8, 13, 24, 36]) {
      const metrics = getThoughtTagMetrics(fontSize)
      expect(metrics.size).toBeLessThanOrEqual(metrics.height)
      expect(getThoughtRequiredTileWidth(fontSize, 3) - getThoughtRequiredTileWidth(fontSize, 2)).toBe(metrics.width)
    }
  })

  test("reserves enough width for the scaled spinner at every supported font size", () => {
    expect([8, 13, 24, 36].map((size) => getThoughtSyncMetrics(size).spinnerSize)).toEqual([7, 12, 22, 33])
    for (let fontSize = 8; fontSize <= 36; fontSize += 1) {
      const metrics = getThoughtSyncMetrics(fontSize)
      expect(metrics.controlSize).toBeGreaterThanOrEqual(metrics.spinnerSize + 8)
      expect(metrics.reserve).toBe(metrics.controlSize + 6)
    }
  })
})
