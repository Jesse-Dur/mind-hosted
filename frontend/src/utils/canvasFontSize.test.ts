import { describe, expect, test } from "bun:test"
import {
  getEffectiveCanvasFontSize,
  getThoughtControlMetrics,
  getThoughtRequiredTileWidth,
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
    expect(getEffectiveCanvasFontSize(36, 144, 0)).toBe(28)
    expect(getEffectiveCanvasFontSize(36, 144, 1)).toBe(20)
    expect(getEffectiveCanvasFontSize(36, 144, 2)).toBe(13)
    expect(getEffectiveCanvasFontSize(36, 168, 2)).toBe(21)
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
})
