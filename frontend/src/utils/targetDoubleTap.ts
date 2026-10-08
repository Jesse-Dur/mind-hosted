export type TargetTap = {
  targetKey: string
  at: number
}

export function resolveTargetTap(previous: TargetTap | null, targetKey: string, at: number, maxIntervalMs = 500) {
  const elapsed = previous ? at - previous.at : Number.POSITIVE_INFINITY
  const isDoubleTap = previous?.targetKey === targetKey && elapsed >= 0 && elapsed <= maxIntervalMs
  return {
    isDoubleTap,
    next: isDoubleTap ? null : { targetKey, at },
  }
}
