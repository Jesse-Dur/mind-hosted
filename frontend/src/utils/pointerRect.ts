export type PointerRect = Pick<DOMRect, "left" | "right" | "top" | "bottom">

export function pointInsideRect(clientX: number, clientY: number, rect: PointerRect) {
  return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom
}
