import { useEffect, useState } from "react"
import { useStore } from "../store"
import { SavingSpinner } from "./SavingSpinner"

const CONFIG = {
  idle:       { color: "#d1d5db", label: "",                              spinner: false },
  processing: { color: "#22c55e", label: "Processing...",                 spinner: true  },
  queued:     { color: "#eab308", label: "In Queue...",                   spinner: false },
  limited:    { color: "#ef4444", label: "High demand, expect long wait times", spinner: false },
}

export function AiStatusPill() {
  const { aiStatus } = useStore()
  const [expanded, setExpanded] = useState(false)
  const [displayStatus, setDisplayStatus] = useState(aiStatus)

  useEffect(() => {
    let t: ReturnType<typeof setTimeout>
    if (aiStatus === "idle") {
      t = setTimeout(() => { setExpanded(false); setDisplayStatus("idle") }, 600)
    } else {
      setExpanded(false)
      t = setTimeout(() => { setDisplayStatus(aiStatus); setExpanded(true) }, 250)
    }
    return () => clearTimeout(t)
  }, [aiStatus])

  const { color, label, spinner } = CONFIG[displayStatus]

  return (
    <div style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", height: 18, width: expanded ? "auto" : 12, minWidth: 12 }}>
      <div style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        height: 18, minWidth: 18,
        borderRadius: 99,
        background: expanded ? color + "22" : color,
        outline: expanded ? `1px solid ${color}55` : "none",
        overflow: "hidden",
        transformOrigin: "left center",
        transform: expanded ? "scale(1)" : "scale(0.44)",
        transition: "transform 0.22s cubic-bezier(0.4,0,0.2,1), background 0.18s ease, outline 0.18s ease",
        animation: aiStatus === "processing" && !expanded ? "aiPulse 1.2s ease-in-out infinite" : undefined,
      }}>
        <span style={{
          fontSize: 10, fontWeight: 500, whiteSpace: "nowrap",
          padding: "0 6px", lineHeight: 1, color,
          opacity: expanded ? 1 : 0,
          transition: "opacity 0.12s ease",
          pointerEvents: "none",
          display: "inline-flex", alignItems: "center", gap: 4,
        }}>
          {spinner && <SavingSpinner />}
          {label}
        </span>
      </div>
      <style>{`@keyframes aiPulse { 0%,100% { opacity:1 } 50% { opacity:0.4 } }`}</style>
    </div>
  )
}
