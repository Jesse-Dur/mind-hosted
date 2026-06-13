import { lazy } from "react"

const loadSpotlight = () => import("./Spotlight").then((module) => ({ default: module.Spotlight }))
const loadHistoryPanel = () => import("./HistoryPanel").then((module) => ({ default: module.HistoryPanel }))
const loadSettingsPanel = () => import("./SettingsPanel").then((module) => ({ default: module.SettingsPanel }))
const loadCanvasDeleteDialog = () => import("./CanvasDeleteDialog").then((module) => ({ default: module.CanvasDeleteDialog }))

export const LazySpotlight = lazy(loadSpotlight)
export const LazyHistoryPanel = lazy(loadHistoryPanel)
export const LazySettingsPanel = lazy(loadSettingsPanel)
export const LazyCanvasDeleteDialog = lazy(loadCanvasDeleteDialog)

export function preloadDeferredSurfaces() {
  // The shell should paint first; then warm chunks that users expect to open instantly.
  for (const loadSurface of [loadSpotlight, loadHistoryPanel, loadSettingsPanel, loadCanvasDeleteDialog]) {
    void loadSurface().catch(console.error)
  }
}
