const BASE_URL = "https://openrouter.ai/api/v1"
const MAX_ATTEMPTS = 3
const MAX_RETRY_DELAY_MS = 10000

export class OpenRouterError extends Error {
  constructor(readonly status: number) {
    // Upstream messages can contain user content. Never include them or a raw cause.
    super(`OpenRouter request failed (${status})`)
  }
}

export function openRouterModel(kind: "ai" | "transcription") {
  return kind === "ai"
    ? process.env.OPENROUTER_AI_MODEL?.trim() || "z-ai/glm-5.3-flash"
    : process.env.OPENROUTER_TRANSCRIPTION_MODEL?.trim() || "elevenlabs/scribe-v2"
}

export function retryDelayMs(retryAfter: string | null, attempt: number, now = Date.now()) {
  if (retryAfter !== null && retryAfter.trim()) {
    const seconds = Number(retryAfter)
    const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retryAfter) - now
    if (Number.isFinite(delay)) return Math.max(0, delay)
  }
  return 1000 * 2 ** attempt
}

type RequestOptions = { onRetry?: (status: number, delayMs: number) => void }

export async function openRouterRequest(
  path: "/chat/completions" | "/audio/transcriptions",
  body: Record<string, unknown>,
  options: RequestOptions = {},
): Promise<unknown> {
  const key = process.env.OPENROUTER_API_KEY?.trim()
  if (!key) throw new OpenRouterError(503)
  const payload = JSON.stringify({
    ...body,
    provider: {
      ...(body.provider as Record<string, unknown> | undefined),
      // Strict Safety Retention exclusions must also be set on the workspace/key.
      zdr: true,
      data_collection: "deny",
    },
  })

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const signal = AbortSignal.timeout(path === "/audio/transcriptions" ? 300000 : 60000)
    let response: Response
    try {
      response = await fetch(`${BASE_URL}${path}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: payload,
        signal,
      })
    } catch {
      // An uncertain network outcome is not automatically replayed.
      throw new OpenRouterError(signal.aborted ? 504 : 503)
    }

    if (response.ok) {
      let data: unknown
      try { data = await response.json() } catch { throw new OpenRouterError(502) }
      if (!data || typeof data !== "object" || "error" in data) throw new OpenRouterError(502)
      return data
    }

    const status = response.status
    const delay = retryDelayMs(response.headers.get("retry-after"), attempt)
    await response.body?.cancel().catch(() => {})
    if (![429, 500, 502, 503, 504].includes(status)
      || attempt === MAX_ATTEMPTS - 1 || delay > MAX_RETRY_DELAY_MS) {
      throw new OpenRouterError(status)
    }
    options.onRetry?.(status, delay)
    await new Promise((resolve) => setTimeout(resolve, delay))
  }
  throw new OpenRouterError(503)
}
