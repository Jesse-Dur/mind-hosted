import { useStore } from "../src/store"
import type { SyncVisualState } from "../src/sync/types"

// Run against the real Thought/MobileFocusedTile components in tag-popover.html?sync.
export async function runThoughtSyncChecks(setStatus: (state: SyncVisualState | null) => void) {
  const mobile = new URLSearchParams(location.search).has("mobile")
  const results: { test: string; passed: boolean }[] = []
  const check = (test: string, passed: boolean) => results.push({ test, passed })
  const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
  const rows = () => [...document.querySelectorAll<HTMLElement>(mobile ? "[data-mobile-thought-id]" : "[data-sync-sample] [draggable]")]
  const geometry = () => rows().map((row) => {
    const rect = row.getBoundingClientRect()
    const text = row.children[1]!.getBoundingClientRect()
    return [rect.x, rect.y, rect.width, rect.height, text.x, text.y, text.width, text.height]
  })
  const same = (actual: number[][], expected: number[][]) => actual.length === expected.length
    && actual.every((row, i) => row.every((value, j) => Math.abs(value - expected[i]![j]!) < 0.1))

  for (const preference of mobile ? [8, 13, 24, 36] : [13]) {
    useStore.setState({ canvasFontSize: preference })
    setStatus(null)
    await wait(280)
    const before = geometry()
    const initialTags = rows().map((row) => row.querySelector("[data-thought-tags-trigger]")?.getBoundingClientRect().x)
    for (const state of ["pending", "synced", "error", "local_only", null] as const) {
      setStatus(state)
      const frames: number[][][] = []
      const started = performance.now()
      await new Promise<void>((resolve) => {
        const frame = () => {
          frames.push(geometry())
          if (performance.now() - started < (state === "synced" ? 1100 : 280)) requestAnimationFrame(frame)
          else resolve()
        }
        requestAnimationFrame(frame)
      })
      check(`${preference}/${state}: row bounds and text wrapping stay fixed in every frame`, frames.every((sample) => same(sample, before)))
      if (state !== "pending") continue
      rows().forEach((row, i) => {
        const fontSize = mobile ? preference : Number.parseFloat(getComputedStyle(row).fontSize)
        const expectedSize = new Map([[8, 7], [13, 12], [24, 22], [36, 33]]).get(fontSize)!
        const button = row.querySelector('[aria-label="Syncing"]')!
        const svg = button.querySelector("svg")!
        const spinner = svg.getBoundingClientRect()
        // Rotation enlarges an SVG's rectangular bounds, but not its circular artwork.
        const size = Number.parseFloat(getComputedStyle(svg).width)
        const centerX = spinner.x + spinner.width / 2
        const centerY = spinner.y + spinner.height / 2
        const bounds = row.getBoundingClientRect()
        check(`${preference}/${i}: spinner scales with the displayed font`, size === expectedSize && Number.parseFloat(getComputedStyle(svg).height) === expectedSize)
        check(`${preference}/${i}: spinner stays centred inside the thought`, Math.abs(centerY - bounds.y - bounds.height / 2) < 0.1 && centerY - size / 2 >= bounds.top && centerY + size / 2 <= bounds.bottom)
        const dots = [...row.querySelectorAll("[data-tag-dot]")]
        check(`${preference}/${i}: tags clear the spinner`, dots.every((dot) => dot.getBoundingClientRect().right <= centerX - size / 2))
      })
    }
    if (!mobile) {
      check("desktop: dots return to their original positions", rows().every((row, i) => {
        const x = row.querySelector("[data-thought-tags-trigger]")?.getBoundingClientRect().x
        return x === undefined || Math.abs(x - initialTags[i]!) < 0.1
      }))
    }
  }
  return results
}

export async function runThoughtTagFocusChecks() {
  const mobile = new URLSearchParams(location.search).has("mobile")
  const row = document.querySelector<HTMLElement>(mobile ? '[data-mobile-thought-id="102"]' : '[data-sync-sample="102"] [draggable]')!
  const trigger = row.querySelector<HTMLElement>("[data-thought-tags-trigger]")!
  const panel = () => document.querySelector<HTMLElement>('[aria-label="Thought tags"]')
  const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
  const results: { test: string; passed: boolean }[] = []
  trigger.focus()
  trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
  await wait(450)
  results.push({ test: "keyboard opening focuses a removal button", passed: document.activeElement === panel()?.querySelector("button") })
  panel()!.querySelector<HTMLButtonElement>("button")!.click()
  await wait(220)
  results.push({ test: "removing a tag focuses the next removal button", passed: document.activeElement === panel()?.querySelector("button") })
  panel()!.querySelector<HTMLButtonElement>("button")!.click()
  await wait(220)
  results.push({ test: "removing the final tag closes the popover", passed: !panel() })
  results.push({ test: "the thought's delete button receives focus", passed: document.activeElement === row.querySelector('[aria-label="Delete thought"]') })
  return results
}
