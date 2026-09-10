import type { Canvas } from "../types"
import { DEFAULT_CANVAS_FONT_SIZE, normalizeCanvasFontSize } from "../utils/canvasFontSize"

const ACTIVE_CANVAS_STORAGE_KEY = "activeCanvasId"
const TABS_VISIBLE_STORAGE_KEY = "tabsVisible"
const CANVAS_HEIGHT_STORAGE_KEY = "canvasHeight"
const CANVAS_FONT_SIZE_STORAGE_KEY = "canvasFontSize"
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

export function readStoredCanvasFontSize() {
  const raw = localStorage.getItem(CANVAS_FONT_SIZE_STORAGE_KEY)
  return raw === null || raw.trim() === "" ? DEFAULT_CANVAS_FONT_SIZE : normalizeCanvasFontSize(Number(raw))
}

export function writeStoredCanvasFontSize(fontSize: number) {
  localStorage.setItem(CANVAS_FONT_SIZE_STORAGE_KEY, String(normalizeCanvasFontSize(fontSize)))
}
