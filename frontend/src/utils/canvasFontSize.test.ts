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

})
