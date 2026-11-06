import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"
import { openRouterModel, openRouterRequest, OpenRouterError, retryDelayMs } from "../ai/openrouter"
import { audioFormat, transcribeAudio } from "../ai/transcribe"

const originalKey = process.env.OPENROUTER_API_KEY
const originalAiModel = process.env.OPENROUTER_AI_MODEL
const originalTranscriptionModel = process.env.OPENROUTER_TRANSCRIPTION_MODEL
let fetchMock: ReturnType<typeof spyOn<typeof globalThis, "fetch">>

beforeEach(() => {
  process.env.OPENROUTER_API_KEY = "test-key"
  delete process.env.OPENROUTER_AI_MODEL
  delete process.env.OPENROUTER_TRANSCRIPTION_MODEL
  fetchMock = spyOn(globalThis, "fetch")
})

afterEach(() => {
  fetchMock.mockRestore()
  for (const [name, value] of Object.entries({
    OPENROUTER_API_KEY: originalKey,
    OPENROUTER_AI_MODEL: originalAiModel,
    OPENROUTER_TRANSCRIPTION_MODEL: originalTranscriptionModel,
  })) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
})

describe("OpenRouter requests", () => {
  test("preserves tool preferences while enforcing privacy on every retry", async () => {
    fetchMock.mockResolvedValueOnce(new Response("private provider detail", { status: 429, headers: { "Retry-After": "0" } }))
      .mockResolvedValueOnce(Response.json({ choices: [] }))
    const onRetry = spyOn({ retry: () => {} }, "retry")
    await openRouterRequest("/chat/completions", {
      model: openRouterModel("ai"), messages: [], tools: [{ type: "function" }],
      provider: { require_parameters: true, zdr: false, data_collection: "allow" },
    }, { onRetry })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(onRetry).toHaveBeenCalledWith(429, 0)
    for (const [url, init] of fetchMock.mock.calls) {
      expect(url).toBe("https://openrouter.ai/api/v1/chat/completions")
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer test-key")
      expect(JSON.parse(String(init?.body))).toMatchObject({
        model: "z-ai/glm-5.3-flash", tools: [{ type: "function" }],
        provider: { require_parameters: true, zdr: true, data_collection: "deny" },
      })
      expect(init?.signal).toBeInstanceOf(AbortSignal)
    }
    onRetry.mockRestore()
  })

  test.each([401, 402, 403, 404])("fails closed without retrying status %s", async (status) => {
    fetchMock.mockResolvedValue(Response.json({ error: { message: "PRIVATE NOTE" } }, { status }))
    const error = await openRouterRequest("/chat/completions", {}).catch((e) => e)
    expect(error).toBeInstanceOf(OpenRouterError)
    expect(error).toMatchObject({ status })
    expect(String(error)).not.toContain("PRIVATE NOTE")
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  test("bounds temporary-failure attempts", async () => {
    for (let i = 0; i < 3; i++) {
      fetchMock.mockResolvedValueOnce(new Response("", { status: 503, headers: { "Retry-After": "0" } }))
    }
    await expect(openRouterRequest("/chat/completions", {})).rejects.toMatchObject({ status: 503 })
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  test("does not retry before a long Retry-After expires", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 429, headers: { "Retry-After": "3600" } }))
    await expect(openRouterRequest("/chat/completions", {})).rejects.toMatchObject({ status: 429 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  test("handles numeric and HTTP-date delays and invalid headers", () => {
    const now = Date.parse("2026-11-06T00:00:00Z")
    expect(retryDelayMs("2", 0, now)).toBe(2000)
    expect(retryDelayMs("Fri, 06 Nov 2026 00:00:03 GMT", 0, now)).toBe(3000)
    expect(retryDelayMs("invalid", 1, now)).toBe(2000)
    expect(retryDelayMs("", 0, now)).toBe(1000)
    expect(retryDelayMs("-1", 0, now)).toBe(0)
  })

  test("sanitizes malformed, embedded-error and uncertain network responses", async () => {
    fetchMock.mockResolvedValueOnce(new Response("PRIVATE NOTE"))
      .mockResolvedValueOnce(Response.json({ error: { message: "PRIVATE NOTE" } }))
      .mockRejectedValueOnce(new Error("PRIVATE NOTE"))
    for (const status of [502, 502, 503]) {
      const error = await openRouterRequest("/chat/completions", {}).catch((e) => e)
      expect(error).toMatchObject({ status })
      expect(String(error)).not.toContain("PRIVATE NOTE")
    }
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  test("fails locally without a configured key", async () => {
    delete process.env.OPENROUTER_API_KEY
    await expect(openRouterRequest("/chat/completions", {})).rejects.toMatchObject({ status: 503 })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test("allows server-side model overrides", () => {
    expect(openRouterModel("transcription")).toBe("elevenlabs/scribe-v2")
    process.env.OPENROUTER_AI_MODEL = " custom/chat "
    process.env.OPENROUTER_TRANSCRIPTION_MODEL = "custom/transcription"
    expect(openRouterModel("ai")).toBe("custom/chat")
    expect(openRouterModel("transcription")).toBe("custom/transcription")
  })
})

describe("transcription", () => {
  test.each([["audio/webm;codecs=opus", "webm"], ["audio/mp4;codecs=mp4a.40.2", "m4a"], ["audio/ogg", "ogg"]])(
    "forwards the actual %s recording format", async (mime, format) => {
      fetchMock.mockResolvedValue(Response.json({ text: "Buy milk tomorrow" }))
      const audio = new File(["test recording"], "recording", { type: mime })
      expect(audioFormat(audio.type)).toBe(format)
      expect(await transcribeAudio(audio, format!)).toBe("Buy milk tomorrow")
      const [url, init] = fetchMock.mock.calls[0]!
      expect(url).toBe("https://openrouter.ai/api/v1/audio/transcriptions")
      expect(JSON.parse(String(init?.body))).toMatchObject({
        model: "elevenlabs/scribe-v2", language: "en",
        input_audio: { data: Buffer.from("test recording").toString("base64"), format },
        provider: { zdr: true, data_collection: "deny" },
      })
    },
  )

  test("rejects unsupported formats and malformed transcripts", async () => {
    expect(audioFormat("text/plain")).toBeNull()
    fetchMock.mockResolvedValue(Response.json({ text: 123 }))
    await expect(transcribeAudio(new File(["audio"], "audio.webm"), "webm")).rejects.toMatchObject({ status: 502 })
  })
})
