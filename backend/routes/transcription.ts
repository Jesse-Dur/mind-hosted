import { Hono } from "hono"
import { getAuth } from "@clerk/hono"
import { autumnAccessDeniedResponse, isAutumnAccessDeniedError } from "../billing/errors"
import { consumeAutumnFeature } from "../billing/entitlements"
import { autumnFeatures } from "../billing/features"
import { audioFormat, MAX_AUDIO_BYTES, transcribeAudio } from "../ai/transcribe"
import { OpenRouterError } from "../ai/openrouter"

export const transcriptionRoute = new Hono()

transcriptionRoute.post("/transcribe", async (c) => {
  const auth = getAuth(c)
  if (!auth?.userId) return c.json({ error: "Unauthorized" }, 401)

  const formData = await c.req.formData()
  const audio = formData.get("audio")
  if (!(audio instanceof File) || !audio.size) return c.json({ error: "No audio file" }, 400)
  if (audio.size > MAX_AUDIO_BYTES) return c.json({ error: "Audio file exceeds 25 MB" }, 413)
  const format = audioFormat(audio.type)
  if (!format) return c.json({ error: "Unsupported audio format" }, 400)

  const transcriptionSeconds = Math.max(1, Math.ceil(audio.size / 32000))
  try {
    // Keep the existing size-based billing estimate for browser recordings.
    await consumeAutumnFeature(auth.userId, autumnFeatures.transcriptionSeconds, transcriptionSeconds)
  } catch (error) {
    if (isAutumnAccessDeniedError(error)) return c.json(autumnAccessDeniedResponse(error), 429)
    throw error
  }

  try {
    return c.json({ text: await transcribeAudio(audio, format) })
  } catch (error) {
    const status = error instanceof OpenRouterError ? error.status : null
    console.error(`[transcription] failed status=${status ?? "internal"}`)
    if (status === 429) return c.json({ error: "Rate limited, please try again shortly" }, 429)
    return c.json({ error: "Transcription failed" }, 502)
  }
})
