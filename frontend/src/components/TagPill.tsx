import { useStore } from "../store"

export function TagDot({ tag }: { tag: string }) {
  const color = useStore((state) => state.tags.find((item) => item.name === tag)?.color ?? "#888")
  return <span aria-label={tag} style={{ width: 12, height: 18, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
    <span aria-hidden style={{ width: 8, height: 8, borderRadius: "50%", background: color }} />
  </span>
}
