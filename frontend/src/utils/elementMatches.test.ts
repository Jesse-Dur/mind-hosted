import { expect, test } from "bun:test"
import { Window } from "happy-dom"
import { restoreElementMatches } from "./elementMatches"

test("restoring selector matching reuses either available method without creating a frame", () => {
  const native = () => true
  const standard = { matches: native } as Element
  const prefixed = { webkitMatchesSelector: native } as Element
  const createElement = () => { throw new Error("A frame is unnecessary") }
  const document = { createElement } as unknown as Document

  restoreElementMatches(standard, document)
  restoreElementMatches(prefixed, document)

  expect(standard.matches).toBe(native)
  expect(prefixed.matches).toBe(native)
})

test("Clerk's focus selectors use the native method from a temporary frame", async () => {
  const browser = new Window({ settings: { enableIframePageLoading: true } })
  try {
    const { document } = browser
    const prototype = {} as Element
    restoreElementMatches(prototype, document as unknown as Document)
    expect(document.querySelector("iframe")).toBeNull()

    const button = document.createElement("button")
    document.body.appendChild(button)
    expect(prototype.matches.call(button, "button:not([inert])")).toBe(true)
    button.setAttribute("inert", "")
    expect(prototype.matches.call(button, "button:not([inert])")).toBe(false)

    const host = document.createElement("div")
    document.body.appendChild(host)
    const shadow = host.attachShadow({ mode: "open" })
    const details = document.createElement("details")
    shadow.appendChild(details)
    details.innerHTML = "<summary>First</summary><summary>Second</summary>"
    const selector = "details > summary:first-of-type:not([inert])"
    expect(prototype.matches.call(details.firstElementChild!, selector)).toBe(true)
    expect(prototype.matches.call(details.lastElementChild!, selector)).toBe(false)

    button.remove()
    expect(prototype.matches.call(button, "button[inert]")).toBe(true)
    expect(prototype.matches.call(button, "a[href]")).toBe(false)
    expect(button.parentNode).toBeNull()
  } finally {
    await browser.close()
  }
})
