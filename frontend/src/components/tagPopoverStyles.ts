import type { CSSProperties } from "react"
import { useMobileWorkspace } from "../layout/useWorkspaceLayout"
import { useStore } from "../store"
import { DEFAULT_CANVAS_FONT_SIZE } from "../utils/canvasFontSize"

export const tagPopoverSurface: CSSProperties = {
  border: "1px solid #e3e3e3",
  borderRadius: 9,
  background: "rgba(255,255,255,0.98)",
  boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
  backdropFilter: "blur(10px)",
}

export function tagPillStyle(color: string): CSSProperties {
  return {
    borderRadius: 99,
    color,
    background: `${color}22`,
    outline: `1px solid ${color}55`,
  }
}

export function useTagPopoverStyles() {
  const mobile = useMobileWorkspace()
  const fontSize = useStore((state) => state.canvasFontSize)
  const labelSize = Math.max(mobile ? 14 : 8, Math.round((mobile ? 14 : 10) * fontSize / DEFAULT_CANVAS_FONT_SIZE))
  const itemHeight = mobile ? Math.max(44, labelSize + 16) : Math.max(22, labelSize + 12)
  const removeSize = mobile ? itemHeight : itemHeight - 2
  return {
    mobile,
    labelSize,
    itemHeight,
    removeSize,
    iconSize: mobile ? 12 : Math.max(6, Math.round(labelSize * 0.6)),
    labelPadding: mobile ? 12 : 7,
    labelGap: mobile ? 8 : 4,
    panelPadding: mobile ? 10 : 8,
  }
}
