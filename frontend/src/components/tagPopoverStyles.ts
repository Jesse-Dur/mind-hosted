import type { CSSProperties } from "react"
import { useMobileWorkspace } from "../layout/useWorkspaceLayout"
import { useStore } from "../store"
import { DEFAULT_CANVAS_FONT_SIZE } from "../utils/canvasFontSize"

export const tagPopoverSurface: CSSProperties = {
  border: "1px solid #e8e8e8",
  borderRadius: 8,
  background: "#fff",
  boxShadow: "0 4px 20px rgba(0,0,0,0.1)",
}

const tagPopoverHeading: CSSProperties = {
  margin: 0,
  fontWeight: 700,
  color: "#aaa",
  letterSpacing: "0.08em",
  textTransform: "uppercase",
}

export function tagRowStyle(color: string, active = true): CSSProperties {
  return {
    color: "#333",
    fontWeight: 400,
    lineHeight: "normal",
    background: active ? `${color}11` : "transparent",
  }
}

export function useTagPopoverStyles() {
  const mobile = useMobileWorkspace()
  const labelSize = useStore((state) => state.canvasFontSize)
  const scale = labelSize / DEFAULT_CANVAS_FONT_SIZE
  const labelPadding = Math.min(20, Math.max(8, Math.round(12 * scale)))
  const panelPadding = Math.min(10, Math.max(4, Math.round(6 * scale)))
  const headingSize = Math.max(8, Math.round(10 * scale))
  const removeSize = Math.max(mobile ? 44 : 20, Math.round(20 * scale))
  return {
    labelSize,
    itemHeight: Math.max(mobile ? 44 : 28, Math.ceil(labelSize * 1.2) + panelPadding * 2, removeSize),
    removeSize,
    iconSize: Math.max(mobile ? 12 : 6, Math.round((mobile ? 12 : 8) * scale)),
    labelPadding,
    labelGap: Math.min(12, Math.max(4, Math.round(8 * scale))),
    panelPadding,
    pillGap: Math.min(mobile ? 12 : 8, Math.max(3, Math.round((mobile ? 8 : 4) * scale))),
    listPadding: Math.min(12, Math.max(4, Math.round(7 * scale))),
    headingSize,
    headingStyle: { ...tagPopoverHeading, fontSize: headingSize, padding: `${Math.max(1, Math.round(2 * scale))}px ${labelPadding}px ${panelPadding}px` },
  }
}
