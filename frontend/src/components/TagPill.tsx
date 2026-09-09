import { useStore } from "../store"

export function TagDot({ tag }: { tag: string }) {
  const { tags } = useStore()
  const match = tags.find((t) => t.name === tag)
  const color = match?.color ?? "#888"

  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        cursor: "default",
        height: 18,
        width: 12,
        minWidth: 12,
      }}
    >
      <div style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        height: 18,
        width: 18,
        minWidth: 18,
        borderRadius: 99,
        background: color,
        transformOrigin: "center center",
        transform: "scale(0.44)",
      }}>
      </div>
    </div>
  )
}
