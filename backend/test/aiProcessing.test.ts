import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"

// Run this module separately from database integration tests: all writes are in-memory.
let authenticated = true
let thoughts: Array<Record<string, any>> = []
const writes: Array<{ action: string; id: number | null; payload: any }> = []
const history = mock(async () => {})
const consume = mock(async (..._args: unknown[]) => {})
mock.module("@clerk/hono", () => ({ getAuth: () => authenticated ? { userId: "test-user" } : null }))
mock.module("../db/tiles", () => ({ tilesDb: { list: async () => [{ id: 1, title: "Tasks" }, { id: 2, title: "Work" }] } }))
mock.module("../db/tags", () => ({ tagsDb: { list: async () => [{ name: "work" }] } }))
mock.module("../db/thoughts", () => ({ thoughtsDb: { list: async (_user: string, filter?: { tileId: number }) =>
  thoughts.filter((thought) => !filter || thought.tile_id === filter.tileId) } }))
mock.module("../db/history", () => ({ historyDb: { log: history } }))
mock.module("../billing/entitlements", () => ({ consumeAutumnFeature: consume }))
mock.module("../db/sync", () => ({ syncDb: {
  latestRevision: async () => 42,
  apply: async (_user: string, _op: string, _entity: string, action: string, _client: null, id: number | null, payload: any) => {
    writes.push({ action, id, payload })
    const entity = { id: id ?? 100, tags: [], sort_order: 0, ...payload }
    return { entity }
  },
} }))

const { aiRoute, classifyAndStore } = await import("../routes/ai")
const { transcriptionRoute, MAX_AUDIO_REQUEST_BYTES } = await import("../routes/transcription")
const { MAX_AUDIO_BYTES } = await import("../ai/transcribe")
const originalKey = process.env.OPENROUTER_API_KEY
let fetchMock: ReturnType<typeof spyOn<typeof globalThis, "fetch">>

function tool(name: string, args: Record<string, unknown> = {}) {
  return { id: crypto.randomUUID(), function: { name, arguments: JSON.stringify(args) } }
}
function response(...calls: ReturnType<typeof tool>[]) {
  return Response.json({ choices: [{ message: { content: null, tool_calls: calls } }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } })
}
async function status() { return (await (await aiRoute.request("/status")).json() as { status: string }).status }
function audioRequest(audio?: File | string) {
  const form = new FormData()
  if (audio !== undefined) form.set("audio", audio)
  return transcriptionRoute.request("/transcribe", { method: "POST", body: form })
}

beforeEach(() => {
  authenticated = true
  process.env.OPENROUTER_API_KEY = "test-key"
  thoughts = [{ id: 7, tile_id: 1, content: "Call dentist", tags: [], sort_order: 3 }]
  writes.length = 0
  history.mockClear()
  consume.mockClear()
  fetchMock = spyOn(globalThis, "fetch")
})
afterEach(() => {
  fetchMock.mockRestore()
  if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY
  else process.env.OPENROUTER_API_KEY = originalKey
})

