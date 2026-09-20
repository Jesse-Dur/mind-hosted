import type { Canvas, Tag, Thought, Tile } from "../../types"
import type { DeletePayload, SyncEntity, SyncEntityType } from "./types"

export type SyncHistoryEntry = {
  action: string
  summary: string
  detail: Record<string, unknown>
}

function quoted(value: string, fallback: string) {
  const normalized = value.trim()
  return normalized ? `"${normalized.slice(0, 80)}${normalized.length > 80 ? "…" : ""}"` : fallback
}

function sameTags(left: string[], right: string[]) {
  if (left.length !== right.length) return false
  const normalizedLeft = [...left].sort()
  const normalizedRight = [...right].sort()
  return normalizedLeft.every((tag, index) => tag === normalizedRight[index])
}

function canvasHistory(before: Canvas | null, canvas: Canvas): SyncHistoryEntry | null {
  const label = quoted(canvas.name, "canvas")
  if (!before) return {
    action: "canvas.create",
    summary: `Created canvas ${label}`,
    detail: { canvas_id: canvas.id, name: canvas.name, sort_order: canvas.sort_order, is_favourite: canvas.is_favourite },
  }

  const changes = [
    before.name !== canvas.name ? "name" : null,
    before.sort_order !== canvas.sort_order ? "order" : null,
    before.is_favourite !== canvas.is_favourite ? "favourite" : null,
  ].filter((change): change is string => change !== null)
  if (changes.length === 0) return null
  const action = changes.length === 1 && changes[0] === "name"
    ? "canvas.rename"
    : changes.length === 1 && changes[0] === "order"
      ? "canvas.reorder"
      : changes.length === 1 && changes[0] === "favourite"
        ? "canvas.favourite"
        : "canvas.update"
  const summary = action === "canvas.rename"
    ? `Renamed canvas to ${label}`
    : action === "canvas.reorder"
      ? `Reordered canvas ${label}`
      : action === "canvas.favourite"
        ? `${canvas.is_favourite ? "Favourited" : "Unfavourited"} canvas ${label}`
        : `Updated canvas ${label}`
  return {
    action,
    summary,
    detail: {
      canvas_id: canvas.id,
      name: canvas.name,
      old_name: before.name,
      sort_order: canvas.sort_order,
      old_sort_order: before.sort_order,
      is_favourite: canvas.is_favourite,
      old_is_favourite: before.is_favourite,
      changes,
    },
  }
}

function tileHistory(before: Tile | null, tile: Tile): SyncHistoryEntry | null {
  const label = quoted(tile.title, "tile")
  if (!before) return {
    action: "tile.create",
    summary: `Created tile ${label}`,
    detail: { tile_id: tile.id, title: tile.title, canvas_id: tile.canvas_id, x: tile.x, y: tile.y, width: tile.width, height: tile.height, importance: tile.importance, visible: tile.visible },
  }

  const changes = [
    before.title !== tile.title ? "title" : null,
    before.canvas_id !== tile.canvas_id ? "canvas" : null,
    before.x !== tile.x || before.y !== tile.y ? "position" : null,
    before.width !== tile.width || before.height !== tile.height ? "size" : null,
    before.importance !== tile.importance ? "importance" : null,
    before.visible !== tile.visible ? "visibility" : null,
  ].filter((change): change is string => change !== null)
  if (changes.length === 0) return null
  const only = (allowed: string[]) => changes.length > 0 && changes.every((change) => allowed.includes(change))
  const action = only(["title"])
    ? "tile.rename"
    : changes.includes("canvas") && only(["canvas", "position"])
      ? "tile.move"
      : changes.includes("size") && only(["position", "size"])
        ? "tile.resize"
        : only(["position"])
          ? "tile.move"
        : only(["visibility"])
          ? "tile.visibility"
          : only(["importance"])
            ? "tile.importance"
            : "tile.update"
  const summary = action === "tile.rename"
    ? `Renamed tile to ${label}`
    : action === "tile.move"
      ? `Moved tile ${label}`
      : action === "tile.resize"
        ? `Resized tile ${label}`
        : action === "tile.visibility"
          ? `${tile.visible ? "Showed" : "Hid"} tile ${label}`
          : action === "tile.importance"
            ? `Changed importance of tile ${label}`
            : `Updated tile ${label}`
  return {
    action,
    summary,
    detail: {
      tile_id: tile.id,
      title: tile.title,
      old_title: before.title,
      canvas_id: tile.canvas_id,
      old_canvas_id: before.canvas_id,
      x: tile.x,
      y: tile.y,
      old_x: before.x,
      old_y: before.y,
      width: tile.width,
      height: tile.height,
      old_width: before.width,
      old_height: before.height,
      importance: tile.importance,
      old_importance: before.importance,
      visible: tile.visible,
      old_visible: before.visible,
      changes,
    },
  }
}

