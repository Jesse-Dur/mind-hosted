import { Command } from "cmdk"
import { useState, useEffect } from "react"
import { useStore } from "../store"
import { tilesApi, thoughtsApi, ollamaApi } from "../api/client"
import type { Tile, Thought } from "../types"
import { findEmptySpot } from "../utils/findEmptySpot"

const ACTION_ITEM: React.CSSProperties = {
  padding: "8px 12px", fontSize: 13, cursor: "pointer",
  borderRadius: 6, margin: "0 6px", display: "flex", alignItems: "center", gap: 8,
}
const GROUP_HEADING: React.CSSProperties = {
  padding: "6px 12px 2px", fontSize: 11, color: "#999", fontWeight: 600,
  textTransform: "uppercase", letterSpacing: "0.05em",
}

export function Spotlight() {
  const { tiles, thoughts, setSpotlightOpen, addTile } = useStore()
  const [showPast, setShowPast] = useState(false)
  const [pastTiles, setPastTiles] = useState<Tile[]>([])
  const [pastThoughts, setPastThoughts] = useState<Thought[]>([])
  const [query, setQuery] = useState("")
  const isAIMode = query.startsWith(">")
  const isTagMode = query.startsWith("#")
  const tagSearch = isTagMode ? query.slice(1).toLowerCase() : ""
  const tagFilteredThoughts = isTagMode
    ? thoughts.filter((t) => t.tags.some((tag) => tag.toLowerCase().includes(tagSearch)))
    : thoughts

  const hasMatches = !query.trim() ||
    tiles.some((t) => t.title.toLowerCase().includes(query.toLowerCase())) ||
    thoughts.some((t) => t.content.toLowerCase().includes(query.toLowerCase()))
  const highlightAI = !hasMatches || isAIMode

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setSpotlightOpen(false)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [setSpotlightOpen])

  async function togglePast() {
    if (!showPast) {
      const [t, th] = await Promise.all([tilesApi.listPast(), thoughtsApi.listPast()])
      setPastTiles(t)
      setPastThoughts(th)
    }
    setShowPast((v) => !v)
  }

  function handleNewTile(title?: string) {
    const { x, y } = findEmptySpot(tiles, 280, 200)
    addTile({ title: title ?? "New Tile", x, y, width: 280, height: 200, importance: 1, visible: true })
    setSpotlightOpen(false)
  }

  function handleAI() {
    const input = isAIMode ? query.slice(1).trim() : query.trim()
    if (!input) return
    ollamaApi.process(input, "medium")
    setSpotlightOpen(false)
  }

  const aiLabel = isAIMode && query.slice(1).trim()
    ? <><em style={{ fontStyle: "normal", opacity: 0.8 }}>{query.slice(1).trim()}</em><span style={{ marginLeft: 4, color: "#bbb", fontSize: 11 }}>→ AI</span></>
    : query.trim() && !isTagMode
      ? <><em style={{ fontStyle: "normal", opacity: 0.8 }}>{query.trim()}</em><span style={{ marginLeft: 4, color: "#bbb", fontSize: 11 }}>→ AI</span></>
      : "Send to AI"

  return (
    <>
      <style>{`
        [cmdk-item] { padding: 8px 12px; font-size: 13px; cursor: pointer; border-radius: 6px; margin: 0 6px; color: #333; display: flex; align-items: center; gap: 8px; }
        [cmdk-item][aria-selected="true"] { background: #f0f0f0; color: #000; }
        [cmdk-group-heading] { padding: 6px 12px 2px; font-size: 11px; color: #999; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; }
        [cmdk-list] { padding: 6px 0; }
      `}</style>
      <div
        onClick={() => setSpotlightOpen(false)}
        style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.2)", display: "flex", alignItems: "flex-start", justifyContent: "center", paddingTop: 120, zIndex: 100 }}
      >
        <div onClick={(e) => e.stopPropagation()} style={{ width: 560, background: "#fff", border: "1px solid #e0e0e0", borderRadius: 12, overflow: "hidden", boxShadow: "0 8px 32px rgba(0,0,0,0.12)" }}>

          {/* Input — outside Command so we control it */}
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") { setSpotlightOpen(false) }
              if (e.key === "Enter" && (isAIMode || highlightAI) && query.trim()) { e.preventDefault(); handleAI() }
            }}
            placeholder="Search, '#tag' filter, 't' new tile, '>' AI…"
            style={{ width: "100%", background: "transparent", border: "none", borderBottom: "1px solid #ebebeb", color: isAIMode ? "#7c3aed" : "#1a1a1a", fontSize: 15, padding: "14px 16px", outline: "none" }}
          />

          {/* Past toggle */}
          <div style={{ padding: "6px 12px", borderBottom: "1px solid #f5f5f5", display: "flex", alignItems: "center", gap: 8 }}>
            <button
              onClick={togglePast}
              style={{ fontSize: 11, fontWeight: 600, padding: "3px 10px", borderRadius: 99, border: "1px solid", borderColor: showPast ? "#1a1a1a" : "#e0e0e0", background: showPast ? "#1a1a1a" : "transparent", color: showPast ? "#fff" : "#999", cursor: "pointer", transition: "background 0.15s ease, color 0.15s ease, border-color 0.15s ease" }}
            >Past</button>
            {showPast && <span style={{ fontSize: 11, color: "#bbb" }}>Showing past thoughts</span>}
          </div>

          {/* Always-visible Actions — never filtered */}
          <div style={{ borderBottom: "1px solid #f5f5f5", padding: "4px 0" }}>
            <p style={GROUP_HEADING}>Actions</p>
            <div
              onClick={() => handleNewTile(query.trim() || undefined)}
              style={ACTION_ITEM}
              onMouseEnter={(e) => (e.currentTarget.style.background = "#f0f0f0")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              <span>＋</span>
              {query.trim() && !isAIMode && !isTagMode ? `New tile "${query.trim()}"` : "New Tile"}
            </div>
            <div
              onClick={handleAI}
              style={{ ...ACTION_ITEM, color: "#7c3aed", background: highlightAI ? "#f0f0f0" : "transparent" }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "#f0f0f0")}
              onMouseLeave={(e) => (e.currentTarget.style.background = highlightAI ? "#f0f0f0" : "transparent")}
            >
              <span>✦</span>{aiLabel}
            </div>
          </div>

          {/* Searchable content via cmdk */}
          <Command>
            <Command.Input value={isTagMode ? "" : query} onValueChange={setQuery} style={{ display: "none" }} />
            <Command.List style={{ maxHeight: 280, overflowY: "auto" }}>
              <Command.Empty style={{ padding: "12px 16px", color: "#999", fontSize: 13 }}>No matching tiles or thoughts</Command.Empty>

              {tiles.length > 0 && (
                <Command.Group heading="Tiles">
                  {tiles.map((tile) => (
                    <Command.Item key={tile.id} value={tile.title} onSelect={() => setSpotlightOpen(false)}>
                      {tile.title}
                    </Command.Item>
                  ))}
                </Command.Group>
              )}

              {(isTagMode ? tagFilteredThoughts : thoughts).length > 0 && (
                <Command.Group heading={isTagMode ? `Thoughts tagged #${tagSearch || "…"}` : "Thoughts"}>
                  {(isTagMode ? tagFilteredThoughts : thoughts).map((t) => {
                    const tile = tiles.find((ti) => ti.id === t.tile_id)
                    return (
                      <Command.Item key={t.id} value={t.content} onSelect={() => setSpotlightOpen(false)}>
                        <span style={{ flex: 1 }}>{t.content}</span>
                        {isTagMode && t.tags.map((tag) => (
                          <span key={tag} style={{ fontSize: 10, color: "#888", background: "#f0f0f0", borderRadius: 4, padding: "1px 5px" }}>{tag}</span>
                        ))}
                        {tile && <span style={{ fontSize: 11, color: "#bbb" }}>{tile.title}</span>}
                      </Command.Item>
                    )
                  })}
                </Command.Group>
              )}

              {showPast && pastTiles.length > 0 && (
                <Command.Group heading="Past Tiles">
                  {pastTiles.map((tile) => (
                    <Command.Item key={`past-tile-${tile.id}`} value={tile.title} onSelect={() => setSpotlightOpen(false)}>
                      <span style={{ color: "#ccc" }}>↩</span> {tile.title}
                    </Command.Item>
                  ))}
                </Command.Group>
              )}

              {showPast && pastThoughts.length > 0 && (
                <Command.Group heading="Past Thoughts">
                  {pastThoughts.map((t) => (
                    <Command.Item key={`past-thought-${t.id}`} value={t.content} onSelect={() => setSpotlightOpen(false)}>
                      <span style={{ color: "#ccc" }}>↩</span> {t.content}
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
            </Command.List>
          </Command>
        </div>
      </div>
    </>
  )
}
