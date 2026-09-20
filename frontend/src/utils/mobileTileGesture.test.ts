import { describe, expect, test } from "bun:test"
import { getMobileTileDropPoint, getMobileTileResize } from "./mobileTileGesture"

describe("mobile tile gestures", () => {
  test("tracks the grabbed point and snaps the tile preview to the desktop grid", () => {
    expect(getMobileTileDropPoint({
      clientX: 179,
      clientY: 157,
      hostLeft: 10,
      hostTop: 20,
      viewX: 12,
      viewY: 5,
      scale: .5,
      grabOffsetX: 48,
      grabOffsetY: 24,
      canvasWidth: 1920,
      canvasHeight: 1080,
      tileWidth: 480,
      tileHeight: 336,
    })).toEqual({ x: 264, y: 240 })
  })

  test("keeps the whole preview inside the destination canvas", () => {
    expect(getMobileTileDropPoint({
      clientX: 9999,
      clientY: 9999,
      hostLeft: 0,
      hostTop: 0,
      viewX: 0,
      viewY: 0,
      scale: 1,
      canvasWidth: 1920,
      canvasHeight: 1080,
      tileWidth: 480,
      tileHeight: 336,
    })).toEqual({ x: 1440, y: 744 })
    expect(getMobileTileDropPoint({
      clientX: 9999,
      clientY: 9999,
      hostLeft: 0,
      hostTop: 0,
      viewX: 0,
      viewY: 0,
      scale: 1,
      canvasWidth: 2560,
      canvasHeight: 1440,
      tileWidth: 480,
      tileHeight: 336,
    })).toEqual({ x: 2064, y: 1104 })
  })

  test("resizes a tile around its centre from an independent two-finger span", () => {
    expect(getMobileTileResize({
      tile: { x: 240, y: 192, width: 240, height: 192 },
      startSpanX: 80,
      startSpanY: 60,
      spanX: 104,
      spanY: 108,
      scale: .5,
      canvasWidth: 960,
      canvasHeight: 720,
    })).toEqual({ x: 216, y: 144, width: 288, height: 288 })
  })

  test("clamps pinched tiles to the grid and canvas bounds", () => {
    expect(getMobileTileResize({
      tile: { x: 0, y: 0, width: 120, height: 120 },
      startSpanX: 90,
      startSpanY: 90,
      spanX: 0,
      spanY: 500,
      scale: 1,
      canvasWidth: 480,
      canvasHeight: 360,
    })).toEqual({ x: 24, y: 0, width: 96, height: 360 })
  })
})