function thoughtHistory(before: Thought | null, thought: Thought): SyncHistoryEntry | null {
  const label = quoted(thought.content, "empty thought")
  if (!before) return {
    action: "thought.create",
    summary: `Added thought ${label}`,
    detail: { thought_id: thought.id, tile_id: thought.tile_id, content: thought.content, tags: thought.tags, sort_order: thought.sort_order },
  }

  const changes = [
    before.content !== thought.content ? "content" : null,
    !sameTags(before.tags, thought.tags) ? "tags" : null,
    before.tile_id !== thought.tile_id ? "tile" : null,
    before.sort_order !== thought.sort_order ? "order" : null,
  ].filter((change): change is string => change !== null)
  if (changes.length === 0) return null
  const only = (allowed: string[]) => changes.length > 0 && changes.every((change) => allowed.includes(change))
  const action = changes.includes("tile") && only(["tile", "order"])
    ? "thought.move"
    : only(["order"])
      ? "thought.reorder"
      : only(["tags"])
        ? "thought.tag"
        : "thought.update"
  const summary = action === "thought.move"
    ? `Moved thought ${label}`
    : action === "thought.reorder"
      ? `Reordered thought ${label}`
      : action === "thought.tag"
        ? `Changed tags on thought ${label}`
        : `Edited thought ${label}`
  return {
    action,
    summary,
    detail: {
      thought_id: thought.id,
      content: thought.content,
      new_content: thought.content,
      old_content: before.content,
      tags: thought.tags,
      old_tags: before.tags,
      tile_id: thought.tile_id,
      old_tile_id: before.tile_id,
      sort_order: thought.sort_order,
      old_sort_order: before.sort_order,
      changes,
    },
  }
}

function tagHistory(before: Tag | null, tag: Tag): SyncHistoryEntry | null {
  const label = quoted(tag.name, "tag")
  if (!before) return {
    action: "tag.create",
    summary: `Created tag ${label}`,
    detail: { tag_id: tag.id, name: tag.name, color: tag.color },
  }

  const renamed = before.name !== tag.name
  const recolored = before.color !== tag.color
  if (!renamed && !recolored) return null
  const action = renamed && !recolored ? "tag.rename" : recolored && !renamed ? "tag.color" : "tag.update"
  const summary = action === "tag.rename"
    ? `Renamed tag to ${label}`
    : action === "tag.color"
      ? `Changed colour of tag ${label}`
      : `Updated tag ${label}`
  return {
    action,
    summary,
    detail: { tag_id: tag.id, name: tag.name, old_name: before.name, color: tag.color, old_color: before.color, changes: [renamed ? "name" : null, recolored ? "color" : null].filter(Boolean) },
  }
}

export function buildUpsertHistory(entityType: SyncEntityType, before: SyncEntity | null, entity: SyncEntity): SyncHistoryEntry | null {
  if (entityType === "canvas") return canvasHistory(before as Canvas | null, entity as Canvas)
  if (entityType === "tile") return tileHistory(before as Tile | null, entity as Tile)
  if (entityType === "thought") return thoughtHistory(before as Thought | null, entity as Thought)
  return tagHistory(before as Tag | null, entity as Tag)
}

export function buildDeleteHistory(entityType: SyncEntityType, entity: SyncEntity, payload: DeletePayload): SyncHistoryEntry {
  if (entityType === "canvas") {
    const canvas = entity as Canvas
    const movedContents = payload.mode === "moveContents"
    return {
      action: "canvas.delete",
      summary: `${movedContents ? "Deleted canvas and moved contents from" : "Deleted canvas"} ${quoted(canvas.name, "canvas")}`,
      detail: { canvas_id: canvas.id, name: canvas.name, mode: payload.mode ?? "deleteContents", target_canvas_id: payload.targetCanvasId ?? null },
    }
  }
  if (entityType === "tile") {
    const tile = entity as Tile
    return { action: "tile.delete", summary: `Deleted tile ${quoted(tile.title, "tile")}`, detail: { tile_id: tile.id, title: tile.title, canvas_id: tile.canvas_id } }
  }
  if (entityType === "thought") {
    const thought = entity as Thought
    return { action: "thought.delete", summary: `Deleted thought ${quoted(thought.content, "empty thought")}`, detail: { thought_id: thought.id, tile_id: thought.tile_id, content: thought.content, tags: thought.tags } }
  }
  const tag = entity as Tag
  return { action: "tag.delete", summary: `Deleted tag ${quoted(tag.name, "tag")}`, detail: { tag_id: tag.id, name: tag.name, color: tag.color } }
}
