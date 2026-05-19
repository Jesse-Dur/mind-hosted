import { Hono } from "hono"
import { getAuth } from "@hono/clerk-auth"
import { tilesDb } from "../db/tiles"
import { thoughtsDb } from "../db/thoughts"
import { tagsDb } from "../db/tags"
import { historyDb } from "../db/history"

export const groqRoute = new Hono()

const CONCURRENCY: Record<string, number> = { low: 1, medium: 2, high: 4 }
let running = 0

const TOOLS = [
  {
    type: "function",
    function: {
      name: "search_by_tag",
      description: "Find all thoughts with a specific tag. Use when searching for things like 'physics' that might be a tag.",
      parameters: { type: "object", properties: { tag: { type: "string" } }, required: ["tag"] },
    },
  },
  {
    type: "function",
    function: {
      name: "search_by_tile",
      description: "List all thoughts in a specific tile. Use when you know which tile to look in.",
      parameters: { type: "object", properties: { tile_id: { type: "number" } }, required: ["tile_id"] },
    },
  },
  {
    type: "function",
    function: {
      name: "search_thoughts",
      description: "Search existing thoughts by keyword. Use before update/delete/move.",
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

async function classifyAndStore(input: string, userId: string) {
  const tiles = await tilesDb.list(userId)
  const tags = await tagsDb.list(userId)
  const tileList = tiles.map((t) => `id:${t.id} title:"${t.title}"`).join(", ")
  const tagList = tags.map((t) => t.name).join(", ")
  const randomTileId = tiles.find((t) => t.title.toLowerCase().includes("random"))?.id ?? null

  const allThoughts = await thoughtsDb.list(userId)
  const inputTags = tags.filter((t) => {
    const re = new RegExp(`\\b${t.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i")
    return re.test(input)
  })
  const inputTagHint = inputTags.length
    ? `\nDetected tags in input: ${inputTags.map((t) => {
        const taggedThoughts = allThoughts.filter((th) => th.tags.includes(t.name))
        if (!taggedThoughts.length) {
          const rTile = tiles.find((ti) => ti.id === randomTileId)
          return `"${t.name}" (no existing thoughts — use tile "${rTile?.title ?? "Random"}" id:${randomTileId ?? "unknown"})`
        }
        const tileCounts: Record<number, number> = {}
        taggedThoughts.forEach((th) => { tileCounts[th.tile_id] = (tileCounts[th.tile_id] ?? 0) + 1 })
        const mostCommonTileId = Number(Object.entries(tileCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? randomTileId)
        const tile = tiles.find((ti) => ti.id === mostCommonTileId)
        return `"${t.name}" (${taggedThoughts.length} existing thought(s), most commonly in tile "${tile?.title ?? "?"}" id:${mostCommonTileId})`
      }).join(", ")} — use these tags and tiles for new thoughts.`
    : ""

  const reqId = Math.random().toString(36).slice(2, 6)
  const log = (msg: string) => console.log(`[${reqId}] ${msg}`)

  console.log(`\n🤖 [${reqId}] AI input: "${input.replace(/[\r\n]/g, " ")}"`)

  type Message = { role: string; content: string; name?: string; tool_call_id?: string }
  const messages: Message[] = [
    {
      role: "system",
      content: `You are a personal dashboard assistant.
Tiles: ${tileList || "none"}
Available tags: ${tagList || "none"}
Default tile for uncertain items: ${randomTileId ? `id:${randomTileId}` : "none — skip if unsure"}

Rules:
- You can call multiple tools in parallel in a single message — do this whenever possible.
- If the input mentions a known tag name, FIRST call search_by_tag with that tag to find related existing thoughts and the correct tile to use.
- Always apply matching tags automatically. Do NOT repeat the tag/subject in the thought content.
- Do NOT repeat tile context in the content (e.g. if in 'Tasks if Bored', don't say 'if I'm bored' or 'when bored').
- Strip all redundant context — the thought should be the pure action/note only.
- Split compound inputs into multiple separate create_thought calls (one task = one thought).
- If search returns no results after trying, CREATE a new thought instead of searching again.
- If input is ambiguous (could be a move instruction or new info), prefer CREATE.
- Call done() in the SAME message as your last action, not separately.`,
    },
    { role: "user", content: input + inputTagHint },
  ]

  const historyActions: string[] = []
  let searchCount = 0
  const MAX_SEARCHES = 2

  for (let i = 0; i < 8; i++) {
    log(`🔄 Iteration ${i + 1}...`)

    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "llama-3.1-8b-instant",
        messages,
        tools: searchCount >= MAX_SEARCHES ? TOOLS.filter((t) => !t.function.name.startsWith("search")) : TOOLS,
        temperature: 0.1,
      }),
      signal: AbortSignal.timeout(60000),
    })

    const data = await res.json() as {
      choices?: { message: { role: string; content: string | null; tool_calls?: { id: string; function: { name: string; arguments: string } }[] } }[]
      error?: { message: string }
    }

    if (!data.choices?.[0]) {
      log(`Bad response: ${JSON.stringify(data.error ?? data)}`)
      messages.push({ role: "user", content: `Error: ${data.error?.message ?? "unknown"}. Try again.` })
      continue
    }

    const msg = data.choices[0].message
    log(`💬 ${msg.tool_calls?.length ? `→ ${msg.tool_calls.map((c) => c.function.name).join(", ")}` : (msg.content ?? "").slice(0, 150)}`)

    if (!msg.tool_calls?.length) {
      log(`✅ Done: ${historyActions.join(" | ") || "no actions"}`)
      if (historyActions.length > 0) {
        await historyDb.log(userId, "ai.process",
          historyActions.length === 1 ? `AI: ${historyActions[0]}` : `AI: ${historyActions.length} actions`,
          { input, actions: historyActions }
        )
      }
      return
    }

    messages.push({ role: "assistant", content: msg.content ?? "" })

    for (const call of msg.tool_calls) {
      if (call.function.name === "done") {
        log(`✅ Done: ${historyActions.join(" | ") || "no actions"}`)
        if (historyActions.length > 0) {
          await historyDb.log(userId, "ai.process",
            historyActions.length === 1 ? `AI: ${historyActions[0]}` : `AI: ${historyActions.length} actions`,
            { input, actions: historyActions }
          )
        }
        return
      }

      const args = JSON.parse(call.function.arguments) as Record<string, unknown>
      let result = ""

      if (call.function.name === "search_thoughts") {
        const query = String(args.query ?? "")
        const results = allThoughts
          .filter((t) => t.content.toLowerCase().includes(query.toLowerCase()))
          .slice(0, 8)
          .map((t) => ({ id: t.id, content: t.content, tile_id: t.tile_id, tile_title: tiles.find((ti) => ti.id === t.tile_id)?.title ?? "?", tags: t.tags }))
        log(`🔍 search("${query}") → ${results.length} result(s)${results.length ? ": " + results.map((r) => `[${r.id}] "${r.content}"`).join(", ") : ""}`)
        searchCount++
        result = results.length
          ? `Found: ${JSON.stringify(results)}. NOW call update_thought/delete_thought/move_thought immediately. Do not search again.`
          : `No results for "${query}". Try search_by_tag or search_by_tile instead.`

      } else if (call.function.name === "search_by_tag") {
        const tag = String(args.tag ?? "")
        const results = allThoughts
          .filter((t) => t.tags.some((tg) => tg.toLowerCase().includes(tag.toLowerCase())))
          .slice(0, 8)
          .map((t) => ({ id: t.id, content: t.content, tile_id: t.tile_id, tile_title: tiles.find((ti) => ti.id === t.tile_id)?.title ?? "?", tags: t.tags }))
        log(`🏷️ search_by_tag("${tag}") → ${results.length} result(s)${results.length ? ": " + results.map((r) => `[${r.id}] "${r.content}"`).join(", ") : ""}`)
        searchCount++
        result = results.length
          ? `Found: ${JSON.stringify(results)}. Use the same tile_id as these results for any new related thoughts. NOW act immediately.`
          : `No thoughts tagged "${tag}"`

      } else if (call.function.name === "search_by_tile") {
        const tileId = Number(args.tile_id)
        const results = (await thoughtsDb.list(userId, tileId)).slice(0, 20).map((t) => ({ id: t.id, content: t.content, tags: t.tags }))
        const tileName = tiles.find((t) => t.id === tileId)?.title ?? tileId
        log(`📂 search_by_tile(${tileId} "${tileName}") → ${results.length} result(s)`)
        searchCount++
        result = results.length
          ? `Found: ${JSON.stringify(results)}. NOW call update_thought/delete_thought/move_thought immediately. Do not search again.`
          : `No thoughts in tile ${tileId}`

      } else if (call.function.name === "create_thought") {
        const tileId = Number(args.tile_id) || randomTileId
        const content = String(args.content ?? "")
        if (!tileId || !content) { result = "Error: missing tile_id or content"; continue }
        const validTags = ((args.tags as string[]) ?? []).filter((t) => tags.some((tag) => tag.name === t))
        const thought = await thoughtsDb.create({ tile_id: tileId, content, tags: validTags, sort_order: 0 }, userId, true)
        const tile = tiles.find((t) => t.id === tileId)
        const action = `Created "${thought.content}" in "${tile?.title ?? tileId}"`
        historyActions.push(action)
        log(`✏️ ${action}`)
        result = `Created thought id:${thought.id}`

      } else if (call.function.name === "update_thought") {
        const id = Number(args.thought_id)
        const content = String(args.content ?? "")
        if (!id || !content) { result = "Error: missing thought_id or content"; continue }
        const validTags = args.tags ? (args.tags as string[]).filter((t) => tags.some((tag) => tag.name === t)) : undefined
        await thoughtsDb.update(id, content, userId, validTags)
        const action = `Updated thought ${id} → "${content}"`
        historyActions.push(action)
        log(`✏️ ${action}`)
        result = "Updated"

      } else if (call.function.name === "delete_thought") {
        const id = Number(args.thought_id)
        if (!id) { result = "Error: missing thought_id"; continue }
        await thoughtsDb.remove(id, userId)
        historyActions.push(`Deleted thought ${id}`)
        log(`🗑️ Deleted thought ${id}`)
        result = "Deleted"

      } else if (call.function.name === "move_thought") {
        const id = Number(args.thought_id)
        const tileId = Number(args.tile_id)
        if (!id || !tileId) { result = "Error: missing ids"; continue }
        await thoughtsDb.move(id, tileId, userId)
        const tile = tiles.find((t) => t.id === tileId)
        const action = `Moved thought ${id} to "${tile?.title ?? tileId}"`
        historyActions.push(action)
        log(`📦 ${action}`)
        result = "Moved"
      }

      messages.push({ role: "tool", content: result, name: call.function.name, tool_call_id: call.id })
    }

    if (historyActions.length > 0) {
      messages.push({ role: "user", content: `Already completed this session: ${historyActions.join("; ")}. Do not repeat these. Call done() if finished.` })
    }
  }

  log("   ⚠️ Loop exhausted")
}

groqRoute.post("/process", async (c) => {
  const auth = getAuth(c)
  if (!auth?.userId) return c.json({ error: "Unauthorized" }, 401)

  const { input, priority = "medium" } = await c.req.json() as { input: string; priority: string }
  const max = CONCURRENCY[priority] ?? 2
  const jobId = crypto.randomUUID()

  if (running < max) {
    running++
    classifyAndStore(input, auth.userId).catch(console.error).finally(() => running--)
  } else {
    setTimeout(() => {
      running++
      classifyAndStore(input, auth.userId).catch(console.error).finally(() => running--)
    }, priority === "low" ? 5000 : 1000)
  }

  return c.json({ job_id: jobId })
})
