import { TagDot } from "./TagPill"

export function ThoughtTags({ tags }: { tags: string[] }) {
  if (!tags.length) return null
  return (
    <>
      <style>{`@keyframes tagIn { from { opacity: 0; transform: scale(0.7); } to { opacity: 1; transform: scale(1); } }`}</style>
      <div style={{ display: "flex", gap: 0, alignItems: "center", flexShrink: 0 }}>
        {tags.map((tag) => (
          <div key={tag} style={{ animation: "tagIn 0.15s cubic-bezier(0.4,0,0.2,1)" }}>
            <TagDot tag={tag} />
          </div>
        ))}
      </div>
    </>
  )
}
