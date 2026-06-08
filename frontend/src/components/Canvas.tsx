import { useRef, useState, useEffect } from "react"
import { useStore } from "../store"
import { Tile } from "./Tile"
import { getCrossCanvasDrag, subscribeCrossCanvasDrag, subscribeCrossCanvasDragPointer, type CrossCanvasDragSession } from "../utils/crossCanvasDrag"
import { canvasIdentityKey } from "../utils/canvasIdentity"
import { optimisticIdentityKey } from "../utils/optimisticIdentity"
import type { Canvas as CanvasType, Thought, Tile as TileType } from "../types"

const GRID = 24
const MIN = GRID * 4

function snap(n: number) {
  return Math.round(n / GRID) * GRID
}

interface Draft { startX: number; startY: number; x: number; y: number; width: number; height: number }
type TileDragSession = Extract<CrossCanvasDragSession, { kind: "tile" }>

function mergeThoughts(primary: Thought[], fallback: Thought[]) {
  const byId = new Map<number, Thought>()
  for (const thought of fallback) byId.set(thought.id, thought)
  for (const thought of primary) byId.set(thought.id, thought)
  return [...byId.values()]
}

function getActiveCanvasKey(canvases: CanvasType[], activeCanvasId: number | null) {
  const canvas = activeCanvasId === null ? undefined : canvases.find((item) => item.id === activeCanvasId)
  return canvas ? canvasIdentityKey(canvas) : activeCanvasId === null ? null : `canvas-${activeCanvasId}`
}

