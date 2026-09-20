type TextControlSelection = {
  selectionStart: number | null
  selectionEnd: number | null
}

type DocumentSelection = {
  rangeCount: number
  isCollapsed: boolean
  toString(): string
}

function isTextControlSelection(value: unknown): value is TextControlSelection {
  if (!value || typeof value !== "object") return false
  return "selectionStart" in value && "selectionEnd" in value
}

/**
 * Input selections are not consistently exposed through window.getSelection()
 * on mobile browsers, so check the focused control and document selection.
 */
export function hasExpandedTextSelection(
  activeElement: unknown = document.activeElement,
  selection: DocumentSelection | null = window.getSelection(),
) {
  if (isTextControlSelection(activeElement)) {
    const { selectionStart, selectionEnd } = activeElement
    if (selectionStart !== null && selectionEnd !== null && selectionStart !== selectionEnd) return true
  }
  return Boolean(selection && selection.rangeCount > 0 && !selection.isCollapsed && selection.toString().length > 0)
}
