import { afterAll, beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test"
import type { syncDb as SyncDb } from "../db/sync"
import type { sql as Sql } from "../db/client"
import type { Canvas } from "../types"
import type postgres from "postgres"

const RUN_ID = `${Date.now()}_${Math.random().toString(36).slice(2)}`
const USER_A = `test_sync_a_${RUN_ID}`
const USER_B = `test_sync_b_${RUN_ID}`
const TEST_USERS = [USER_A, USER_B]
setDefaultTimeout(45000)

type SqlClient = typeof Sql
type SyncDbClient = typeof SyncDb

async function waitForBlockedMutation(sql: SqlClient, blockingPids: number[]) {
  const deadline = Date.now() + 10000
  while (Date.now() < deadline) {
    const [waiting] = await sql<{ pid: number }[]>`
      SELECT pid FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock'
        AND pg_blocking_pids(pid) && ${blockingPids}::int[]
        AND pid <> ALL(${blockingPids}::int[])
    `
    if (waiting) return waiting.pid
    await Bun.sleep(10)
  }
  throw new Error("Mutation did not reach the database lock barrier")
}

async function runBlockedMutations<T>(
  sql: SqlClient,
  lock: (transaction: postgres.TransactionSql) => Promise<void>,
  mutations: (() => Promise<T>)[],
) {
  const pending: Promise<T>[] = []
  try {
    await sql.begin(async (transaction) => {
      await lock(transaction)
      const [blocker] = await transaction<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`
      const blockingPids = [blocker!.pid]
      // Queue each request only after the previous one is demonstrably waiting.
      // The transaction's commit releases the barrier after both are queued.
      for (const mutation of mutations) {
        const result = mutation()
        pending.push(result)
        void result.catch(() => {})
        blockingPids.push(await waitForBlockedMutation(sql, blockingPids))
      }
    })
    return await Promise.all(pending)
  } finally {
    // Always release the barrier and drain requests before test cleanup runs.
    await Promise.allSettled(pending)
  }
}

async function createTagFixture(syncDb: SyncDbClient, names = ["A"]) {
  const canvasId = await createCanvas(syncDb, USER_A)
  const tileId = await createTile(syncDb, USER_A, canvasId)
  for (let index = 0; index < 2; index += 1) {
    await syncDb.apply(USER_A, `tag-thought-${index}`, "thought", "upsert", `tag-thought-${index}`, null, {
      tile_id: tileId,
      content: `Tagged thought ${index}`,
      tags: [...names, "keep"],
      sort_order: index,
    })
  }
  const ids: number[] = []
  for (const name of names) {
    const result = await syncDb.apply(USER_A, `tag-create-${name}`, "tag", "upsert", `tag-client-${name}`, null, {
      name, color: "#111111",
    })
    ids.push(Number(result.server_id))
  }
  return ids
}

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
  const { logEvent } = await import("../db/sync/events")

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
      const historyRows = await sql<{ count: number; op_ids: string[]; client_ids: string[] }[]>`
        SELECT COUNT(*)::int AS count,
          ARRAY_AGG(op_id ORDER BY id) AS op_ids,
          ARRAY_AGG(client_id ORDER BY id) AS client_ids
        FROM history WHERE user_id = ${USER_A} AND action = 'canvas.create'
      `
      const canvasHistory = await sql<{ op_id: string; action: string }[]>`
        SELECT op_id, action FROM history
        WHERE user_id = ${USER_A} AND op_id IN ('canvas-op-1', 'canvas-op-2')
        ORDER BY id
      `

      expect(second.server_id).toBe(first.server_id)
      expect(otherUser.server_id).not.toBe(first.server_id)
      expect(rows).toHaveLength(2)
      expect(rows.find((row) => row.user_id === USER_A)?.name).toBe("Renamed")
      expect(historyRows[0]?.count).toBe(1)
      expect(historyRows[0]?.op_ids).toEqual(["canvas-op-1"])
      expect(historyRows[0]?.client_ids).toEqual([clientId])
      expect(canvasHistory.map(({ op_id, action }) => ({ op_id, action }))).toEqual([
        { op_id: "canvas-op-1", action: "canvas.create" },
        { op_id: "canvas-op-2", action: "canvas.update" },
      ])
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

    test("successful synced moves, tag edits, and deletes are written to history", async () => {
      const sourceCanvasId = await createCanvas(syncDb, USER_A, "history-source-canvas")
      const targetCanvasId = await createCanvas(syncDb, USER_A, "history-target-canvas")
      const sourceTileId = await createTile(syncDb, USER_A, sourceCanvasId, "history-source-tile")
      const targetTileId = await createTile(syncDb, USER_A, targetCanvasId, "history-target-tile")
      const thought = await syncDb.apply(USER_A, "history-thought-create", "thought", "upsert", "history-thought", null, {
        tile_id: sourceTileId,
        content: "Move me",
        tags: [],
        sort_order: 0,
      })
      const tag = await syncDb.apply(USER_A, "history-tag-create", "tag", "upsert", "history-tag", null, {
        name: "Before",
        color: "#7c3aed",
      })

      await syncDb.apply(USER_A, "history-tile-move", "tile", "upsert", "history-source-tile", sourceTileId, {
        canvas_id: targetCanvasId,
        title: "Tasks",
        x: 48,
        y: 72,
        width: 280,
        height: 200,
        importance: 1,
        visible: true,
      }, { occurredAt: "2026-08-25T10:30:00.000Z" })
      await syncDb.apply(USER_A, "history-thought-move", "thought", "upsert", "history-thought", Number(thought.server_id), {
        tile_id: targetTileId,
        content: "Move me",
        tags: [],
        sort_order: 1,
      })
      await syncDb.apply(USER_A, "history-tag-rename", "tag", "upsert", "history-tag", Number(tag.server_id), {
        name: "After",
        color: "#7c3aed",
      })
      await syncDb.apply(USER_A, "history-thought-delete", "thought", "delete", "history-thought", Number(thought.server_id), {})

      const rows = await sql<{ op_id: string; action: string; occurred_at: string }[]>`
        SELECT op_id, action, occurred_at FROM history
        WHERE user_id = ${USER_A}
          AND op_id IN ('history-tile-move', 'history-thought-move', 'history-tag-rename', 'history-thought-delete')
        ORDER BY id
      `
      expect(rows.map(({ op_id, action }) => ({ op_id, action }))).toEqual([
        { op_id: "history-tile-move", action: "tile.move" },
        { op_id: "history-thought-move", action: "thought.move" },
        { op_id: "history-tag-rename", action: "tag.rename" },
        { op_id: "history-thought-delete", action: "thought.delete" },
      ])
      expect(new Date(rows[0]!.occurred_at).toISOString()).toBe("2026-08-25T10:30:00.000Z")
    })

    test("internal grouped sync writes can suppress duplicate History rows", async () => {
      await syncDb.apply(USER_A, "internal-canvas-op", "canvas", "upsert", "internal-canvas", null, {
        name: "Internal",
        sort_order: 0,
        is_favourite: false,
      }, { writeHistory: false })

      const rows = await sql<{ count: number }[]>`
        SELECT COUNT(*)::int AS count FROM history WHERE user_id = ${USER_A} AND op_id = 'internal-canvas-op'
      `
      expect(rows[0]?.count).toBe(0)
    })

    test("deleting a tag removes it from thoughts and publishes its name", async () => {
      const canvasId = await createCanvas(syncDb, USER_A, "tag-delete-canvas")
      const tileId = await createTile(syncDb, USER_A, canvasId, "tag-delete-tile")
      await syncDb.apply(USER_A, "tag-delete-thought-op", "thought", "upsert", "tag-delete-thought", null, {
        tile_id: tileId,
        content: "Tagged thought",
        tags: ["cleanup", "keep"],
        sort_order: 0,
      })
      const tagResult = await syncDb.apply(USER_A, "tag-delete-create-op", "tag", "upsert", "tag-delete-tag", null, {
        name: "cleanup",
        color: "#123456",
      })

      await syncDb.apply(USER_A, "tag-delete-op", "tag", "delete", "tag-delete-tag", Number(tagResult.server_id), {
        name: "caller-supplied-wrong-name",
      })

      const thoughts = await sql<{ tags: string[] }[]>`
        SELECT tags FROM thoughts WHERE user_id = ${USER_A} AND client_id = 'tag-delete-thought'
      `
      const events = await sql<{ data: Record<string, unknown> }[]>`
        SELECT data FROM sync_events WHERE user_id = ${USER_A} AND op_id = 'tag-delete-op'
      `
      const tagDeleteHistory = await sql<{ action: string; summary: string }[]>`
        SELECT action, summary FROM history WHERE user_id = ${USER_A} AND op_id = 'tag-delete-op'
      `
      expect(thoughts[0]?.tags).toEqual(["keep"])
      expect(events[0]?.data).toMatchObject({ name: "cleanup" })
      expect(tagDeleteHistory[0]).toMatchObject({ action: "tag.delete", summary: 'Deleted tag "cleanup"' })
    })

    for (const firstAlias of ["server", "client"] as const) {
      test(`concurrent tag renames serialize ${firstAlias}-id then the other alias`, async () => {
        const [tagId] = await createTagFixture(syncDb)
        const rename = (alias: "server" | "client", name: string) => () => syncDb.apply(
          USER_A, `rename-${name}`, "tag", "upsert",
          alias === "client" ? "tag-client-A" : null,
          alias === "server" ? tagId! : null,
          { name, color: "#111111" },
        )
        const results = await runBlockedMutations(sql, async (transaction) => {
          await transaction`SELECT id FROM tags WHERE user_id = ${USER_A} AND id = ${tagId!} FOR UPDATE`
        }, [rename(firstAlias, "Bee"), rename(firstAlias === "server" ? "client" : "server", "Ceeeee")])

        const [tag] = await sql<{ name: string }[]>`SELECT name FROM tags WHERE user_id = ${USER_A} AND id = ${tagId!}`
        const thoughts = await sql<{ tags: string[] }[]>`SELECT tags FROM thoughts WHERE user_id = ${USER_A} ORDER BY id`
        const history = await sql<{ op_id: string; detail: { old_name: string; name: string } }[]>`
          SELECT op_id, detail FROM history WHERE user_id = ${USER_A} AND op_id IN ('rename-Bee', 'rename-Ceeeee') ORDER BY id
        `
        expect(results.map((result) => Number(result.server_id))).toEqual([tagId!, tagId!])
        expect(tag?.name).toBe("Ceeeee")
        expect(thoughts.map((thought) => thought.tags)).toEqual([["Ceeeee", "keep"], ["Ceeeee", "keep"]])
        expect(history.map(({ op_id, detail }) => ({ op_id, ...detail }))).toMatchObject([
          { op_id: "rename-Bee", old_name: "A", name: "Bee" },
          { op_id: "rename-Ceeeee", old_name: "Bee", name: "Ceeeee" },
        ])
        const { getStorageUsage, recalculateUserStorage } = await import("../billing/storageUsage")
        const tracked = await getStorageUsage(USER_A)
        expect((await recalculateUserStorage(USER_A)).storageBytes).toBe(tracked.storageBytes)
      })
    }

    test("tag deletion waits for a concurrent rename and removes the current label", async () => {
      const [tagId] = await createTagFixture(syncDb)
      await runBlockedMutations(sql, async (transaction) => {
        await transaction`SELECT id FROM tags WHERE user_id = ${USER_A} AND id = ${tagId!} FOR UPDATE`
      }, [
        () => syncDb.apply(USER_A, "rename-before-delete", "tag", "upsert", "tag-client-A", null, { name: "Renamed", color: "#111111" }),
        () => syncDb.apply(USER_A, "delete-after-rename", "tag", "delete", null, tagId!, {}),
      ])

      const tags = await sql`SELECT id FROM tags WHERE user_id = ${USER_A}`
      const thoughts = await sql<{ tags: string[] }[]>`SELECT tags FROM thoughts WHERE user_id = ${USER_A} ORDER BY id`
      const [history] = await sql<{ detail: { name: string } }[]>`
        SELECT detail FROM history WHERE user_id = ${USER_A} AND op_id = 'delete-after-rename'
      `
      const [event] = await sql<{ data: { name: string } }[]>`
        SELECT data FROM sync_events WHERE user_id = ${USER_A} AND op_id = 'delete-after-rename'
      `
      expect(tags).toHaveLength(0)
      expect(thoughts.map((thought) => thought.tags)).toEqual([["keep"], ["keep"]])
      expect(history?.detail.name).toBe("Renamed")
      expect(event?.data.name).toBe("Renamed")
      const { getStorageUsage, recalculateUserStorage } = await import("../billing/storageUsage")
      const tracked = await getStorageUsage(USER_A)
      expect((await recalculateUserStorage(USER_A)).storageBytes).toBe(tracked.storageBytes)
    })

    test("name-conflict tag updates read the previous color under the same row lock", async () => {
      const [tagId] = await createTagFixture(syncDb)
      await runBlockedMutations(sql, async (transaction) => {
        await transaction`SELECT id FROM tags WHERE user_id = ${USER_A} AND id = ${tagId!} FOR UPDATE`
      }, [
        () => syncDb.apply(USER_A, "color-by-server", "tag", "upsert", null, tagId!, { name: "A", color: "#222222" }),
        () => syncDb.apply(USER_A, "color-by-name", "tag", "upsert", "new-tag-client", null, { name: "A", color: "#333333" }),
      ])

      const tags = await sql<{ id: string; client_id: string; color: string }[]>`SELECT id, client_id, color FROM tags WHERE user_id = ${USER_A}`
      const history = await sql<{ action: string; detail: { old_color: string; color: string } }[]>`
        SELECT action, detail FROM history WHERE user_id = ${USER_A} AND op_id IN ('color-by-server', 'color-by-name') ORDER BY id
      `
      expect(tags).toHaveLength(1)
      expect(Number(tags[0]?.id)).toBe(tagId!)
      expect(tags[0]?.client_id).toBe("tag-client-A")
      expect(tags[0]?.color).toBe("#333333")
      expect(history).toMatchObject([
        { action: "tag.color", detail: { old_color: "#111111", color: "#222222" } },
        { action: "tag.color", detail: { old_color: "#222222", color: "#333333" } },
      ])
    })

    test("concurrent renames of different tags preserve both labels on shared thoughts", async () => {
      const [firstTagId, secondTagId] = await createTagFixture(syncDb, ["A", "D"])
      await runBlockedMutations(sql, async (transaction) => {
        await transaction`SELECT id FROM thoughts WHERE user_id = ${USER_A} ORDER BY id FOR UPDATE`
      }, [
        () => syncDb.apply(USER_A, "rename-shared-A", "tag", "upsert", null, firstTagId!, { name: "Bee", color: "#111111" }),
        () => syncDb.apply(USER_A, "rename-shared-D", "tag", "upsert", null, secondTagId!, { name: "Eeeeee", color: "#111111" }),
      ])

      const thoughts = await sql<{ tags: string[] }[]>`SELECT tags FROM thoughts WHERE user_id = ${USER_A} ORDER BY id`
      expect(thoughts.map((thought) => thought.tags)).toEqual([["Bee", "Eeeeee", "keep"], ["Bee", "Eeeeee", "keep"]])
      const { getStorageUsage, recalculateUserStorage } = await import("../billing/storageUsage")
      const tracked = await getStorageUsage(USER_A)
      expect((await recalculateUserStorage(USER_A)).storageBytes).toBe(tracked.storageBytes)
    })

    test("failed tag renames roll back and release their locks", async () => {
      const [tagId] = await createTagFixture(syncDb, ["A", "Taken"])
      const { getStorageUsage } = await import("../billing/storageUsage")
      const before = await getStorageUsage(USER_A)
      await expect(syncDb.apply(USER_A, "failed-rename", "tag", "upsert", null, tagId!, {
        name: "Taken", color: "#111111",
      })).rejects.toMatchObject({ code: "23505" })

      const [tag] = await sql<{ name: string }[]>`SELECT name FROM tags WHERE user_id = ${USER_A} AND id = ${tagId!}`
      const thoughts = await sql<{ tags: string[] }[]>`SELECT tags FROM thoughts WHERE user_id = ${USER_A} ORDER BY id`
      const history = await sql`SELECT id FROM history WHERE user_id = ${USER_A} AND op_id = 'failed-rename'`
      expect(tag?.name).toBe("A")
      expect(thoughts.map((thought) => thought.tags)).toEqual([["A", "Taken", "keep"], ["A", "Taken", "keep"]])
      expect(history).toHaveLength(0)
      expect((await getStorageUsage(USER_A)).storageBytes).toBe(before.storageBytes)
      await syncDb.apply(USER_A, "rename-after-failure", "tag", "upsert", "tag-client-A", null, { name: "Bee", color: "#111111" })
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

    test("billable resource creation is serialized per user and feature", async () => {
      const { createSerializedBillableResource } = await import("../billing/resourceUsage")
      let activeCreates = 0
      let maximumConcurrentCreates = 0

      await Promise.all([1, 2].map((value) => createSerializedBillableResource(USER_A, "canvases", async (transaction) => {
        activeCreates += 1
        maximumConcurrentCreates = Math.max(maximumConcurrentCreates, activeCreates)
        await transaction`SELECT pg_sleep(0.05)`
        activeCreates -= 1
        return value
      })))

      expect(maximumConcurrentCreates).toBe(1)
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

    test("sync event revisions use an uncached sequence", async () => {
      const [sequence] = await sql<{ cache_size: number | string }[]>`
        SELECT seqcache AS cache_size FROM pg_sequence
        WHERE seqrelid = pg_get_serial_sequence('sync_events', 'revision')::regclass
      `
      expect(Number(sequence?.cache_size)).toBe(1)
    })

    for (const outcome of ["commit", "rollback"] as const) {
      for (const scoped of [false, true]) {
        test(`${scoped ? "canvas" : "global"} pull cannot skip a blocked publication after ${outcome}`, async () => {
          const canvasId = await createCanvas(syncDb, USER_A)
          const [canvas] = await sql<Canvas[]>`SELECT * FROM canvases WHERE id = ${canvasId}`
          const since = await syncDb.latestRevision(USER_A)
          const pullCanvasId = scoped ? canvasId : undefined
          const inserted = Promise.withResolvers<{ pid: number; revision: number }>()
          const release = Promise.withResolvers<void>()
          const first = sql.begin(async (transaction) => {
            // Hold a real publication transaction open after it allocates its revision.
            await transaction`SELECT pg_advisory_xact_lock(hashtextextended(${`sync-events:${USER_A}`}, 0))`
            const [connection] = await transaction<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`
            const [event] = await transaction<{ revision: number | string }[]>`
              INSERT INTO sync_events (user_id, canvas_id, entity_type, entity_id, op_id, action, data)
              VALUES (${USER_A}, ${canvasId}, 'canvas', ${canvasId}, 'publication-first', 'upsert', '{}')
              RETURNING revision
            `
            inserted.resolve({ pid: connection!.pid, revision: Number(event!.revision) })
            await release.promise
            if (outcome === "rollback") throw new Error("Publication rolled back")
          })
          void first.catch(inserted.reject)
          let second: Promise<number | null> | undefined
          try {
            const held = await inserted.promise
            second = logEvent(USER_A, "canvas", "upsert", "publication-second", canvas!, null, { ...canvas! })
            void second.catch(() => {})
            await Promise.race([
              waitForBlockedMutation(sql, [held.pid]),
              second.then(() => { throw new Error("Later publication committed before the earlier transaction ended") }),
            ])

            // A different user may publish a higher global revision without
            // advancing this user's cursor past its uncommitted event.
            const otherRevision = await logEvent(USER_B, "tag", "delete", "publication-other-user", null, null, {})
            expect(otherRevision).toBeGreaterThan(held.revision)
            const during = await syncDb.pull(USER_A, since, pullCanvasId)
            expect(during.events).toEqual([])
            expect(during.latest_revision).toBe(since)
            expect(await syncDb.latestRevision(USER_A)).toBe(since)

            release.resolve()
            if (outcome === "rollback") await expect(first).rejects.toThrow("Publication rolled back")
            else await first
            const secondRevision = await second
            expect(secondRevision).toBeGreaterThan(held.revision)
            const after = await syncDb.pull(USER_A, during.latest_revision, pullCanvasId)
            expect(after.events.map((event) => event.op_id)).toEqual(
              outcome === "commit" ? ["publication-first", "publication-second"] : ["publication-second"],
            )
            expect(after.latest_revision).toBe(secondRevision!)
            expect((await syncDb.pull(USER_A, after.latest_revision, pullCanvasId)).events).toEqual([])
          } finally {
            release.resolve()
            await Promise.allSettled([first, ...(second ? [second] : [])])
          }
        })
      }
    }

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

    test("child cleanup after canvas deletion does not subtract storage twice", async () => {
      const { getStorageUsage, recalculateUserStorage } = await import("../billing/storageUsage")
      const canvasId = await createCanvas(syncDb, USER_A, "storage-delete-canvas")
      const tileId = await createTile(syncDb, USER_A, canvasId, "storage-delete-tile")
      const thought = await syncDb.apply(USER_A, "storage-delete-thought-op", "thought", "upsert", "storage-delete-thought", null, {
        tile_id: tileId,
        content: "Delete once",
        tags: [],
        sort_order: 0,
      })

      await syncDb.apply(USER_A, "storage-delete-canvas-op", "canvas", "delete", "storage-delete-canvas", canvasId, {
        mode: "deleteContents",
      })
      const afterCanvasDelete = await getStorageUsage(USER_A)

      // This matches the durable child cleanup queued by the frontend after its
      // aggregate canvas delete has already removed the same server rows.
      await syncDb.apply(USER_A, "storage-delete-child-thought-op", "thought", "delete", "storage-delete-thought", Number(thought.server_id), {})
      await syncDb.apply(USER_A, "storage-delete-child-tile-op", "tile", "delete", "storage-delete-tile", tileId, {})
      const afterChildCleanup = await getStorageUsage(USER_A)
      const recalculated = await recalculateUserStorage(USER_A)

      expect(afterChildCleanup.storageBytes).toBe(afterCanvasDelete.storageBytes)
      expect(recalculated.storageBytes).toBe(afterChildCleanup.storageBytes)
    })
  })
}
