export type AutumnFeature = "ai_processing_requests" | "transcription_seconds" | "storage" | "canvases" | "tiles" | "thoughts"
export type ResourceFeature = "canvases" | "tiles" | "thoughts"

export const autumnFeatures = {
  aiProcessingRequests: "ai_processing_requests",
  transcriptionSeconds: "transcription_seconds",
  storage: "storage",
  canvases: "canvases",
  tiles: "tiles",
  thoughts: "thoughts",
} as const satisfies Record<string, AutumnFeature>
