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
    ? { ...session, enteredCanvasId: canvasId, targetTileId: null }
    : { ...session, enteredCanvasId: canvasId }
  emitSnapshot()
  emitPointer()
}

export function setThoughtDragTargetTile(tileId: number | null) {
  if (!session || session.kind !== "thought" || session.targetTileId === tileId) return
  session = { ...session, targetTileId: tileId }
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
