// This file coordinates workspace startup phases so App.tsx stays focused on rendering the shell.
import { useStore } from "../store"

export type WorkspaceBootstrapResult = {
  activeCanvasId: number | null
  hasUsableCache: boolean
}

async function hydrateBackgroundWorkspace(activeCanvasId: number | null, refreshActiveCanvas: boolean) {
  const store = useStore.getState()

  // Background hydration should never block the shell. It only fills in warmer caches after the first paint.
  if (refreshActiveCanvas && activeCanvasId !== null) {
    await Promise.all([
      store.loadCanvases(),
      store.loadTags(),
      store.loadTiles(activeCanvasId),
      store.loadThoughts(activeCanvasId),
    ])
  }

  await Promise.all([
    store.hydrateHistoryCache(),
    store.hydrateBillingCache(),
  ])
  await store.hydrateRemainingCanvases()
}

async function warmSidebarOnOpen() {
  // Opening the sidebar should not do anything heavier than hover; it is just
  // a fallback signal if the user goes straight to the panel without hovering.
  await warmSidebarOnHover()
}

async function warmSidebarOnHover() {
  const store = useStore.getState()
  await Promise.all([
    store.hydrateHistoryCache(),
    store.refreshHistory(),
    store.hydrateBillingCache(),
    // Hover is the earliest low-cost signal that the sidebar is about to be used,
    // so we only stage the current usage payload instead of forcing a refresh.
    store.preloadBillingUsage(),
  ])
}

async function warmBillingOnPlans() {
  const store = useStore.getState()
  await store.hydrateBillingCache()
  await Promise.all([
    store.refreshBillingUsage(),
    // The usage page should make plans ready, but it does not need to revalidate
    // them yet; the plans page itself does that when it opens.
    store.preloadBillingPlans(),
  ])
}

export async function bootstrapCriticalWorkspace(): Promise<WorkspaceBootstrapResult> {
  const store = useStore.getState()
  // Start the authenticated settings read early, but preserve cached workspace startup's no-network wait.
  void store.loadUserSettings().catch(console.error)
  await store.startSyncRuntime()

  const cached = await store.restoreCachedWorkspace()
  if (cached.hasUsableCache) return cached

  // No local workspace means we must fetch enough server state to draw the initial shell.
  const initialCanvasId = await store.loadCanvases()
  return { activeCanvasId: initialCanvasId, hasUsableCache: false }
}

export function startDeferredWorkspaceWarmup(activeCanvasId: number | null, refreshActiveCanvas: boolean) {
  // The loading screen fade is the earliest safe point to start warming background data.
  void hydrateBackgroundWorkspace(activeCanvasId, refreshActiveCanvas).catch(console.error)
}

export function startSidebarWarmupOnOpen() {
  // Opening the sidebar should match hover so we keep the fallback path cheap.
  return warmSidebarOnOpen().catch(console.error)
}

export function startSidebarWarmupOnHover() {
  // Hover is the earliest cheap signal that the sidebar is about to be used,
  // so we keep it to the current usage payload and history.
  return warmSidebarOnHover().catch(console.error)
}

export function startBillingWarmupOnPlans() {
  // The usage surface should refresh usage, then stage plans so the plans page
  // can revalidate itself when it becomes visible.
  return warmBillingOnPlans().catch(console.error)
}
