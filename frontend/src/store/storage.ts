import type { Canvas } from "../types"

const ACTIVE_CANVAS_STORAGE_KEY = "activeCanvasId"
const TABS_VISIBLE_STORAGE_KEY = "tabsVisible"
const CANVAS_HEIGHT_STORAGE_KEY = "canvasHeight"
const DEFAULT_CANVAS_HEIGHT = 1440

export function readStoredActiveCanvasId() {
  const raw = localStorage.getItem(ACTIVE_CANVAS_STORAGE_KEY)
  if (raw === null) return null
  const id = Number(raw)
  if (!Number.isInteger(id)) return null
  return id
}

export function getStoredActiveCanvasId(canvases: Canvas[]) {
  const id = readStoredActiveCanvasId()
  if (id === null) return null
  return canvases.some((canvas) => canvas.id === id) ? id : null
}

export function writeStoredActiveCanvasId(id: number | null) {
  // A single writer avoids subtle drift between active state and restored tabs.
  if (id === null) localStorage.removeItem(ACTIVE_CANVAS_STORAGE_KEY)
  else localStorage.setItem(ACTIVE_CANVAS_STORAGE_KEY, String(id))
}

export function readStoredTabsVisible() {
  return localStorage.getItem(TABS_VISIBLE_STORAGE_KEY) !== "false"
}

export function writeStoredTabsVisible(visible: boolean) {
  localStorage.setItem(TABS_VISIBLE_STORAGE_KEY, String(visible))
}

export function readStoredCanvasHeight() {
  return Number(localStorage.getItem(CANVAS_HEIGHT_STORAGE_KEY) ?? DEFAULT_CANVAS_HEIGHT)
}

export function writeStoredCanvasHeight(height: number) {
  localStorage.setItem(CANVAS_HEIGHT_STORAGE_KEY, String(height))
}
