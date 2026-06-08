export type TabShortcutAction =
  | { type: "newCanvas" }
  | { type: "nextTab" }
  | { type: "previousTab" }
  | { type: "jumpToTab"; index: number }

function isApplePlatform() {
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform) || /Mac|iPhone|iPad|iPod/.test(navigator.userAgent)
}

function formatShortcut(key: string) {
  return isApplePlatform() ? `⌃⌥${key}` : `Ctrl+Alt+${key}`
}

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  const tagName = target.tagName
  return target.isContentEditable || tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT"
}

function getDigitIndex(code: string) {
  if (/^Digit[1-9]$/.test(code)) return Number(code.slice(5)) - 1
  if (/^Numpad[1-9]$/.test(code)) return Number(code.slice(6)) - 1
  return null
}

export function getTabShortcutAction(event: KeyboardEvent): TabShortcutAction | null {
  if (!event.ctrlKey || !event.altKey || event.metaKey || event.shiftKey) return null
  if (event.getModifierState("AltGraph") || isEditableTarget(event.target)) return null

  if (event.code === "KeyN") return { type: "newCanvas" }
  if (event.code === "Period") return { type: "nextTab" }
  if (event.code === "Comma") return { type: "previousTab" }

  const index = getDigitIndex(event.code)
  return index === null ? null : { type: "jumpToTab", index }
}

export function tabShortcutLabel(index: number) {
  return index < 9
    ? `Change tabs with ${formatShortcut(String(index + 1))}`
    : `Change tabs with ${formatShortcut(",")}, or ${formatShortcut(".")}`
}

export function newCanvasShortcutLabel() {
  return `New canvas (${formatShortcut("N")})`
}
