import { afterAll, beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test"
import type { syncDb as SyncDb } from "../db/sync"
import type { sql as Sql } from "../db/client"

const RUN_ID = `${Date.now()}_${Math.random().toString(36).slice(2)}`
const USER_A = `test_sync_a_${RUN_ID}`
const USER_B = `test_sync_b_${RUN_ID}`
const TEST_USERS = [USER_A, USER_B]
setDefaultTimeout(45000)

type SqlClient = typeof Sql
type SyncDbClient = typeof SyncDb

async function cleanup(sql: SqlClient) {
  await sql`DELETE FROM user_usage WHERE user_id = ANY(${TEST_USERS})`
  await sql`DELETE FROM sync_applied_ops WHERE user_id = ANY(${TEST_USERS})`
  await sql`DELETE FROM sync_events WHERE user_id = ANY(${TEST_USERS})`
  await sql`DELETE FROM history WHERE user_id = ANY(${TEST_USERS})`
  await sql`DELETE FROM thoughts WHERE user_id = ANY(${TEST_USERS})`
  await sql`DELETE FROM tiles WHERE user_id = ANY(${TEST_USERS})`
  await sql`DELETE FROM tags WHERE user_id = ANY(${TEST_USERS})`
  await sql`DELETE FROM canvases WHERE user_id = ANY(${TEST_USERS})`
}

async function createCanvas(syncDb: SyncDbClient, userId: string, clientId = `${userId}:canvas`) {
  const result = await syncDb.apply(userId, `${clientId}:op`, "canvas", "upsert", clientId, null, {
    name: "Home",
    sort_order: 0,
    is_favourite: false,
  })
  if (!result.server_id) throw new Error("Canvas create did not return a server id")
  return Number(result.server_id)
}

async function createTile(syncDb: SyncDbClient, userId: string, canvasId: number, clientId = `${userId}:tile`) {
  const result = await syncDb.apply(userId, `${clientId}:op`, "tile", "upsert", clientId, null, {
    canvas_id: canvasId,
    title: "Tasks",
    x: 0,
    y: 0,
    width: 280,
    height: 200,
    importance: 1,
    visible: true,
  })
  if (!result.server_id) throw new Error("Tile create did not return a server id")
  return Number(result.server_id)
}

if (!process.env.DATABASE_URL) {
  describe("backend sync db", () => {
    test.skip("set DATABASE_URL to run backend sync integration tests", () => {})
  })
} else {
  const { sql } = await import("../db/client")
  const { syncDb } = await import("../db/sync")

  describe("backend sync db", () => {
    beforeEach(async () => {
      await cleanup(sql)
    })

    afterAll(async () => {
      await cleanup(sql)
      await sql.end()
    })

    test("client ids are idempotent per user", async () => {
      const clientId = "shared-canvas-client"
      const first = await syncDb.apply(USER_A, "canvas-op-1", "canvas", "upsert", clientId, null, {
        name: "Inbox",
        sort_order: 0,
        is_favourite: false,
      })
      const second = await syncDb.apply(USER_A, "canvas-op-2", "canvas", "upsert", clientId, null, {
        name: "Renamed",
        sort_order: 1,
        is_favourite: true,
      })
      const otherUser = await syncDb.apply(USER_B, "canvas-op-3", "canvas", "upsert", clientId, null, {
        name: "Other User",
        sort_order: 0,
        is_favourite: false,
      })

      const rows = await sql<{ user_id: string; id: number; name: string }[]>`
        SELECT user_id, id, name FROM canvases
        WHERE user_id = ANY(${TEST_USERS}) AND client_id = ${clientId}
        ORDER BY user_id
      `
      const historyRows = await sql<{ count: number }[]>`
        SELECT COUNT(*)::int AS count FROM history WHERE user_id = ${USER_A} AND action = 'canvas.create'
      `

      expect(second.server_id).toBe(first.server_id)
      expect(otherUser.server_id).not.toBe(first.server_id)
      expect(rows).toHaveLength(2)
      expect(rows.find((row) => row.user_id === USER_A)?.name).toBe("Renamed")
      expect(historyRows[0]?.count).toBe(1)
    })

    test("upserts preserve child relationships and thought ordering", async () => {
      const canvasId = await createCanvas(syncDb, USER_A)
      const tileId = await createTile(syncDb, USER_A, canvasId)
      await syncDb.apply(USER_A, "thought-op-1", "thought", "upsert", "thought-client-1", null, {
        tile_id: tileId,
        content: "First",
        tags: [],
        sort_order: 0,
      })
      const thought = await syncDb.apply(USER_A, "thought-op-2", "thought", "upsert", "thought-client-2", null, {
        tile_id: tileId,
        content: "Second",
        tags: ["work"],
      })
      const tag = await syncDb.apply(USER_A, "tag-op-1", "tag", "upsert", "tag-client", null, {
        name: "work",
        color: "#123456",
      })

      const thoughtRows = await sql<{ content: string; sort_order: number; tags: string[] }[]>`
        SELECT content, sort_order, tags FROM thoughts WHERE user_id = ${USER_A} ORDER BY sort_order
      `

      expect(Number(thought.server_id)).toBeGreaterThan(0)
      expect(Number(tag.server_id)).toBeGreaterThan(0)
      expect(thoughtRows.map((row) => row.content)).toEqual(["First", "Second"])
      expect(thoughtRows[1]?.sort_order).toBe(1)
      expect(thoughtRows[1]?.tags).toEqual(["work"])
    })

    test("invalid child references are rejected before writing", async () => {
      await expect(syncDb.apply(USER_A, "bad-tile-op", "tile", "upsert", "bad-tile-client", null, {
        canvas_id: 999999999,
        title: "Bad Tile",
      })).rejects.toThrow("Canvas not found")

      await expect(syncDb.apply(USER_A, "bad-thought-op", "thought", "upsert", "bad-thought-client", null, {
        tile_id: 999999999,
        content: "Bad Thought",
      })).rejects.toThrow("Tile not found")
    })

    test("canvas delete can move or delete child contents", async () => {
      const sourceCanvasId = await createCanvas(syncDb, USER_A, "source-canvas")
      const targetCanvasId = await createCanvas(syncDb, USER_A, "target-canvas")
      const movedTileId = await createTile(syncDb, USER_A, sourceCanvasId, "moved-tile")
      await syncDb.apply(USER_A, "move-canvas-op", "canvas", "delete", "source-canvas", sourceCanvasId, {
        mode: "moveContents",
        targetCanvasId,
      })

      const movedRows = await sql<{ canvas_id: number | string | null }[]>`
        SELECT canvas_id FROM tiles WHERE id = ${movedTileId} AND user_id = ${USER_A}
      `
      expect(Number(movedRows[0]?.canvas_id)).toBe(targetCanvasId)

      const deleteCanvasId = await createCanvas(syncDb, USER_A, "delete-canvas")
      const deletedTileId = await createTile(syncDb, USER_A, deleteCanvasId, "deleted-tile")
      await syncDb.apply(USER_A, "delete-thought-op", "thought", "upsert", "deleted-thought", null, {
        tile_id: deletedTileId,
        content: "Remove me",
        tags: [],
        sort_order: 0,
      })
      await syncDb.apply(USER_A, "delete-canvas-op", "canvas", "delete", "delete-canvas", deleteCanvasId, {
        mode: "deleteContents",
      })

      const deletedRows = await sql<{ tile_deleted: boolean; thought_deleted: boolean }[]>`
        SELECT
          tiles.deleted_at IS NOT NULL AS tile_deleted,
          thoughts.deleted_at IS NOT NULL AS thought_deleted
        FROM tiles
        JOIN thoughts ON thoughts.tile_id = tiles.id
        WHERE tiles.id = ${deletedTileId} AND tiles.user_id = ${USER_A}
      `
      expect(deletedRows[0]).toEqual({ tile_deleted: true, thought_deleted: true })
    })

    test("snapshot and pull expose normalized revisioned changes", async () => {
      const canvasId = await createCanvas(syncDb, USER_A)
      const tileId = await createTile(syncDb, USER_A, canvasId)
      const thought = await syncDb.apply(USER_A, "pull-thought-op", "thought", "upsert", "pull-thought", null, {
        tile_id: tileId,
        content: "Pull me",
        tags: [],
        sort_order: 0,
      })

      const snapshot = await syncDb.snapshot(USER_A, canvasId)
      const pull = await syncDb.pull(USER_A, 0, canvasId)

      expect(snapshot.active_canvas_id).toBe(canvasId)
      expect(snapshot.tiles.map((tile) => Number(tile.id))).toContain(tileId)
      expect(thought.server_id).not.toBeNull()
      expect(snapshot.thoughts.map((item) => Number(item.id))).toContain(Number(thought.server_id))
      expect(pull.latest_revision).toBeGreaterThanOrEqual(thought.revision ?? 0)
      expect(pull.events.every((event) => typeof event.revision === "number")).toBe(true)
      expect(pull.events.some((event) => event.entity_type === "thought" && event.client_id === "pull-thought")).toBe(true)
    })

    test("storage usage tracks active user data and can be recalculated", async () => {
      const { getStorageUsage, recalculateUserStorage } = await import("../billing/storageUsage")
      const canvasId = await createCanvas(syncDb, USER_A, "storage-canvas")
      const tileId = await createTile(syncDb, USER_A, canvasId, "storage-tile")
      const thought = await syncDb.apply(USER_A, "storage-thought-op", "thought", "upsert", "storage-thought", null, {
        tile_id: tileId,
        content: "Storage tracked thought",
        tags: ["billing"],
        sort_order: 0,
      })
      await syncDb.apply(USER_A, "storage-tag-op", "tag", "upsert", "storage-tag", null, {
        name: "billing",
        color: "#123456",
      })

      const afterCreates = await getStorageUsage(USER_A)
      expect(afterCreates.storageBytes).toBeGreaterThan(0)
      expect(afterCreates.storageMegabytes).toBe(1)

      const recalculated = await recalculateUserStorage(USER_A)
      expect(recalculated.storageBytes).toBe(afterCreates.storageBytes)

      await syncDb.apply(USER_A, "storage-thought-delete", "thought", "delete", "storage-thought", Number(thought.server_id), {})
      const afterDelete = await getStorageUsage(USER_A)
      expect(afterDelete.storageBytes).toBeLessThan(afterCreates.storageBytes)

      const recalculatedAfterDelete = await recalculateUserStorage(USER_A)
      expect(recalculatedAfterDelete.storageBytes).toBe(afterDelete.storageBytes)
    })
  })
}
