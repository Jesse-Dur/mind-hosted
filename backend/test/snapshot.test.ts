import { beforeEach, describe, expect, mock, test } from "bun:test"
import type { Canvas } from "../types"
import type { SyncEvent } from "../db/sync/types"

// Run separately from the database integration suite so this module mock stays isolated.
const userId = "snapshot-test-user"
const canvas: Canvas = {
  id: 1,
  client_id: "snapshot-canvas",
  name: "Home",
  sort_order: 0,
  is_favourite: false,
  created_at: "2026-01-01T00:00:00.000Z",
}

let revision = 10
let canvases: Canvas[] = []
let events: SyncEvent[] = []
let dataReads: string[] = []
let afterCanvasRead: (() => void) | undefined
let beforeRevisionReturn: (() => Promise<void>) | undefined

mock.module("../db/client", () => ({
  sql: async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const query = strings.join("?").replace(/\s+/g, " ").trim()
    expect(values[query.startsWith("UPDATE tiles") ? 1 : 0]).toBe(userId)
    if (query.includes("COALESCE(MAX(revision)")) {
      const capturedRevision = revision
      await beforeRevisionReturn?.()
      return [{ revision: String(capturedRevision) }]
    }
    if (query.startsWith("SELECT revision,")) {
      const since = Number(values[1])
      return events.filter((event) => event.revision > since
        && (values[2] === undefined || event.canvas_id === null || event.canvas_id === values[2]))
    }
    if (query.includes("LIMIT 1")) return canvases.slice(0, 1)
    if (query.startsWith("INSERT INTO canvases")) {
      canvases = [{ ...canvas }]
      return canvases
    }
    if (query.startsWith("UPDATE tiles")) return []
    if (query.startsWith("SELECT * FROM canvases")) {
      dataReads.push("canvases")
      const rows = canvases.map((item) => ({ ...item }))
      afterCanvasRead?.()
      return rows
    }
    if (query.startsWith("SELECT * FROM tags")) {
      dataReads.push("tags")
      return []
    }
    if (query.startsWith("SELECT * FROM tiles")) {
      dataReads.push("tiles")
      return []
    }
    if (query.startsWith("SELECT thoughts.*")) {
      dataReads.push("thoughts")
      return []
    }
    throw new Error(`Unexpected snapshot query: ${query}`)
  },
}))

const { syncSnapshot } = await import("../db/sync/snapshot")
const { pullSyncEvents } = await import("../db/sync/pull")

describe("snapshot revision anchor", () => {
  beforeEach(() => {
    revision = 10
    canvases = [{ ...canvas }]
    events = []
    dataReads = []
    afterCanvasRead = undefined
    beforeRevisionReturn = undefined
  })

  test("a canvas change omitted by the snapshot remains available to pull", async () => {
    afterCanvasRead = () => {
      const renamedCanvas = { ...canvas, name: "Renamed" }
      canvases = [renamedCanvas]
      revision += 1
      events.push({
        revision,
        canvas_id: canvas.id,
        entity_type: "canvas",
        entity_id: canvas.id,
        client_id: canvas.client_id ?? null,
        op_id: "rename-canvas",
        action: "upsert",
        data: { ...renamedCanvas },
        created_at: canvas.created_at,
      })
    }

    const snapshot = await syncSnapshot(userId, canvas.id)
    expect(snapshot.canvases[0]?.name).toBe("Home")
    const pull = await pullSyncEvents(userId, snapshot.revision, canvas.id)
    expect(pull.events).toHaveLength(1)
    expect(pull.events[0]).toMatchObject({ revision: 11, data: { name: "Renamed" } })
    expect(pull.latest_revision).toBe(11)
    expect(snapshot.revision).toBe(10)
  })

  test("waits for the revision anchor before starting snapshot data reads", async () => {
    const started = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    beforeRevisionReturn = async () => {
      started.resolve()
      await release.promise
    }

    const pendingSnapshot = syncSnapshot(userId, canvas.id)
    await started.promise
    const readsBeforeAnchor = [...dataReads]
    release.resolve()
    const snapshot = await pendingSnapshot

    expect(readsBeforeAnchor).toEqual([])
    expect(dataReads.toSorted()).toEqual(["canvases", "tags", "thoughts", "tiles"])
    expect(snapshot.revision).toBe(10)
  })

  test("initializes the default canvas and returns a numeric zero revision for a new user", async () => {
    revision = 0
    canvases = []

    const snapshot = await syncSnapshot(userId)

    expect(snapshot.revision).toBe(0)
    expect(snapshot.active_canvas_id).toBe(canvas.id)
    expect(snapshot.canvases).toEqual([canvas])
    expect(snapshot.tags).toEqual([])
    expect(snapshot.tiles).toEqual([])
    expect(snapshot.thoughts).toEqual([])
  })
})
