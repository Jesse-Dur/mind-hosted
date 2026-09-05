import { describe, expect, test } from "bun:test"
import {
  getEffectiveCanvasFontSize,
  getEnforcedTileBounds,
  getMinimumTileWidth,
  getThoughtControlMetrics,
  getThoughtRequiredTileWidth,
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
    expect(getEffectiveCanvasFontSize(36, 96, 0)).toBe(18)
    expect(getEffectiveCanvasFontSize(36, 96, 1)).toBe(9)
    expect(getEffectiveCanvasFontSize(36, 120, 1)).toBe(23)
    expect(getEffectiveCanvasFontSize(36, 120, 2)).toBe(17)
  })

  test("reserves the full width of every tag dot", () => {
    expect(getThoughtRequiredTileWidth(8, 1)).toBe(96)
    expect(getThoughtRequiredTileWidth(8, 2)).toBe(108)
    expect(getThoughtRequiredTileWidth(8, 3)).toBe(120)
  })

  test("raises the minimum tile width once the 8px font cannot fit", () => {
    expect(getMinimumTileWidth(0)).toBe(96)
    expect(getMinimumTileWidth(1)).toBe(96)
    expect(getMinimumTileWidth(2)).toBe(120)
    expect(getMinimumTileWidth(3)).toBe(120)
    expect(getMinimumTileWidth(4)).toBe(144)
  })

  test("always leaves every tag and control inside the enforced width", () => {
    for (let tagCount = 0; tagCount <= 12; tagCount += 1) {
      const minimumWidth = getMinimumTileWidth(tagCount)
      const fontSize = getEffectiveCanvasFontSize(36, minimumWidth, tagCount)

      expect(minimumWidth % 24).toBe(0)
      expect(getThoughtRequiredTileWidth(fontSize, tagCount)).toBeLessThanOrEqual(minimumWidth)
    }
  })

  test("moves a widened tile back inside the canvas", () => {
    expect(getEnforcedTileBounds(1824, 96, 144, 1920)).toEqual({ x: 1776, width: 144 })
    expect(getEnforcedTileBounds(240, 280, 96, 1920)).toEqual({ x: 240, width: 280 })
  })
})
