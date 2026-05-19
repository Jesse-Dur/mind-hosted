import { useState, useRef } from "react"
import { thoughtsApi } from "../api/client"
import { useStore } from "../store"

function parseInput(value: string, knownTags: string[]): { content: string; tags: string[] } {
  const found: string[] = []
  // sort longest first so "follow up" matches before "follow"
  const sorted = [...knownTags].sort((a, b) => b.length - a.length)
  let cleaned = value
  for (const tag of sorted) {
    const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    const re = new RegExp(`#${escaped}`, "gi")
    if (re.test(cleaned)) {
      found.push(tag)
      cleaned = cleaned.replace(re, "")
    }
  }
  return { content: cleaned.replace(/\s+/g, " ").trim(), tags: found }
}

export function ThoughtInput({ tileId, inputRef }: { tileId: number; inputRef?: React.RefObject<HTMLInputElement | null> }) {
  const [value, setValue] = useState("")
  const [suggestion, setSuggestion] = useState<string | null>(null)
  const { loadThoughts, tags } = useStore()
  const localRef = useRef<HTMLInputElement>(null)
  const ref = inputRef ?? localRef

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Tab" && suggestion) {
      e.preventDefault()
      setValue((v) => v.replace(/#\S*$/, `#${suggestion} `))
      setSuggestion(null)
    }
  }

  function onChange(val: string) {
    setValue(val)
    const hashMatch = val.match(/#(\S*)$/)
    if (hashMatch) {
      const partial = hashMatch[1].toLowerCase()
      const match = partial
        ? tags.find((t) => t.name.toLowerCase().startsWith(partial))
        : tags[0] ?? null
      setSuggestion(match?.name ?? null)
    } else {
      setSuggestion(null)
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!value.trim()) return
    const { content, tags: parsedTags } = parseInput(value, tags.map((t) => t.name))
    await thoughtsApi.create({ tile_id: tileId, content: content || value.trim(), tags: parsedTags, sort_order: 0 })
    setValue("")
    setSuggestion(null)
    loadThoughts()
  }

  return (
    <form onSubmit={submit} style={{ marginTop: 6, position: "relative" }}>
      <input
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Add a thought… (#tag to tag)"
        style={{ width: "100%", background: "transparent", border: "none", borderTop: "1px solid #ebebeb", color: "#999", fontSize: 12, padding: "5px 0", outline: "none" }}
      />
      {suggestion && (
        <div style={{ position: "absolute", top: "100%", left: 0, background: "#fff", border: "1px solid #e8e8e8", borderRadius: 6, padding: "3px 8px", fontSize: 11, color: "#888", boxShadow: "0 2px 8px rgba(0,0,0,0.08)", whiteSpace: "nowrap", zIndex: 10 }}>
          #{suggestion} <span style={{ color: "#ccc" }}>Tab to complete</span>
        </div>
      )}
    </form>
  )
}
