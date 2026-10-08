import { TagDot } from "./TagPill"

export function ThoughtTags({ tags, expandOnHover = true }: { tags: string[]; expandOnHover?: boolean }) {
  if (!tags.length) return null
  return (
    <>
      <style>{`@keyframes tagIn { from { opacity: 0; transform: scale(0.7); } to { opacity: 1; transform: scale(1); } }`}</style>
      <div style={{ height: expandOnHover ? 18 : 20, display: "flex", gap: 0, alignItems: "center", flexShrink: 0, marginRight: -4, userSelect: "none", WebkitUserSelect: "none" }}>
        {tags.map((tag) => (
          <div key={tag} style={{ height: expandOnHover ? 18 : 20, display: "flex", alignItems: "center", animation: "tagIn 0.15s cubic-bezier(0.4,0,0.2,1)" }}>
            <TagDot tag={tag} expandOnHover={expandOnHover} />
          </div>
        ))}
      </div>
    </>
  )
}
