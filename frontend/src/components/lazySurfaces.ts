import { lazy } from "react"

const loadSpotlight = () => import("./Spotlight").then((module) => ({ default: module.Spotlight }))
const loadCanvasDeleteDialog = () => import("./CanvasDeleteDialog").then((module) => ({ default: module.CanvasDeleteDialog }))

export const LazySpotlight = lazy(loadSpotlight)
export const LazyCanvasDeleteDialog = lazy(loadCanvasDeleteDialog)

export function preloadDeferredSurfaces() {
  // The shell should paint first; then warm chunks that users expect to open instantly.
  for (const loadSurface of [loadSpotlight, loadCanvasDeleteDialog]) {
    void loadSurface().catch(console.error)
  }
}
