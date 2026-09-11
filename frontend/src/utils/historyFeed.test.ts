import { describe, expect, test } from "bun:test"
import type { HistoryEvent } from "../types"
import type { SyncActivityRecord } from "../sync/types"
import { buildHistoryFeed } from "./historyFeed"

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
