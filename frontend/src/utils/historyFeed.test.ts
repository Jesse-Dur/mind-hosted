import { describe, expect, test } from "bun:test"
import type { HistoryEvent } from "../types"
import type { SyncActivityRecord } from "../sync/types"
import { buildHistoryFeed } from "./historyFeed"
import { historyDetailRows, historySummaryParts } from "./historyPresentation"

const activity: SyncActivityRecord = {
  opId: "thought-op",
  entityType: "thought",
  clientId: "thought-client",
  action: "upsert",
  state: "synced",
  summary: "Save thought “Remember milk”",
  error: null,
  createdAt: 1_000,
  updatedAt: 2_000,
}

const event: HistoryEvent = {
  id: 7,
  action: "thought.create",
  summary: "Added thought",
  detail: { content: "Remember milk" },
  op_id: "thought-op",
  created_at: new Date(2_000).toISOString(),
}

describe("unified history feed", () => {
  test("merges a server event and its local sync operation into one row", () => {
    const feed = buildHistoryFeed([event], [activity])

    expect(feed).toHaveLength(1)
    expect(feed[0]).toMatchObject({ kind: "history", state: "synced", activity: { opId: "thought-op" } })
  })

  test("keeps local operations that do not have server history", () => {
    const pending = { ...activity, opId: "tag-op", entityType: "tag" as const, state: "pending" as const }
    const feed = buildHistoryFeed([event], [activity, pending])

    expect(feed.map((item) => item.key)).toContain("activity:tag-op")
  })

  test("deduplicates legacy create history using its label and acknowledgement time", () => {
    const legacyEvent = { ...event, op_id: null }
    expect(buildHistoryFeed([legacyEvent], [activity])).toHaveLength(1)
  })

  test("the issues filter contains only actionable local states", () => {
    const rows = buildHistoryFeed(
      [event],
      [
        activity,
        { ...activity, opId: "pending", state: "pending" },
        { ...activity, opId: "error", state: "error" },
        { ...activity, opId: "local", state: "local_only" },
        { ...activity, opId: "discarded", state: "discarded" },
      ],
      true,
    )

    expect(rows.map((row) => row.state).sort()).toEqual(["error", "local_only"])
  })
})

describe("history presentation", () => {
  test.each([
    ["tile.create", "Create tile", "Created tile"],
    ["tile.rename", "Rename tile", "Renamed tile to"],
    ["tile.move", "Move tile", "Moved tile"],
    ["tile.resize", "Resize tile", "Resized tile"],
    ["tile.update", "Update tile", "Updated tile"],
    ["tile.delete", "Delete tile", "Deleted tile"],
    ["canvas.create", "Create canvas", "Created Canvas"],
    ["canvas.rename", "Rename canvas", "Renamed canvas to"],
    ["canvas.reorder", "Reorder canvas", "Reordered canvas"],
    ["canvas.update", "Update canvas", "Updated canvas"],
    ["canvas.delete", "Delete canvas", "Deleted Canvas"],
    ["thought.create", "Add thought", "Added thought"],
    ["thought.update", "Edit thought", "Edited thought"],
    ["thought.move", "Move thought", "Moved thought"],
    ["thought.reorder", "Reorder thought", "Reordered thought"],
    ["thought.tag", "Change tags on thought", "Changed tags on thought"],
    ["thought.delete", "Delete thought", "Deleted thought"],
    ["tag.create", "Create tag", "Created tag"],
    ["tag.rename", "Rename tag", "Renamed tag to"],
    ["tag.color", "Change colour of tag", "Changed colour of tag"],
    ["tag.update", "Update tag", "Updated tag"],
    ["tag.delete", "Delete tag", "Deleted tag"],
  ])("%s has the same badge locally and on the server", (action, local, server) => {
    expect(historySummaryParts(`${local} "Test"`)).toEqual(historySummaryParts(`${server} "Test"`, action))
    expect(historySummaryParts(`${server} "Test"`, action).remainder).toBe('"Test"')
  })

  test("preserves directional and unknown summary information", () => {
    expect(historySummaryParts('Hid tile "Test"', "tile.visibility").label).toBe("Hid tile")
    expect(historySummaryParts('Unfavourited canvas "Test"', "canvas.favourite").label).toBe("Unfavourited canvas")
    expect(historySummaryParts('Deleted canvas and moved contents from "Test"', "canvas.delete").remainder).toBe('and moved contents from "Test"')
    expect(historySummaryParts("Unfamiliar event", "future.action").remainder).toBe("Unfamiliar event")
  })

  test.each(["thought", "tile", "canvas", "tag"])("short %s creations/deletions have no redundant expansion", (entity) => {
    const detail = { content: "Test", title: "Test", name: "Test", tags: [] }
    for (const action of ["create", "delete"]) {
      expect(historyDetailRows(`${entity}.${action}`, detail, 'Action "Test"')).toEqual([])
    }
  })

  test("preserves full text, tags, moves and compound edits as useful details", () => {
    const long = "A".repeat(100)
    expect(historyDetailRows("thought.delete", { content: long }, `Deleted thought "${long.slice(0, 80)}…"`)).toEqual([`"${long}"`])
    expect(historyDetailRows("thought.create", { content: "Test", tags: ["home"] }, 'Added thought "Test"')).toEqual(["Tags: home"])
    expect(historyDetailRows("tile.move", { old_x: 0, old_y: 1, x: 2, y: 3 }, "Moved tile")).toEqual(["Position: 0, 1 → 2, 3"])
    expect(historyDetailRows("thought.update", { old_content: "", content: "New", old_tags: [], tags: ["home"] }, 'Edited thought "New"')).toEqual(['Before: ""', 'After: "New"', "Tags before: no tags", "Tags after: home"])
    expect(historyDetailRows("canvas.delete", { mode: "moveContents", target_canvas_id: 10 }, "Deleted canvas")).toEqual(["Moved contents to canvas 10"])
  })

  test("missing or unchanged details do not offer expansion", () => {
    expect(historyDetailRows("tile.move", {}, "Moved tile")).toEqual([])
    expect(historyDetailRows("thought.tag", { old_tags: ["a", "b"], tags: ["b", "a"] }, "Tagged thought")).toEqual([])
    expect(historyDetailRows("tile.move", { old_x: 0, old_y: 1, x: 0, y: 1 }, "Moved tile")).toEqual([])
  })
})
