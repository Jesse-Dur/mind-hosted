import { describe, expect, test } from "bun:test"
import { keyIndicatesPhysicalKeyboard } from "./physicalKeyboard"

const key = (value: string, modifiers: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean }> = {}) => ({
  key: value,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  ...modifiers,
})

describe("physical keyboard detection", () => {
  test("recognises shortcut and navigation keys unavailable from normal touch typing", () => {
    expect(keyIndicatesPhysicalKeyboard(key("m", { ctrlKey: true }))).toBeTrue()
    expect(keyIndicatesPhysicalKeyboard(key("ArrowDown"))).toBeTrue()
    expect(keyIndicatesPhysicalKeyboard(key("Escape"))).toBeTrue()
  })

  test("does not treat ordinary virtual-keyboard text entry as physical-keyboard evidence", () => {
    expect(keyIndicatesPhysicalKeyboard(key("a"))).toBeFalse()
    expect(keyIndicatesPhysicalKeyboard(key("Enter"))).toBeFalse()
    expect(keyIndicatesPhysicalKeyboard(key("Backspace"))).toBeFalse()
  })
})
