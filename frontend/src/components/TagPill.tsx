import { useStore } from "../store"
import { getThoughtTagMetrics } from "../utils/canvasFontSize"

export function TagDot({ tag, fontSize }: { tag: string; fontSize: number }) {
  const color = useStore((state) => state.tags.find((item) => item.name === tag)?.color ?? "#888")
  const { size, width, height } = getThoughtTagMetrics(fontSize)
  return <span aria-label={tag} style={{ width, height, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
    <span aria-hidden data-tag-dot style={{ width: size, height: size, borderRadius: "50%", background: color }} />
  </span>
}
