import { Command } from "cmdk"
import { useState, useEffect, useRef } from "react"
import { useAuth } from "@clerk/clerk-react"
import { useStore } from "../store"
import { createApi } from "../api/client"
import { useMicRecording } from "../hooks/useMicRecording"
import { MicButton } from "./MicButton"
import type { Tile, Thought } from "../types"
import { findEmptySpot } from "../utils/findEmptySpot"

export function Spotlight({ openedByMic, onClose }: { openedByMic: boolean; onClose: () => void }) {
  const { tiles, thoughts, tileCache, thoughtCache, addTile, processAiInput, setHighlight, setActiveCanvas, activeCanvasId } = useStore()
  const { getToken } = useAuth()
  const [showPast, setShowPast] = useState(false)
  const [allTabs, setAllTabs] = useState(false)
  const [pastTiles, setPastTiles] = useState<Tile[]>([])
  const [pastThoughts, setPastThoughts] = useState<Thought[]>([])
  const [query, setQuery] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)
  const cmdkInputRef = useRef<HTMLInputElement>(null)
  const { micState, micError, handleMic, cancelRecording, stopForEditing, stopAndTranscribe } = useMicRecording(getToken, (text) => {
    setQuery((q) => (q ? q + " " : "> ") + text)
    setTimeout(() => inputRef.current?.focus(), 50)
  })
  const openedByMicRef = useRef(openedByMic)
  const startedMicFromOpenRef = useRef(false)
  const showRecordingHints = micState === "recording" || micState === "loading" || (openedByMicRef.current && !query.trim())
  const showShortcutHint = micState === "idle" && !openedByMicRef.current && !query.trim()
  const isAIMode = query.startsWith(">")
  const AI_LIMIT = 500
  const aiInput = isAIMode ? query.slice(1).trim() : query.trim()
  const aiCharsLeft = AI_LIMIT - aiInput.length
  const showCounter = aiCharsLeft <= 50
  const isOverLimit = aiCharsLeft < 0
  const isTagMode = query.startsWith("#")
  const tagSearch = isTagMode ? query.slice(1).toLowerCase() : ""
  const cachedTiles = [...new Map([...tileCache.values()].flat().map((t) => [t.id, t])).values()]
  const cachedThoughts = [...new Map([...thoughtCache.values()].flat().map((t) => [t.id, t])).values()]
  // All Tabs uses warmed caches; active mode stays limited to the visible canvas.
  const visibleTiles = allTabs ? cachedTiles : tiles.filter((t) => t.canvas_id === activeCanvasId)
  const visibleThoughts = allTabs ? cachedThoughts : thoughts.filter((t) => visibleTiles.some((ti) => ti.id === t.tile_id))
  const tagFilteredThoughts = isTagMode
    ? visibleThoughts.filter((t) => t.tags.some((tag) => tag.toLowerCase().includes(tagSearch)))
    : visibleThoughts

  const hasMatches = !query.trim() ||
    visibleTiles.some((t) => t.title.toLowerCase().includes(query.toLowerCase())) ||
    visibleThoughts.some((t) => t.content.toLowerCase().includes(query.toLowerCase()))
  const highlightAI = !hasMatches || isAIMode
  // Keep the search box hot after UI interactions so typing can continue without an extra click.
  const focusInput = () => requestAnimationFrame(() => inputRef.current?.focus())

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        if (micState === "recording" || micState === "loading") { cancelRecording(); return }
        onClose()
        return
      }
      if ((micState === "recording" || micState === "loading") && e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
        stopForEditing()
      }
    }
    function onMicShortcut() {
      if (micState === "idle") {
        handleMic()
      } else if (micState === "recording") {
        stopAndTranscribe((text) => {
          const input = text.trim()
          processAiInput(input, "medium")
          onClose()
        })
      }
    }
    window.addEventListener("keydown", onKey)
    window.addEventListener("mic-shortcut", onMicShortcut)
    return () => {
      window.removeEventListener("keydown", onKey)
      window.removeEventListener("mic-shortcut", onMicShortcut)
    }
  }, [micState, cancelRecording, stopForEditing, stopAndTranscribe, handleMic, onClose, processAiInput])

  async function togglePast() {
    if (!showPast) {
      const api = createApi(getToken)
      const [t, th] = await Promise.all([api.tiles.listPast(), api.thoughts.listPast()])
      setPastTiles(t)
      setPastThoughts(th)
    }
    setShowPast((v) => !v)
    focusInput()
  }

  function handleNewTile(title?: string) {
    const { x, y } = findEmptySpot(tiles, 280, 200)
    addTile({ title: title ?? "New Tile", x, y, width: 280, height: 200, importance: 1, visible: true, canvas_id: activeCanvasId })
    onClose()
  }

  function handleAI() {
    const input = isAIMode ? query.slice(1).trim() : query.trim()
    if (!input) return
    if (input.length > AI_LIMIT) { return }
    processAiInput(input, "medium")
    onClose()
  }

  function switchToResultCanvas(canvasId: number | null) {
    // Search results can come from warmed caches, so switch tabs before highlighting off-canvas matches.
    if (canvasId !== null && canvasId !== activeCanvasId) setActiveCanvas(canvasId)
  }

  function handleTileSelect(tile: Tile) {
    switchToResultCanvas(tile.canvas_id)
    setHighlight("tile", tile.id)
    onClose()
  }

  function getThoughtCanvasId(thought: Thought, parentTile?: Tile) {
    if (parentTile?.canvas_id !== null && parentTile?.canvas_id !== undefined) return parentTile.canvas_id
    for (const [canvasId, cachedThoughts] of thoughtCache) {
      if (cachedThoughts.some((cachedThought) => cachedThought.id === thought.id)) return canvasId
    }
    return null
  }

  function handleThoughtSelect(thought: Thought, parentTile?: Tile) {
    switchToResultCanvas(getThoughtCanvasId(thought, parentTile))
    setHighlight("thought", thought.id)
    onClose()
  }

  const aiLabel = isAIMode && query.slice(1).trim()
    ? <><em style={{ fontStyle: "normal", opacity: 0.8 }}>{query.slice(1).trim()}</em><span style={{ marginLeft: 4, color: "#bbb", fontSize: 11 }}>→ AI</span></>
    : query.trim() && !isTagMode
      ? <><em style={{ fontStyle: "normal", opacity: 0.8 }}>{query.trim()}</em><span style={{ marginLeft: 4, color: "#bbb", fontSize: 11 }}>→ AI</span></>
      : "Send to AI"

  useEffect(() => {
    if (!openedByMic || startedMicFromOpenRef.current || micState !== "idle") return
    startedMicFromOpenRef.current = true
    handleMic()
  }, [handleMic, micState, openedByMic])

  return (
    <>
      <style>{`
        [cmdk-item] { padding: 8px 12px; font-size: 13px; cursor: pointer; border-radius: 6px; margin: 0 6px; color: #333; display: flex; align-items: center; gap: 8px; }
        [cmdk-item][aria-selected="true"] { background: #f0f0f0; color: #000; }
        [cmdk-group-heading] { padding: 6px 12px 2px; font-size: 11px; color: #999; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; }
        [cmdk-list] { padding: 6px 0; }
        @keyframes micPulse { 0%,100% { opacity:1 } 50% { opacity:0.5 } }
        @keyframes spin { to { transform: rotate(360deg) } }
      `}</style>
      <div
        onMouseDown={() => onClose()}
        style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.2)", display: "flex", alignItems: "flex-start", justifyContent: "center", paddingTop: 120, zIndex: 100 }}
      >
        <div
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => {
            e.stopPropagation()
            if (e.target !== inputRef.current) {
              e.preventDefault()
              focusInput()
            }
          }}
          style={{ width: 560, background: "#fff", border: "1px solid #e0e0e0", borderRadius: 12, overflow: "hidden", boxShadow: "0 8px 32px rgba(0,0,0,0.12)" }}
        >

          {/* Input row with mic button */}
          <div style={{ position: "relative", display: "flex", alignItems: "center", borderBottom: "1px solid #ebebeb" }}>
            <input
              ref={inputRef}
              autoFocus
              value={query}
              onKeyDown={(e) => {
                if (e.key === "Escape") { onClose() }
                if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                  e.preventDefault()
                  cmdkInputRef.current?.dispatchEvent(new KeyboardEvent("keydown", { key: e.key, bubbles: true, cancelable: true }))
                }
                if (e.key === "Enter") {
                  const selected = document.querySelector('[cmdk-item][aria-selected="true"]')
                  if (selected) {
                    e.preventDefault()
                    cmdkInputRef.current?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }))
                  } else if ((isAIMode || highlightAI) && query.trim()) {
                    e.preventDefault()
                    handleAI()
                  }
                }
              }}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search, '#tag' filter, '>' AI…"
              disabled={micState === "transcribing"}
              style={{ flex: 1, background: "transparent", border: "none", color: isAIMode ? "#7c3aed" : "#1a1a1a", fontSize: 15, padding: "14px 16px", outline: "none" }}
            />
            <MicButton micState={micState} onMicClick={handleMic} />
          </div>

          {/* Mic error + AI char counter */}
          {(micError || showCounter || isOverLimit) && (
            <div style={{ padding: "4px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", minHeight: 24 }}>
              {micError
                ? <span style={{ fontSize: 12, color: "#ef4444" }}>{micError}</span>
                : <span />}
              {(showCounter || isOverLimit) && (
                <span style={{ fontSize: 12, fontWeight: 500, marginLeft: "auto", color: aiCharsLeft < 0 ? "#ef4444" : aiCharsLeft === 0 ? "#f97316" : "#999" }}>
                  AI Input Characters: {aiCharsLeft}
                </span>
              )}
            </div>
          )}

          {/* Recording hints */}
          <div style={{
            maxHeight: showRecordingHints ? 32 : 0,
            overflow: "hidden",
            transition: "max-height 0.25s cubic-bezier(0.4,0,0.2,1)",
          }}>
            <div style={{ padding: "5px 16px", display: "flex", alignItems: "center", gap: 12, background: "#fafafa", borderBottom: "1px solid #f5f5f5" }}>
              <span style={{ fontSize: 10, color: "#bbb" }}><kbd style={{ fontFamily: "inherit", background: "#f0f0f0", borderRadius: 3, padding: "1px 4px" }}>⌘⇧M</kbd> send</span>
              <span style={{ fontSize: 10, color: "#bbb" }}><kbd style={{ fontFamily: "inherit", background: "#f0f0f0", borderRadius: 3, padding: "1px 4px" }}>any key</kbd> edit</span>
              <span style={{ fontSize: 10, color: "#bbb" }}><kbd style={{ fontFamily: "inherit", background: "#f0f0f0", borderRadius: 3, padding: "1px 4px" }}>esc</kbd> cancel</span>
            </div>
          </div>

          {/* Mic shortcut hint */}
          <div style={{
            maxHeight: showShortcutHint ? 40 : 0,
            overflow: "hidden",
            transition: "max-height 0.25s cubic-bezier(0.4,0,0.2,1)",
          }}>
            <div style={{ padding: "5px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", background: "#fafafa", borderBottom: "1px solid #f5f5f5" }}>
              <span style={{ fontSize: 11, color: "#aaa" }}><kbd style={{ fontFamily: "inherit", background: "#f0f0f0", borderRadius: 3, padding: "1px 4px", fontSize: 10 }}>Ctrl+Shift+M</kbd> or <kbd style={{ fontFamily: "inherit", background: "#f0f0f0", borderRadius: 3, padding: "1px 4px", fontSize: 10 }}>⌘⇧M</kbd> to record</span>
            </div>
          </div>

          {/* Nav hints — idle with content */}
          <div style={{
            maxHeight: micState === "idle" && !!query.trim() ? 32 : 0,
            overflow: "hidden",
            transition: "max-height 0.25s cubic-bezier(0.4,0,0.2,1)",
          }}>
            <div style={{ padding: "5px 16px", display: "flex", alignItems: "center", gap: 12, background: "#fafafa", borderBottom: "1px solid #f5f5f5" }}>
              <span style={{ fontSize: 10, color: "#bbb" }}><kbd style={{ fontFamily: "inherit", background: "#f0f0f0", borderRadius: 3, padding: "1px 4px" }}>↑↓</kbd> navigate</span>
              <span style={{ fontSize: 10, color: "#bbb" }}><kbd style={{ fontFamily: "inherit", background: "#f0f0f0", borderRadius: 3, padding: "1px 4px" }}>enter</kbd> select</span>
            </div>
          </div>

          {/* Past + All Tabs toggles */}
          <div style={{ padding: "6px 12px", borderBottom: "1px solid #f5f5f5", display: "flex", alignItems: "center", gap: 8 }}>
            <button
              onClick={togglePast}
              style={{ fontSize: 11, fontWeight: 600, padding: "3px 10px", borderRadius: 99, border: "1px solid", borderColor: showPast ? "#1a1a1a" : "#e0e0e0", background: showPast ? "#1a1a1a" : "transparent", color: showPast ? "#fff" : "#999", cursor: "pointer", transition: "background 0.15s ease, color 0.15s ease, border-color 0.15s ease" }}
            >Past</button>
            <button
              onClick={() => setAllTabs((v) => !v)}
              style={{ fontSize: 11, fontWeight: 600, padding: "3px 10px", borderRadius: 99, border: "1px solid", borderColor: allTabs ? "#1a1a1a" : "#e0e0e0", background: allTabs ? "#1a1a1a" : "transparent", color: allTabs ? "#fff" : "#999", cursor: "pointer", transition: "background 0.15s ease, color 0.15s ease, border-color 0.15s ease" }}
            >All Tabs</button>
            {showPast && <span style={{ fontSize: 11, color: "#bbb" }}>Showing past thoughts</span>}
          </div>

          {/* Searchable content via cmdk */}
          <Command>
            <Command.Input ref={cmdkInputRef} value={isTagMode ? "" : query} onValueChange={setQuery} style={{ display: "none" }} />
            <Command.List style={{ maxHeight: 400, overflowY: "auto" }}>
              <Command.Empty style={{ padding: "12px 16px", color: "#999", fontSize: 13 }}>No matching tiles or thoughts</Command.Empty>

              {/* Actions — always visible */}
              <Command.Group forceMount heading="Actions">
                <Command.Item value="__action__send_ai" onSelect={handleAI} style={{ color: "#7c3aed" }}>
                  <span>✦</span>{aiLabel}
                </Command.Item>
                <Command.Item value="__action__new_tile" onSelect={() => handleNewTile(query.trim() || undefined)}>
                  <span>＋</span>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>{query.trim() && !isAIMode && !isTagMode ? `New tile "${query.trim()}"` : "New Tile"}</span>
                </Command.Item>
              </Command.Group>

              {visibleTiles.length > 0 && (
                <Command.Group heading="Tiles">
                  {visibleTiles.map((tile) => (
                    <Command.Item key={tile.id} value={tile.title} onSelect={() => handleTileSelect(tile)}>
                      {tile.title}
                    </Command.Item>
                  ))}
                </Command.Group>
              )}

              {(isTagMode ? tagFilteredThoughts : visibleThoughts).length > 0 && (
                <Command.Group heading={isTagMode ? `Thoughts tagged #${tagSearch || "…"}` : "Thoughts"}>
                  {(isTagMode ? tagFilteredThoughts : visibleThoughts).map((t) => {
                    const tile = visibleTiles.find((ti) => ti.id === t.tile_id)
                    return (
                      <Command.Item key={t.id} value={t.content} onSelect={() => handleThoughtSelect(t, tile)}>
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
                    <Command.Item key={`past-tile-${tile.id}`} value={tile.title} onSelect={() => onClose()}>
                      <span style={{ color: "#ccc" }}>↩</span> {tile.title}
                    </Command.Item>
                  ))}
                </Command.Group>
              )}

              {showPast && pastThoughts.length > 0 && (
                <Command.Group heading="Past Thoughts">
                  {pastThoughts.map((t) => (
                    <Command.Item key={`past-thought-${t.id}`} value={t.content} onSelect={() => onClose()}>
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
