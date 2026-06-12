export const GLOBAL_REVISION_KEY = "globalRevision"
export const ACTIVE_REVISION_PREFIX = "canvasRevision:"

export function canvasRevisionKey(canvasId: number) {
  return `${ACTIVE_REVISION_PREFIX}${canvasId}`
}
