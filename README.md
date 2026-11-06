# Mind (Hosted)
This is the hosted version of [Mind](https://github.com/Jesse-Dur/mind) — a cloud-deployed, multi-user edition with authentication and a managed database. Everything is still open-source.

If you want to run Mind fully locally on your own machine with no accounts or cloud services, use the [local version](https://github.com/Jesse-Dur/mind) instead.

---

## A bit about why i made this
Does a random idea, something you need to do later, or just an interesting thought ever pop into your mind and you have to scramble to write it down else you risk forgetting?
Well, this happens (or should i say *happened*) to me. Every day.
I used to write it down on notepad (back in my microslop windows days), or write it in Goodnotes on my iPad, on a piece of paper, or set a reminder on my phone. But no matter what i did, i found there was no one place I could centralise all of these thoughts, so I made one.

Lying in bed, I began to imagine a blank slate, where i could create tiles and put my 'thoughts', so made it (with the help of AI, of course). I never intended to make this public, but many people have been very interested, so I thought i'd open-source it, the logical solution! But this does mean it's largely vibecoded slop, so feel free to contribute, or to put your time towards a better cause (or touch grass).

Privacy is important to me. Thought processing and voice transcription run through OpenRouter and its downstream providers. Text processing sends your input and relevant tile, tag, and thought context; transcription sends your audio.

Both requests require Zero Data Retention (ZDR) routing and deny provider data collection. The OpenRouter workspace or key must also enforce ZDR only with Safety Retention excluded; the request flag follows those settings. OpenRouter defines ZDR as no routine storage after processing, with a legal/CSAM retention exception ([policy](https://openrouter.ai/docs/guides/features/zdr)).

Your saved thoughts and AI input/action History remain in the account-scoped managed Postgres database, and offline data remains in your browser. Recordings are forwarded for transcription without being saved by the backend; AI diagnostic logs exclude audio, transcripts, and note content.

You're welcome to open issues, fork the project, make it commercial, heck i dont care. All i ask is you be a good person & those are the terms you agree to by interacting with this project.

---

## Features

- **Freeform canvas** — drag to draw tiles anywhere on a canvas that scales to your screen
- **Thoughts** — dot-point notes inside tiles, draggable to reorder or move between tiles
- **Tags** — colour-coded tags with an expanding pill UI, searchable via Spotlight
- **Spotlight** (`Cmd+K`) — fuzzy search across tiles, thoughts, and tags. Workspace and Past results stay current while search is open. Type `#tag` to filter by tag, `>` to send to AI, or `t` to create a new tile
- **AI processing** — type a thought in natural language, the AI classifies it, splits compound inputs, applies tags, and files it in the right tile. Can also update, delete, and move existing thoughts
- **History** — local and synced actions share the same badges. Older local entries load as you scroll; every entry is retained, and unresolved sync issues stay available. Expand appears only for additional information, such as before/after values, positions, tags, full text, or AI input and actions.
- **Sidebar** — Tags, History, and Settings panels
- **Auth** — secure accounts via Clerk, your data is scoped to you
- **Offline sync** — canvases, tiles, thoughts, and tags are cached locally and local edits are queued when the connection is unreliable
- **Installable mobile workspace** — the PWA has a phone/tablet split view, canvas overview, direct touch gestures, and cross-canvas thought and tile dragging without an app store
- **Mobile thought entry** — tap blank space in the focused tile's thought list to focus the add-thought input.
- **Mobile canvas tabs** — swipe across tabs to scroll. Hold briefly, then move to reorder; hold and release to open tab actions. Tap to switch canvases or double-tap to rename.
- **Sync transitions** — on desktop and mobile, removed thoughts fade out before the remaining rows slide into place. Incoming thoughts fade in, and mobile overview previews follow the same movement. Canvas tabs also fade and slide when synced additions, removals, reordering, or renames change the tab strip. Reduced-motion preferences are respected.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Bun |
| Backend | Hono (VPS, managed by PM2 behind Nginx) |
| Database | Neon (Postgres) |
| Frontend | React + TypeScript + Vite (hosted on Vercel) |
| State | Zustand |
| Offline storage | IndexedDB via Dexie |
| AI | OpenRouter (`z-ai/glm-5.3-flash`) |
| Transcription | OpenRouter (`elevenlabs/scribe-v2`) |
| Auth | Clerk |

---

## Offline sync model

Mind uses a local-first sync engine for app data. Zustand is still the fast in-memory UI store, while IndexedDB stores durable cached entities and a mutation outbox. Dexie is the small wrapper used to keep the IndexedDB code transactional and readable.

The sync implementation is split by responsibility: frontend enqueue/flush/pull/runtime modules live under `frontend/src/sync`, while backend apply/upsert/delete/events/snapshot/pull modules live under `backend/db/sync`. The public facades remain `frontend/src/sync/engine.ts` and `backend/db/sync.ts`.

The sync engine prioritises the active canvas:

- On boot, cached canvases, tiles, thoughts, and tags can render before network requests finish.
- Server refreshes use `GET /api/sync/snapshot`, scoped to the active canvas where possible, so current-state repair does not need the old entity CRUD routes.
- After default-canvas initialization, snapshots capture their revision before reading canvases and other entity data. Changes made during those reads remain eligible for the next pull, including changes already visible in the snapshot.
- The active canvas is pulled and reconciled before inactive canvases.
- Background canvas hydration is sequential and stops when the active canvas changes, so the newly selected tab gets priority.
- Local creates, edits, moves, resizes, reorders, and deletes are written to the outbox and flushed later if the connection drops.
- IndexedDB is partitioned by Clerk user. Existing unpartitioned data is claimed once by the signed-in account, and signed-out account caches cannot be opened by another account. Account switches pause sync before changing authentication and resume after the matching local database is ready.
- Workspace startup failures retry automatically with increasing delays capped at 15 seconds. The loading screen stays visible; if the first retry also fails, it shows “Loading failed, automatically retrying” beneath the icon.
- Small entity spinners show queued local saves and fade after acknowledgement; soft red attention markers flag failures, while an outlined orange dot identifies intentionally device-only changes. The durable status history and resolution actions are available in History.
- History starts loading its next pages when about 25 displayed events remain below the viewport, with a spinner at the bottom while more events are loading on desktop and mobile.
- Temporary failures to obtain an authentication token pause uploads without blocking later attempts. Reconnecting rechecks authentication, so queued changes can resume without a manual retry.
- Pending uploads, including temporary network failures, appear as “Syncing” without error text. Reconnecting bypasses their retry delay; rejected and intentionally device-only changes still require their existing resolution actions.
- Desktop and mobile publish a sync cycle's accepted changes together. Existing tiles move and resize to their final geometry over 250 ms; content changes, additions, and deletions appear immediately without purple flashes. Reduced-motion preferences disable the geometry animation.
- Local moves stay immediate while syncing. Assigning a newly created tile or thought its server ID preserves newer local edits. Mobile tile drags, resizes, and Undo continue through that ID change without showing a second tile or resetting the position.
- Creates use `client_id` idempotency keys so a retried request cannot create duplicates after packet loss.
- Creation acknowledgements normalize server IDs before linking queued children. Retry now also normalizes parent IDs saved as text by older clients, preserving failed thought creations and moves.
- Normal writes use `POST /api/sync/push`; incremental multi-device updates use `GET /api/sync/pull`.
- Tag renames and deletions lock the current tag row before reading its name. Server-ID and client-ID updates share that lock; thought-label propagation and History commit in the same transaction.

The multi-device model is sequential rather than realtime collaborative editing. A device pushes revisioned changes to the server, and another device pulls those revisions later. For v1, conflict handling is intentionally simple: pending local changes are preserved over stale server lists, and same-field conflicts resolve by the latest accepted server operation.

Sync event publication uses a short transaction with a per-user advisory lock across backend instances. Each publisher acquires the lock before allocating a revision and holds it through commit, so a pull cannot advance past an event that later commits with a lower revision for that user. Different users can publish concurrently. Revision gaps from rollbacks are allowed; the `sync_events` sequence must retain its default `CACHE 1` setting. Entity mutations and event publication still commit separately.

When upgrading an existing installation to serialized publication, stop and drain the old backend writers before starting the updated backend. Clients that already missed events need fresh snapshots for their cached canvases; snapshot reconciliation preserves pending local work and the outbox.

AI processing and voice transcription require network access to OpenRouter. AI writes are restricted to thoughts and go through the same backend sync mutation path internally, so AI-created, updated, deleted, and moved thoughts emit `sync_events` and are picked up by normal pull flows.

The public app data API is intentionally narrow:

- `POST /api/sync/push` for browser outbox writes.
- `GET /api/sync/pull` for revisioned incremental updates.
- `GET /api/sync/snapshot` for boot, tab switches, background canvas hydration, and cache repair.
- Feature-specific routes remain for AI, voice transcription, history, and background refresh of Spotlight's local Past cache.
- `GET/PUT /api/preferences/device` stores per-installation layout preferences and supplies the newest same-class phone, tablet, or desktop profile to a new device.

---

## Dependency updates

Dependabot follows the SMILES website update schedule: backend, frontend, and runtime Bun packages are checked daily at 06:00 Australia/Adelaide, and GitHub Actions at 06:20. `runtime/package.json` and its lockfile pin the Bun executable and PM2, using the official npm packages. Runtime updates stay separate from application updates. Routine application patches wait two days after release and are grouped; runtime patches are individual PRs. Minors and majors wait four days and remain separate. GitHub Actions updates wait four days. Security updates have no cooldown and are not grouped by this configuration.

The CI workflow installs all three lockfiles, runs the dependency-policy and runtime recovery tests and application suite, checks types, and builds the frontend. It uses the proposed Bun and PM2 versions from `runtime/package.json`, Node 22 for PM2, and a disposable PostgreSQL service with external billing disabled. A runtime smoke test starts and resurrects a temporary Bun process under the proposed PM2 using an isolated process-manager directory. CI and the Kody approval status are advisory: this configuration does not require branch-protection checks or prevent manual merges.

Dependency automation merges patches, minors, and verified security fixes only after the **Test suite** check passes and **kody-ai[bot]** approves the exact current commit. Normal major upgrades also need Jesse-Dur's approval of that commit; GitHub Actions changes remain manual. Missing, failed, or outdated checks and reviews keep an update open. The policy rechecks the revision and review before merging and assigns updates needing attention to Jesse-Dur. Human-authored PRs receive a Kody approval indicator but are not automatically merged.

The repository variable `DEPENDENCY_AUTO_MERGE_PAUSED=true` suspends automatic merges while leaving update PRs, CI, reviews, and manual merges available. `PRODUCTION_DEPLOYMENT_PAUSED=true` suspends the deployment job. These switches are independent and take effect on new workflow runs.

The hosted Kody app must have access to the repository. `kodus-config.yml` enables automatic reviews, approvals, and requests for changes, including dependency manifests and lockfiles. Dependabot alerts and security updates must be enabled in the repository security settings. The optional Actions secret `DEPENDABOT_ALERTS_TOKEN` grants only Dependabot-alert and pull-request read access; without it, unverified major security fixes follow the normal manual-major policy.

Manual merges into `main` use the deployment workflow. Dependency-policy merges explicitly dispatch that same workflow because merges made with `GITHUB_TOKEN` do not trigger push workflows. Dispatch retries up to three times; if none is confirmed, the workflow fails and attempts to assign the merged PR and post deployment recovery instructions. Deployments run one at a time and check out the workflow's exact commit; an outdated run cannot overwrite a newer deployed commit.

On the VPS, `.github/scripts/deploy-runtime.mjs` installs locked runtime releases under `~/.local/share/mind-runtime/releases`. It bootstraps the exact proposed Bun version through npm so an older installed Bun does not need to parse a newer lockfile format. It verifies both installed versions and installs the locked backend dependencies before switching the runtime. The deployment account needs Node, npm, an existing `pm2-opc` startup service, and passwordless sudo for its systemd override and restart. The saved PM2 process list must contain only `mind-backend`, using `~/.bun/bin/bun`, as in the existing VPS setup.

The deployer saves the process list, atomically switches the Bun executable, and installs a systemd override that uses the managed PM2 on reboot. After restarting the process manager, it checks that the unauthenticated local sync endpoint returns its expected 401. If activation or health checks fail, it restores the previous runtime and service override and restarts the prior manager; the workflow reports failure even when recovery succeeds. This recovery does not revert application source or backend dependencies. The current and previous runtime releases are retained; older releases are removed after a successful deployment. The original global PM2 is retained as a bootstrap tool, while the service uses the repository-managed installation.

OS packages and Node are maintained through the VPS package manager. TLS renewal uses Certbot independently of dependency updates.

---

## Production certificate renewal

The VPS uses Certbot's Route 53 DNS challenge to renew `api.mind.durik.com.au`; port 80 is not required. The enabled `certbot-renew.timer` runs the renewal service on a randomized schedule. After a successful renewal, `/etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh` validates the Nginx configuration and gracefully reloads Nginx to serve the new certificate. The backend process does not need to restart.

---

## Self-hosting

### Prerequisites

- **[Bun](https://bun.sh)** — use the version pinned in `runtime/package.json`
- Node 22 and npm for PM2 and runtime tests
- A [Neon](https://neon.tech) Postgres database
- An [OpenRouter](https://openrouter.ai/settings/keys) API key from a workspace configured for strict ZDR
- A [Clerk](https://clerk.com) application

### Setup

```bash
# Install dependencies
bun install
bun install --cwd runtime --frozen-lockfile
cd frontend && bun install && cd ..
```

### Configuration

| Environment variable | Description |
|---|---|
| `DATABASE_URL` | Neon Postgres connection string |
| `OPENROUTER_API_KEY` | Server-only OpenRouter API key |
| `OPENROUTER_AI_MODEL` | Optional; defaults to `z-ai/glm-5.3-flash` |
| `OPENROUTER_TRANSCRIPTION_MODEL` | Optional; defaults to `elevenlabs/scribe-v2` |
| `CLERK_SECRET_KEY` | Clerk secret key |
| `CLERK_PUBLISHABLE_KEY` | Clerk publishable key (backend) |
| `VITE_CLERK_PUBLISHABLE_KEY` | Clerk publishable key (frontend) |

In OpenRouter, enforce ZDR for all model groups, select **ZDR only** for both Google and other models (exclude Safety Retention), and keep prompt/completion logging and training opt-ins disabled. Apply these settings to the workspace/key used by the backend before sending user data. Requests fail when no eligible provider is available; retries do not relax privacy settings. Never put the API key in frontend variables.

The browser preserves its recorded audio format, including WebM and MP4/M4A. Uploads are limited to 25 MB, with request sizes capped before parsing. Scribe v2 detects the language automatically and serves the existing `/api/whisper/transcribe` URL.

Run `bun run test:ai-integration` for mocked provider, tool-mutation, and recording-format regression checks. The existing `bun run bench:ai-prompts` command makes live model calls and writes benchmark fixtures; use an isolated test database.

### Running

```bash
bun run dev
```

This starts both servers concurrently:
- **Backend** — `http://localhost:3000` (Hono + Postgres)
- **Frontend** — `http://localhost:5173` (Vite + React)

Open `http://localhost:5173` in your browser.

The development service worker prefers network responses while online so reloads use current Vite modules, with cached files as an offline fallback. Production uses separate build-specific caches.

---

## Credits
- The icon of the project & svg is from [freesvg.org](https://freesvg.org/colorful-brain)
- Built with [Amazon Q Developer](https://aws.amazon.com/q/developer/) then Codex. (and my brain too!)

Peace.

### Billing Config
Autumn is the source of truth for tiers, daily limits, paid plans, PAYG, and user-specific overrides.

#### Environment
- `AUTUMN_SECRET_KEY`: Autumn secret key.
- `AUTUMN_FREE_PLAN_ID`: optional free plan to auto-enable when a customer is first created.
- `AUTUMN_API_BASE`: optional, defaults to `https://api.useautumn.com`.
- `AUTUMN_FAIL_OPEN`: defaults to fail-open. Set to `false` to fail closed when Autumn is unavailable.
- `AUTUMN_DISABLED`: set to `true` in automated tests so test users are not created in Autumn.

#### Usage model
- AI processing is consumed atomically with Autumn `balances.check` and `send_event`.
- Transcription is consumed as `transcription_seconds`; current server-side duration is estimated from uploaded audio size.
- Storage is tracked locally with an explicit byte estimate, not measured row or file size, and lazily synced to Autumn as rounded-up megabytes (`1 unit = 1 MB`).
- PostgreSQL is authoritative for active canvas, tile, and thought counts; Autumn is authoritative for plans and limits.
- Resource counts are reconciled to Autumn as absolute values after count-changing mutations and whenever billing usage is loaded. Ordinary edits do not trigger reconciliation.
- At a resource limit, only new creation of that resource is blocked. Above any resource limit, all non-delete operations are frozen until cleanup brings the account back to the limit.
- Billing access checks may fail open on network or Autumn 5xx failures when configured, but provider 4xx responses and plan mutations never report false success.
- Soft-deleted tiles and thoughts do not count.
- Hourly limits are intentionally not implemented here; model daily/monthly/PAYG limits in Autumn.
- Autumn `past_due` subscriptions are treated as active access here while payment retry is in progress. If you want access blocked during `past_due`, enable that policy in Autumn first.

#### Usage endpoint
`GET /api/billing/usage` returns local active counts, local estimated storage usage, and Autumn allowance metadata. Loading it reconciles active resource counts and the current estimated storage MB to Autumn.

#### Testing
Automated tests must not call the real Autumn API. The backend test script sets `AUTUMN_DISABLED=true`, so billing checks fail open and storage usage remains local. Test Autumn itself only in an explicit integration test suite against a sandbox account with cleanup.
