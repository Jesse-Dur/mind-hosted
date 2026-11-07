export const DEFAULT_CANVAS_FONT_SIZE = 13
export const MIN_CANVAS_FONT_SIZE = 8
export const MAX_CANVAS_FONT_SIZE = 36
const THOUGHT_HORIZONTAL_CHROME = 40
const THOUGHT_GAP = 6
const MIN_THOUGHT_TEXT_WIDTH = 4

export function normalizeCanvasFontSize(value: number) {
  if (!Number.isFinite(value)) return DEFAULT_CANVAS_FONT_SIZE
  return Math.min(MAX_CANVAS_FONT_SIZE, Math.max(MIN_CANVAS_FONT_SIZE, Math.round(value)))
}

export function getThoughtControlMetrics(fontSize: number) {
  const normalizedFontSize = normalizeCanvasFontSize(fontSize)
  const controlScale = normalizedFontSize / DEFAULT_CANVAS_FONT_SIZE
  const desiredControlSize = normalizedFontSize < DEFAULT_CANVAS_FONT_SIZE
    ? Math.max(13, Math.round(18 * controlScale))
    : Math.max(18, Math.round(normalizedFontSize * 1.1))

  return {
    controlSize: desiredControlSize,
    handleSize: Math.min(Math.max(8, Math.round(11 * controlScale)), desiredControlSize - 6),
    closeIconSize: Math.min(Math.max(7, Math.round(8 * controlScale)), Math.round(desiredControlSize * 0.55)),
  }
}

export function getThoughtTagMetrics(fontSize: number) {
  const scale = normalizeCanvasFontSize(fontSize) / DEFAULT_CANVAS_FONT_SIZE
  const size = Math.max(5, Math.round(8 * scale))
  const padding = Math.max(3, Math.round(4 * scale))
  return { size, width: size + padding, height: getThoughtControlMetrics(fontSize).controlSize, trailingOffset: padding }
}

export function getThoughtSyncMetrics(fontSize: number) {
  const spinnerSize = Math.round(12 * normalizeCanvasFontSize(fontSize) / DEFAULT_CANVAS_FONT_SIZE)
  const controlSize = Math.max(20, spinnerSize + 8)
  // Reserve the same width before, during, and after syncing so text cannot rewrap.
  return { spinnerSize, controlSize, reserve: controlSize + THOUGHT_GAP }
}

export function getThoughtRequiredTileWidth(fontSize: number, tagCount: number) {
  const { controlSize } = getThoughtControlMetrics(fontSize)
  const tagMetrics = getThoughtTagMetrics(fontSize)
  const normalizedTagCount = Number.isFinite(tagCount) ? Math.max(0, Math.floor(tagCount)) : 0
  const hasTags = normalizedTagCount > 0
  const tagWidth = hasTags
    ? normalizedTagCount * tagMetrics.width - tagMetrics.trailingOffset
    : 0
  const gapWidth = (hasTags ? 3 : 2) * THOUGHT_GAP

  return THOUGHT_HORIZONTAL_CHROME
    + getThoughtSyncMetrics(fontSize).reserve
    + controlSize * 2
    + tagWidth
    + gapWidth
    + MIN_THOUGHT_TEXT_WIDTH
}

export function getEffectiveCanvasFontSize(preferredFontSize: number, tileWidth: number, maxTagCount: number) {
  const preferred = normalizeCanvasFontSize(preferredFontSize)
  for (let fontSize = preferred; fontSize >= MIN_CANVAS_FONT_SIZE; fontSize -= 1) {
    if (getThoughtRequiredTileWidth(fontSize, maxTagCount) <= tileWidth) return fontSize
  }
  return MIN_CANVAS_FONT_SIZE
}
