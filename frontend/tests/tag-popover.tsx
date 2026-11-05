import { useState } from "react"
import { createRoot } from "react-dom/client"
import { ThoughtTags } from "../src/components/ThoughtTags"
import { useStore } from "../src/store"

const params = new URLSearchParams(location.search)
const names = params.has("many") ? Array.from({ length: 40 }, (_, i) => `Tag ${i + 1}`)
  : params.has("long") ? ["A very long tag ".repeat(30)]
  : ["Follow up", "Personal", "Project Mind", "A longer tag name"]
const colors = ["#7c3aed", "#059669", "#d97706", "#2563eb"]
useStore.setState({ tags: names.map((name, id) => ({ id: id + 1, name, color: colors[id % colors.length]! })) })

function Row({ side, initial = names }: { side: string; initial?: string[] }) {
  const [tags, setTags] = useState(initial)
  const placement = side === "top" ? { left: 24, top: 70 }
    : side === "bottom" ? { right: 12, bottom: 12 }
    : side === "left" ? { left: 8, top: "45%" }
    : side === "right" ? { right: 8, top: "45%" }
    : { left: "40%", top: "35%" }
  return <div data-row={side} style={{ position: "absolute", ...placement, display: "flex", gap: 6, alignItems: "center", padding: 8, background: "#fafafa", border: "1px solid #ddd", borderRadius: 6, fontSize: 13, maxWidth: 300 }}>
    <span style={{ color: "#ccc" }}>⠿</span>
    <span style={{ flex: 1 }}>A thought with tags</span>
    <ThoughtTags tags={tags} onRemove={(tag) => {
      window.__tagRemovals.push(tag)
      setTags((current) => current.filter((item) => item !== tag))
    }} />
    <span style={{ color: "#bbb" }}>×</span>
  </div>
}

window.__tagRemovals = []
function App() {
  const [key, setKey] = useState(0)
  return <>
    <button onClick={() => setKey(key + 1)} style={{ margin: 12 }}>Reset sample tags</button>
    <main key={key}>
      <Row side="top" /><Row side="bottom" />
      <Row side="left" initial={names.slice(0, 2)} />
      <Row side="right" initial={names.slice(0, 3)} /><Row side="center" />
    </main>
  </>
}
createRoot(document.getElementById("root")!).render(<App />)

declare global {
  interface Window {
    __tagRemovals: string[]
    runTagPopoverChecks: typeof runTagPopoverChecks
    armTagPopoverHoverClose: typeof armTagPopoverHoverClose
    tagPopoverHoverCloseResult: { test: string; passed: boolean }[] | null
  }
}

