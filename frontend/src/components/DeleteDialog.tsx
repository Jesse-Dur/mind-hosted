import { createPortal } from "react-dom"

export function DeleteDialog({ title, message, deleteLabel, onClose, onDelete }: { title: string; message: string; deleteLabel: string; onClose: () => void; onDelete: () => void }) {
  return createPortal(
    <div role="dialog" aria-modal="true" aria-labelledby="delete-dialog-title" style={backdropStyle} onPointerDown={(event) => { event.stopPropagation(); if (event.target === event.currentTarget) onClose() }} onContextMenu={(event) => { event.preventDefault(); event.stopPropagation() }}>
      <div style={dialogStyle}>
        <h2 id="delete-dialog-title" style={{ fontSize: 17, margin: 0 }}>{title}</h2>
        <p style={{ fontSize: 13, lineHeight: 1.45, color: "#666", margin: 0 }}>{message}</p>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button onClick={onClose} style={secondaryButton}>Cancel</button>
          <button onClick={onDelete} style={dangerButton}>{deleteLabel}</button>
        </div>
      </div>
    </div>,
    document.body
  )
}

const backdropStyle: React.CSSProperties = { position: "fixed", inset: 0, zIndex: 240, display: "grid", placeItems: "center", background: "rgba(0,0,0,.38)", padding: 18 }
const dialogStyle: React.CSSProperties = { width: "min(410px,100%)", borderRadius: 14, background: "#fff", boxShadow: "0 20px 60px rgba(0,0,0,.2)", padding: 18, display: "flex", flexDirection: "column", gap: 14 }
const secondaryButton: React.CSSProperties = { border: "1px solid #ddd", borderRadius: 8, background: "#fff", color: "#444", padding: "8px 12px", fontWeight: 600 }
const dangerButton: React.CSSProperties = { border: 0, borderRadius: 8, background: "#dc2626", color: "#fff", padding: "8px 12px", fontWeight: 650 }
