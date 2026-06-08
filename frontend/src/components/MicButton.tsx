import { Tooltip } from "./Tooltip"

type MicState = "idle" | "loading" | "recording" | "transcribing"

interface Props {
  micState: MicState
  onMicClick: () => void
}

const SIZE = 28
const RADIUS = 13
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

export function MicButton({ micState, onMicClick }: Props) {
  const isActive = micState !== "idle"
  const tooltipLabel = micState === "recording" ? "Stop recording" : "Voice input"

  return (
    <Tooltip label={tooltipLabel} placement="top">
      <div style={{ position: "relative", width: SIZE, height: SIZE, flexShrink: 0, marginRight: 10 }}>
        <style>{`
          @keyframes micFill { from { stroke-dashoffset: ${CIRCUMFERENCE} } to { stroke-dashoffset: 0 } }
          @keyframes micPulse { 0%,100% { opacity:1 } 50% { opacity:0.5 } }
          @keyframes spin { to { transform: rotate(360deg) } }
        `}</style>

        <button
          onClick={(e) => { e.stopPropagation(); onMicClick() }}
          disabled={micState === "transcribing" || micState === "loading"}
          aria-label={tooltipLabel}
          style={{
            position: "absolute", inset: 0,
            width: SIZE, height: SIZE, borderRadius: "50%",
            border: "none",
            cursor: isActive ? (micState === "recording" ? "pointer" : "default") : "pointer",
            background: micState === "recording" ? "#ef4444" : "transparent",
            display: "flex", alignItems: "center", justifyContent: "center",
            transition: "background 0.2s ease",
            animation: micState === "recording" ? "micPulse 1s ease-in-out infinite" : undefined,
          }}
          onMouseEnter={(e) => { if (micState === "idle") e.currentTarget.style.background = "#f0f0f0" }}
          onMouseLeave={(e) => { if (micState === "idle") e.currentTarget.style.background = "transparent" }}
        >
          {micState === "transcribing"
            ? <svg width="12" height="12" viewBox="0 0 12 12"><circle cx="6" cy="6" r="4.5" fill="none" stroke="#ddd" strokeWidth="1.5"/><path d="M6 1.5A4.5 4.5 0 0 1 10.5 6" fill="none" stroke="#aaa" strokeWidth="1.5" strokeLinecap="round" style={{ animation: "spin 0.7s linear infinite" }}/></svg>
            : micState === "recording"
            ? <svg width="10" height="10" viewBox="0 0 10 10"><rect width="10" height="10" rx="2" fill="#fff"/></svg>
            : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style={{ display: "block", margin: "auto", position: "relative", top: 0 }}><rect x="9" y="2" width="6" height="12" rx="3" stroke={micState === "loading" ? "#1a1a1a" : "#bbb"} strokeWidth="1.8"/><path d="M5 10a7 7 0 0 0 14 0" stroke={micState === "loading" ? "#1a1a1a" : "#bbb"} strokeWidth="1.8" strokeLinecap="round"/><line x1="12" y1="17" x2="12" y2="21" stroke={micState === "loading" ? "#1a1a1a" : "#bbb"} strokeWidth="1.8" strokeLinecap="round"/></svg>
          }
        </button>

        {/* Loading ring — traces border during stream init, rendered on top */}
        {micState === "loading" && (
          <svg width={SIZE + 2} height={SIZE + 1} viewBox="0 0 30 29" style={{ position: "absolute", top: -1, left: -1, transform: "rotate(-90deg)", pointerEvents: "none" }}>
            <circle
              cx="15" cy="15" r={RADIUS}
              fill="none" stroke="#555" strokeWidth="2"
              strokeDasharray={CIRCUMFERENCE}
              strokeLinecap="round"
              style={{ animation: `micFill 0.8s ease forwards` }}
            />
          </svg>
        )}
      </div>
    </Tooltip>
  )
}
