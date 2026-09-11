// This file defines the app store contract and the slice interfaces that compose it.
import type { StateCreator } from "zustand"
import type { BillingCreationLimitFeature, BillingLimitFeature, BillingLimitNotice, BillingOverage, BillingPlanImpact, BillingPlanSwitchResult, BillingPlans, BillingUsage, Canvas, HistoryEvent, Tag, Thought, Tile } from "../types"
import type { SyncActivityRecord, SyncEntityStatus } from "../sync/types"

export type AiStatus = "idle" | "processing" | "queued" | "limited"
export type CanvasOrderUpdate = Pick<Canvas, "id" | "sort_order" | "is_favourite">
export type AiPriority = "low" | "medium" | "high"
export type CanvasDeleteOptions =
  | { mode: "deleteContents" }
  | { mode: "moveContents"; targetCanvasId: number }

export type CanvasCreation = {
  canvas: Canvas
  persisted: Promise<Canvas>
}

export type ThoughtMoveOptions = {
  sourceCanvasId?: number | null
  targetCanvasId?: number | null
  orderedIds?: number[]
}

export interface UiSlice {
  tabsVisible: boolean
  spotlightOpen: boolean
  sidebarOpen: boolean
  canvasHeight: number
  mobilePortraitSplit: number
  mobileLandscapeSplit: number
  focusedTileByCanvas: Record<string, string>
  canvasFontSize: number
  highlightedId: { type: "tile" | "thought"; id: number } | null
  recentLocalTileChangeIds: Map<number, number>
  remoteChangedTileIds: Set<number>
  remoteChangedThoughtIds: Set<number>
  markLocalTileChange: (tileId: number) => void
  markRemoteChanges: (tileIds: number[], thoughtIds: number[]) => void
  setHighlight: (type: "tile" | "thought", id: number) => void
  setSpotlightOpen: (open: boolean) => void
  setSidebarOpen: (open: boolean) => void
  setCanvasHeight: (height: number) => void
  setCanvasFontSize: (fontSize: number) => void
  setTabsVisible: (visible: boolean) => void
  applyDevicePreferences: (preferences: import("../preferences/devicePreferences").DevicePreferences) => void
  setMobileSplit: (orientation: "portrait" | "landscape", ratio: number) => void
  setFocusedTile: (canvasKey: string, tileKey: string) => void
}

export interface CanvasSlice {
  canvases: Canvas[]
  activeCanvasId: number | null
  loadCanvases: () => Promise<number | null>
  setActiveCanvas: (id: number) => void
  addCanvas: (name: string) => CanvasCreation | null
  updateCanvas: (id: number, data: Partial<Pick<Canvas, "name" | "sort_order" | "is_favourite">>) => Promise<void>
  removeCanvas: (id: number, options: CanvasDeleteOptions) => Promise<void>
  reorderCanvases: (updates: CanvasOrderUpdate[]) => void
}

export interface CanvasDataSlice {
  tileCache: Map<number, Tile[]>
  thoughtCache: Map<number, Thought[]>
  tiles: Tile[]
  thoughts: Thought[]
  loadTiles: (canvasId?: number) => Promise<void>
  loadThoughts: (canvasId?: number) => Promise<void>
  hydrateRemainingCanvases: (refresh?: boolean) => Promise<void>
}

export interface TileSlice {
  addTile: (tile: Omit<Tile, "id" | "created_at">) => Promise<void>
  moveTileLocal: (id: number, data: Partial<Tile>, fallbackTile?: Tile) => void
  updateTile: (id: number, data: Partial<Tile>) => Promise<void | Tile>
  moveTileToCanvas: (id: number, targetCanvasId: number, x: number, y: number) => Promise<void>
  removeTile: (id: number) => Promise<void>
}

export interface ThoughtSlice {
  thoughtStableKeys: Map<number, number>
  addThought: (thought: Omit<Thought, "id" | "created_at">) => Promise<void>
  addThoughtToTile: (tileId: number, content: string, tags: string[]) => Promise<void>
  adoptTemporaryTileThoughts: (temporaryTileId: number, savedTileId: number) => Promise<void>
  discardThoughtsForTile: (tileId: number) => void
  moveThoughtToTile: (id: number, tileId: number, options?: ThoughtMoveOptions) => Promise<void>
  removeThought: (id: number) => void
  updateThoughtContent: (id: number, content: string) => Promise<void>
  updateThoughtTags: (id: number, tags: string[]) => Promise<void>
}

