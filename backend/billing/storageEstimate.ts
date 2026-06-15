import type { Canvas, Tag, Thought, Tile } from "../types"

const textEncoder = new TextEncoder()

const CANVAS_BASE_BYTES = 2048
const TILE_BASE_BYTES = 4096
const THOUGHT_BASE_BYTES = 2048
const TAG_BASE_BYTES = 1024

function textBytes(value: string) {
  return textEncoder.encode(value).byteLength
}

export function estimateCanvasStorage(canvas: Pick<Canvas, "name">) {
  return CANVAS_BASE_BYTES + textBytes(canvas.name)
}

export function estimateTileStorage(tile: Pick<Tile, "title">) {
  return TILE_BASE_BYTES + textBytes(tile.title)
}

export function estimateThoughtStorage(thought: Pick<Thought, "content" | "tags">) {
  return THOUGHT_BASE_BYTES + textBytes(thought.content) + thought.tags.reduce((total, tag) => total + textBytes(tag), 0)
}

export function estimateTagStorage(tag: Pick<Tag, "name" | "color">) {
  return TAG_BASE_BYTES + textBytes(tag.name) + textBytes(tag.color)
}
