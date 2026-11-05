// Aliases cover both durable local summaries and server history, including older entries.
const ACTION_LABELS: Record<string, string[]> = {
  "tile.create": ["Created tile", "Create tile"],
  "tile.rename": ["Renamed tile", "Renamed tile to", "Rename tile"],
  "tile.move": ["Moved tile", "Move tile"],
  "tile.resize": ["Resized tile", "Resize tile"],
  "tile.visibility": ["Changed visibility", "Showed tile", "Hid tile"],
  "tile.importance": ["Changed importance", "Changed importance of tile"],
  "tile.update": ["Updated tile", "Update tile", "Save tile"],
  "tile.delete": ["Deleted tile", "Delete tile"],
  "canvas.create": ["Created canvas", "Create canvas"],
  "canvas.rename": ["Renamed canvas", "Renamed canvas to", "Rename canvas"],
  "canvas.reorder": ["Reordered canvas", "Reorder canvas"],
  "canvas.favourite": ["Changed favourite", "Favourited canvas", "Unfavourited canvas"],
  "canvas.update": ["Updated canvas", "Update canvas", "Save canvas"],
  "canvas.delete": ["Deleted canvas", "Delete canvas"],
  "thought.create": ["Added thought", "Add thought"],
  "thought.update": ["Edited thought", "Edit thought", "Update thought", "Save thought"],
  "thought.move": ["Moved thought", "Move thought"],
  "thought.reorder": ["Reordered thought", "Reorder thought"],
  "thought.tag": ["Tagged thought", "Changed tags on thought", "Change tags on thought"],
  "thought.delete": ["Deleted thought", "Delete thought"],
  "tag.create": ["Created tag", "Create tag"],
  "tag.rename": ["Renamed tag", "Renamed tag to", "Rename tag"],
  "tag.color": ["Changed tag colour", "Changed colour of tag", "Change colour of tag"],
  "tag.update": ["Updated tag", "Update tag", "Save tag"],
  "tag.delete": ["Deleted tag", "Delete tag"],
  "ai.process": ["AI processed"],
}

export function historySummaryParts(summary: string, action?: string) {
  const trimmed = summary.trim()
  const candidates = action ? [ACTION_LABELS[action] ?? [action]] : Object.values(ACTION_LABELS)
  for (const [label, ...aliases] of candidates) {
    const prefix = [label, ...aliases].sort((a, b) => b.length - a.length).find((value) =>
      trimmed.toLowerCase() === value.toLowerCase() || trimmed.toLowerCase().startsWith(`${value.toLowerCase()} `))
    if (prefix) {
      // Preserve whether visibility/favourite was enabled or disabled in the badge.
      const directional = /^(Showed|Hid|Favourited|Unfavourited) /i.test(prefix)
      return { label: directional ? prefix : label, remainder: trimmed.slice(prefix.length).trim() }
    }
  }
  return { label: action ? ACTION_LABELS[action]?.[0] ?? action : "Change", remainder: trimmed }
}

export function historyDetailRows(action: string, detail: Record<string, unknown>, summary: string) {
  const rows: string[] = []
  function textChange(before: unknown, after: unknown) {
    if (typeof before === "string" && typeof after === "string" && before !== after) {
      rows.push(`Before: "${before}"`, `After: "${after}"`)
    } else if (typeof after === "string" && after.trim() && !summary.includes(after.trim())) {
      rows.push(`"${after}"`)
    }
  }
  function change(label: string, before: unknown, after: unknown) {
    if (before !== undefined && after !== undefined && before !== after) {
      rows.push(`${label}: ${before ?? "none"} → ${after ?? "none"}`)
    }
  }
  function pair(first: unknown, second: unknown, separator: string) {
    return typeof first === "number" && typeof second === "number" ? `${first}${separator}${second}` : undefined
  }

  if (action.startsWith("thought.")) {
    textChange(detail.old_content, detail.new_content ?? detail.content)
    change("Tile", detail.old_tile_id, detail.tile_id)
    change("Order", detail.old_sort_order, detail.sort_order)
    const tags = Array.isArray(detail.tags) ? detail.tags.filter((tag): tag is string => typeof tag === "string") : []
    if (Array.isArray(detail.old_tags)) {
      const before = detail.old_tags.filter((tag): tag is string => typeof tag === "string")
      if (JSON.stringify([...before].sort()) !== JSON.stringify([...tags].sort())) {
        rows.push(`Tags before: ${before.join(", ") || "no tags"}`, `Tags after: ${tags.join(", ") || "no tags"}`)
      }
    } else if (tags.length) rows.push(`Tags: ${tags.join(", ")}`)
  } else if (action.startsWith("tile.")) {
    textChange(detail.old_title, detail.title)
    change("Canvas", detail.old_canvas_id, detail.canvas_id)
    change("Position", pair(detail.old_x, detail.old_y, ", "), pair(detail.x, detail.y, ", "))
    change("Size", pair(detail.old_width, detail.old_height, " × "), pair(detail.width, detail.height, " × "))
    change("Importance", detail.old_importance, detail.importance)
    change("Visible", detail.old_visible, detail.visible)
  } else if (action.startsWith("canvas.")) {
    textChange(detail.old_name, detail.name)
    change("Order", detail.old_sort_order, detail.sort_order)
    change("Favourite", detail.old_is_favourite, detail.is_favourite)
    if (detail.mode === "moveContents" && detail.target_canvas_id != null) rows.push(`Moved contents to canvas ${detail.target_canvas_id}`)
  } else if (action.startsWith("tag.")) {
    textChange(detail.old_name, detail.name)
    change("Colour", detail.old_color, detail.color)
  }
  return rows
}
