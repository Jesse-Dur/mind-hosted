import { useEffect, useState } from "react"
import { useStore } from "../store"

const CONFIG = {
  idle:       { color: "rgba(34,197,94,0.5)",  label: "",                              spinner: false },
  processing: { color: "rgba(34,197,94,0.9)",  label: "Processing...",                 spinner: true  },
  queued:     { color: "rgba(234,179,8,0.9)",  label: "In Queue...",                   spinner: false },
  limited:    { color: "rgba(239,68,68,0.9)",  label: "High demand, expect long wait", spinner: false },
}

export function AiStatusPill() {
  const { aiStatus, loadAiStatus } = useStore()
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    const poll = setInterval(loadAiStatus, 3000)
    return () => clearInterval(poll)
  }, [loadAiStatus])

  useEffect(() => {
    if (aiStatus !== "idle") {
      setExpanded(true)
    } else {
      const t = setTimeout(() => setExpanded(false), 1500)
      return () => clearTimeout(t)
    }
  }, [aiStatus])

  const { color, label, spinner } = CONFIG[aiStatus]

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 6,
      height: 20,
      background: expanded ? color : "transparent",
      borderRadius: 99,
      padding: expanded ? "0 8px" : 0,
      transition: "background 0.4s ease, padding 0.3s ease, width 0.3s ease",
      overflow: "hidden",
      whiteSpace: "nowrap",
    }}>
      <div style={{
        width: 8, height: 8, borderRadius: "50%",
        background: color,
        flexShrink: 0,
        transition: "background 0.4s ease",
        animation: aiStatus === "processing" ? "aiPulse 1.2s ease-in-out infinite" : undefined,
      }} />
      {expanded && label && (
        <span style={{ fontSize: 11, color: "#fff", fontWeight: 500 }}>
          {spinner && (
            <span style={{ display: "inline-block", marginRight: 5, animation: "aiSpin 0.8s linear infinite" }}>⟳</span>
          )}
          {label}
        </span>
      )}
      <style>{`
        @keyframes aiPulse { 0%,100% { opacity:1 } 50% { opacity:0.4 } }
        @keyframes aiSpin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }
      `}</style>
    </div>
  )
}
