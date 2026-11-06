export function TagLabel({ name, color }: { name: string; color: string }) {
  return <span data-tag-label style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0 }}>
    <span aria-hidden data-tag-marker style={{ width: 8, height: 8, borderRadius: "50%", background: color, flexShrink: 0 }} />
    <span data-tag-name style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
  </span>
}
