# Mind (Hosted)
This is the hosted version of [Mind](https://github.com/jdurik/mind) — a cloud-deployed, multi-user edition with authentication and a managed database. Everything is still open-source.

If you want to run Mind fully locally on your own machine with no accounts or cloud services, use the [local version](https://github.com/jdurik/mind) instead.

---

## A bit about why i made this
Does a random idea, something you need to do later, or just an interesting thought ever pop into your mind and you have to scramble to write it down else you risk forgetting?
Well, this happens (or should i say *happened*) to me. Every day.
I used to write it down on notepad (back in my microslop windows days), or write it in Goodnotes on my iPad, on a piece of paper, or set a reminder on my phone. But no matter what i did, i found there was no one place I could centralise all of these thoughts, so I made one.

Lying in bed, I began to imagine a blank slate, where i could create tiles and put my 'thoughts', so made it (with the help of AI, of course). I never intended to make this public, but many people have been very interested, so I thought i'd open-source it, the logical solution! But this does mean it's largely vibecoded slop, so feel free to contribute, or to put your time towards a better cause (or touch grass).

Privacy is important to me. AI processing is handled by Groq, who do not retain your prompts or completions. Your thoughts are stored in a managed Postgres database scoped strictly to your account.

You're welcome to open issues, fork the project, make it commercial, heck i dont care. All i ask is you be a good person & that's the terms you agree to by interacting with this project.

---

## Features

- **Freeform canvas** — drag to draw tiles anywhere on a canvas that scales to your screen
- **Thoughts** — dot-point notes inside tiles, draggable to reorder or move between tiles
- **Tags** — colour-coded tags with an expanding pill UI, searchable via Spotlight
- **Spotlight** (`Cmd+K`) — fuzzy search across tiles, thoughts, and tags. Type `#tag` to filter by tag, `>` to send to AI, or `t` to create a new tile
- **AI processing** — type a thought in natural language, the AI classifies it, splits compound inputs, applies tags, and files it in the right tile. Can also update, delete, and move existing thoughts
- **History** — full audit log of every action with expand view showing what you said and the actions the LLM took based on that
- **Sidebar** — Tags, History, and Settings panels
- **Auth** — secure accounts via Clerk, your data is scoped to you
- **Offline sync** — canvases, tiles, thoughts, and tags are cached locally and local edits are queued when the connection is unreliable

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Bun |
| Backend | Hono (hosted on Render) |
| Database | Neon (Postgres) |
| Frontend | React + TypeScript + Vite (hosted on Vercel) |
| State | Zustand |
| Offline storage | IndexedDB via Dexie |
| AI | Groq (`llama-3.1-8b-instant`) |
| Auth | Clerk |

---

## Offline sync model

Mind uses a local-first sync engine for app data. Zustand is still the fast in-memory UI store, while IndexedDB stores durable cached entities and a mutation outbox. Dexie is the small wrapper used to keep the IndexedDB code transactional and readable.

The sync implementation is split by responsibility: frontend enqueue/flush/pull/runtime modules live under `frontend/src/sync`, while backend apply/upsert/delete/events/snapshot/pull modules live under `backend/db/sync`. The public facades remain `frontend/src/sync/engine.ts` and `backend/db/sync.ts`.

The sync engine prioritises the active canvas:

- On boot, cached canvases, tiles, thoughts, and tags can render before network requests finish.
- Server refreshes use `GET /api/sync/snapshot`, scoped to the active canvas where possible, so current-state repair does not need the old entity CRUD routes.
- The active canvas is pulled and reconciled before inactive canvases.
- Background canvas hydration is sequential and stops when the active canvas changes, so the newly selected tab gets priority.
- Local creates, edits, moves, resizes, reorders, and deletes are written to the outbox and flushed later if the connection drops.
- Remote tile and thought upserts animate only when a pull or snapshot changes this device's cached payload; local optimistic writes stay immediate.
- Creates use `client_id` idempotency keys so a retried request cannot create duplicates after packet loss.
- Normal writes use `POST /api/sync/push`; incremental multi-device updates use `GET /api/sync/pull`.

The multi-device model is sequential rather than realtime collaborative editing. A device pushes revisioned changes to the server, and another device pulls those revisions later. For v1, conflict handling is intentionally simple: pending local changes are preserved over stale server lists, and same-field conflicts resolve by the latest accepted server operation.

AI processing still requires network access to Groq. AI writes are restricted to thoughts and go through the same backend sync mutation path internally, so AI-created, updated, deleted, and moved thoughts emit `sync_events` and are picked up by normal pull flows.

The public app data API is intentionally narrow:

- `POST /api/sync/push` for browser outbox writes.
- `GET /api/sync/pull` for revisioned incremental updates.
- `GET /api/sync/snapshot` for boot, tab switches, background canvas hydration, and cache repair.
- Feature-specific routes remain for AI, voice transcription, history, and Spotlight's past-item views.

---

## Self-hosting

### Prerequisites

- **[Bun](https://bun.sh)** — runtime and package manager
- A [Neon](https://neon.tech) Postgres database
- A [Groq](https://console.groq.com) API key
- A [Clerk](https://clerk.com) application

### Setup

```bash
# Install dependencies
bun install
cd frontend && bun install && cd ..
```

### Configuration

| Environment variable | Description |
|---|---|
| `DATABASE_URL` | Neon Postgres connection string |
| `GROQ_API_KEY` | Groq API key |
| `CLERK_SECRET_KEY` | Clerk secret key |
| `CLERK_PUBLISHABLE_KEY` | Clerk publishable key (backend) |
| `VITE_CLERK_PUBLISHABLE_KEY` | Clerk publishable key (frontend) |

### Running

```bash
bun run dev
```

This starts both servers concurrently:
- **Backend** — `http://localhost:3000` (Hono + Postgres)
- **Frontend** — `http://localhost:5173` (Vite + React)

Open `http://localhost:5173` in your browser.

---

## Credits
- The icon of the project & svg is from [freesvg.org](https://freesvg.org/colorful-brain)
- Built with [Amazon Q Developer](https://aws.amazon.com/q/developer/)

Peace.
