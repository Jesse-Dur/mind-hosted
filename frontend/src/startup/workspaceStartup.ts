// This file coordinates workspace startup phases so App.tsx stays focused on rendering the shell.
import { useStore } from "../store"
import { configureAccountDatabase } from "../sync/localDb"
import { hydrateDevicePreferences } from "../preferences/devicePreferences"
import { refreshPastEntitiesCache } from "../sync/pastCache"
import { assertSyncAccountScopeCurrent, runSyncAccountTask } from "../sync/accountScope"

export type WorkspaceBootstrapResult = {
  activeCanvasId: number | null
  hasUsableCache: boolean
}

async function hydrateBackgroundWorkspace(activeCanvasId: number | null, refreshActiveCanvas: boolean) {
  return runSyncAccountTask(async (scope) => {
    const store = useStore.getState()

  // Background hydration should never block the shell. It only fills in warmer caches after the first paint.
    if (refreshActiveCanvas && activeCanvasId !== null) {
      await Promise.all([
        store.loadCanvases(),
        store.loadTags(),
        store.loadTiles(activeCanvasId),
        store.loadThoughts(activeCanvasId),
      ])
      assertSyncAccountScopeCurrent(scope)
    }

    await Promise.all([
      store.hydrateHistoryCache(),
      store.hydrateBillingCache(),
    ])
    assertSyncAccountScopeCurrent(scope)
    // Spotlight always reads Past from IndexedDB. Reconcile that cache only as
    // background work so tapping the control never waits on the network.
    await refreshPastEntitiesCache()
    assertSyncAccountScopeCurrent(scope)
    await store.hydrateRemainingCanvases()
    assertSyncAccountScopeCurrent(scope)
  })
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

export async function bootstrapCriticalWorkspace(userId?: string | null, canUseServer = true): Promise<WorkspaceBootstrapResult | null> {
  if (userId) await configureAccountDatabase(userId)
  const store = useStore.getState()
  // Account transitions wait for old scoped tasks before the database swap.
  // Reset once more after that boundary so no old-account completion can remain
  // in the shared in-memory store.
  if (userId) store.resetStore()
  // Local preferences apply synchronously; same-class/server reconciliation is
  // background work and must never delay an offline cached workspace.
  void hydrateDevicePreferences(store.applyDevicePreferences, Boolean(userId) && canUseServer).catch(console.error)
  // Status/history hydration is useful but not required to draw the workspace.
  // Start it alongside the entity-cache read so large local activity logs never
  // hold the loading screen open.
  void store.startSyncRuntime().catch(console.error)

  const cached = await store.restoreCachedWorkspace()
  if (cached.hasUsableCache) return cached
  // A remembered account does not guarantee either a cache or a valid session.
  // Leave startup pending until sign-in can fetch the missing workspace.
  if (!canUseServer) return null

  // No local workspace means we must fetch enough server state to draw the initial shell.
  const initialCanvasId = await store.loadCanvases()
  // loadCanvases tolerates auth/network failures. Those are not a ready workspace;
  // a successful server snapshot always includes at least the default canvas.
  if (useStore.getState().canvases.length === 0) return null
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
