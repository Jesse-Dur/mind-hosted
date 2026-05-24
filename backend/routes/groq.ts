import { Hono } from "hono"
import { getAuth } from "@hono/clerk-auth"
import { tilesDb } from "../db/tiles"
import { thoughtsDb } from "../db/thoughts"
import { tagsDb } from "../db/tags"
import { historyDb } from "../db/history"

export const groqRoute = new Hono()

const CONCURRENCY: Record<string, number> = { low: 1, medium: 2, high: 4 }
let running = 0

export type AiStatus = "idle" | "processing" | "queued" | "limited"
const userStatus = new Map<string, AiStatus>()
const userStatusTimers = new Map<string, ReturnType<typeof setTimeout>>()

function setStatus(userId: string, s: AiStatus, resetAfterMs?: number) {
  if (s === "idle") userStatus.delete(userId)
  else userStatus.set(userId, s)
  const existing = userStatusTimers.get(userId)
  if (existing) clearTimeout(existing)
  if (resetAfterMs) {
    userStatusTimers.set(userId, setTimeout(() => { userStatus.delete(userId); userStatusTimers.delete(userId) }, resetAfterMs))
  }
}

function getStatus(userId: string): AiStatus {
  return userStatus.get(userId) ?? "idle"
}

groqRoute.get("/status", (c) => {
  const auth = getAuth(c)
  if (!auth?.userId) return c.json({ status: "idle" })
  return c.json({ status: getStatus(auth.userId) })
})

