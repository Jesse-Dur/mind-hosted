import { Hono } from "hono"
import { cors } from "hono/cors"
import { clerkMiddleware } from "@clerk/hono"
import { tilesRoute } from "./routes/tiles"
import { thoughtsRoute } from "./routes/thoughts"
import { aiRoute } from "./routes/ai"
import { historyRoute } from "./routes/history"
import { transcriptionRoute } from "./routes/transcription"
import { syncRoute } from "./routes/sync"
import { billingRoute } from "./routes/billing"
import { preferencesRoute } from "./routes/preferences"
import "./db/client"

const app = new Hono()

app.use("*", cors({ origin: process.env.FRONTEND_URL ?? "http://localhost:5173" }))
app.use("*", clerkMiddleware())

app.route("/api/tiles", tilesRoute)
app.route("/api/thoughts", thoughtsRoute)
app.route("/api/ai", aiRoute)
app.route("/api/history", historyRoute)
app.route("/api/whisper", transcriptionRoute)
app.route("/api/sync", syncRoute)
app.route("/api/billing", billingRoute)
app.route("/api/preferences", preferencesRoute)

export default { port: 3000, fetch: app.fetch }
