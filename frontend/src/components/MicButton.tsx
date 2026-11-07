import { Tooltip } from "./Tooltip"
import { useOnline } from "../utils/connectivity"
import { SavingSpinner } from "./SavingSpinner"

type MicState = "idle" | "loading" | "recording" | "transcribing"

interface Props {
  micState: MicState
  onMicClick: () => void
}

const SIZE = 28
const RADIUS = 13
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

export function MicButton({ micState, onMicClick }: Props) {
  const online = useOnline()
  const isActive = micState !== "idle"
  const offlineBlocked = !online && micState !== "recording"
  const micColor = !online ? "#c8c8c8" : micState === "loading" ? "#1a1a1a" : "#bbb"
  const tooltipLabel = micState === "recording" ? "Stop recording" : offlineBlocked ? "Voice input requires an internet connection" : "Voice input"

  return (
    <Tooltip label={tooltipLabel} placement="top">
      <div style={{ position: "relative", width: SIZE, height: SIZE, flexShrink: 0, marginRight: 10 }}>
        <style>{`
          @keyframes micFill { from { stroke-dashoffset: ${CIRCUMFERENCE} } to { stroke-dashoffset: 0 } }
          @keyframes micPulse { 0%,100% { opacity:1 } 50% { opacity:0.5 } }
        `}</style>

        <button
          onClick={(e) => { e.stopPropagation(); onMicClick() }}
          disabled={offlineBlocked || micState === "transcribing" || micState === "loading"}
          aria-label={tooltipLabel}
          aria-disabled={offlineBlocked || undefined}
          title={offlineBlocked ? "Connect to the internet to use voice input" : undefined}
          style={{
            position: "absolute", inset: 0,
            width: SIZE, height: SIZE, borderRadius: "50%",
            border: "none", padding: 0, boxSizing: "border-box",
            cursor: offlineBlocked ? "not-allowed" : isActive ? (micState === "recording" ? "pointer" : "default") : "pointer",
            background: micState === "recording" ? "#ef4444" : "transparent",
            display: "flex", alignItems: "center", justifyContent: "center",
            transition: "background 0.2s ease",
            animation: micState === "recording" ? "micPulse 1s ease-in-out infinite" : undefined,
            opacity: offlineBlocked ? 0.38 : 1,
          }}
          onMouseEnter={(e) => { if (micState === "idle") e.currentTarget.style.background = "#f0f0f0" }}
          onMouseLeave={(e) => { if (micState === "idle") e.currentTarget.style.background = "transparent" }}
        >
          {micState === "transcribing"
            ? <SavingSpinner />
            : micState === "recording"
            ? <svg width="10" height="10" viewBox="0 0 10 10"><rect width="10" height="10" rx="2" fill="#fff"/></svg>
            : <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} fill="none" style={{ display: "block", flexShrink: 0 }}>
                {micState === "loading" && <circle
                  cx={SIZE / 2} cy={SIZE / 2} r={RADIUS}
                  stroke="#555" strokeWidth="2"
                  strokeDasharray={CIRCUMFERENCE}
                  strokeLinecap="round"
                  transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
                  style={{ animation: "micFill 0.8s ease forwards" }}
                />}
                <svg x="7" y="7" width="14" height="14" viewBox="0 0 24 24">
                  <rect x="9" y="2" width="6" height="12" rx="3" stroke={micColor} strokeWidth="1.8"/>
                  <path d="M5 10a7 7 0 0 0 14 0" stroke={micColor} strokeWidth="1.8" strokeLinecap="round"/>
                  <line x1="12" y1="17" x2="12" y2="21" stroke={micColor} strokeWidth="1.8" strokeLinecap="round"/>
                </svg>
              </svg>
          }
        </button>
      </div>
    </Tooltip>
  )
}
