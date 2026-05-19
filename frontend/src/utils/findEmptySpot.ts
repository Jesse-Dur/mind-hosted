import type { Tile } from "../types"

const GRID = 24

function overlaps(ax: number, ay: number, aw: number, ah: number, t: Tile) {
  return ax < t.x + t.width && ax + aw > t.x && ay < t.y + t.height && ay + ah > t.y
}

export function findEmptySpot(tiles: Tile[], width: number, height: number): { x: number; y: number } {
  for (let row = 0; row * GRID + height <= 1440; row++) {
    for (let col = 0; col * GRID + width <= 2560; col++) {
      const x = col * GRID
      const y = row * GRID
      if (!tiles.some((t) => overlaps(x, y, width, height, t))) return { x, y }
    }
  }
  return { x: GRID, y: GRID }
}
