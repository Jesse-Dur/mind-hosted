import { useRef } from "react"
import { useStore } from "../store"
import type { Tile } from "../types"

const GRID = 24
function snap(n: number) { return Math.round(n / GRID) * GRID }

export function useTileDrag(tile: Tile, scale: number) {
  const { updateTile, canvasHeight } = useStore()
  const CANVAS_W = Math.floor(Math.round(canvasHeight * (16 / 9)) / GRID) * GRID
  const CANVAS_H = canvasHeight
  const drag = useRef<{ mx: number; my: number; tx: number; ty: number } | null>(null)
  const resize = useRef<{ mx: number; my: number; tw: number; th: number } | null>(null)

  function onDragDown(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const startY = e.clientY
    const tileWidth = tile.width
    const tileHeight = tile.height
    const maxX = Math.floor((CANVAS_W - tileWidth) / GRID) * GRID
    const maxY = Math.floor((CANVAS_H - tileHeight) / GRID) * GRID
    let moved = false
    drag.current = { mx: e.clientX, my: e.clientY, tx: tile.x, ty: tile.y }

    function onMove(e: MouseEvent) {
      if (!drag.current) return
      if (!moved && (Math.abs(e.clientX - startX) > 8 || Math.abs(e.clientY - startY) > 8)) moved = true
      if (!moved) return
      e.preventDefault()
      const x = Math.max(0, Math.min(snap((drag.current.tx + (e.clientX - drag.current.mx))), maxX))
      const y = Math.max(0, Math.min(snap((drag.current.ty + (e.clientY - drag.current.my))), maxY))
      updateTile(tile.id, { x, y })
    }

    function onUp() {
      drag.current = null
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
      const width = Math.min(snap(CANVAS_W - tile.x), Math.max(GRID * 4, snap(resize.current.tw + (e.clientX - resize.current.mx))))
      const height = Math.min(snap(CANVAS_H - tile.y), Math.max(GRID * 4, snap(resize.current.th + (e.clientY - resize.current.my))))
      updateTile(tile.id, { width, height })
    }

    function onUp() {
      resize.current = null
      window.removeEventListener("mousemove", onMove)
      window.removeEventListener("mouseup", onUp)
    }

    window.addEventListener("mousemove", onMove)
    window.addEventListener("mouseup", onUp)
  }

  return { onDragDown, onResizeDown }
}
