/**
 * AI prompt benchmark harness — compare different system prompts against a Neon branch DB via DATABASE_URL in .env.local
 * Usage: bun run backend/test/ai.test.ts
 * This is intentionally a performance/quality comparison tool, not a strict pass/fail correctness suite.
 */

import { sql } from "../db/client"
import { classifyAndStore } from "../routes/groq"

const TEST_USER = "test_ai_suite"

// ─── Seed ────────────────────────────────────────────────────────────────────

async function seed() {
  await sql`INSERT INTO tags (user_id, name, color) VALUES
    (${TEST_USER}, 'urgent', '#ef4444'),
    (${TEST_USER}, 'in2it', '#7c3aed'),
    (${TEST_USER}, 'health', '#22c55e'),
    (${TEST_USER}, 'physics', '#3b82f6'),
    (${TEST_USER}, 'work', '#f59e0b'),
    (${TEST_USER}, 'personal', '#06b6d4')
    ON CONFLICT (user_id, name) DO NOTHING`

  const [homework] = await sql`INSERT INTO tiles (user_id, title, x, y, width, height, importance, visible)
    VALUES (${TEST_USER}, 'Homework', 0, 0, 280, 200, 1, true) RETURNING id` as [{ id: number }]
  const [tasks] = await sql`INSERT INTO tiles (user_id, title, x, y, width, height, importance, visible)
    VALUES (${TEST_USER}, 'Tasks', 300, 0, 280, 200, 1, true) RETURNING id` as [{ id: number }]
  const [shopping] = await sql`INSERT INTO tiles (user_id, title, x, y, width, height, importance, visible)
    VALUES (${TEST_USER}, 'Shopping', 600, 0, 280, 200, 1, true) RETURNING id` as [{ id: number }]
  const [health] = await sql`INSERT INTO tiles (user_id, title, x, y, width, height, importance, visible)
    VALUES (${TEST_USER}, 'Health', 0, 300, 280, 200, 1, true) RETURNING id` as [{ id: number }]
  const [work] = await sql`INSERT INTO tiles (user_id, title, x, y, width, height, importance, visible)
    VALUES (${TEST_USER}, 'Work', 300, 300, 280, 200, 1, true) RETURNING id` as [{ id: number }]
  const [ideas] = await sql`INSERT INTO tiles (user_id, title, x, y, width, height, importance, visible)
    VALUES (${TEST_USER}, 'Ideas', 600, 300, 280, 200, 1, true) RETURNING id` as [{ id: number }]
  const [reading] = await sql`INSERT INTO tiles (user_id, title, x, y, width, height, importance, visible)
    VALUES (${TEST_USER}, 'Reading List', 0, 600, 280, 200, 1, true) RETURNING id` as [{ id: number }]
  const [finance] = await sql`INSERT INTO tiles (user_id, title, x, y, width, height, importance, visible)
    VALUES (${TEST_USER}, 'Finance', 300, 600, 280, 200, 1, true) RETURNING id` as [{ id: number }]

  const hId = homework.id
  const tId = tasks.id
  const sId = shopping.id
  const hlId = health.id
  const wId = work.id
  const iId = ideas.id
  const rId = reading.id
  const fId = finance.id

  // Homework — 5 thoughts
  await sql`INSERT INTO thoughts (user_id, tile_id, content, tags, sort_order) VALUES
    (${TEST_USER}, ${hId}, 'Physics', '{physics}', 0),
    (${TEST_USER}, ${hId}, 'Maths', '{}', 1),
    (${TEST_USER}, ${hId}, 'English essay', '{}', 2),
    (${TEST_USER}, ${hId}, 'Chemistry lab report', '{}', 3),
    (${TEST_USER}, ${hId}, 'History assignment', '{}', 4)`

  // Tasks — 15 thoughts
  await sql`INSERT INTO thoughts (user_id, tile_id, content, tags, sort_order) VALUES
    (${TEST_USER}, ${tId}, 'in2it website redesign', '{in2it,urgent}', 0),
    (${TEST_USER}, ${tId}, 'Call dentist', '{health}', 1),
    (${TEST_USER}, ${tId}, 'in2it fix login bug', '{in2it}', 2),
    (${TEST_USER}, ${tId}, 'Reply to landlord email', '{personal}', 3),
    (${TEST_USER}, ${tId}, 'Book flights for December', '{personal}', 4),
    (${TEST_USER}, ${tId}, 'in2it deploy to production', '{in2it,urgent}', 5),
    (${TEST_USER}, ${tId}, 'Renew car registration', '{personal}', 6),
    (${TEST_USER}, ${tId}, 'Submit tax return', '{urgent}', 7),
    (${TEST_USER}, ${tId}, 'in2it update API docs', '{in2it}', 8),
    (${TEST_USER}, ${tId}, 'Pick up dry cleaning', '{}', 9),
    (${TEST_USER}, ${tId}, 'Schedule eye test', '{health}', 10),
    (${TEST_USER}, ${tId}, 'Fix leaking tap', '{}', 11),
    (${TEST_USER}, ${tId}, 'in2it review pull requests', '{in2it}', 12),
    (${TEST_USER}, ${tId}, 'Organise garage', '{personal}', 13),
    (${TEST_USER}, ${tId}, 'Cancel gym membership', '{}', 14)`

  // Shopping — 10 thoughts (no bread/cheese/butter/yoghurt — tests add those)
  await sql`INSERT INTO thoughts (user_id, tile_id, content, tags, sort_order) VALUES
    (${TEST_USER}, ${sId}, 'Milk', '{}', 0),
    (${TEST_USER}, ${sId}, 'Eggs', '{}', 1),
    (${TEST_USER}, ${sId}, 'Chicken', '{}', 2),
    (${TEST_USER}, ${sId}, 'Olive oil', '{}', 3),
    (${TEST_USER}, ${sId}, 'Pasta', '{}', 4),
    (${TEST_USER}, ${sId}, 'Tomatoes', '{}', 5),
    (${TEST_USER}, ${sId}, 'Shampoo', '{}', 6),
    (${TEST_USER}, ${sId}, 'Toothpaste', '{}', 7),
    (${TEST_USER}, ${sId}, 'Coffee', '{}', 8),
    (${TEST_USER}, ${sId}, 'Orange juice', '{}', 9)`

  // Health — 8 thoughts
  await sql`INSERT INTO thoughts (user_id, tile_id, content, tags, sort_order) VALUES
    (${TEST_USER}, ${hlId}, 'Morning run', '{health}', 0),
    (${TEST_USER}, ${hlId}, '10k steps daily', '{health}', 1),
    (${TEST_USER}, ${hlId}, 'Drink 2L water', '{health}', 2),
    (${TEST_USER}, ${hlId}, 'Sleep by 10:30pm', '{health}', 3),
    (${TEST_USER}, ${hlId}, 'Stretch after workout', '{health}', 4),
    (${TEST_USER}, ${hlId}, 'Take vitamins', '{health}', 5),
    (${TEST_USER}, ${hlId}, 'Meal prep Sunday', '{health}', 6),
    (${TEST_USER}, ${hlId}, 'No sugar this week', '{health}', 7)`

  // Work — 6 thoughts
  await sql`INSERT INTO thoughts (user_id, tile_id, content, tags, sort_order) VALUES
    (${TEST_USER}, ${wId}, 'Q4 planning meeting', '{work,urgent}', 0),
    (${TEST_USER}, ${wId}, 'Performance review prep', '{work}', 1),
    (${TEST_USER}, ${wId}, 'Update project roadmap', '{work}', 2),
    (${TEST_USER}, ${wId}, 'Onboard new team member', '{work}', 3),
    (${TEST_USER}, ${wId}, 'Send weekly status report', '{work}', 4),
    (${TEST_USER}, ${wId}, 'Review budget proposal', '{work,urgent}', 5)`

  // Ideas — 2 thoughts
  await sql`INSERT INTO thoughts (user_id, tile_id, content, tags, sort_order) VALUES
    (${TEST_USER}, ${iId}, 'App for tracking habits', '{}', 0),
    (${TEST_USER}, ${iId}, 'Blog post about AI agents', '{}', 1)`

  // Reading List — 1 thought
  await sql`INSERT INTO thoughts (user_id, tile_id, content, tags, sort_order) VALUES
    (${TEST_USER}, ${rId}, 'Atomic Habits', '{}', 0)`

  // Finance — 2 thoughts
  await sql`INSERT INTO thoughts (user_id, tile_id, content, tags, sort_order) VALUES
    (${TEST_USER}, ${fId}, 'Review monthly budget', '{}', 0),
    (${TEST_USER}, ${fId}, 'Transfer to savings', '{}', 1)`

  return { homeworkId: hId, tasksId: tId, shoppingId: sId, healthId: hlId, workId: wId, ideasId: iId, readingId: rId, financeId: fId }
}

