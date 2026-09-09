export const DEFAULT_CANVAS_FONT_SIZE = 13
export const MIN_CANVAS_FONT_SIZE = 8
export const MAX_CANVAS_FONT_SIZE = 36

const THOUGHT_HORIZONTAL_CHROME = 40
const THOUGHT_GAP = 6
const THOUGHT_TAG_WIDTH = 12
const THOUGHT_TAG_TRAILING_OFFSET = 4
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

export function getThoughtRequiredTileWidth(fontSize: number, tagCount: number) {
  const { controlSize } = getThoughtControlMetrics(fontSize)
  const normalizedTagCount = Number.isFinite(tagCount) ? Math.max(0, Math.floor(tagCount)) : 0
  const hasTags = normalizedTagCount > 0
  const tagWidth = hasTags
    ? normalizedTagCount * THOUGHT_TAG_WIDTH - THOUGHT_TAG_TRAILING_OFFSET
    : 0
  const gapWidth = (hasTags ? 3 : 2) * THOUGHT_GAP

  return THOUGHT_HORIZONTAL_CHROME
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
