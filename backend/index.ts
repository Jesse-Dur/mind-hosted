import { Hono } from "hono"
import { cors } from "hono/cors"
import { clerkMiddleware } from "@clerk/hono"
import { tilesRoute } from "./routes/tiles"
import { thoughtsRoute } from "./routes/thoughts"
import { groqRoute } from "./routes/groq"
import { historyRoute } from "./routes/history"
import { whisperRoute } from "./routes/whisper"
import { syncRoute } from "./routes/sync"
import "./db/client"

const app = new Hono()

app.use("*", cors({ origin: process.env.FRONTEND_URL ?? "http://localhost:5173" }))
app.use("*", clerkMiddleware())

app.route("/api/tiles", tilesRoute)
app.route("/api/thoughts", thoughtsRoute)
app.route("/api/ai", groqRoute)
app.route("/api/history", historyRoute)
app.route("/api/whisper", whisperRoute)
app.route("/api/sync", syncRoute)

export default { port: 3000, fetch: app.fetch }
