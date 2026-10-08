const DISMISS_DISTANCE = 48

export function shouldDismissMobileToast(deltaX: number, deltaY: number) {
  return Math.hypot(deltaX, deltaY) >= DISMISS_DISTANCE
}
