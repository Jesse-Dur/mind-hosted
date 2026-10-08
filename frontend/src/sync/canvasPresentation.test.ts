import { beforeEach, expect, test } from "bun:test"
import { canvas, resetFrontendState, useStore } from "../test/syncTestHarness"
import { cacheServerEntity } from "./cache"
import { pullSync } from "./pull"
import type { SyncPullEvent } from "./types"

beforeEach(resetFrontendState)

const first = () => canvas({ id: 10, client_id: "canvas-first", sort_order: 0 })
const second = () => canvas({ id: 11, client_id: "canvas-second", sort_order: 1 })
const third = () => canvas({ id: 12, client_id: "canvas-third", sort_order: 2 })

async function seed() {
  const canvases = [first(), second(), third()]
  for (const item of canvases) await cacheServerEntity("canvas", item, false)
  useStore.setState({ activeCanvasId: 10, canvases })
}

function event(revision: number, data: ReturnType<typeof canvas>, action: "upsert" | "delete" = "upsert"): SyncPullEvent {
  return { revision, canvas_id: null, entity_type: "canvas", entity_id: data.id, client_id: data.client_id!, op_id: `remote-canvas-${revision}`, action, data, created_at: "2026-01-01T00:00:00Z" }
}

test("canvas additions, removals and reordering publish one animation revision with the final tabs", async () => {
  await seed()
  const incoming = canvas({ id: 13, client_id: "incoming", sort_order: 1 })
  const events = [event(1, second(), "delete"), event(2, { ...third(), sort_order: -1 }), event(3, incoming)]
  globalThis.fetch = async () => Response.json({ events, latest_revision: 3 })
  const frames: { ids: number[]; revision: number }[] = []
  const unsubscribe = useStore.subscribe((state, previous) => {
    if (state.canvases !== previous.canvases) frames.push({ ids: state.canvases.map((item) => item.id), revision: state.remoteCanvasRevision })
  })
  try {
    await pullSync()
    expect(frames).toEqual([{ ids: [12, 10, 13], revision: 1 }])
    expect(useStore.getState().remoteThoughtRevision).toBe(0)
    await pullSync()
    expect(frames).toHaveLength(1)
  } finally { unsubscribe() }
})

test("a remote favourite change moves the tab with the same animation notification", async () => {
  await seed()
  globalThis.fetch = async () => Response.json({ events: [event(1, { ...third(), is_favourite: true })], latest_revision: 1 })
  await pullSync()
  expect(useStore.getState().canvases.map((item) => item.id)).toEqual([12, 10, 11])
  expect(useStore.getState().remoteCanvasRevision).toBe(1)
})

test("local tab reordering and a protected remote update do not increment the sync animation revision", async () => {
  await seed()
  await useStore.getState().updateCanvas(11, { sort_order: -1 })
  expect(useStore.getState().remoteCanvasRevision).toBe(0)
  globalThis.fetch = async () => Response.json({ events: [event(1, { ...second(), sort_order: 4 })], latest_revision: 1 })
  await pullSync()
  expect(useStore.getState().canvases.find((item) => item.id === 11)?.sort_order).toBe(-1)
  expect(useStore.getState().remoteCanvasRevision).toBe(0)
})

test("cached canvas refresh publishes snapshot removals with the canvas animation revision", async () => {
  await seed()
  useStore.setState({ canvases: [] })
  globalThis.fetch = async (path) => Response.json(String(path).includes("/snapshot")
    ? { revision: 1, active_canvas_id: 10, canvases: [third(), first()], tags: [], tiles: [], thoughts: [] }
    : { events: [], latest_revision: 0 })
  const refreshed = Promise.withResolvers<void>()
  const frames: { ids: number[]; revision: number }[] = []
  const unsubscribe = useStore.subscribe((state, previous) => {
    if (state.canvases !== previous.canvases) frames.push({ ids: state.canvases.map((item) => item.id), revision: state.remoteCanvasRevision })
    if (state.remoteCanvasRevision > previous.remoteCanvasRevision) refreshed.resolve()
  })
  try {
    await useStore.getState().loadCanvases()
    await refreshed.promise
    expect(frames.at(-1)).toEqual({ ids: [10, 12], revision: 1 })
    useStore.getState().resetStore()
    expect(useStore.getState().remoteCanvasRevision).toBe(0)
  } finally { unsubscribe() }
})
