export const THOUGHT_TAP_SLOP = 9

type KeyboardViewport = Pick<Window, "innerWidth" | "innerHeight" | "addEventListener" | "removeEventListener"> & {
  visualViewport: Pick<VisualViewport, "height" | "scale" | "addEventListener" | "removeEventListener"> | null
}

// Keyboard dismissal does not necessarily blur a contenteditable on mobile.
// Require a substantial shrink followed by a return near the original height;
// toolbar movement alone must not finish an edit. Width/scale changes reset the
// baseline so rotation and pinch zoom are not mistaken for keyboard dismissal.
export function observeMobileKeyboardDismiss(onDismiss: () => void, owner: KeyboardViewport = window) {
  const viewport = owner.visualViewport
  let width = owner.innerWidth
  let scale = viewport?.scale ?? 1
  let closedHeight = viewport?.height ?? owner.innerHeight
  let keyboardOpen = false

  function resize() {
    const nextWidth = owner.innerWidth
    const nextScale = viewport?.scale ?? 1
    const height = viewport?.height ?? owner.innerHeight
    if (Math.abs(nextWidth - width) > 1 || Math.abs(nextScale - scale) > .01 || Math.abs(nextScale - 1) > .01) {
      width = nextWidth
      scale = nextScale
      closedHeight = height
      keyboardOpen = false
      return
    }
    const keyboardDelta = Math.max(150, closedHeight * .2)
    if (!keyboardOpen) {
      if (closedHeight - height >= keyboardDelta) keyboardOpen = true
      else closedHeight = Math.max(closedHeight, height)
    } else if (closedHeight - height < keyboardDelta / 2) {
      keyboardOpen = false
      closedHeight = height
      onDismiss()
    }
  }

  viewport?.addEventListener("resize", resize)
  owner.addEventListener("resize", resize)
  return () => {
    viewport?.removeEventListener("resize", resize)
    owner.removeEventListener("resize", resize)
  }
}

export function focusThoughtText(node: HTMLElement, x: number, y: number) {
  node.contentEditable = "true"
  node.focus({ preventScroll: true })
  // Becoming editable on release skips the browser's usual caret placement on
  // pointer-down. Restore the caret at the tapped text, not at the start.
  const owner = node.ownerDocument
  const position = owner.caretPositionFromPoint?.(x, y)
  const range = position ? owner.createRange() : owner.caretRangeFromPoint?.(x, y)
  if (position && range) {
    range.setStart(position.offsetNode, position.offset)
    range.collapse(true)
  }
  if (range && node.contains(range.startContainer)) {
    const selection = owner.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
  }
}
