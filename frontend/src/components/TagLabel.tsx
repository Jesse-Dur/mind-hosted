import { DEFAULT_CANVAS_FONT_SIZE, getThoughtTagMetrics } from "../utils/canvasFontSize"

export function TagLabel({ name, color, fontSize = DEFAULT_CANVAS_FONT_SIZE }: { name: string; color: string; fontSize?: number }) {
  const { size } = getThoughtTagMetrics(fontSize)
  return <span data-tag-label style={{ display: "flex", alignItems: "center", gap: size, flex: 1, minWidth: 0 }}>
    <span aria-hidden data-tag-marker style={{ width: size, height: size, borderRadius: "50%", background: color, flexShrink: 0 }} />
    <span data-tag-name style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
  </span>
}
