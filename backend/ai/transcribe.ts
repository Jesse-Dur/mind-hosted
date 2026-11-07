import { openRouterModel, openRouterRequest, OpenRouterError } from "./openrouter"

export const MAX_AUDIO_BYTES = 25 * 1024 * 1024

export function audioFormat(mimeType: string) {
  const formats: Record<string, string> = {
    "audio/webm": "webm", "video/webm": "webm",
    "audio/mp4": "m4a", "video/mp4": "m4a", "audio/x-m4a": "m4a",
    "audio/mpeg": "mp3", "audio/mp3": "mp3",
    "audio/ogg": "ogg", "application/ogg": "ogg",
    "audio/wav": "wav", "audio/x-wav": "wav",
    "audio/flac": "flac", "audio/x-flac": "flac", "audio/aac": "aac",
  }
  return formats[mimeType.split(";")[0]!.trim().toLowerCase()] ?? null
}

export async function transcribeAudio(audio: File, format: string): Promise<string> {
  const data = await openRouterRequest("/audio/transcriptions", {
    model: openRouterModel("transcription"),
    input_audio: { data: Buffer.from(await audio.arrayBuffer()).toString("base64"), format },
  })
  if (!data || typeof data !== "object" || !("text" in data) || typeof data.text !== "string") {
    throw new OpenRouterError(502)
  }
  return data.text
}
