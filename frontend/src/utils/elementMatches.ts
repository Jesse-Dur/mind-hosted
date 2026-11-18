export function restoreElementMatches(prototype: Element, document: Document) {
  if (typeof prototype.matches === "function") return

  const matches = typeof prototype.webkitMatchesSelector === "function"
    ? prototype.webkitMatchesSelector
    : matchesFromBlankFrame(document)
  if (typeof matches === "function") {
    Reflect.defineProperty(prototype, "matches", { configurable: true, writable: true, value: matches })
  }
}

function matchesFromBlankFrame(document: Document) {
  // Safari can still expose the native method in a fresh frame on this page.
  const frame = document.createElement("iframe")
  frame.hidden = true
  document.body.appendChild(frame)
  try {
    const frameWindow = frame.contentDocument?.defaultView
    return frameWindow?.Element.prototype.matches
  } finally {
    frame.remove()
  }
}
