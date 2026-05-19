import { useState } from "react"
import { useStore } from "../store"
import { CloseButton } from "./CloseButton"

const MAX_TAG_LENGTH = 16

export function TagsPanel() {
  const { tags, addTag, removeTag, updateTag } = useStore()
  const [name, setName] = useState("")
  const [color, setColor] = useState("#7c3aed")
  const [hexInput, setHexInput] = useState("#7c3aed")
  const [editing, setEditing] = useState<number | null>(null)
  const [editName, setEditName] = useState("")
  const [editColor, setEditColor] = useState("")
  const [editHex, setEditHex] = useState("")

  function onColorChange(val: string) { setColor(val); setHexInput(val) }
  function onHexChange(val: string) {
    setHexInput(val)
    if (/^#[0-9a-fA-F]{6}$/.test(val)) setColor(val)
  }

  function startEdit(tag: { id: number; name: string; color: string }) {
    setEditing(tag.id)
    setEditName(tag.name)
    setEditColor(tag.color)
    setEditHex(tag.color)
  }

  async function saveEdit(id: number) {
    const trimmed = editName.trim().slice(0, MAX_TAG_LENGTH)
    if (trimmed) await updateTag(id, trimmed, editColor)
    setEditing(null)
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = name.trim().slice(0, MAX_TAG_LENGTH)
    if (!trimmed) return
    await addTag(trimmed, color)
    setName("")
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden" }}>
      <div style={{ flex: 1, overflowY: "auto", marginBottom: 16 }}>
        {tags.length === 0 && <p style={{ fontSize: 12, color: "#ccc" }}>No tags yet</p>}
        <style>{`@keyframes tagRowIn { from { opacity:0; transform:translateY(4px) } to { opacity:1; transform:translateY(0) } }`}</style>
        {tags.map((tag, i) => (
          <div key={tag.id} style={{ padding: "5px 0", borderBottom: "1px solid #f5f5f5", animation: `tagRowIn 0.25s ease ${i * 0.02}s both`, opacity: 0 }}>
            {editing === tag.id ? (
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <input type="color" value={editColor}
                  onChange={(e) => { setEditColor(e.target.value); setEditHex(e.target.value) }}
                  style={{ width: 24, height: 24, border: "1px solid #e0e0e0", borderRadius: 4, cursor: "pointer", padding: 1, flexShrink: 0 }} />
                <input value={editName} onChange={(e) => setEditName(e.target.value.slice(0, MAX_TAG_LENGTH))}
                  onKeyDown={(e) => { if (e.key === "Enter") saveEdit(tag.id); if (e.key === "Escape") setEditing(null) }}
                  autoFocus
                  style={{ flex: 1, fontSize: 13, border: "none", outline: "none", color: "#1a1a1a", background: "transparent" }} />
                <input value={editHex} onChange={(e) => { setEditHex(e.target.value); if (/^#[0-9a-fA-F]{6}$/.test(e.target.value)) setEditColor(e.target.value) }}
                  style={{ width: 70, fontSize: 11, padding: "2px 4px", border: "1px solid #e0e0e0", borderRadius: 4, fontFamily: "monospace", color: "#1a1a1a" }} />
                <button onClick={() => saveEdit(tag.id)} style={{ fontSize: 11, padding: "2px 8px", background: "#1a1a1a", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer" }}>Save</button>
                <button onClick={() => setEditing(null)} style={{ fontSize: 11, padding: "2px 6px", background: "none", border: "1px solid #e0e0e0", borderRadius: 4, cursor: "pointer", color: "#888" }}>✕</button>
              </div>
            ) : (
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ width: 10, height: 10, borderRadius: "50%", background: tag.color, flexShrink: 0, transition: "background 0.3s ease" }} />
                <span onClick={() => startEdit(tag)} style={{ flex: 1, fontSize: 13, color: "#333", cursor: "text" }}>{tag.name}</span>
                <CloseButton onClick={() => removeTag(tag.id)} size={20} />
              </div>
            )}
          </div>
        ))}
      </div>
      <form onSubmit={submit} style={{ borderTop: "1px solid #ebebeb", paddingTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
        <p style={{ fontSize: 11, fontWeight: 600, color: "#aaa", textTransform: "uppercase", letterSpacing: "0.06em" }}>New Tag</p>
        <input value={name} onChange={(e) => setName(e.target.value.slice(0, MAX_TAG_LENGTH))} placeholder="Tag name…"
          style={{ fontSize: 13, padding: "6px 8px", border: "1px solid #e0e0e0", borderRadius: 6, outline: "none", color: "#1a1a1a" }} />
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input type="color" value={color} onChange={(e) => onColorChange(e.target.value)}
            style={{ width: 32, height: 32, border: "1px solid #e0e0e0", borderRadius: 6, cursor: "pointer", padding: 2 }} />
          <input value={hexInput} onChange={(e) => onHexChange(e.target.value)} placeholder="#7c3aed"
            style={{ flex: 1, fontSize: 12, padding: "6px 8px", border: "1px solid #e0e0e0", borderRadius: 6, outline: "none", fontFamily: "monospace", color: "#1a1a1a" }} />
        </div>
        <button type="submit"
          style={{ fontSize: 12, padding: "6px 0", background: "#1a1a1a", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 500, transition: "opacity 0.15s ease" }}
          onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.8")}
          onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
        >Add Tag</button>
      </form>
    </div>
  )
}
