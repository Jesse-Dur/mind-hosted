import { describe, expect, test } from "bun:test"
import {
  getEffectiveCanvasFontSize,
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
    expect(getEffectiveCanvasFontSize(36, 144, 0)).toBe(28)
    expect(getEffectiveCanvasFontSize(36, 144, 1)).toBe(22)
    expect(getEffectiveCanvasFontSize(36, 144, 2)).toBe(16)
    expect(getEffectiveCanvasFontSize(36, 168, 2)).toBe(27)
  })

  test("reserves every tag dot and a stable sync control area", () => {
    expect(getThoughtRequiredTileWidth(8, 1)).toBe(122)
    expect(getThoughtRequiredTileWidth(8, 2)).toBe(134)
    expect(getThoughtRequiredTileWidth(8, 3)).toBe(146)
  })

})
