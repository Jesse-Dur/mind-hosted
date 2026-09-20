import { SignInButton } from "@clerk/clerk-react"

export function ReauthenticationOverlay({ hasLocalData }: { hasLocalData: boolean }) {
  return (
    <div
      role="presentation"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 800,
        background: "rgba(235, 235, 238, 0.62)",
        backdropFilter: "grayscale(0.3)",
        WebkitBackdropFilter: "grayscale(0.3)",
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="reauthentication-title"
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          padding: "18px max(18px, env(safe-area-inset-right)) max(18px, calc(env(safe-area-inset-bottom) + 14px)) max(18px, env(safe-area-inset-left))",
          background: "rgba(255, 255, 255, 0.98)",
          borderTop: "1px solid rgba(0, 0, 0, 0.1)",
          boxShadow: "0 -12px 36px rgba(0, 0, 0, 0.12)",
        }}
      >
        <div style={{ width: "min(920px, 100%)", margin: "0 auto", display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", alignItems: "center", gap: 18 }}>
          <div>
            <h2 id="reauthentication-title" style={{ margin: 0, color: "#242424", fontSize: "clamp(17px, 2.5vw, 21px)", lineHeight: 1.25 }}>
              Sign in again to continue
            </h2>
            {hasLocalData && <p style={{ margin: "5px 0 0", color: "#707070", fontSize: 12.5, lineHeight: 1.45 }}>
              Your local data is still safe on this device.
            </p>}
          </div>
          <SignInButton mode="modal">
            <button
              type="button"
              style={{ minWidth: 94, minHeight: 44, padding: "10px 20px", border: 0, borderRadius: 10, background: "#1a1a1a", color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer", boxShadow: "0 3px 12px rgba(0, 0, 0, 0.16)" }}
            >
              Sign in
            </button>
          </SignInButton>
        </div>
      </section>
    </div>
  )
}
