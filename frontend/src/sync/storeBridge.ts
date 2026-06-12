import type { Canvas, Tag, Thought, Tile } from "../types"
import type { AppStore } from "../store/types"
import { writeStoredActiveCanvasId } from "../store/storage"
import type { LocalEntityRecord, SyncEntity, SyncEntityType, SyncPayload } from "./types"

type GetState = () => AppStore
type SetState = (updater: (state: AppStore) => Partial<AppStore>) => void
type ApplyRemoteEntityOptions = { animate?: boolean }

let getState: GetState | null = null
let setState: SetState | null = null

export function registerSyncStore(get: GetState, set: SetState) {
  getState = get
  setState = set
}

function updateMapList<T>(map: Map<number, T[]>, update: (list: T[]) => T[]) {
  const next = new Map(map)
  for (const [key, list] of next) next.set(key, update(list))
  return next
}

function replaceCanvasIdInCache<T extends { canvas_id?: number | null }>(map: Map<number, T[]>, tempId: number, serverId: number) {
  const next = new Map<number, T[]>()
  for (const [key, list] of map) {
    const nextKey = key === tempId ? serverId : key
    next.set(nextKey, list.map((item) => item.canvas_id === tempId ? { ...item, canvas_id: serverId } : item))
  }
  return next
}

function thoughtCanvasId(state: AppStore, thought: Thought) {
  if (state.tiles.some((tile) => tile.id === thought.tile_id)) return state.activeCanvasId
  for (const [canvasId, tiles] of state.tileCache) {
    if (tiles.some((tile) => tile.id === thought.tile_id)) return canvasId
  }
  return null
}

function sortCanvases(canvases: Canvas[]) {
  return [...canvases].sort((a, b) => Number(b.is_favourite) - Number(a.is_favourite) || a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at))
}

function sortThoughts(thoughts: Thought[]) {
  return [...thoughts].sort((a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at) || a.id - b.id)
}

function mergeThoughts(existing: Thought[], incoming: Thought[]) {
  const byId = new Map(existing.map((thought) => [thought.id, thought]))
  for (const thought of incoming) byId.set(thought.id, thought)
  return sortThoughts([...byId.values()])
}

function thoughtsForTile(state: AppStore, tileId: number) {
  const byId = new Map<number, Thought>()
  for (const thought of state.thoughts) if (thought.tile_id === tileId) byId.set(thought.id, thought)
  for (const thoughts of state.thoughtCache.values()) {
    for (const thought of thoughts) if (thought.tile_id === tileId) byId.set(thought.id, thought)
  }
  return [...byId.values()]
}

function targetCanvasIdFromPayload(payload: SyncPayload | undefined) {
  const value = payload?.targetCanvasId
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null
}

function renameThoughtTags(tags: string[], oldName: string | undefined, newName: string) {
  return oldName && oldName !== newName ? tags.map((tag) => tag === oldName ? newName : tag) : tags
}

function sameTagIdentity(left: Tag, right: Tag) {
  return left.id === right.id || Boolean(left.client_id && right.client_id && left.client_id === right.client_id)
}