describe("thought processing via OpenRouter", () => {
  test("applies multiple creates once and finishes after the whole batch", async () => {
    const milk = tool("create_thought", { tile_id: 1, content: "Buy milk" })
    fetchMock.mockResolvedValueOnce(response(
      tool("done"),
      milk,
      tool("create_thought", { tile_id: 1, content: "Buy bread" }),
      tool("create_thought", { tile_id: 1, content: "Buy milk" }),
      tool("create_thought", { tile_id: 2, content: "Send invoice", tags: ["work"] }),
    ))

    const stats = await classifyAndStore("Buy milk and bread, and send the work invoice", "test-user")

    expect(stats.iterations).toBe(1)
    expect(writes).toEqual([
      { action: "upsert", id: null, payload: { tile_id: 1, content: "Buy milk", tags: [] } },
      { action: "upsert", id: null, payload: { tile_id: 1, content: "Buy bread", tags: [] } },
      { action: "upsert", id: null, payload: { tile_id: 2, content: "Send invoice", tags: ["work"] } },
    ])
    expect(history).toHaveBeenCalledTimes(1)
    expect((history.mock.calls[0] as unknown as any[])[3].actions).toHaveLength(3)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(await status()).toBe("idle")
  })

  test("uses a batch of searches before applying several different mutations", async () => {
    thoughts.push(
      { id: 8, tile_id: 1, content: "Send draft", tags: ["work"], sort_order: 4 },
      { id: 9, tile_id: 2, content: "Old meeting", tags: ["work"], sort_order: 1 },
    )
    fetchMock.mockResolvedValueOnce(response(
      tool("search_by_tile", { tile_id: 1 }),
      tool("search_by_tag", { tag: "work" }),
    )).mockResolvedValueOnce(response(
      tool("update_thought", { thought_id: 7, content: "Call dentist Friday" }),
      tool("move_thought", { thought_id: 8, tile_id: 2 }),
      tool("delete_thought", { thought_id: 9 }),
      tool("create_thought", { tile_id: 1, content: "Buy envelopes" }),
      tool("done"),
    ))

    const stats = await classifyAndStore("Change several Tasks and work thoughts", "test-user")

    expect(stats.iterations).toBe(2)
    expect(writes).toHaveLength(4)
    expect(writes[0]).toMatchObject({ action: "upsert", id: 7, payload: { content: "Call dentist Friday" } })
    expect(writes[1]).toMatchObject({ action: "upsert", id: 8, payload: { tile_id: 2, content: "Send draft", tags: ["work"] } })
    expect(writes[2]).toMatchObject({ action: "delete", id: 9 })
    expect(writes[3]).toMatchObject({ action: "upsert", id: null, payload: { tile_id: 1, content: "Buy envelopes" } })
    const secondRequest = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))
    const context = JSON.stringify(secondRequest.messages)
    expect(context).toContain("Call dentist")
    expect(context).toContain("Old meeting")
    expect(history).toHaveBeenCalledTimes(1)
    expect((history.mock.calls[0] as unknown as any[])[3].actions).toHaveLength(4)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(await status()).toBe("idle")
  })

  test.each([
    ["update_thought", { thought_id: 7, content: "Call dentist tomorrow" }, "upsert"],
    ["move_thought", { thought_id: 7, tile_id: 2 }, "upsert"],
    ["delete_thought", { thought_id: 7 }, "delete"],
  ] as const)("keeps search-before-write and sync behavior for %s", async (name, args, action) => {
    fetchMock.mockResolvedValueOnce(response(tool("search_thoughts", { query: "dentist" })))
      .mockResolvedValueOnce(response(tool(name, args), tool("done")))
    const stats = await classifyAndStore("Change my dentist task", "test-user")
    expect(stats).toEqual({ totalInput: 20, totalOutput: 10, totalTokens: 30, iterations: 2 })
    expect(writes).toHaveLength(1)
    expect(writes[0]).toMatchObject({ id: 7, action })
    expect(history).toHaveBeenCalledTimes(1)
    expect(await status()).toBe("idle")
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))
    expect(body).toMatchObject({ model: "z-ai/glm-5.3-flash", reasoning: { effort: "low", exclude: true } })
    expect(body.tools.some((item: any) => item.function.name === "search_thoughts")).toBe(true)
  })

  test("rejects mutation IDs that were not searched", async () => {
    fetchMock.mockResolvedValue(response(tool("delete_thought", { thought_id: 999 }), tool("done")))
    await classifyAndStore("Delete a thought", "test-user")
    expect(writes).toHaveLength(0)
  })

  test("does not duplicate a completed create when a later request is rate limited", async () => {
    const create = tool("create_thought", { tile_id: 1, content: "Buy milk" })
    fetchMock.mockResolvedValueOnce(response(create))
      .mockResolvedValueOnce(new Response("", { status: 429, headers: { "Retry-After": "0" } }))
      .mockImplementationOnce(Object.assign(async () => {
        expect(await status()).toBe("queued")
        return response(create, tool("done"))
      }, { preconnect: () => {} }))
    await classifyAndStore("Buy milk", "test-user")
    expect(writes).toHaveLength(1)
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(await status()).toBe("idle")
  })

  test("clears the queue after rate-limit retries are exhausted", async () => {
    const statuses: string[] = []
    fetchMock.mockImplementation(Object.assign(async () => {
      statuses.push(await status())
      return new Response("", { status: 429, headers: { "Retry-After": "0" } })
    }, { preconnect: () => {} }))
    await expect(classifyAndStore("Buy milk", "test-user")).rejects.toMatchObject({ status: 429 })
    expect(statuses).toEqual(["processing", "queued", "queued"])
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(writes).toHaveLength(0)
    expect(await status()).toBe("idle")
  })

  test("clears processing status on invalid, timed-out and rejected requests", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ choices: [] }))
      .mockRejectedValueOnce(new DOMException("PRIVATE NOTE", "TimeoutError"))
      .mockResolvedValueOnce(new Response("PRIVATE NOTE", { status: 403 }))
    for (let i = 0; i < 3; i++) {
      const error = await classifyAndStore("PRIVATE NOTE", "test-user").catch((e) => e)
      expect(String(error)).not.toContain("PRIVATE NOTE")
      expect(await status()).toBe("idle")
    }
    expect(writes).toHaveLength(0)
  })
})

