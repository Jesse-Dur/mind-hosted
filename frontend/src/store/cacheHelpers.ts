import type { Thought, Tile } from "../types"

export function upsertTile(list: Tile[], tile: Tile) {
  return [...list.filter((item) => item.id !== tile.id), tile]
}

export function findTileInState(id: number, tiles: Tile[], tileCache: Map<number, Tile[]>) {
  const visible = tiles.find((tile) => tile.id === id)
  if (visible) return visible
  for (const cachedTiles of tileCache.values()) {
    const tile = cachedTiles.find((item) => item.id === id)
    if (tile) return tile
  }
  return null
}

export function findThoughtInState(id: number, thoughts: Thought[], thoughtCache: Map<number, Thought[]>) {
  const visible = thoughts.find((thought) => thought.id === id)
  if (visible) return visible
  for (const cachedThoughts of thoughtCache.values()) {
    const thought = cachedThoughts.find((item) => item.id === id)
    if (thought) return thought
  }
  return null
}

export function findThoughtCanvasId(id: number, thoughtCache: Map<number, Thought[]>) {
  for (const [canvasId, cachedThoughts] of thoughtCache) {
    if (cachedThoughts.some((thought) => thought.id === id)) return canvasId
  }
  return null
}

export function findThoughtsForTile(tileId: number, thoughts: Thought[], thoughtCache: Map<number, Thought[]>) {
  const byId = new Map<number, Thought>()
  for (const thought of thoughts) if (thought.tile_id === tileId) byId.set(thought.id, thought)
  for (const cachedThoughts of thoughtCache.values()) {
    for (const thought of cachedThoughts) if (thought.tile_id === tileId) byId.set(thought.id, thought)
  }
  return [...byId.values()]
}

export function sortThoughtsForPlacement(thoughts: Thought[]) {
  return [...thoughts].sort((a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at) || a.id - b.id)
}

export function sameNumberArray(a: number[], b: number[]) {
  return a.length === b.length && a.every((value, index) => value === b[index])
}

export function buildThoughtOrderIds(requestedIds: number[] | undefined, movingId: number, targetThoughts: Thought[]) {
  const existingIds = sortThoughtsForPlacement(targetThoughts)
    .map((thought) => thought.id)
    .filter((id) => id !== movingId)
  if (!requestedIds || requestedIds.length === 0) return [...existingIds, movingId]

  const allowed = new Set([...existingIds, movingId])
  const orderedIds: number[] = []
  for (const id of requestedIds) {
    if (!allowed.has(id) || orderedIds.includes(id)) continue
    orderedIds.push(id)
  }
  if (!orderedIds.includes(movingId)) orderedIds.push(movingId)
  for (const id of existingIds) if (!orderedIds.includes(id)) orderedIds.push(id)
  return orderedIds
}

export function applyOrderedThoughts(list: Thought[], movingId: number, orderedThoughts: Thought[], includeMovedThought: boolean) {
  const orderedById = new Map(orderedThoughts.map((thought) => [thought.id, thought]))
  const next = list
    .filter((thought) => thought.id !== movingId)
    .map((thought) => orderedById.get(thought.id) ?? thought)
  if (!includeMovedThought) return next

  const existingIds = new Set(next.map((thought) => thought.id))
  for (const thought of orderedThoughts) {
    if (!existingIds.has(thought.id)) {
      next.push(thought)
      existingIds.add(thought.id)
    }
  }
  return next
}

export function visibleTiles(activeCanvasId: number | null, tileCache: Map<number, Tile[]>, fallback: Tile[]) {
  if (activeCanvasId === null) return []
  return tileCache.get(activeCanvasId) ?? fallback.filter((tile) => tile.canvas_id === activeCanvasId)
}

export function visibleThoughts(activeCanvasId: number | null, thoughtCache: Map<number, Thought[]>, fallback: Thought[]) {
  if (activeCanvasId === null) return []
  return thoughtCache.get(activeCanvasId) ?? fallback
}