export function Canvas({ tabBarVisible }: { tabBarVisible: boolean }) {
  const { tiles, thoughts, addTile, newestTileId, canvasHeight, activeCanvasId, canvases } = useStore()
  const TAB_OFFSET = tabBarVisible ? 36 : 0
  const CANVAS_H = canvasHeight
  const CANVAS_W = Math.floor(Math.round(canvasHeight * (16 / 9)) / GRID) * GRID
  const [draft, setDraft] = useState<Draft | null>(null)
  const [scale, setScale] = useState(1)
  const [displayedTiles, setDisplayedTiles] = useState(tiles)
  const [displayedThoughts, setDisplayedThoughts] = useState(thoughts)
  const [visible, setVisible] = useState(true)
  const canvasRef = useRef<HTMLDivElement>(null)
  const activeCanvasKey = getActiveCanvasKey(canvases, activeCanvasId)
  const prevCanvasKey = useRef(activeCanvasKey)
  const transitioning = useRef(false)
  const [immuneTileSession, setImmuneTileSession] = useState<TileDragSession | null>(() => {
    const session = getCrossCanvasDrag()
    return session?.kind === "tile" ? session : null
  })

  useEffect(() => subscribeCrossCanvasDrag((session) => {
    if (session?.kind === "tile") {
      setImmuneTileSession(session)
      return
    }
    if (!transitioning.current) setImmuneTileSession(null)
  }), [])

  useEffect(() => subscribeCrossCanvasDragPointer((session) => {
    if (session.kind === "tile") setImmuneTileSession(session)
  }), [])

  useEffect(() => {
    if (prevCanvasKey.current === activeCanvasKey) return
    prevCanvasKey.current = activeCanvasKey
    transitioning.current = true
    setVisible(false)
    const t = setTimeout(() => {
      const { tiles, thoughts } = useStore.getState()
      setDisplayedTiles(tiles)
      setDisplayedThoughts(thoughts)
      transitioning.current = false
      setVisible(true)
      if (getCrossCanvasDrag()?.kind !== "tile") setImmuneTileSession(null)
    }, 150)
    return () => clearTimeout(t)
  }, [activeCanvasKey])

  // Only sync displayed tiles when not mid-transition
  useEffect(() => {
    if (!transitioning.current) setDisplayedTiles(tiles)
  }, [tiles])

  useEffect(() => {
    if (!transitioning.current) setDisplayedThoughts(thoughts)
  }, [thoughts])

  useEffect(() => {
    function updateScale() {
      const s = Math.min(window.innerWidth / CANVAS_W, (window.innerHeight - TAB_OFFSET) / CANVAS_H)
      setScale(s)
    }
    updateScale()
    window.addEventListener("resize", updateScale)
    return () => window.removeEventListener("resize", updateScale)
  }, [CANVAS_W, CANVAS_H, TAB_OFFSET])

  function clamp(x: number, y: number, width: number, height: number) {
    return {
      x: Math.max(0, Math.min(x, snap(CANVAS_W - width))),
      y: Math.max(0, Math.min(y, snap(CANVAS_H - height))),
      width: Math.min(width, CANVAS_W),
      height: Math.min(height, CANVAS_H),
    }
  }

  function toCanvas(clientX: number, clientY: number) {
    const rect = canvasRef.current!.getBoundingClientRect()
    return { x: (clientX - rect.left) / scale, y: (clientY - rect.top) / scale }
  }

  function onMouseDown(e: React.MouseEvent<HTMLDivElement>) {
    if ((e.target as HTMLElement) !== canvasRef.current) return
    const { x, y } = toCanvas(e.clientX, e.clientY)
    const sx = snap(x), sy = snap(y)
    setDraft({ startX: sx, startY: sy, x: sx, y: sy, width: GRID, height: GRID })
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setDraft(null)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  function onMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    if (!draft) return
    const { x, y } = toCanvas(e.clientX, e.clientY)
    const curX = snap(x), curY = snap(y)
    setDraft({
      ...draft,
      x: Math.min(draft.startX, curX),
      y: Math.min(draft.startY, curY),
      width: Math.max(MIN, Math.abs(curX - draft.startX)),
      height: Math.max(MIN, Math.abs(curY - draft.startY)),
    })
  }

  function onMouseUp() {
    if (!draft) return
    if (draft.width >= MIN && draft.height >= MIN) {
      addTile({ title: "New Tile", ...clamp(draft.x, draft.y, draft.width, draft.height), importance: 1, visible: true, canvas_id: null })
    }
    setDraft(null)
  }

  function dragSessionTilePosition(session: TileDragSession, tile: TileType) {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return tile
    const maxX = Math.floor((CANVAS_W - tile.width) / GRID) * GRID
    const maxY = Math.floor((CANVAS_H - tile.height) / GRID) * GRID
    const minY = -Math.round(rect.top / scale)
    const x = Math.max(0, Math.min(snap((session.clientX - rect.left) / scale - session.grabOffsetX), maxX))
    const y = Math.max(minY, Math.min(snap((session.clientY - rect.top) / scale - session.grabOffsetY), maxY))
    return { ...tile, x, y }
  }

  const immuneTileId = immuneTileSession?.tile.id ?? null
  const baseImmuneTile = immuneTileId === null
    ? null
    : tiles.find((tile) => tile.id === immuneTileId) ?? displayedTiles.find((tile) => tile.id === immuneTileId) ?? immuneTileSession?.tile ?? null
  const immuneTile = immuneTileSession && baseImmuneTile
    ? dragSessionTilePosition(immuneTileSession, baseImmuneTile)
    : null
  const immuneThoughts = immuneTileSession
    ? mergeThoughts(
        thoughts.filter((thought) => thought.tile_id === immuneTileSession.tile.id),
        immuneTileSession.thoughts
      )
    : []

  return (
    <div style={{ position: "fixed", top: TAB_OFFSET, left: 0, right: 0, bottom: 0, overflow: immuneTile ? "visible" : "hidden", background: "#f5f5f5", display: "flex", alignItems: "center", justifyContent: "center", zIndex: immuneTile ? 80 : 0 }}>
      <div
        data-mind-canvas
        ref={canvasRef}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        style={{
          position: "absolute",
          width: CANVAS_W,
          height: CANVAS_H,
          transformOrigin: "top left",
          zoom: scale,
          backgroundImage: "radial-gradient(circle, #c8c8c8 1px, transparent 1px)",
          backgroundSize: `${GRID}px ${GRID}px`,
          cursor: "crosshair",
        }}
      >
        {/* Tiles fade independently — dot grid stays visible during transition */}
        <div style={{ opacity: visible ? 1 : 0, transition: "opacity 0.15s ease", position: "absolute", inset: 0, pointerEvents: "none" }}>
          {displayedTiles.filter((t) => t.visible && t.id !== immuneTileId).map((tile) => (
            <Tile key={optimisticIdentityKey(tile, "tile")} tile={tile} thoughts={displayedThoughts} isNew={tile.id === newestTileId} scale={scale} />
          ))}
        </div>
        {immuneTile?.visible && (
          <Tile key={`immune-${optimisticIdentityKey(immuneTile, "tile")}`} tile={immuneTile} thoughts={immuneThoughts} isNew={immuneTile.id === newestTileId} scale={scale} />
        )}
        {draft && (
          <div style={{
            position: "absolute",
            left: draft.x, top: draft.y, width: draft.width, height: draft.height,
            border: "2px dashed #aaa",
            borderRadius: 8,
            background: "rgba(0,0,0,0.04)",
            pointerEvents: "none",
          }} />
        )}
      </div>
    </div>
  )
}
