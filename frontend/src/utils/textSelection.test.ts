import { describe, expect, test } from "bun:test"
import { hasExpandedTextSelection } from "./textSelection"

describe("mobile text selection isolation", () => {
  test("recognises selected text in an input even without a document selection", () => {
    expect(hasExpandedTextSelection(
      { selectionStart: 4, selectionEnd: 11 },
      { rangeCount: 0, isCollapsed: true, toString: () => "" },
    )).toBe(true)
  })

  test("recognises an expanded content selection", () => {
    expect(hasExpandedTextSelection(
      null,
      { rangeCount: 1, isCollapsed: false, toString: () => "selected thought" },
    )).toBe(true)
  })

  test("does not block the divider when no text is selected", () => {
    expect(hasExpandedTextSelection(
      { selectionStart: 3, selectionEnd: 3 },
      { rangeCount: 1, isCollapsed: true, toString: () => "" },
    )).toBe(false)
  })
})
