export function recordingBlob(chunks: Blob[], mimeType: string) {
  const type = mimeType || chunks.find((chunk) => chunk.type)?.type || "application/octet-stream"
  return new Blob(chunks, { type })
}

export function recordingFilename(mimeType: string) {
  const type = mimeType.split(";")[0]?.trim().toLowerCase()
  if (type === "audio/mp4" || type === "video/mp4" || type === "audio/x-m4a") return "audio.m4a"
  if (type === "audio/ogg") return "audio.ogg"
  if (type === "audio/webm" || type === "video/webm") return "audio.webm"
  return "audio"
}