export interface TagSlice {
  tags: Tag[]
  loadTags: () => Promise<void>
  addTag: (name: string, color: string) => Promise<void>
  updateTag: (id: number, name: string, color: string) => Promise<void>
  removeTag: (id: number) => Promise<void>
}

export interface HistorySlice {
  historyEvents: HistoryEvent[]
  historyNextCursor: string | null
  historyHasMore: boolean
  historyLoaded: boolean
  historyRefreshing: boolean
  historyLoadingMore: boolean
  newHistoryIds: Set<number>
  hydrateHistoryCache: () => Promise<void>
  refreshHistory: () => Promise<void>
  loadMoreHistory: () => Promise<void>
}

export interface AiSlice {
  aiStatus: AiStatus
  loadAiStatus: () => Promise<void>
  startAiPolling: () => void
  setAiStatus: (status: AiStatus) => void
  processAiInput: (input: string, priority?: AiPriority) => void
}

export interface SyncSlice {
  syncPendingCount: number
  syncEntityStatuses: Map<string, SyncEntityStatus>
  syncActivity: SyncActivityRecord[]
  startSyncRuntime: () => Promise<void>
  syncNow: () => Promise<void>
  refreshSyncStatuses: () => Promise<void>
  retrySyncOperation: (opId: string) => Promise<void>
  keepSyncOperationLocal: (opId: string) => Promise<void>
  discardSyncOperation: (opId: string) => Promise<void>
}

export interface BillingSlice {
  billingUsage: BillingUsage | null
  billingPlans: BillingPlans | null
  billingUsageLoading: boolean
  billingPlansLoading: boolean
  billingUsageError: string | null
  billingPlansError: string | null
  billingChangedFeatureIds: Set<BillingUsage["features"][number]["id"]>
  billingOverageModalOpen: boolean
  billingOverageDismissReady: boolean
  billingOverageDismissSeconds: number
  billingCreationLimitNotice: BillingLimitNotice | null
  hydrateBillingCache: () => Promise<void>
  preloadBillingUsage: () => Promise<BillingUsage>
  refreshBillingUsage: () => Promise<BillingUsage>
  preloadBillingPlans: () => Promise<BillingPlans>
  refreshBillingPlans: () => Promise<BillingPlans>
  previewBillingPlanImpact: (planId: string) => Promise<BillingPlanImpact>
  switchBillingPlan: (planId: string, confirmedOverLimit?: boolean) => Promise<BillingPlanSwitchResult>
  openBillingOverageModal: (options?: { immediateDismiss?: boolean }) => void
  closeBillingOverageModal: () => void
  setBillingOverageDismissState: (state: { ready: boolean; seconds: number }) => void
  showBillingCreationLimitNotice: (feature: BillingLimitFeature, options?: { resetAt?: string | null }) => void
  dismissBillingCreationLimitNotice: () => void
  canCreateBillingFeature: (feature: BillingCreationLimitFeature) => boolean
  adjustBillingFeatureUsage: (feature: BillingCreationLimitFeature, delta: number) => void
  assertBillingEditingAllowed: () => void
  assertBillingCreationAllowed: (feature: BillingOverage["suspended_creation"][number]) => void
  resetBillingState: () => void
}

export interface SessionSlice {
  resetStore: () => void
}

export type CachedWorkspaceHydration = {
  activeCanvasId: number | null
  hasUsableCache: boolean
}

export interface WorkspaceRestoreSlice {
  restoreCachedWorkspace: () => Promise<CachedWorkspaceHydration>
}

export type AppStore = UiSlice
  & WorkspaceRestoreSlice
  & CanvasSlice
  & CanvasDataSlice
  & TileSlice
  & ThoughtSlice
  & TagSlice
  & HistorySlice
  & AiSlice
  & SyncSlice
  & BillingSlice
  & SessionSlice

export type StoreSlice<Slice> = StateCreator<AppStore, [], [], Slice>
