import { afterEach, beforeEach, expect, mock, test } from "bun:test"
import "fake-indexeddb/auto"
import { Window } from "happy-dom"
import { act } from "react"
import type { Root } from "react-dom/client"
import type { Thought, Tile } from "../types"

const browser = new Window({ url: "http://localhost" })
for (const name of ["window", "document", "navigator", "localStorage", "Element", "Node", "HTMLElement", "MutationObserver", "ResizeObserver", "requestAnimationFrame", "cancelAnimationFrame"] as const) {
  Object.defineProperty(globalThis, name, { configurable: true, value: name === "window" ? browser : browser[name] })
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const { createRoot } = await import("react-dom/client")
const { TabBar } = await import("./TabBar")
const { setGetToken, useStore } = await import("../store")
const { syncDb } = await import("../sync/localDb")
const { cancelScheduledFlush, waitForSyncIdle } = await import("../sync/flush")
const { clearReauthRequired } = await import("../auth/reauthSignal")
const canvas = { id: -1, client_id: "source", name: "Source", is_favourite: false, sort_order: 0, created_at: "", stableKey: "source" }
const target = { ...canvas, id: -2, client_id: "destination", name: "Destination", sort_order: 1, stableKey: "destination" }
const syncedCanvas = { ...canvas, id: 10 }
const syncedTarget = { ...target, id: 11 }
const removeCanvas = mock(useStore.getState().removeCanvas)
const removeCanvasIfEmpty = mock(useStore.getState().removeCanvasIfEmpty)
const originalFetch = globalThis.fetch
let root: Root
let host: HTMLElement

beforeEach(async () => {
  await Promise.all([syncDb.entities.clear(), syncDb.outbox.clear(), syncDb.metadata.clear(), syncDb.syncActivity.clear()])
  clearReauthRequired()
  removeCanvas.mockClear()
  removeCanvasIfEmpty.mockClear()
  useStore.setState({
    canvases: [canvas, target],
    activeCanvasId: canvas.id,
    tiles: [],
    thoughts: [],
    tileCache: new Map(),
    thoughtCache: new Map(),
    loadedCanvasIds: new Set(),
    removeCanvas,
    removeCanvasIfEmpty,
  })
  host = document.createElement("div")
  document.body.appendChild(host)
  root = createRoot(host)
  await act(() => root.render(<TabBar />))
})

afterEach(async () => {
  await act(() => root.unmount())
  host.remove()
  cancelScheduledFlush()
  setGetToken(async () => null)
  globalThis.fetch = originalFetch
})

async function openTabMenu(tabState: "active" | "inactive", label = "Delete") {
  const tab = host.querySelector(`[data-tabbar-jut="${tabState}"]`)!
  await act(() => tab.dispatchEvent(new browser.MouseEvent("contextmenu", { bubbles: true, button: 2 })))
  return Array.from(host.querySelectorAll("div")).find((item) => item.textContent === label && !item.firstElementChild)!
}

async function clickDelete(action: HTMLDivElement) {
  await act(() => action.dispatchEvent(new browser.PointerEvent("pointerdown", { bubbles: true })))
  await act(async () => {
    action.click()
    await removeCanvasIfEmpty.mock.results.at(-1)?.value
  })
}

async function chooseDelete(tabState: "active" | "inactive") {
  await clickDelete(await openTabMenu(tabState))
}

function findButton(label: string) {
  return Array.from(document.querySelectorAll("button")).find((item) => item.textContent === label)!
}

async function showCachedEmptyCanvas(activeCanvasId = syncedCanvas.id) {
  await act(() => useStore.setState({
    canvases: [syncedCanvas, syncedTarget],
    activeCanvasId,
    tileCache: new Map([[syncedCanvas.id, []]]),
    thoughtCache: new Map([[syncedCanvas.id, []]]),
  }))
}

function snapshotResponse(tiles: Tile[] = [], thoughts: Thought[] = []) {
  return Response.json({
    revision: 0,
    canvases: [syncedCanvas, syncedTarget],
    active_canvas_id: syncedCanvas.id,
    tags: [],
    thoughts,
    tiles,
  })
}

test("Rename opens when DOM containment disagrees with the event path", async () => {
  const action = await openTabMenu("active", "Rename")
  // Match the live trace where the press reaches Rename and the containment check returns false.
  Object.defineProperty(action.parentElement!, "contains", { value: () => false })
  await act(() => action.dispatchEvent(new browser.PointerEvent("pointerdown", { bubbles: true, button: 0 })))
  expect(action.isConnected).toBe(true)

  await act(() => action.dispatchEvent(new browser.PointerEvent("pointerup", { bubbles: true, button: 0 })))
  await act(() => action.click())
  expect(host.querySelector<HTMLInputElement>('[data-tabbar-jut="active"] input')?.value).toBe(canvas.name)
  expect(action.isConnected).toBe(false)
})

test("a press outside the menu dismisses it before the click", async () => {
  const action = await openTabMenu("active", "Rename")
  await act(() => host.dispatchEvent(new browser.PointerEvent("pointerdown", { bubbles: true, button: 0 })))
  expect(action.isConnected).toBe(false)
  expect(host.querySelector('[data-tabbar-jut="active"] input')).toBeNull()
})

test.each(["active", "inactive"] as const)("Delete asks while an empty cache is loading for an %s canvas and skips confirmation after an empty snapshot", async (tabState) => {
  await showCachedEmptyCanvas(tabState === "active" ? syncedCanvas.id : syncedTarget.id)
  setGetToken(async () => "test-token")
  const requested = Promise.withResolvers<void>()
  const response = Promise.withResolvers<Response>()
  globalThis.fetch = async () => {
    requested.resolve()
    return response.promise
  }
  let loading!: Promise<void>
  await act(async () => {
    const store = useStore.getState()
    loading = tabState === "active" ? store.loadTiles(syncedCanvas.id) : store.hydrateRemainingCanvases(true)
    await requested.promise
  })
  await chooseDelete(tabState)
  expect(document.querySelector('[role="dialog"]')?.textContent ?? "").toContain('Delete "Source"?')
  expect(removeCanvas).not.toHaveBeenCalled()
  await act(() => findButton("Cancel").click())
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  expect(removeCanvas).not.toHaveBeenCalled()

  await act(async () => {
    response.resolve(snapshotResponse())
    await loading
  })
  setGetToken(async () => null)
  await chooseDelete(tabState)
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  expect(removeCanvas).toHaveBeenCalledWith(syncedCanvas.id, { mode: "deleteContents" })
  expect(useStore.getState().canvases).toEqual([syncedTarget])
})

test("Delete on a loaded canvas opens confirmation when DOM containment disagrees with the event path", async () => {
  const tile: Tile = {
    id: 20, canvas_id: syncedCanvas.id, title: "Tile", x: 0, y: 0, width: 100, height: 100,
    importance: 0, visible: true, created_at: "",
  }
  const thought: Thought = { id: 21, tile_id: tile.id, content: "Canvas item", tags: [], sort_order: 0, created_at: "" }
  await showCachedEmptyCanvas()
  setGetToken(async () => "test-token")
  globalThis.fetch = async () => snapshotResponse([tile], [thought])
  await act(() => useStore.getState().loadTiles(syncedCanvas.id))
  expect(useStore.getState().tiles.map((item) => item.id)).toEqual([tile.id])
  expect(useStore.getState().thoughts.map((item) => item.id)).toEqual([thought.id])

  const action = await openTabMenu("active")
  Object.defineProperty(action.parentElement!, "contains", { value: () => false })
  await clickDelete(action)
  const dialog = document.querySelector('[role="dialog"]')
  expect(dialog?.querySelector("h2")?.textContent).toBe('Delete "Source"?')
  expect(removeCanvas).not.toHaveBeenCalled()
})

test("Delete asks while the last tile's removal is waiting to sync", async () => {
  const tile: Tile = {
    id: 20, canvas_id: syncedCanvas.id, title: "Tile", x: 0, y: 0, width: 100, height: 100,
    importance: 0, visible: true, created_at: "",
  }
  await showCachedEmptyCanvas()
  setGetToken(async () => "test-token")
  globalThis.fetch = async () => snapshotResponse([tile])
  await act(() => useStore.getState().loadTiles(syncedCanvas.id))
  setGetToken(async () => null)
  await act(async () => {
    await useStore.getState().removeTile(tile.id)
    cancelScheduledFlush()
    await waitForSyncIdle()
    clearReauthRequired()
  })
  expect(useStore.getState().tiles).toEqual([])
  await chooseDelete("active")
  expect(document.querySelector('[role="dialog"]')?.textContent ?? "").toContain('Delete "Source"?')
  expect(removeCanvas).not.toHaveBeenCalled()
})

test("confirming Move and delete queues the canvas deletion with its destination", async () => {
  await showCachedEmptyCanvas(syncedTarget.id)
  await chooseDelete("inactive")
  await act(async () => {
    findButton("Move and delete").click()
    await removeCanvas.mock.results[0]?.value
  })
  expect(useStore.getState().canvases).toEqual([syncedTarget])
  expect(await syncDb.outbox.where("entityType").equals("canvas").first()).toMatchObject({
    action: "delete",
    serverId: syncedCanvas.id,
    payload: { mode: "moveContents", targetCanvasId: syncedTarget.id },
  })
})