// Run in a real browser. Geometry samples catch a missing dot-to-pill transition
// even when markup, unit tests, and the production build all look correct.
async function runTagPopoverChecks() {
  const results: { test: string; passed: boolean }[] = []
  const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
  const panel = () => document.querySelector<HTMLElement>('[aria-label="Thought tags"]')
  const trigger = (side: string) => document.querySelector<HTMLElement>(`[data-row="${side}"] [role="button"]`)!
  const emit = (node: Element, type: string, pointerType = "mouse") => node.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerType }))
  const check = (test: string, passed: boolean) => results.push({ test, passed })
  const close = async () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
    await wait(450)
  }
  document.querySelector<HTMLButtonElement>('#root > button')!.click()
  window.__tagRemovals.length = 0
  await wait(30)
  for (const side of ["top", "bottom", "left", "right", "center"]) {
    const anchor = trigger(side)
    const source = anchor.firstElementChild!.getBoundingClientRect()
    const before = anchor.parentElement!.getBoundingClientRect()
    emit(anchor, "pointerover")
    const samples: { x: number; y: number; width: number }[] = []
    const start = performance.now()
    await new Promise<void>((resolve) => {
      function tick() {
        const pill = panel()?.querySelector<HTMLElement>("[data-tag-pill]")
        if (pill && getComputedStyle(panel()!).visibility === "visible") {
          const r = pill.getBoundingClientRect()
          samples.push({ x: r.x, y: r.y, width: r.width })
        }
        if (performance.now() - start < 450) requestAnimationFrame(tick)
        else resolve()
      }
      requestAnimationFrame(tick)
    })
    const first = samples[0]!
    const last = samples[samples.length - 1]!
    check(`${side}: starts at source dot`, Math.abs(first.x - source.x - 2) < 1 && Math.abs(first.y - source.y - 5) < 1 && Math.abs(first.width - 8) < 1)
    check(`${side}: travels before expanding`, samples.some((s) => s.width > 9 && s.width < last.width - 1 && Math.abs(s.y - first.y) > 1))
    const bounds = panel()!.getBoundingClientRect()
    check(`${side}: stays in viewport`, bounds.x >= 7.9 && bounds.y >= 7.9 && bounds.right <= innerWidth - 7.9 && bounds.bottom <= innerHeight - 7.9)
    const after = anchor.parentElement!.getBoundingClientRect()
    check(`${side}: thought does not move`, before.x === after.x && before.y === after.y && before.width === after.width && before.height === after.height)
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
    const returning: { x: number; y: number; width: number }[] = []
    const closingStart = performance.now()
    await new Promise<void>((resolve) => {
      function tick() {
        const pill = panel()?.querySelector<HTMLElement>("[data-tag-pill]")
        if (pill) {
          const r = pill.getBoundingClientRect()
          returning.push({ x: r.x, y: r.y, width: r.width })
        }
        if (performance.now() - closingStart < 450) requestAnimationFrame(tick)
        else resolve()
      }
      requestAnimationFrame(tick)
    })
    const returned = returning[returning.length - 1]!
    check(`${side}: reverses through intermediate frames`, returning.some((s) => s.width > 9 && s.width < last.width - 1))
    check(`${side}: returns to its source`, Math.abs(returned.x - source.x - 2) < 1 && Math.abs(returned.y - source.y - 5) < 1 && Math.abs(returned.width - 8) < 1)
    check(`${side}: Escape closes`, !panel())
    check(`${side}: source returns without fading`, getComputedStyle(anchor.firstElementChild!).opacity === "1" && getComputedStyle(anchor.firstElementChild!).animationName === "none")
  }
  const anchor = trigger("center")
  for (const type of ["pointerover", "pointerdown", "pointerup"]) emit(anchor, type, "touch")
  await wait(450)
  check("first touch opens", !!panel())
  emit(document.body, "pointerdown", "touch")
  await wait(450)
  check("outside tap closes", !panel())
  emit(anchor, "pointerover")
  await wait(90)
  emit(anchor, "pointerout")
  await wait(160)
  emit(anchor, "pointerover")
  await wait(450)
  check("rapid reopen remains open", !!panel())
  await close()
  anchor.focus()
  anchor.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
  await wait(450)
  check("keyboard reaches removal buttons", document.activeElement === panel()?.querySelector("button"))
  const width = panel()!.getBoundingClientRect().width
  panel()!.querySelector<HTMLButtonElement>('[aria-label="Remove A longer tag name tag"]')!.click()
  check("removal saves before animation finishes", window.__tagRemovals.includes("A longer tag name"))
  await wait(220)
  check("longest removal keeps panel width", Math.abs(panel()!.getBoundingClientRect().width - width) < 1)
  panel()!.querySelector<HTMLButtonElement>("button")!.focus()
  panel()!.querySelector<HTMLButtonElement>("button")!.click()
  await wait(220)
  check("focus survives removing a pill", document.activeElement === panel()?.querySelector("button"))
  while (panel()) {
    panel()!.querySelector<HTMLButtonElement>("button")!.click()
    await wait(220)
  }
  check("last removal dismisses panel", !trigger("center") && !panel())
  document.querySelector<HTMLButtonElement>('#root > button')!.click()
  return results
}
window.runTagPopoverChecks = runTagPopoverChecks

// Synthetic pointer events do not update browser hit testing. Arm this check
// while hovering a cluster, then move the real pointer to the returned gap.
// Returning pills cross that gap and must not reopen the panel under the mouse.
function armTagPopoverHoverClose(side = "center") {
  const anchor = document.querySelector<HTMLElement>(`[data-row="${side}"] [role="button"]`)!
  const panel = document.getElementById(anchor.getAttribute("aria-controls")!)!
  if (!panel) throw new Error("Hover the requested tag cluster before arming this check")
  const anchorRect = anchor.getBoundingClientRect()
  const panelRect = panel.getBoundingClientRect()
  const source = anchor.firstElementChild!.getBoundingClientRect()
  window.tagPopoverHoverCloseResult = null
  anchor.addEventListener("pointerleave", (event) => {
    let closingSeen = false
    let reopened = false
    let intercepted = false
    let returned: DOMRect | null = null
    const start = performance.now()
    function tick() {
      const closing = (panel.firstElementChild as HTMLElement).style.opacity === "0"
      if (closingSeen && !closing) reopened = true
      closingSeen ||= closing
      const pill = panel.querySelector<HTMLElement>("[data-tag-pill]")!
      if (document.contains(panel)) returned = pill.getBoundingClientRect()
      if (closing) {
        const hit = document.elementFromPoint(event.clientX, event.clientY)
        intercepted ||= Boolean(hit?.closest("[data-tag-pill]"))
      }
      if (performance.now() - start < 900) requestAnimationFrame(tick)
      else window.tagPopoverHoverCloseResult = [
        { test: "uses native hover hit testing", passed: event.isTrusted },
        { test: "leaving starts contraction", passed: closingSeen },
        { test: "returning pills do not intercept the cursor", passed: !intercepted },
        { test: "closing does not reopen itself", passed: !reopened && !document.contains(panel) },
        { test: "contraction reaches the source dot", passed: Boolean(returned && Math.abs(returned.x - source.x - 2) < 1 && Math.abs(returned.y - source.y - 5) < 1 && Math.abs(returned.width - 8) < 1) },
      ]
    }
    requestAnimationFrame(tick)
  }, { once: true })
  return {
    x: anchorRect.x + anchorRect.width / 2,
    y: panelRect.top >= anchorRect.bottom ? (anchorRect.bottom + panelRect.top) / 2 : (panelRect.bottom + anchorRect.top) / 2,
  }
}
window.armTagPopoverHoverClose = armTagPopoverHoverClose
