import { useEffect, useMemo, useState } from "react"
import type { Canvas } from "../types"
import type { CanvasDeleteOptions } from "../store/types"

type CanvasDeleteDialogProps = {
  canvas: Canvas
  canvases: Canvas[]
  onCancel: () => void
  onConfirm: (options: CanvasDeleteOptions) => void
}

type DeleteMode = CanvasDeleteOptions["mode"]

export function CanvasDeleteDialog({ canvas, canvases, onCancel, onConfirm }: CanvasDeleteDialogProps) {
  const destinationCanvases = useMemo(() => canvases.filter((item) => item.id !== canvas.id), [canvas.id, canvases])
  const firstDestinationId = destinationCanvases[0]?.id ?? null
  const [mode, setMode] = useState<DeleteMode>(firstDestinationId === null ? "deleteContents" : "moveContents")
  const [targetCanvasId, setTargetCanvasId] = useState<number | null>(firstDestinationId)
  const canMove = destinationCanvases.length > 0
  const moveSelectorOpen = mode === "moveContents" && canMove

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel()
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [onCancel])

  function confirm() {
    if (mode === "deleteContents") {
      onConfirm({ mode: "deleteContents" })
      return
    }
    if (targetCanvasId !== null) onConfirm({ mode: "moveContents", targetCanvasId })
  }

  const confirmDisabled = mode === "moveContents" && targetCanvasId === null

  return (
    <div
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel()
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 500,
        minHeight: "100dvh",
        background: "rgba(24, 24, 27, 0.34)",
        backdropFilter: "blur(7px)",
        display: "grid",
        placeItems: "center",
        padding: 24,
        boxSizing: "border-box",
        overflowY: "auto",
        animation: "dialogBackdropIn 0.16s ease forwards",
      }}
    >
      <style>{`
        @keyframes dialogBackdropIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes dialogCardIn {
          from { opacity: 0; transform: translateY(8px) scale(0.98); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="canvas-delete-title"
        style={{
          width: "min(460px, calc(100vw - 32px))",
          maxHeight: "calc(100dvh - 48px)",
          borderRadius: 8,
          background: "#fbfbfd",
          border: "1px solid #ddd6fe",
          boxShadow: "0 18px 42px rgba(24, 24, 27, 0.16)",
          color: "#1a1a1a",
          overflow: "auto",
          animation: "dialogCardIn 0.2s cubic-bezier(0.16, 1, 0.3, 1) forwards",
        }}
      >
        <div style={{ padding: "18px 20px 14px", background: "#ede9fe", borderBottom: "1px solid #ddd6fe" }}>
          <h2 id="canvas-delete-title" style={{ margin: 0, fontSize: 17, lineHeight: 1.25, fontWeight: 700, letterSpacing: 0 }}>
            Delete "{canvas.name}"?
          </h2>
          <p style={{ margin: "8px 0 0", color: "#555", fontSize: 13, lineHeight: 1.45 }}>
            Choose what should happen to this canvas's tiles and thoughts.
          </p>
        </div>

        <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 10, background: "#fbfbfd" }}>
          <label
            style={{
              display: "grid",
              gridTemplateColumns: "18px 1fr",
              gap: 10,
              padding: 12,
              borderRadius: 8,
              border: `1px solid ${mode === "deleteContents" ? "#fca5a5" : "#e5e5e5"}`,
              background: mode === "deleteContents" ? "#fff1f2" : "#ffffff",
              boxShadow: mode === "deleteContents" ? "0 0 0 3px rgba(239, 68, 68, 0.08)" : "none",
              cursor: "pointer",
              transition: "border 0.16s ease, background 0.16s ease, box-shadow 0.16s ease",
            }}
          >
            <input
              type="radio"
              name="canvas-delete-mode"
              checked={mode === "deleteContents"}
              onChange={() => setMode("deleteContents")}
              style={{ margin: "2px 0 0", accentColor: "#ef4444" }}
            />
            <span>
              <span style={{ display: "block", fontSize: 13, fontWeight: 700, color: "#991b1b", letterSpacing: 0 }}>
                Delete all tiles and thoughts
              </span>
              <span style={{ display: "block", marginTop: 4, fontSize: 12, lineHeight: 1.4, color: "#7f1d1d" }}>
                This permanently removes everything in this canvas.
              </span>
            </span>
          </label>

          <label
            style={{
              display: "grid",
              gridTemplateColumns: "18px 1fr",
              gap: 10,
              padding: 12,
              borderRadius: 8,
              border: `1px solid ${mode === "moveContents" ? "#c4b5fd" : "#e5e5e5"}`,
              background: mode === "moveContents" ? "#f5f3ff" : "#ffffff",
              boxShadow: "none",
              opacity: canMove ? 1 : 0.56,
              cursor: canMove ? "pointer" : "default",
              transition: "border 0.16s ease, background 0.16s ease, box-shadow 0.16s ease",
            }}
          >
            <input
              type="radio"
              name="canvas-delete-mode"
              checked={mode === "moveContents"}
              disabled={!canMove}
              onChange={() => {
                setMode("moveContents")
                setTargetCanvasId((current) => current ?? firstDestinationId)
              }}
              style={{ margin: "2px 0 0", accentColor: "#7c3aed" }}
            />
            <span>
              <span style={{ display: "block", fontSize: 13, fontWeight: 700, color: "#4c1d95", letterSpacing: 0 }}>
                Move tiles and thoughts to another canvas
              </span>
              <span style={{ display: "block", marginTop: 4, fontSize: 12, lineHeight: 1.4, color: "#555" }}>
                Keep the contents and choose their new canvas.
              </span>
            </span>
          </label>

          <div
            aria-hidden={!moveSelectorOpen}
            style={{
              display: "grid",
              gridTemplateRows: moveSelectorOpen ? "1fr" : "0fr",
              opacity: moveSelectorOpen ? 1 : 0,
              transform: moveSelectorOpen ? "translateY(0)" : "translateY(-4px)",
              transition: "grid-template-rows 0.22s cubic-bezier(0.4,0,0.2,1), opacity 0.18s ease, transform 0.22s cubic-bezier(0.4,0,0.2,1)",
              overflow: "hidden",
            }}
          >
            <div style={{ minHeight: 0, overflow: "hidden" }}>
              <label style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 2 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: "#333", letterSpacing: 0 }}>Destination canvas</span>
                <select
                  value={targetCanvasId ?? ""}
                  disabled={!moveSelectorOpen}
                  onChange={(event) => setTargetCanvasId(Number(event.target.value))}
                  style={{
                    height: 36,
                    borderRadius: 8,
                    border: "1px solid #ddd6fe",
                    background: "#ffffff",
                    color: "#1a1a1a",
                    fontSize: 13,
                    padding: "0 34px 0 10px",
                    outline: "none",
                    boxShadow: "0 1px 2px rgba(88, 28, 135, 0.08)",
                  }}
                >
                  {destinationCanvases.map((destination) => (
                    <option key={destination.id} value={destination.id}>{destination.name}</option>
                  ))}
                </select>
              </label>
            </div>
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, padding: "14px 20px 18px", background: "#ffffff", borderTop: "1px solid #eee" }}>
          <button
            type="button"
            onClick={onCancel}
            style={{
              height: 34,
              padding: "0 12px",
              borderRadius: 7,
              border: "1px solid #d4d4d8",
              background: "#ffffff",
              color: "#333",
              fontSize: 13,
              fontWeight: 700,
              cursor: "pointer",
              transition: "background 0.15s ease, border 0.15s ease",
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={confirmDisabled}
            onClick={confirm}
            style={{
              height: 34,
              padding: "0 12px",
              borderRadius: 7,
              border: "none",
              background: mode === "deleteContents" ? "#dc2626" : "#1a1a1a",
              color: "#ffffff",
              fontSize: 13,
              fontWeight: 700,
              opacity: confirmDisabled ? 0.58 : 1,
              cursor: confirmDisabled ? "default" : "pointer",
              boxShadow: confirmDisabled ? "none" : "0 8px 18px rgba(24, 24, 27, 0.18)",
              transition: "opacity 0.15s ease, transform 0.15s ease, box-shadow 0.15s ease",
            }}
          >
            {mode === "deleteContents" ? "Delete permanently" : "Move and delete"}
          </button>
        </div>
      </div>
    </div>
  )
}