describe("transcription route", () => {
  test("keeps the response and billing contracts", async () => {
    fetchMock.mockResolvedValue(Response.json({ text: "Buy milk" }))
    const res = await audioRequest(new File(["audio"], "audio.m4a", { type: "audio/mp4" }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ text: "Buy milk" })
    expect(consume).toHaveBeenCalledWith("test-user", "transcription_seconds", 1)
  })

  test("rejects unauthenticated and invalid uploads before billing or inference", async () => {
    authenticated = false
    expect((await audioRequest()).status).toBe(401)
    authenticated = true
    for (const audio of [undefined, "not a file", new File([], "empty"), new File(["text"], "text", { type: "text/plain" })]) {
      expect((await audioRequest(audio)).status).toBe(400)
    }
    expect(consume).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test("rejects oversized declared requests before parsing and authenticates first", async () => {
    const parse = spyOn(Request.prototype, "formData")
    const request = () => transcriptionRoute.request("/transcribe", {
      method: "POST",
      headers: { "Content-Length": String(MAX_AUDIO_REQUEST_BYTES + 1) },
      body: "unparsed upload",
    })
    try {
      expect((await request()).status).toBe(413)
      authenticated = false
      expect((await request()).status).toBe(401)
      expect(parse).not.toHaveBeenCalled()
      expect(consume).not.toHaveBeenCalled()
      expect(fetchMock).not.toHaveBeenCalled()
    } finally { parse.mockRestore() }
  })

  test("bounds uploads without Content-Length before parsing", async () => {
    const parse = spyOn(Request.prototype, "formData")
    const chunk = new Uint8Array(1024 * 1024)
    let chunksRead = 0
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        chunksRead += 1
        controller.enqueue(chunk)
        if (chunksRead === 100) controller.close()
      },
    }, { highWaterMark: 0 })
    try {
      const res = await transcriptionRoute.request("/transcribe", { method: "POST", body })
      expect(res.status).toBe(413)
      expect(chunksRead).toBe(Math.floor(MAX_AUDIO_REQUEST_BYTES / chunk.length) + 1)
      expect(parse).not.toHaveBeenCalled()
      expect(consume).not.toHaveBeenCalled()
      expect(fetchMock).not.toHaveBeenCalled()
    } finally { parse.mockRestore() }
  })

  test("allows the full audio limit with multipart overhead", async () => {
    fetchMock.mockResolvedValue(Response.json({ text: "Full recording" }))
    const res = await audioRequest(new File([new Uint8Array(MAX_AUDIO_BYTES)], "audio.webm", { type: "audio/webm" }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ text: "Full recording" })
    expect(consume).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  test("rejects audio over the file limit within the request allowance", async () => {
    const res = await audioRequest(new File([new Uint8Array(MAX_AUDIO_BYTES + 1)], "audio.webm", { type: "audio/webm" }))
    expect(res.status).toBe(413)
    expect(await res.json()).toEqual({ error: "Audio file exceeds 25 MB" })
    expect(consume).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test("does not leak upstream errors into responses or logs", async () => {
    const log = spyOn(console, "error").mockImplementation(() => {})
    try {
      fetchMock.mockResolvedValue(new Response("PRIVATE NOTE", { status: 403 }))
      const res = await audioRequest(new File(["audio"], "audio.webm", { type: "audio/webm" }))
      expect(res.status).toBe(502)
      expect(await res.text()).not.toContain("PRIVATE NOTE")
      expect(JSON.stringify(log.mock.calls)).not.toContain("PRIVATE NOTE")
    } finally { log.mockRestore() }
  })
})