export function adoptServerEntity(entityType: SyncEntityType, record: LocalEntityRecord | undefined, entity: SyncEntity) {
  if (!setState || !record) return
  const tempId = record.tempId
  if (tempId === null || tempId === entity.id) return

  setState((state) => {
    if (entityType === "canvas") {
      const canvas = entity as Canvas
      if (state.activeCanvasId === tempId) writeStoredActiveCanvasId(canvas.id)
      const tileCache = replaceCanvasIdInCache(state.tileCache, tempId, canvas.id)
      const thoughtCache = new Map<number, Thought[]>()
      for (const [key, thoughts] of state.thoughtCache) thoughtCache.set(key === tempId ? canvas.id : key, thoughts)
      return {
        canvases: state.canvases.map((item) => item.id === tempId ? { ...canvas, stableKey: item.stableKey } : item),
        activeCanvasId: state.activeCanvasId === tempId ? canvas.id : state.activeCanvasId,
        tiles: state.tiles.map((tile) => tile.canvas_id === tempId ? { ...tile, canvas_id: canvas.id } : tile),
        tileCache,
        thoughtCache,
      }
    }

    if (entityType === "tile") {
      const tile = entity as Tile
      const replaceTile = (item: Tile) => item.id === tempId ? { ...tile, stableKey: item.stableKey } : item
      const retileThought = (thought: Thought) => thought.tile_id === tempId ? { ...thought, tile_id: tile.id } : thought
      return {
        tiles: state.tiles.map(replaceTile),
        thoughts: state.thoughts.map(retileThought),
        tileCache: updateMapList(state.tileCache, (tiles) => tiles.map(replaceTile)),
        thoughtCache: updateMapList(state.thoughtCache, (thoughts) => thoughts.map(retileThought)),
      }
    }

    if (entityType === "thought") {
      const thought = entity as Thought
      const replaceThought = (item: Thought) => item.id === tempId ? { ...thought, stableKey: item.stableKey } : item
      const keys = new Map(state.thoughtStableKeys)
      const stableKey = keys.get(tempId)
      keys.delete(tempId)
      if (stableKey !== undefined) keys.set(thought.id, stableKey)
      return {
        thoughts: state.thoughts.map(replaceThought),
        thoughtCache: updateMapList(state.thoughtCache, (thoughts) => thoughts.map(replaceThought)),
        thoughtStableKeys: keys,
      }
    }

    const tag = entity as Tag
    return {
      tags: state.tags.map((item) => item.id === tempId ? tag : item),
    }
  })
}

export function applyRemoteEntity(entityType: SyncEntityType, entity: SyncEntity, options: ApplyRemoteEntityOptions = {}) {
  if (!setState || !getState) return
  setState((state) => {
    if (entityType === "canvas") {
      const canvas = entity as Canvas
      return { canvases: sortCanvases([...state.canvases.filter((item) => item.id !== canvas.id), canvas]) }
    }
    if (entityType === "tile") {
      const tile = entity as Tile
      const movedThoughts = tile.canvas_id === null ? [] : thoughtsForTile(state, tile.id)
      const tileCache = updateMapList(state.tileCache, (tiles) => tiles.filter((item) => item.id !== tile.id))
      if (tile.canvas_id !== null) tileCache.set(tile.canvas_id, [...(tileCache.get(tile.canvas_id) ?? []).filter((item) => item.id !== tile.id), tile])
      const thoughtCache = updateMapList(state.thoughtCache, (thoughts) => thoughts.filter((thought) => thought.tile_id !== tile.id))
      if (tile.canvas_id !== null && movedThoughts.length > 0) {
        thoughtCache.set(tile.canvas_id, mergeThoughts(thoughtCache.get(tile.canvas_id) ?? [], movedThoughts))
      }
      const activeThoughts = state.activeCanvasId === tile.canvas_id
        ? mergeThoughts(state.thoughts.filter((thought) => thought.tile_id !== tile.id), movedThoughts)
        : state.thoughts.filter((thought) => thought.tile_id !== tile.id)
      return {
        tiles: state.activeCanvasId === tile.canvas_id ? [...state.tiles.filter((item) => item.id !== tile.id), tile] : state.tiles.filter((item) => item.id !== tile.id),
        tileCache,
        thoughts: activeThoughts,
        thoughtCache,
      }
    }
    if (entityType === "thought") {
      const thought = entity as Thought
      const canvasId = thoughtCanvasId(state, thought)
      const thoughtCache = updateMapList(state.thoughtCache, (thoughts) => thoughts.filter((item) => item.id !== thought.id))
      if (canvasId !== null) {
        thoughtCache.set(canvasId, mergeThoughts((thoughtCache.get(canvasId) ?? []).filter((item) => item.id !== thought.id), [thought]))
      }
      return {
        thoughts: state.activeCanvasId === canvasId
          ? mergeThoughts(state.thoughts.filter((item) => item.id !== thought.id), [thought])
          : state.thoughts.filter((item) => item.id !== thought.id),
        thoughtCache,
      }
    }
    const tag = entity as Tag
    const existing = state.tags.find((item) => sameTagIdentity(item, tag))
    return {
      tags: [...state.tags.filter((item) => !sameTagIdentity(item, tag)), tag].sort((a, b) => a.name.localeCompare(b.name)),
      thoughts: state.thoughts.map((thought) => ({ ...thought, tags: renameThoughtTags(thought.tags, existing?.name, tag.name) })),
      thoughtCache: new Map([...state.thoughtCache].map(([canvasId, thoughts]) => [canvasId, thoughts.map((thought) => ({
        ...thought,
        tags: renameThoughtTags(thought.tags, existing?.name, tag.name),
      }))])),
    }
  })
  if (!options.animate) return
  if (entityType === "tile") {
    getState().markRemoteChanges([(entity as Tile).id], [])
    return
  }
  if (entityType === "thought") getState().markRemoteChanges([], [(entity as Thought).id])
}

