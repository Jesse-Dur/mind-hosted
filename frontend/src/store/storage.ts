import type { Canvas } from "../types"
import { readLocalDevicePreferences } from "../preferences/devicePreferences"
import { getActiveSyncUserId } from "../sync/localDb"
import { normalizeCanvasFontSize } from "../utils/canvasFontSize"

const ACTIVE_CANVAS_STORAGE_KEY = "activeCanvasId"
const TABS_VISIBLE_STORAGE_KEY = "tabsVisible"
const CANVAS_HEIGHT_STORAGE_KEY = "canvasHeight"
const CANVAS_FONT_SIZE_STORAGE_KEY = "canvasFontSize"

function activeCanvasStorageKey() {
  const userId = getActiveSyncUserId()
  return userId ? `${ACTIVE_CANVAS_STORAGE_KEY}:${encodeURIComponent(userId)}` : ACTIVE_CANVAS_STORAGE_KEY
}

export function readStoredActiveCanvasId() {
  const raw = localStorage.getItem(activeCanvasStorageKey())
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
  const key = activeCanvasStorageKey()
  if (id === null) localStorage.removeItem(key)
  else localStorage.setItem(key, String(id))
}

export function readStoredTabsVisible() {
  return readLocalDevicePreferences().tabsVisible
}

export function writeStoredTabsVisible(visible: boolean) {
  localStorage.setItem(TABS_VISIBLE_STORAGE_KEY, String(visible))
}

export function readStoredCanvasHeight() {
  return readLocalDevicePreferences().canvasHeight
}

export function writeStoredCanvasHeight(height: number) {
  localStorage.setItem(CANVAS_HEIGHT_STORAGE_KEY, String(height))
}

export function readStoredCanvasFontSize() {
  return readLocalDevicePreferences().canvasFontSize
}

export function writeStoredCanvasFontSize(fontSize: number) {
  localStorage.setItem(CANVAS_FONT_SIZE_STORAGE_KEY, String(normalizeCanvasFontSize(fontSize)))
}
