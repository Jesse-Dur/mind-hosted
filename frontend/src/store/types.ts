import type { StateCreator } from "zustand"
import type { Canvas, Tag, Thought, Tile } from "../types"
import type { CanvasDeleteOptions } from "../api/client"

export type AiStatus = "idle" | "processing" | "queued" | "limited"
export type CanvasOrderUpdate = Pick<Canvas, "id" | "sort_order" | "is_favourite">
export type AiPriority = "low" | "medium" | "high"

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
  inFlightTileMoves: Set<number>
  newestTileId: number | null
  addTile: (tile: Omit<Tile, "id" | "created_at">) => Promise<void>
  moveTileLocal: (id: number, data: Partial<Tile>, fallbackTile?: Tile) => void
  updateTile: (id: number, data: Partial<Tile>) => Promise<void | Tile>
  moveTileToCanvas: (id: number, targetCanvasId: number, x: number, y: number) => Promise<void>
  removeTile: (id: number) => Promise<void>
}

export interface ThoughtSlice {
  newThoughtIds: Set<number>
  thoughtStableKeys: Map<number, number>
  inFlightMoves: Set<number>
  addThought: (thought: Omit<Thought, "id" | "created_at">) => Promise<void>
  addThoughtToTile: (tileId: number, content: string, tags: string[]) => Promise<void>
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

export interface AiSlice {
  aiStatus: AiStatus
  loadAiStatus: () => Promise<void>
  startAiPolling: () => void
  setAiStatus: (status: AiStatus) => void
  processAiInput: (input: string, priority?: AiPriority) => void
}

export type AppStore = UiSlice
  & CanvasSlice
  & CanvasDataSlice
  & TileSlice
  & ThoughtSlice
  & TagSlice
  & AiSlice

export type StoreSlice<Slice> = StateCreator<AppStore, [], [], Slice>