async function cleanup() {
  await sql`DELETE FROM history WHERE user_id = ${TEST_USER}`
  await sql`DELETE FROM thoughts WHERE user_id = ${TEST_USER}`
  await sql`DELETE FROM tiles WHERE user_id = ${TEST_USER}`
  await sql`DELETE FROM tags WHERE user_id = ${TEST_USER}`
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

type Row = Record<string, any>

async function getThoughts(tileId: number): Promise<Row[]> {
  return sql`SELECT * FROM thoughts WHERE user_id = ${TEST_USER} AND tile_id = ${tileId} AND deleted_at IS NULL ORDER BY sort_order`
}

async function getDeletedThoughts(): Promise<Row[]> {
  return sql`SELECT * FROM thoughts WHERE user_id = ${TEST_USER} AND deleted_at IS NOT NULL`
}

// ─── Test runner ─────────────────────────────────────────────────────────────

type Ids = Awaited<ReturnType<typeof seed>>
type RunResult = { passed: boolean; reason?: string; ms: number; input: number; output: number; tokens: number; iterations: number }
type TestResult = { name: string; runs: RunResult[] }
const results: Map<string, TestResult> = new Map()

const TESTS: Array<{ name: string; fn: (ids: Ids) => Promise<{ passed: boolean; reason?: string; stats: Awaited<ReturnType<typeof classifyAndStore>> }> }> = [
  { name: "Create simple — buy bread → Shopping", fn: testCreateSimple },
  { name: "Create compound — 3 items → Shopping", fn: testCreateCompound },
  { name: "Update existing — physics homework pages", fn: testUpdateExisting },
  { name: "Create with tags — in2it + urgent → Tasks", fn: testCreateWithTag },
  { name: "Delete — call dentist", fn: testDeleteThought },
  { name: "Move — morning run → Tasks", fn: testMoveThought },
  { name: "Edit with detail — maths pages", fn: testEditWithDetail },
  { name: "Create health-tagged — yoga → Health", fn: testCreateHealthTagged },
  { name: "Duplicate prevention — eggs already exists", fn: testDuplicatePrevention },
  { name: "Compound with tags — 2x in2it tasks", fn: testCompoundWithTags },
  { name: "Create in sparse tile — book → Reading List", fn: testCreateInReading },
  { name: "Create bill — electricity → Finance or Tasks", fn: testCreateInFinance },
  { name: "Move across tiles — tax return → Work", fn: testMoveFromTasksToWork },
]

// ─── Tests ───────────────────────────────────────────────────────────────────

async function testCreateSimple(ids: Ids) {
  const stats = await classifyAndStore("I need to buy bread", TEST_USER)
  const thoughts = await getThoughts(ids.shoppingId)
  const found = thoughts.find((t) => t.content.toLowerCase().includes("bread"))
  return { passed: !!found, reason: found ? undefined : "bread not found in Shopping tile", stats }
}

async function testCreateCompound(ids: Ids) {
  const stats = await classifyAndStore("I need to buy cheese, butter and yoghurt", TEST_USER)
  const thoughts = await getThoughts(ids.shoppingId)
  const cheese = thoughts.find((t) => t.content.toLowerCase().includes("cheese"))
  const butter = thoughts.find((t) => t.content.toLowerCase().includes("butter"))
  const yoghurt = thoughts.find((t) => t.content.toLowerCase().includes("yoghurt"))
  const passed = !!cheese && !!butter && !!yoghurt
  return { passed, reason: passed ? undefined : `missing:${!cheese ? " cheese" : ""}${!butter ? " butter" : ""}${!yoghurt ? " yoghurt" : ""}`, stats }
}

async function testUpdateExisting(ids: Ids) {
  const stats = await classifyAndStore("My physics homework is questions 1 to 20", TEST_USER)
  const thoughts = await getThoughts(ids.homeworkId)
  const updated = thoughts.find((t) => t.content.toLowerCase().includes("physics") && (t.content.includes("1") || t.content.includes("20")))
  return { passed: !!updated, reason: updated ? undefined : `physics not updated with question numbers, thoughts: ${JSON.stringify(thoughts.map((t: Row) => t.content))}`, stats }
}

async function testCreateWithTag(ids: Ids) {
  const stats = await classifyAndStore("I urgently need to fix the in2it login page", TEST_USER)
  const thoughts = await getThoughts(ids.tasksId)
  const found = thoughts.find((t) => t.content.toLowerCase().includes("login") || t.content.toLowerCase().includes("in2it"))
  const hasTag = found && (found.tags.includes("in2it") || found.tags.includes("urgent"))
  return { passed: !!hasTag, reason: hasTag ? undefined : `thought not found or missing tags, got: ${JSON.stringify(found)}`, stats }
}

async function testDeleteThought(ids: Ids) {
  const stats = await classifyAndStore("Delete the call dentist task", TEST_USER)
  const deleted = await getDeletedThoughts()
  const found = deleted.find((t) => t.content.toLowerCase().includes("dentist"))
  return { passed: !!found, reason: found ? undefined : "dentist thought not deleted", stats }
}

async function testMoveThought(ids: Ids) {
  const stats = await classifyAndStore("Move the morning run to Tasks", TEST_USER)
  const taskThoughts = await getThoughts(ids.tasksId)
  const healthThoughts = await getThoughts(ids.healthId)
  const movedToTasks = taskThoughts.find((t) => t.content.toLowerCase().includes("run"))
  const goneFromHealth = !healthThoughts.find((t) => t.content.toLowerCase().includes("run"))
  const passed = !!movedToTasks && goneFromHealth
  return { passed, reason: passed ? undefined : `run ${!movedToTasks ? "not in Tasks" : "still in Health"}`, stats }
}

async function testEditWithDetail(ids: Ids) {
  const stats = await classifyAndStore("My maths homework is pages 45 to 60", TEST_USER)
  const thoughts = await getThoughts(ids.homeworkId)
  const updated = thoughts.find((t) => t.content.toLowerCase().includes("maths") && (t.content.includes("45") || t.content.includes("60")))
  return { passed: !!updated, reason: updated ? undefined : `maths not updated with page numbers, thoughts: ${JSON.stringify(thoughts.map((t: Row) => t.content))}`, stats }
}

async function testCreateHealthTagged(ids: Ids) {
  const stats = await classifyAndStore("I should start doing yoga every morning", TEST_USER)
  const thoughts = await getThoughts(ids.healthId)
  const found = thoughts.find((t) => t.content.toLowerCase().includes("yoga"))
  return { passed: !!found, reason: found ? undefined : "yoga not found in Health tile", stats }
}

async function testDuplicatePrevention(ids: Ids) {
  const stats = await classifyAndStore("Add eggs to my shopping list", TEST_USER)
  const thoughts = await getThoughts(ids.shoppingId)
  const eggs = thoughts.filter((t) => t.content.toLowerCase().includes("egg"))
  return { passed: eggs.length <= 1, reason: eggs.length > 1 ? `duplicate eggs created (${eggs.length} found)` : undefined, stats }
}

async function testCompoundWithTags(ids: Ids) {
  const stats = await classifyAndStore("I urgently need to finish the in2it dashboard and fix the in2it API", TEST_USER)
  const thoughts = await getThoughts(ids.tasksId)
  const dashboard = thoughts.find((t) => t.content.toLowerCase().includes("dashboard"))
  const api = thoughts.find((t) => t.content.toLowerCase().includes("api"))
  const passed = !!dashboard && !!api
  return { passed, reason: passed ? undefined : `missing:${!dashboard ? " dashboard" : ""}${!api ? " api" : ""}`, stats }
}

async function testCreateInReading(ids: Ids) {
  const stats = await classifyAndStore("I want to read The Pragmatic Programmer", TEST_USER)
  const thoughts = await getThoughts(ids.readingId)
  const found = thoughts.find((t) => t.content.toLowerCase().includes("pragmatic") || t.content.toLowerCase().includes("programmer"))
  return { passed: !!found, reason: found ? undefined : "book not found in Reading List tile", stats }
}

async function testCreateInFinance(ids: Ids) {
  const stats = await classifyAndStore("I need to pay my electricity bill", TEST_USER)
  const financeThoughts = await getThoughts(ids.financeId)
  const taskThoughts = await getThoughts(ids.tasksId)
  const found = [...financeThoughts, ...taskThoughts].find((t) => t.content.toLowerCase().includes("electric") || t.content.toLowerCase().includes("bill"))
  return { passed: !!found, reason: found ? undefined : "electricity bill not found in Finance or Tasks tile", stats }
}

async function testMoveFromTasksToWork(ids: Ids) {
  const stats = await classifyAndStore("Move the submit tax return task to Work", TEST_USER)
  const workThoughts = await getThoughts(ids.workId)
  const taskThoughts = await getThoughts(ids.tasksId)
  const movedToWork = workThoughts.find((t) => t.content.toLowerCase().includes("tax"))
  const goneFromTasks = !taskThoughts.find((t) => t.content.toLowerCase().includes("tax"))
  const passed = !!movedToWork && goneFromTasks
  return { passed, reason: passed ? undefined : `tax return ${!movedToWork ? "not in Work" : "still in Tasks"}`, stats }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const ROUNDS = 5

console.log("🧹 Cleaning up any leftover benchmark data...")
await cleanup()

for (let round = 1; round <= ROUNDS; round++) {
  console.log(`\n🔄 Round ${round}/${ROUNDS} — seeding...`)
  const ids = await seed()
  console.log(`✅ Seeded`)

  for (const test of TESTS) {
    if (!results.has(test.name)) results.set(test.name, { name: test.name, runs: [] })
    const testResult = results.get(test.name)!
    console.log(`\n🧪 [R${round}] ${test.name}`)
    const start = Date.now()
    try {
      const { passed, reason, stats } = await test.fn(ids)
      const ms = Date.now() - start
      testResult.runs.push({ passed, reason, ms, input: stats.totalInput, output: stats.totalOutput, tokens: stats.totalTokens, iterations: stats.iterations })
      console.log(`  ${passed ? "✅" : `❌ ${reason}`} — ${stats.totalTokens} tokens, ${stats.iterations} iter, ${ms}ms`)
    } catch (e) {
      const ms = Date.now() - start
      const reason = e instanceof Error ? e.message : String(e)
      testResult.runs.push({ passed: false, reason, ms, input: 0, output: 0, tokens: 0, iterations: 0 })
      console.log(`  💥 ${reason} (${ms}ms)`)
    }
  }

  console.log(`\n🧹 Cleaning up after round ${round}...`)
  await cleanup()
}

const allResults = [...results.values()]
const totalRuns = allResults.reduce((s, r) => s + r.runs.length, 0)
const totalPassed = allResults.reduce((s, r) => s + r.runs.filter((x) => x.passed).length, 0)
const totalMs = allResults.reduce((s, r) => s + r.runs.reduce((a, x) => a + x.ms, 0), 0)
const totalTokens = allResults.reduce((s, r) => s + r.runs.reduce((a, x) => a + x.tokens, 0), 0)
console.log(`\n📊 Benchmark summary: ${totalPassed}/${totalRuns} passed (${((totalPassed / totalRuns) * 100).toFixed(0)}%), ${(totalMs / 1000).toFixed(1)}s total, ${totalTokens} total tokens`)

// CSV output
const csvLines = [
  "Test,Run 1,Run 2,Run 3,Run 4,Run 5,Success Rate,Avg Input Tokens,Avg Output Tokens,Avg Total Tokens,Total Input Tokens,Total Output Tokens,Total Tokens,Avg Iterations,Avg Time (ms)"
]
for (const t of allResults) {
  const passStr = t.runs.map((r) => r.passed ? "PASS" : "FAIL").join(",")
  const successRate = `${((t.runs.filter((r) => r.passed).length / t.runs.length) * 100).toFixed(0)}%`
  const avgInput = (t.runs.reduce((s, r) => s + r.input, 0) / t.runs.length).toFixed(0)
  const avgOutput = (t.runs.reduce((s, r) => s + r.output, 0) / t.runs.length).toFixed(0)
  const avgTokens = (t.runs.reduce((s, r) => s + r.tokens, 0) / t.runs.length).toFixed(0)
  const totalInput = t.runs.reduce((s, r) => s + r.input, 0)
  const totalOutput = t.runs.reduce((s, r) => s + r.output, 0)
  const totalTok = t.runs.reduce((s, r) => s + r.tokens, 0)
  const avgIter = (t.runs.reduce((s, r) => s + r.iterations, 0) / t.runs.length).toFixed(1)
  const avgMs = (t.runs.reduce((s, r) => s + r.ms, 0) / t.runs.length).toFixed(0)
  csvLines.push(`"${t.name}",${passStr},${successRate},${avgInput},${avgOutput},${avgTokens},${totalInput},${totalOutput},${totalTok},${avgIter},${avgMs}`)
}
const allRuns = allResults.flatMap((r) => r.runs)
const overallRate = `${((totalPassed / totalRuns) * 100).toFixed(0)}%`
const avgInput = (allRuns.reduce((s, r) => s + r.input, 0) / allRuns.length).toFixed(0)
const avgOutput = (allRuns.reduce((s, r) => s + r.output, 0) / allRuns.length).toFixed(0)
const avgTokens = (allRuns.reduce((s, r) => s + r.tokens, 0) / allRuns.length).toFixed(0)
const grandTotalInput = allRuns.reduce((s, r) => s + r.input, 0)
const grandTotalOutput = allRuns.reduce((s, r) => s + r.output, 0)
const grandTotalTokens = allRuns.reduce((s, r) => s + r.tokens, 0)
const avgIter = (allRuns.reduce((s, r) => s + r.iterations, 0) / allRuns.length).toFixed(1)
const avgMs = (allRuns.reduce((s, r) => s + r.ms, 0) / allRuns.length).toFixed(0)
csvLines.push(`"OVERALL",,,,,,${overallRate},${avgInput},${avgOutput},${avgTokens},${grandTotalInput},${grandTotalOutput},${grandTotalTokens},${avgIter},${avgMs}`)

const csvPath = `backend/test/results-${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.csv`
await Bun.write(csvPath, csvLines.join("\n"))
console.log(`\n📄 CSV saved to ${csvPath}`)

process.exit(totalPassed < totalRuns ? 1 : 0)
