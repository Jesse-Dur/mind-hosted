import type { CSSProperties } from "react"
import { useMobileWorkspace } from "../layout/useWorkspaceLayout"

export const tagPopoverSurface: CSSProperties = {
  border: "1px solid #e8e8e8",
  borderRadius: 8,
  background: "#fff",
  boxShadow: "0 4px 20px rgba(0,0,0,0.1)",
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
  return {
    labelSize: 13,
    itemHeight: mobile ? 44 : 28,
    removeSize: mobile ? 44 : 20,
    iconSize: mobile ? 12 : 8,
    labelPadding: 12,
    labelGap: 8,
    panelPadding: 6,
  }
}
