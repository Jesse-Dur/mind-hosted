import type { Thought, Tile } from "../types"

export type CrossCanvasDragSession =
  | {
      kind: "tile"
      tile: Tile
      thoughts: Thought[]
      sourceCanvasId: number | null
      grabOffsetX: number
      grabOffsetY: number
      clientX: number
      clientY: number
      enteredCanvasId: number | null
    }
  | {
      kind: "thought"
      thought: Thought
      sourceTileId: number
      sourceCanvasId: number | null
      targetTileId: number | null
      targetIndex: number | null
      clientX: number
      clientY: number
      enteredCanvasId: number | null
    }

type SnapshotListener = (session: CrossCanvasDragSession | null) => void
type PointerListener = (session: CrossCanvasDragSession) => void

let session: CrossCanvasDragSession | null = null
const snapshotListeners = new Set<SnapshotListener>()
const pointerListeners = new Set<PointerListener>()

function emitSnapshot() {
  for (const listener of snapshotListeners) listener(session)
}

function emitPointer() {
  if (!session) return
  for (const listener of pointerListeners) listener(session)
}

export function beginCrossCanvasDrag(nextSession: CrossCanvasDragSession) {
  session = nextSession
  emitSnapshot()
  emitPointer()
}

export function moveCrossCanvasDrag(clientX: number, clientY: number) {
  if (!session) return
  session = { ...session, clientX, clientY }
  emitPointer()
}

export function setCrossCanvasDragEnteredCanvas(canvasId: number) {
  if (!session) return
  session = session.kind === "thought"
    ? { ...session, enteredCanvasId: canvasId, targetTileId: null, targetIndex: null }
    : { ...session, enteredCanvasId: canvasId }
  emitSnapshot()
  emitPointer()
}

export function setThoughtDragTargetTile(tileId: number | null) {
  setThoughtDragTarget(tileId, null)
}

export function setThoughtDragTarget(tileId: number | null, targetIndex: number | null) {
  if (!session || session.kind !== "thought" || (session.targetTileId === tileId && session.targetIndex === targetIndex)) return
  session = { ...session, targetTileId: tileId, targetIndex }
  emitSnapshot()
  emitPointer()
}

export function endCrossCanvasDrag() {
  if (!session) return
  session = null
  emitSnapshot()
}

export function getCrossCanvasDrag() {
  return session
}

export function adoptCrossCanvasDragId(entityType: "canvas" | "tile" | "thought" | "tag", temporaryId: number, serverId: number) {
  if (!session || entityType === "tag") return
  const canvasId = (id: number | null) => entityType === "canvas" && id === temporaryId ? serverId : id
  const tileId = (id: number) => entityType === "tile" && id === temporaryId ? serverId : id
  const thought = (item: Thought) => ({
    ...item,
    id: entityType === "thought" && item.id === temporaryId ? serverId : item.id,
    tile_id: tileId(item.tile_id),
  })
  session = session.kind === "thought"
    ? { ...session, thought: thought(session.thought), sourceTileId: tileId(session.sourceTileId), targetTileId: session.targetTileId === null ? null : tileId(session.targetTileId), sourceCanvasId: canvasId(session.sourceCanvasId), enteredCanvasId: canvasId(session.enteredCanvasId) }
    : { ...session, tile: { ...session.tile, id: tileId(session.tile.id), canvas_id: canvasId(session.tile.canvas_id) }, thoughts: session.thoughts.map(thought), sourceCanvasId: canvasId(session.sourceCanvasId), enteredCanvasId: canvasId(session.enteredCanvasId) }
  emitSnapshot()
  emitPointer()
}

export function subscribeCrossCanvasDrag(listener: SnapshotListener) {
  snapshotListeners.add(listener)
  listener(session)
  return () => { snapshotListeners.delete(listener) }
}

export function subscribeCrossCanvasDragPointer(listener: PointerListener) {
  pointerListeners.add(listener)
  if (session) listener(session)
  return () => { pointerListeners.delete(listener) }
}
