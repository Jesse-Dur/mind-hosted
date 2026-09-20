const GRID = 24

const snap = (value: number) => Math.round(value / GRID) * GRID
const floorToGrid = (value: number) => Math.floor(value / GRID) * GRID

export function getMobileTileDropPoint({ clientX, clientY, hostLeft, hostTop, viewX, viewY, scale, grabOffsetX = 0, grabOffsetY = 0, canvasWidth, canvasHeight, tileWidth = 0, tileHeight = 0 }: { clientX: number; clientY: number; hostLeft: number; hostTop: number; viewX: number; viewY: number; scale: number; grabOffsetX?: number; grabOffsetY?: number; canvasWidth: number; canvasHeight: number; tileWidth?: number; tileHeight?: number }) {
  const safeScale = Math.max(.01, scale)
  const maxX = Math.max(0, floorToGrid(canvasWidth - tileWidth))
  const maxY = Math.max(0, floorToGrid(canvasHeight - tileHeight))
  return {
    x: Math.max(0, Math.min(maxX, snap((clientX - hostLeft - viewX) / safeScale - grabOffsetX))),
    y: Math.max(0, Math.min(maxY, snap((clientY - hostTop - viewY) / safeScale - grabOffsetY))),
  }
}

export function getMobileTileResize({ tile, startSpanX, startSpanY, spanX, spanY, scale, canvasWidth, canvasHeight }: {
  tile: { x: number; y: number; width: number; height: number }
  startSpanX: number
  startSpanY: number
  spanX: number
  spanY: number
  scale: number
  canvasWidth: number
  canvasHeight: number
}) {
  const safeScale = Math.max(.01, scale)
  const minSize = GRID * 4
  const centerX = tile.x + tile.width / 2
  const centerY = tile.y + tile.height / 2
  const width = Math.max(minSize, Math.min(canvasWidth, snap(tile.width + (spanX - startSpanX) / safeScale)))
  const height = Math.max(minSize, Math.min(canvasHeight, snap(tile.height + (spanY - startSpanY) / safeScale)))
  return {
    x: Math.max(0, Math.min(canvasWidth - width, snap(centerX - width / 2))),
    y: Math.max(0, Math.min(canvasHeight - height, snap(centerY - height / 2))),
    width,
    height,
  }
}
