import { Hono } from "hono"
import { getAuth } from "@clerk/hono"
import { autumnAccessDeniedResponse, isAutumnAccessDeniedError } from "../billing/errors"
import { consumeAutumnFeature } from "../billing/entitlements"
import { autumnFeatures } from "../billing/features"

export const whisperRoute = new Hono()

const MAX_RETRIES = 3

whisperRoute.post("/transcribe", async (c) => {
  const auth = getAuth(c)
  if (!auth?.userId) return c.json({ error: "Unauthorized" }, 401)

  const formData = await c.req.formData()
  const audio = formData.get("audio") as File | null
  if (!audio) return c.json({ error: "No audio file" }, 400)
  const transcriptionSeconds = Math.max(1, Math.ceil(audio.size / 32000))
  try {
    // WebM duration is not reliably available server-side here, so size gives a conservative billing estimate.
    await consumeAutumnFeature(auth.userId, autumnFeatures.transcriptionSeconds, transcriptionSeconds)
  } catch (error) {
    if (isAutumnAccessDeniedError(error)) return c.json(autumnAccessDeniedResponse(error), 429)
    throw error
  }

  const body = new FormData()
  body.append("file", audio, "audio.webm")
  body.append("model", "whisper-large-v3-turbo")
  body.append("response_format", "json")

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${process.env.GROQ_API_KEY}` },
      body,
    })

    if (res.status === 429) {
      const retryAfter = res.headers.get("retry-after")
      const resetTokens = res.headers.get("x-ratelimit-reset-requests") ?? res.headers.get("x-ratelimit-reset-tokens")
      const wait = retryAfter ? Number(retryAfter) * 1000 : 10000
      console.warn(`[whisper] rate limited (attempt ${attempt}/${MAX_RETRIES}) - waiting ${wait / 1000}s (reset: ${resetTokens})`)
      if (attempt === MAX_RETRIES) return c.json({ error: "Rate limited, please try again shortly" }, 429)
      await new Promise((r) => setTimeout(r, wait))
      continue
    }

    if (!res.ok) {
      console.error(`[whisper] error ${res.status}: ${res.statusText || "upstream request failed"}`)
      return c.json({ error: "Transcription failed" }, 500)
    }

    const data = await res.json() as { text: string }
    return c.json({ text: data.text })
  }

  return c.json({ error: "Transcription failed after retries" }, 500)
})