export function removeRemoteEntity(entityType: SyncEntityType, serverId: number | null, payload?: SyncPayload) {
  if (!setState || serverId === null) return
  setState((state) => {
    if (entityType === "canvas") {
      const tileCache = new Map(state.tileCache)
      const thoughtCache = new Map(state.thoughtCache)
      const canvases = state.canvases.filter((item) => item.id !== serverId)
      const targetCanvasId = targetCanvasIdFromPayload(payload)
      const usableTargetCanvasId = targetCanvasId !== null && canvases.some((canvas) => canvas.id === targetCanvasId) ? targetCanvasId : null
      const sourceTiles = tileCache.get(serverId) ?? (state.activeCanvasId === serverId ? state.tiles : [])
      const sourceThoughts = thoughtCache.get(serverId) ?? (state.activeCanvasId === serverId ? state.thoughts : [])
      if (usableTargetCanvasId !== null) {
        const movedTiles = sourceTiles.map((tile) => ({ ...tile, canvas_id: usableTargetCanvasId }))
        const movedTileIds = new Set(movedTiles.map((tile) => tile.id))
        const targetTiles = tileCache.get(usableTargetCanvasId) ?? (state.activeCanvasId === usableTargetCanvasId ? state.tiles : [])
        tileCache.set(usableTargetCanvasId, [
          ...targetTiles.filter((tile) => !movedTileIds.has(tile.id)),
          ...movedTiles,
        ])

        const movedThoughtIds = new Set(sourceThoughts.map((thought) => thought.id))
        const targetThoughts = thoughtCache.get(usableTargetCanvasId) ?? (state.activeCanvasId === usableTargetCanvasId ? state.thoughts : [])
        thoughtCache.set(usableTargetCanvasId, mergeThoughts(
          targetThoughts.filter((thought) => !movedThoughtIds.has(thought.id)),
          sourceThoughts,
        ))
      }
      tileCache.delete(serverId)
      thoughtCache.delete(serverId)
      const activeCanvasId = state.activeCanvasId === serverId ? usableTargetCanvasId ?? canvases[0]?.id ?? null : state.activeCanvasId
      if (state.activeCanvasId === serverId) writeStoredActiveCanvasId(activeCanvasId)
      return {
        canvases,
        activeCanvasId,
        tiles: activeCanvasId === null ? [] : tileCache.get(activeCanvasId) ?? (state.activeCanvasId === activeCanvasId ? state.tiles : []),
        thoughts: activeCanvasId === null ? [] : thoughtCache.get(activeCanvasId) ?? (state.activeCanvasId === activeCanvasId ? state.thoughts : []),
        tileCache,
        thoughtCache,
      }
    }
    if (entityType === "tile") {
      return {
        tiles: state.tiles.filter((item) => item.id !== serverId),
        thoughts: state.thoughts.filter((item) => item.tile_id !== serverId),
        tileCache: updateMapList(state.tileCache, (tiles) => tiles.filter((item) => item.id !== serverId)),
        thoughtCache: updateMapList(state.thoughtCache, (thoughts) => thoughts.filter((item) => item.tile_id !== serverId)),
      }
    }
    if (entityType === "thought") {
      return {
        thoughts: state.thoughts.filter((item) => item.id !== serverId),
        thoughtCache: updateMapList(state.thoughtCache, (thoughts) => thoughts.filter((item) => item.id !== serverId)),
      }
    }
    return { tags: state.tags.filter((item) => item.id !== serverId) }
  })
}
