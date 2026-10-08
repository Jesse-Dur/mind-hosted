import { beforeEach, expect, test } from "bun:test"
import { canvas, resetFrontendState, thought, tile, useStore } from "../test/syncTestHarness"
import { cacheServerEntity } from "./cache"
import { pullSync } from "./pull"
import type { SyncPullEvent } from "./types"

beforeEach(resetFrontendState)

async function seed() {
  const thoughts = [thought(), thought({ id: 31, client_id: "second-thought", sort_order: 1 })]
  await cacheServerEntity("tile", tile(), false)
  for (const item of thoughts) await cacheServerEntity("thought", item, false)
  useStore.setState({ activeCanvasId: 10, tiles: [tile()], thoughts })
  return thoughts
}

function remoteEvent(revision: number, data: ReturnType<typeof thought>, action: "upsert" | "delete" = "upsert"): SyncPullEvent {
  return {
    revision, canvas_id: 10, entity_type: "thought", entity_id: data.id, client_id: data.client_id!,
    op_id: `remote-${revision}`, action, data, created_at: "2026-01-01T00:00:00Z",
  }
}

test("thought moves, additions and deletions publish one animation revision with the final list", async () => {
  const [first, second] = await seed()
  const incoming = thought({ id: 32, client_id: "new-thought", sort_order: 2 })
  const events = [remoteEvent(1, { ...first!, tile_id: 21 }), remoteEvent(2, second!, "delete"), remoteEvent(3, incoming)]
  globalThis.fetch = async () => Response.json({ events, latest_revision: 3 })
  const frames: { ids: number[]; revision: number }[] = []
  const unsubscribe = useStore.subscribe((state, previous) => {
    if (state.thoughts !== previous.thoughts) frames.push({ ids: state.thoughts.map((item) => item.id), revision: state.remoteThoughtRevision })
  })
  try {
    await pullSync(10)
    expect(frames).toEqual([{ ids: [incoming.id], revision: 1 }])
    await pullSync(10)
    expect(frames).toHaveLength(1)
  } finally { unsubscribe() }
})

test("a standalone remote deletion carries its animation revision in the same store notification", async () => {
  const [first, second] = await seed()
  globalThis.fetch = async () => Response.json({ events: [remoteEvent(1, first!, "delete")], latest_revision: 1 })
  const revisions: number[] = []
  const unsubscribe = useStore.subscribe((state, previous) => {
    if (state.thoughts !== previous.thoughts) revisions.push(state.remoteThoughtRevision)
  })
  try {
    await pullSync(10)
    expect(useStore.getState().thoughts.map((item) => item.id)).toEqual([second!.id])
    expect(revisions).toEqual([1])
  } finally { unsubscribe() }
})

test("a local deletion is immediate and its server echo keeps the same visible thought order", async () => {
  const [first] = await seed()
  useStore.getState().removeThought(first!.id)
  expect(useStore.getState().remoteThoughtRevision).toBe(0)
  const remainingIds = useStore.getState().thoughts.map((item) => item.id)
  globalThis.fetch = async () => Response.json({ events: [remoteEvent(1, first!, "delete")], latest_revision: 1 })
  await pullSync(10)
  expect(useStore.getState().thoughts.map((item) => item.id)).toEqual(remainingIds)
})

test.each(["loadThoughts", "loadTiles"] as const)("%s publishes snapshot removals with their animation revision", async (load) => {
  await seed()
  globalThis.fetch = async () => Response.json({
    revision: 1, active_canvas_id: 10, canvases: [canvas()], tags: [], tiles: [tile()], thoughts: [],
  })
  const frames: { count: number; revision: number }[] = []
  const refreshed = Promise.withResolvers<void>()
  const unsubscribe = useStore.subscribe((state, previous) => {
    if (state.thoughts !== previous.thoughts) frames.push({ count: state.thoughts.length, revision: state.remoteThoughtRevision })
    if (state.remoteThoughtRevision > previous.remoteThoughtRevision) refreshed.resolve()
  })
  try {
    await useStore.getState()[load](10)
    await refreshed.promise
    expect(frames.at(-1)).toEqual({ count: 0, revision: 1 })
  } finally { unsubscribe() }
})
