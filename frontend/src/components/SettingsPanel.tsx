import { useStore } from "../store"

const OPTIONS = [
  { value: 1080, label: "Less room, bigger tiles", sub: "1080p" },
  { value: 1440, label: "Balanced room and tile size", sub: "1440p" },
  { value: 2160, label: "Most room, smallest tiles", sub: "4K" },
]

const GRID = 24
function snap(n: number) { return Math.round(n / GRID) * GRID }

export function SettingsPanel() {
  const { canvasHeight, setCanvasHeight, tabsVisible, setTabsVisible, tiles, updateTile } = useStore()
  const idx = OPTIONS.findIndex(o => o.value === canvasHeight) ?? 1
  const CANVAS_W = Math.round(canvasHeight * (16 / 9))

  const outOfBounds = tiles.filter(t => t.x + t.width > CANVAS_W || t.y + t.height > canvasHeight)

  function fixAll() {
    outOfBounds.forEach(t => {
      const x = Math.min(t.x, snap(CANVAS_W - t.width))
      const y = Math.min(t.y, snap(canvasHeight - t.height))
      const width = Math.min(t.width, CANVAS_W)
      const height = Math.min(t.height, canvasHeight)
      updateTile(t.id, { x: Math.max(0, x), y: Math.max(0, y), width, height })
    })
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <p style={{ fontSize: 11, color: "#ccc", textAlign: "right", marginBottom: -8 }}>v{__APP_VERSION__}</p>

      <div>
        <p style={{ fontSize: 11, fontWeight: 700, color: "#aaa", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 12 }}>Tab Bar</p>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: 13, color: "#333" }}>Show tab bar</span>
          <button
            onClick={() => setTabsVisible(!tabsVisible)}
            style={{ width: 36, height: 20, borderRadius: 99, border: "none", cursor: "pointer", background: tabsVisible ? "#1a1a1a" : "#ddd", transition: "background 0.2s", position: "relative" }}
          >
            <span style={{ position: "absolute", top: 2, left: tabsVisible ? 18 : 2, width: 16, height: 16, borderRadius: "50%", background: "#fff", transition: "left 0.2s" }} />
          </button>
        </div>
      </div>

      <div>
        <p style={{ fontSize: 11, fontWeight: 700, color: "#aaa", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 16 }}>Canvas Size</p>

        <input
          type="range"
          min={0}
          max={2}
          step={1}
          value={idx}
          onChange={(e) => setCanvasHeight(OPTIONS[Number(e.target.value)].value)}
          style={{ width: "100%", accentColor: "#1a1a1a", cursor: "pointer" }}
        />

        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}>
          {OPTIONS.map((o, i) => (
            <span key={o.value} style={{ fontSize: 10, color: i === idx ? "#1a1a1a" : "#bbb", fontWeight: i === idx ? 600 : 400, transition: "color 0.15s ease" }}>
              {o.sub}
            </span>
          ))}
        </div>

        <div style={{ marginTop: 12, padding: "10px 12px", background: "#f8f8f8", borderRadius: 8 }}>
          <p style={{ fontSize: 13, color: "#333", fontWeight: 500 }}>{OPTIONS[idx].label}</p>
        </div>

        {outOfBounds.length > 0 && (
          <div style={{ marginTop: 12, padding: "10px 12px", background: "#fff7ed", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <p style={{ fontSize: 12, color: "#c2410c" }}>
              ⚠ {outOfBounds.length} tile{outOfBounds.length > 1 ? "s are" : " is"} outside the canvas
            </p>
            <button
              onClick={fixAll}
              style={{ fontSize: 11, fontWeight: 600, color: "#fff", background: "#c2410c", border: "none", borderRadius: 5, padding: "4px 10px", cursor: "pointer", flexShrink: 0 }}
            >Fix all</button>
          </div>
        )}
      </div>
    </div>
  )
}
