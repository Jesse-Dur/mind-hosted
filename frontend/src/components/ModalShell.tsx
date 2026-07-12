import type { ReactNode } from "react"

type ModalShellProps = {
  titleId: string
  title: string
  subtitle?: string
  width?: string
  zIndex?: number
  onClose: () => void
  closeOnBackdrop?: boolean
  children: ReactNode
  footer?: ReactNode
}

export function ModalShell({ titleId, title, subtitle, width = "min(540px, calc(100vw - 32px))", zIndex = 700, onClose, closeOnBackdrop = true, children, footer }: ModalShellProps) {
  return (
    <div
      role="presentation"
      onMouseDown={(event) => {
        if (closeOnBackdrop && event.target === event.currentTarget) onClose()
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex,
        minHeight: "100dvh",
        background: "rgba(24, 24, 27, 0.34)",
        display: "grid",
        placeItems: "center",
        padding: 24,
        boxSizing: "border-box",
        overflowY: "auto",
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        style={{
          width,
          maxHeight: "calc(100dvh - 48px)",
          borderRadius: 8,
          background: "#fbfbfd",
          border: "1px solid #ddd6fe",
          boxShadow: "0 18px 42px rgba(24, 24, 27, 0.16)",
          color: "#1a1a1a",
          overflow: "auto",
        }}
      >
        <div style={{ padding: "18px 20px 14px", background: "#ede9fe", borderBottom: "1px solid #ddd6fe" }}>
          <h2 id={titleId} style={{ margin: 0, fontSize: 17, lineHeight: 1.25, fontWeight: 700, letterSpacing: 0 }}>
            {title}
          </h2>
          {subtitle && (
            <p style={{ margin: "8px 0 0", color: "#555", fontSize: 13, lineHeight: 1.45 }}>
              {subtitle}
            </p>
          )}
        </div>

        <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 14, background: "#fbfbfd" }}>
          {children}
        </div>

        {footer && (
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, padding: "14px 20px 18px", background: "#ffffff", borderTop: "1px solid #eee" }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}
