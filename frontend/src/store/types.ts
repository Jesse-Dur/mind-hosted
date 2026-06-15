import type { StateCreator } from "zustand"
import type { Canvas, HistoryEvent, Tag, Thought, Tile } from "../types"

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
  highlightedId: { type: "tile" | "thought"; id: number } | null
  remoteChangedTileIds: Set<number>
  remoteChangedThoughtIds: Set<number>
  markRemoteChanges: (tileIds: number[], thoughtIds: number[]) => void
  setHighlight: (type: "tile" | "thought", id: number) => void
  setSpotlightOpen: (open: boolean) => void
  setSidebarOpen: (open: boolean) => void
  setCanvasHeight: (height: number) => void
  setTabsVisible: (visible: boolean) => void
}

export interface CanvasSlice {
  canvases: Canvas[]
  activeCanvasId: number | null
  loadCanvases: () => Promise<number | null>
  setActiveCanvas: (id: number) => void
  addCanvas: (name: string) => CanvasCreation
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
  initializeSync: () => Promise<void>
  syncNow: () => Promise<void>
}

export type CachedWorkspaceHydration = {
  activeCanvasId: number | null
  hasUsableCache: boolean
}

export interface BootSlice {
  hydrateCachedWorkspace: () => Promise<CachedWorkspaceHydration>
}

export type AppStore = UiSlice
  & BootSlice
  & CanvasSlice
  & CanvasDataSlice
  & TileSlice
  & ThoughtSlice
  & TagSlice
  & HistorySlice
  & AiSlice
  & SyncSlice

export type StoreSlice<Slice> = StateCreator<AppStore, [], [], Slice>
