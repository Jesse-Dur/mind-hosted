import { afterEach, beforeEach, expect, mock, test } from "bun:test"
import "fake-indexeddb/auto"
import { Window } from "happy-dom"
import { act } from "react"
import type { Root } from "react-dom/client"

const browser = new Window({ url: "http://localhost" })
for (const name of ["window", "document", "navigator", "localStorage", "Element", "Node", "HTMLElement", "MutationObserver", "ResizeObserver", "requestAnimationFrame", "cancelAnimationFrame"] as const) {
  Object.defineProperty(globalThis, name, { configurable: true, value: name === "window" ? browser : browser[name] })
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const matchMedia = browser.matchMedia.bind(browser)
browser.matchMedia = (query) => {
  const result = matchMedia(query)
  if (query === "(prefers-reduced-motion: reduce)") Object.defineProperty(result, "matches", { value: true })
  return result
}

const { createRoot } = await import("react-dom/client")
const { ThoughtTags } = await import("./ThoughtTags")
const { DeleteDialog } = await import("./DeleteDialog")
const { MobileFocusedTile } = await import("../layout/mobile/MobileFocusedTile")
const { MobileOverview } = await import("../layout/mobile/MobileOverview")
const { useStore } = await import("../store")

let host: HTMLElement
let root: Root

beforeEach(() => {
  host = document.createElement("div")
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(() => root.unmount())
  host.remove()
})

async function press(target: Element) {
  await act(async () => {
    target.dispatchEvent(new browser.PointerEvent("pointerdown", { bubbles: true, pointerType: "touch" }))
    await Bun.sleep(10)
  })
}

test("thought tags keep the popover open for trigger and panel presses when DOM containment fails", async () => {
  await act(() => root.render(<ThoughtTags tags={["Work"]} />))
  const trigger = host.querySelector("[data-thought-tags-trigger]")!
  await act(() => trigger.dispatchEvent(new browser.PointerEvent("pointerup", { bubbles: true, pointerType: "touch" })))
  const panel = document.querySelector('[aria-label="Thought tags"]')!
  Object.defineProperty(trigger, "contains", { value: () => false })
  Object.defineProperty(panel, "contains", { value: () => false })

  await press(trigger.firstElementChild!)
  expect(panel.isConnected).toBe(true)
  await press(panel.querySelector("[data-tag-pill]")!)
  expect(panel.isConnected).toBe(true)
  await press(host)
  expect(panel.isConnected).toBe(false)
})

const canvas = { id: 1, name: "Sample", sort_order: 0, is_favourite: false, created_at: "" }
const tile = { id: 1, canvas_id: 1, title: "Sample", x: 0, y: 0, width: 200, height: 120, importance: 0, visible: true, created_at: "" }

test("the portaled delete dialog closes only on a backdrop press", async () => {
  const close = mock(() => {})
  await act(() => root.render(<DeleteDialog title="Delete sample?" message="Sample tile" deleteLabel="Delete" onClose={close} onDelete={() => {}} />))
  const backdrop = document.querySelector('[role="dialog"]')!
  await press(backdrop.querySelector("h2")!)
  expect(close).not.toHaveBeenCalled()
  await press(backdrop)
  expect(close).toHaveBeenCalledTimes(1)
})

test("a click in the mobile thought list still focuses its input when DOM containment fails", async () => {
  await act(() => root.render(<MobileFocusedTile tile={tile} thoughts={[]} onFocusTarget={() => {}} />))
  const list = host.querySelector("[data-mobile-thought-list]")!
  Object.defineProperty(list, "contains", { value: () => false })
  await act(() => list.dispatchEvent(new browser.MouseEvent("click", { bubbles: true })))
  expect(document.activeElement === list.querySelector("input")).toBe(true)
})

test("mobile resize and Undo keep presses within their own controls", async () => {
  const previous = useStore.getState()
  const updateTile = mock(async () => {})
  useStore.setState({ canvases: [canvas], activeCanvasId: canvas.id, tiles: [tile], updateTile })
  try {
    await act(() => root.render(<MobileOverview focusedTileId={tile.id} onFocusTile={() => {}} />))
    const overview = host.firstElementChild!
    const tileElement = overview.querySelector("[data-mobile-tile-id]")!
    Object.defineProperty(overview, "contains", { value: () => false })
    const pointer = (type: string, pointerId: number, position: number) => new browser.PointerEvent(type, {
      pointerId, clientX: position, clientY: position, pointerType: "touch", bubbles: true, cancelable: true,
    })
    await act(() => {
      tileElement.dispatchEvent(pointer("pointerdown", 1, 10))
      host.dispatchEvent(pointer("pointerdown", 2, 20))
      tileElement.dispatchEvent(pointer("pointerdown", 3, 30))
      browser.dispatchEvent(pointer("pointermove", 3, 40))
      browser.dispatchEvent(pointer("pointerup", 3, 40))
    })
    expect(updateTile).toHaveBeenCalledTimes(1)

    const undo = overview.querySelector("[data-mobile-tile-undo]")!
    const button = undo.querySelector("button")!
    Object.defineProperty(button, "closest", { value: () => null })
    await press(button)
    expect(undo.isConnected).toBe(true)
    await act(() => button.click())
    expect(updateTile).toHaveBeenLastCalledWith(tile.id, { x: tile.x, y: tile.y, width: tile.width, height: tile.height })
    await press(host)
    expect(undo.isConnected).toBe(false)
  } finally {
    await act(() => useStore.setState(previous))
  }
})
