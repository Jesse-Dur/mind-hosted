import { useRef } from "react"
import { useStore } from "../store"
import { beginCrossCanvasDrag, endCrossCanvasDrag, getCrossCanvasDrag, moveCrossCanvasDrag } from "../utils/crossCanvasDrag"
import type { Thought, Tile } from "../types"

const GRID = 24
function snap(n: number) { return Math.round(n / GRID) * GRID }

export function useTileDrag(tile: Tile, tileThoughts: Thought[], scale: number) {
  const updateTile = useStore((s) => s.updateTile)
  const moveTileLocal = useStore((s) => s.moveTileLocal)
  const moveTileToCanvas = useStore((s) => s.moveTileToCanvas)
  const canvasHeight = useStore((s) => s.canvasHeight)
  const CANVAS_W = Math.floor(Math.round(canvasHeight * (16 / 9)) / GRID) * GRID
  const CANVAS_H = canvasHeight
  const drag = useRef<{ mx: number; my: number; tx: number; ty: number } | null>(null)
  const resize = useRef<{ mx: number; my: number; tw: number; th: number } | null>(null)

  function getCanvasRect() {
    return document.querySelector<HTMLElement>("[data-mind-canvas]")?.getBoundingClientRect() ?? null
  }

  function getCanvasDropPoint(clientX: number, clientY: number, grabOffsetX: number, grabOffsetY: number, tileWidth: number, tileHeight: number) {
    const rect = getCanvasRect()
    if (!rect) return null
    const maxX = Math.floor((CANVAS_W - tileWidth) / GRID) * GRID
    const maxY = Math.floor((CANVAS_H - tileHeight) / GRID) * GRID
    const x = Math.max(0, Math.min(snap((clientX - rect.left) / scale - grabOffsetX), maxX))
    const y = Math.max(0, Math.min(snap((clientY - rect.top) / scale - grabOffsetY), maxY))
    return { x, y }
  }

  function getDragVisualPoint(clientX: number, clientY: number, grabOffsetX: number, grabOffsetY: number, tileWidth: number, tileHeight: number) {
    const rect = getCanvasRect()
    if (!rect) return null
    const maxX = Math.floor((CANVAS_W - tileWidth) / GRID) * GRID
    const maxY = Math.floor((CANVAS_H - tileHeight) / GRID) * GRID
    const minY = -Math.round(rect.top / scale)
    const x = Math.max(0, Math.min(snap((clientX - rect.left) / scale - grabOffsetX), maxX))
    const y = Math.max(minY, Math.min(snap((clientY - rect.top) / scale - grabOffsetY), maxY))
    return { x, y }
  }

  function onDragDown(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const startY = e.clientY
    const tileWidth = tile.width
    const tileHeight = tile.height
    const sourceCanvasId = tile.canvas_id ?? useStore.getState().activeCanvasId
    const canvasRect = getCanvasRect()
    const grabOffsetX = canvasRect ? (e.clientX - canvasRect.left) / scale - tile.x : 0
    const grabOffsetY = canvasRect ? (e.clientY - canvasRect.top) / scale - tile.y : 0
    let moved = false
    let crossDragStarted = false
    drag.current = { mx: e.clientX, my: e.clientY, tx: tile.x, ty: tile.y }

    function onMove(e: MouseEvent) {
      if (!drag.current) return
      if (!moved && (Math.abs(e.clientX - startX) > 8 || Math.abs(e.clientY - startY) > 8)) moved = true
      if (!moved) return
      e.preventDefault()
      if (!crossDragStarted) {
        crossDragStarted = true
        beginCrossCanvasDrag({
          kind: "tile",
          tile,
          thoughts: tileThoughts,
          sourceCanvasId,
          grabOffsetX,
          grabOffsetY,
          clientX: e.clientX,
          clientY: e.clientY,
          enteredCanvasId: null,
        })
      }
      moveCrossCanvasDrag(e.clientX, e.clientY)
      const visualPoint = getDragVisualPoint(e.clientX, e.clientY, grabOffsetX, grabOffsetY, tileWidth, tileHeight)
      if (visualPoint) moveTileLocal(tile.id, visualPoint, tile)
    }

    function onUp(e: MouseEvent) {
      if (moved && drag.current) {
        const session = getCrossCanvasDrag()
        const enteredCanvasId = session?.kind === "tile" && session.tile.id === tile.id ? session.enteredCanvasId : null
        if (enteredCanvasId !== null && enteredCanvasId !== sourceCanvasId) {
          const dropPoint = getCanvasDropPoint(e.clientX, e.clientY, grabOffsetX, grabOffsetY, tileWidth, tileHeight)
          if (dropPoint) void moveTileToCanvas(tile.id, enteredCanvasId, dropPoint.x, dropPoint.y)
        } else {
          const dropPoint = getCanvasDropPoint(e.clientX, e.clientY, grabOffsetX, grabOffsetY, tileWidth, tileHeight)
          if (dropPoint) updateTile(tile.id, dropPoint)
        }
      }
      drag.current = null
      if (crossDragStarted) endCrossCanvasDrag()
      window.removeEventListener("mousemove", onMove)
      window.removeEventListener("mouseup", onUp)
    }

    window.addEventListener("mousemove", onMove)
    window.addEventListener("mouseup", onUp)
  }

  function onResizeDown(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    resize.current = { mx: e.clientX, my: e.clientY, tw: tile.width, th: tile.height }

    function onMove(e: MouseEvent) {
      if (!resize.current) return
      e.preventDefault()
      const width = Math.min(snap(CANVAS_W - tile.x), Math.max(GRID * 4, snap(resize.current.tw + (e.clientX - resize.current.mx) / scale)))
      const height = Math.min(snap(CANVAS_H - tile.y), Math.max(GRID * 4, snap(resize.current.th + (e.clientY - resize.current.my) / scale)))
      useStore.getState().moveTileLocal(tile.id, { width, height })
    }

    function onUp(e: MouseEvent) {
      if (resize.current) {
        const width = Math.min(snap(CANVAS_W - tile.x), Math.max(GRID * 4, snap(resize.current.tw + (e.clientX - resize.current.mx) / scale)))
        const height = Math.min(snap(CANVAS_H - tile.y), Math.max(GRID * 4, snap(resize.current.th + (e.clientY - resize.current.my) / scale)))
        updateTile(tile.id, { width, height })
      }
      resize.current = null
      window.removeEventListener("mousemove", onMove)
      window.removeEventListener("mouseup", onUp)
    }

    window.addEventListener("mousemove", onMove)
    window.addEventListener("mouseup", onUp)
  }

  return { onDragDown, onResizeDown }
}