const TOOLS = [
  {
    type: "function",
    function: {
      name: "search_by_tag",
      description: "Find thoughts with a specific tag.",
      parameters: { type: "object", properties: { tag: { type: "string" } }, required: ["tag"] },
    },
  },
  {
    type: "function",
    function: {
      name: "search_by_tile",
      description: "List all thoughts in a tile.",
      parameters: { type: "object", properties: { tile_id: { type: "number" } }, required: ["tile_id"] },
    },
  },
  {
    type: "function",
    function: {
      name: "search_thoughts",
      description: "Search thoughts by keyword. A match means it exists — update rather than create. Use a single short keyword e.g. 'physics' not 'physics homework'.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Short keyword, e.g. 'physics'" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_thought",
      description: "Create a new thought in a tile.",
      parameters: {
        type: "object",
        properties: {
          tile_id: { type: "number", description: "Tile ID to add thought to" },
          content: { type: "string", description: "Concise thought text, max 10 words" },
          tags: { type: "array", items: { type: "string" }, description: "Tags from available list only" },
        },
        required: ["tile_id", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_thought",
      description: "Update the content of an existing thought.",
      parameters: {
        type: "object",
        properties: {
          thought_id: { type: "number" },
          content: { type: "string", description: "New concise content" },
          tags: { type: "array", items: { type: "string" } },
        },
        required: ["thought_id", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_thought",
      description: "Delete an existing thought.",
      parameters: {
        type: "object",
        properties: {
          thought_id: { type: "number" },
        },
        required: ["thought_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "move_thought",
      description: "Move a thought to a different tile.",
      parameters: {
        type: "object",
        properties: {
          thought_id: { type: "number" },
          tile_id: { type: "number" },
        },
        required: ["thought_id", "tile_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "done",
      description: "Call this when you have finished all actions.",
      parameters: { type: "object", properties: {} },
    },
  },
]

const SEARCH_TOOLS = new Set(["search_by_tag", "search_by_tile", "search_thoughts"])

export async function classifyAndStore(input: string, userId: string): Promise<{ totalInput: number; totalOutput: number; totalTokens: number; iterations: number }> {
  const stats = { totalInput: 0, totalOutput: 0, totalTokens: 0, iterations: 0 }
  const tiles = await tilesDb.list(userId)
  const tags = await tagsDb.list(userId)
  const tileList = tiles.map((t) => `${t.id}:"${t.title}"`).join(", ")
  const tagList = tags.map((t) => t.name).join(", ")

  const allThoughts = await thoughtsDb.list(userId)
  const inputTags = tags.filter((t) => {
    const re = new RegExp(`\\b${t.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i")
    return re.test(input)
  })
  const inputTagHint = inputTags.length
    ? `\nDetected tags in input: ${inputTags.map((t) => {
        const taggedThoughts = allThoughts.filter((th) => th.tags.includes(t.name))
        if (!taggedThoughts.length) return `"${t.name}" (no existing thoughts with this tag)`
        const tileCounts: Record<number, number> = {}
        taggedThoughts.forEach((th) => { tileCounts[th.tile_id] = (tileCounts[th.tile_id] ?? 0) + 1 })
        const mostCommonTileId = Number(Object.entries(tileCounts).sort((a, b) => b[1] - a[1])[0]![0])
        const tile = tiles.find((ti) => ti.id === mostCommonTileId)
        return `"${t.name}" (${taggedThoughts.length} existing thought(s), most commonly in tile "${tile?.title ?? "?"}" id:${mostCommonTileId})`
      }).join(", ")} — these tiles may be most appropriate for new thoughts.`
    : ""

  const reqId = Math.random().toString(36).slice(2, 6)
  const log = (msg: string) => console.log(`[${reqId}] ${msg}`)

  console.log(`\n🤖 [${reqId}] AI input: "${input.replace(/[\r\n]/g, " ")}"`)
  setStatus(userId, "processing")

  type Message = { role: string; content: string; name?: string; tool_call_id?: string; tool_calls?: { id: string; function: { name: string; arguments: string } }[] }
  const baseMessages: Message[] = [
    {
      role: "system",
      content: `You are a personal thought organiser assistant.
Tiles: ${tileList || "none"}
Available tags: ${tagList || "none"}

- ALWAYS call done() in the SAME message as your last action, not separately.
- Call multiple tools at once whenever possible. Particularly when searching initially. Call done() alongside your final CRUD toolcalls.
- If the input mentions a known tag name, call search_by_tag with that tag to find useful context.
- Always apply matching tags automatically. Do NOT repeat the tag/subject in the thought content if a tag already covers it. If no tag covers the subject, keep it in the content.
- Do NOT repeat tile context in the content (e.g. if in 'Tasks if Bored', don't say 'if I'm bored' or 'when bored'). If in 'Homework', don't say 'homework' in the thought.
- Strip all redundant context, the thought should be the pure action/note only. e.g. "if I'm bored I can do Sunny website development" tagged 'Sunny' in 'Tasks if Bored' → content: "Website development".
- Create multiple thoughts if multiple tasks are mentioned.
- If the input references a tile by name (e.g. 'shopping list', 'homework', 'tasks'), ALWAYS call search_by_tile first before creating — the item may already exist.
- If the input adds detail to something that likely already exists (e.g. "My physics homework is questions 1-20" when a "Physics" thought exists → update it to "Physics: questions 1-20"), call update_thought rather than creating a new one.
- If input is ambiguous (could be a move instruction or new info), prefer CREATE.`,
    },
    { role: "user", content: input + inputTagHint },
  ]

  const historyActions: string[] = []
  let searchIterations = 0
  const MAX_SEARCH_ITERATIONS = 3

  type SearchRecord = { tool: string; arg: string; results: string }
  const searchLog: SearchRecord[] = []

  function buildSessionState(): Message | null {
    if (historyActions.length === 0 && searchLog.length === 0) return null
    const parts: string[] = []
    if (searchLog.length > 0) {
      parts.push("Search results:")
      for (const s of searchLog) parts.push(`- ${s.tool}(${s.arg}): ${s.results}`)
    }
    if (historyActions.length > 0) {
      parts.push("Completed actions (if original request is satisfied, call done() NOW):")
      for (const a of historyActions) parts.push(`- ${a}`)
    }
    return { role: "user", content: parts.join("\n") }
  }

  for (let i = 0; i < 8; i++) {
    log(`🔄 Iteration ${i + 1}...`)

    const sessionMsg = buildSessionState()
    const messages: Message[] = sessionMsg ? [...baseMessages, sessionMsg] : [...baseMessages]

    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "qwen/qwen3-32b",
        messages,
        tools: searchIterations >= MAX_SEARCH_ITERATIONS ? TOOLS.filter((t) => !SEARCH_TOOLS.has(t.function.name)) : TOOLS,
        temperature: 0.1,
      }),
      signal: AbortSignal.timeout(60000),
    })

    const data = await res.json() as {
      choices?: { message: { role: string; content: string | null; tool_calls?: { id: string; function: { name: string; arguments: string } }[] } }[]
      usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number; completion_tokens_details?: { reasoning_tokens?: number } }
      prompt_eval_count?: number
      eval_count?: number
      error?: { message: string }
    }

    const remainingReqs = res.headers.get("x-ratelimit-remaining-requests")
    const remainingTokens = res.headers.get("x-ratelimit-remaining-tokens")
    const resetTokens = res.headers.get("x-ratelimit-reset-tokens")
    if (remainingReqs || remainingTokens) {
      log(`📊 rate limit — requests remaining: ${remainingReqs}, tokens remaining: ${remainingTokens}, reset: ${resetTokens}`)
    }
    stats.iterations++
    if (data.usage || data.eval_count) {
      const inp = data.usage?.prompt_tokens ?? data.prompt_eval_count ?? 0
      const out = data.usage?.completion_tokens ?? data.eval_count ?? 0
      const total = data.usage?.total_tokens ?? (inp + out)
      const reasoningTokens = data.usage?.completion_tokens_details?.reasoning_tokens
      stats.totalInput += inp
      stats.totalOutput += out
      stats.totalTokens += total
      const totalLabel = reasoningTokens ? `total (incl. reasoning): ${total}` : `total (excl. reasoning): ${total}`
      log(`🔢 input: ${inp}, output: ${out}${reasoningTokens ? `, reasoning: ${reasoningTokens}` : ""}, ${totalLabel}`)
    }

    if (!data.choices?.[0]) {
      const errMsg = data.error?.message ?? "unknown"
      log(`Bad response ${res.status}: ${errMsg}`)
      if (res.status === 429) {
        const retryAfter = res.headers.get("retry-after")
        const wait = retryAfter ? Number(retryAfter) * 1000 : 10000
        setStatus(userId, wait > 60000 ? "limited" : "queued")
        log(`⏳ Rate limited — waiting ${wait / 1000}s (reset: ${resetTokens})`)
        await new Promise((r) => setTimeout(r, wait))
        setStatus(userId, "processing")
        continue
      }
      if (res.status >= 400 && res.status < 500) {
        log(`❌ Non-retryable error ${res.status} — aborting`)
        setStatus(userId, "idle")
        return stats
      }
      continue
    }

    const msg = data.choices[0].message
    const MAX_TOOL_CALLS = 10
    const rawCalls = msg.tool_calls ?? []
    const seenCalls = new Set<string>()
    const toolCalls = rawCalls
      .filter((c) => {
        const key = `${c.function.name}:${c.function.arguments}`
        if (seenCalls.has(key)) return false
        seenCalls.add(key)
        return true
      })
      .slice(0, MAX_TOOL_CALLS)
      .sort((a, b) => (a.function.name === "done" ? 1 : b.function.name === "done" ? -1 : 0))
    const hasSearches = toolCalls.some((c) => SEARCH_TOOLS.has(c.function.name))
    const filteredCalls = hasSearches ? toolCalls.filter((c) => c.function.name !== "done" && !c.function.name.startsWith("create") && !c.function.name.startsWith("update") && !c.function.name.startsWith("delete") && !c.function.name.startsWith("move")) : toolCalls
    if (rawCalls.length > filteredCalls.length) {
      log(`⚠️ Trimmed tool calls: ${rawCalls.length} → ${filteredCalls.length} (dupes/cap/search-action separation)`)
    }
    log(`💬 ${filteredCalls.length ? `→ ${filteredCalls.map((c) => c.function.name).join(", ")}` : (msg.content ?? "").slice(0, 150)}`)

    if (!filteredCalls.length) {
      log(`✅ Done: ${historyActions.join(" | ") || "no actions"}`)
      if (historyActions.length > 0) {
        await historyDb.log(userId, "ai.process",
          historyActions.length === 1 ? `AI: ${historyActions[0]}` : `AI: ${historyActions.length} actions`,
          { input, actions: historyActions }
        )
      }
      setStatus(userId, "idle")
      return stats
    }

    if (hasSearches) searchIterations++

    for (const call of filteredCalls) {
      if (call.function.name === "done") {
        log(`✅ Done: ${historyActions.join(" | ") || "no actions"}`)
        if (historyActions.length > 0) {
          await historyDb.log(userId, "ai.process",
            historyActions.length === 1 ? `AI: ${historyActions[0]}` : `AI: ${historyActions.length} actions`,
            { input, actions: historyActions }
          )
        }
        setStatus(userId, "idle")
        return stats
      }

      let args: Record<string, unknown> = {}
      try { args = JSON.parse(call.function.arguments) } catch {
        continue
      }
      let result = ""

      try {
        if (call.function.name === "search_thoughts") {
          const query = String(args.query ?? "")
          const keywords = query.toLowerCase().split(/\s+/).filter(Boolean)
          const results = allThoughts
            .filter((t) => keywords.some((kw) => t.content.toLowerCase().includes(kw)))
            .slice(0, 8)
            .map((t) => ({ id: t.id, content: t.content, tile_id: t.tile_id, tile_title: tiles.find((ti) => ti.id === t.tile_id)?.title ?? "?", tags: t.tags }))
          log(`🔍 search("${query}") → ${results.length} result(s)${results.length ? ": " + results.map((r) => `[${r.id}] "${r.content}"`).join(", ") : ""}`)
          const resultStr = results.length
            ? results.map((r) => `id:${r.id} "${r.content}" (tile:"${r.tile_title}"${r.tags.length ? ` tags:[${r.tags.join(",")}]` : ""})`).join(", ")
            : "no results"
          searchLog.push({ tool: "search_thoughts", arg: `"${query}"`, results: resultStr })
          result = results.length
            ? `Found: ${JSON.stringify(results)}. NOW call update_thought/delete_thought/move_thought immediately. Do not search again.`
            : `No results for "${query}". Call create_thought now — do not search again.`

        } else if (call.function.name === "search_by_tag") {
          const tag = String(args.tag ?? "")
          const results = allThoughts
            .filter((t) => t.tags.some((tg) => tg.toLowerCase().includes(tag.toLowerCase())))
            .slice(0, 8)
            .map((t) => ({ id: t.id, content: t.content, tile_id: t.tile_id, tile_title: tiles.find((ti) => ti.id === t.tile_id)?.title ?? "?", tags: t.tags }))
          log(`🏷️ search_by_tag("${tag}") → ${results.length} result(s)${results.length ? ": " + results.map((r) => `[${r.id}] "${r.content}"`).join(", ") : ""}`)
          const resultStr = results.length
            ? results.map((r) => `id:${r.id} "${r.content}" (tile:"${r.tile_title}")`).join(", ")
            : "no results"
          searchLog.push({ tool: "search_by_tag", arg: `"${tag}"`, results: resultStr })
          result = results.length
            ? `Found: ${JSON.stringify(results)}. Use the same tile_id as these results for any new related thoughts. NOW act immediately.`
            : `No thoughts tagged "${tag}"`

        } else if (call.function.name === "search_by_tile") {
          const tileId = Number(args.tile_id)
          const results = (await thoughtsDb.list(userId, tileId)).slice(0, 20).map((t) => ({ id: t.id, content: t.content, tags: t.tags }))
          const tileName = tiles.find((t) => Number(t.id) === tileId)?.title ?? tileId
          log(`📂 search_by_tile(${tileId} "${tileName}") → ${results.length} result(s)`)
          const resultStr = results.length
            ? results.map((r) => `id:${r.id} "${r.content}"${r.tags.length ? ` tags:[${r.tags.join(",")}]` : ""}`).join(", ")
            : "no results"
          searchLog.push({ tool: "search_by_tile", arg: `${tileId} "${tileName}"`, results: resultStr })
          result = results.length
            ? `Found in tile "${tileName}": ${JSON.stringify(results)}. If the user's input is about any of these subjects (even if adding new detail or context), call update_thought on the matching one. Only call create_thought if nothing is related.`
            : `No thoughts in tile ${tileId}. Call create_thought.`

        } else if (call.function.name === "create_thought") {
          const tileId = Number(args.tile_id)
          const content = String(args.content ?? "")
          if (!tileId || !content) {
            result = "Error: missing tile_id or content"
          } else {
            const validTile = tiles.find((t) => Number(t.id) === tileId)
            if (!validTile) {
              log(`⚠️ create_thought: tile_id ${tileId} not found`)
              result = `Error: tile_id ${tileId} does not exist. Valid tile IDs: ${tiles.map((t) => `${Number(t.id)} ("${t.title}")`).join(", ")}`
            } else {
              const validTags = ((args.tags as string[]) ?? []).filter((t) => tags.some((tag) => tag.name === t))
              const thought = await thoughtsDb.create({ tile_id: tileId, content, tags: validTags, sort_order: 0 }, userId, true)
              const action = `Created "${thought.content}" in "${validTile.title}"`
              historyActions.push(action)
              log(`✏️ ${action}`)
              result = `Created thought id:${thought.id}`
            }
          }

        } else if (call.function.name === "update_thought") {
          const id = Number(args.thought_id)
          const content = String(args.content ?? "")
          if (!id || !content) {
            result = "Error: missing thought_id or content"
          } else {
            const validTags = args.tags ? (args.tags as string[]).filter((t) => tags.some((tag) => tag.name === t)) : undefined
            await thoughtsDb.update(id, content, userId, validTags)
            const action = `Updated thought ${id} → "${content}"`
            historyActions.push(action)
            log(`✏️ ${action}`)
            result = "Updated"
          }

        } else if (call.function.name === "delete_thought") {
          const id = Number(args.thought_id)
          if (!id) {
            result = "Error: missing thought_id"
          } else {
            await thoughtsDb.remove(id, userId)
            historyActions.push(`Deleted thought ${id}`)
            log(`🗑️ Deleted thought ${id}`)
            result = "Deleted"
          }

        } else if (call.function.name === "move_thought") {
          const id = Number(args.thought_id)
          const tileId = Number(args.tile_id)
          if (!id || !tileId) {
            result = "Error: missing ids"
          } else {
            const validTile = tiles.find((t) => Number(t.id) === tileId)
            if (!validTile) {
              log(`⚠️ move_thought: tile_id ${tileId} not found`)
              result = `Error: tile_id ${tileId} does not exist. Valid tile IDs: ${tiles.map((t) => `${Number(t.id)} ("${t.title}")`).join(", ")}`
            } else {
              await thoughtsDb.move(id, tileId, userId)
              const action = `Moved thought ${id} to "${validTile.title}"`
              historyActions.push(action)
              log(`📦 ${action}`)
              result = "Moved"
            }
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        log(`⚠️ Tool error (${call.function.name}): ${msg}`)
        result = `Error executing ${call.function.name}: ${msg}. Try again with valid parameters.`
      }

      // result captured in searchLog/historyActions for next iteration's session state
    }
  }

  log("   ⚠️ Loop exhausted")
  setStatus(userId, "idle")
  return stats
}

groqRoute.post("/process", async (c) => {
  const auth = getAuth(c)
  if (!auth?.userId) return c.json({ error: "Unauthorized" }, 401)

  const { input: rawInput, priority = "medium" } = await c.req.json() as { input: string; priority: string }
  const input = String(rawInput ?? "").slice(0, 500)
  if (!input.trim()) return c.json({ error: "Empty input" }, 400)
  const max = CONCURRENCY[priority] ?? 2
  const jobId = crypto.randomUUID()

  if (running < max) {
    running++
    classifyAndStore(input, auth.userId).catch(console.error).finally(() => running--)
  } else {
    setStatus(auth.userId, "queued")
    setTimeout(() => {
      running++
      classifyAndStore(input, auth.userId).catch(console.error).finally(() => running--)
    }, priority === "low" ? 5000 : 1000)
  }

  return c.json({ job_id: jobId })
})
