# Regression Test Plan

The AI prompt harness is intentionally separate from the regression suite. It is
used to compare prompt quality, token use, iterations, and latency across prompt
changes; it is not the pass/fail gate for application behavior.

## Manual Commands

- `bun run test`: run the current manual regression suite and type/build checks.
- `bun run test:backend`: run snapshot revision tests, then backend sync database integration tests in a separate process to isolate the mocked database client.
- `bun run test:frontend-sync`: run frontend offline sync tests.
- `bun run test:store`: run frontend optimistic store tests.
- `bun run typecheck`: run backend TypeScript checking and the frontend production build.
- `bun run bench:ai-prompts`: run the AI prompt benchmark harness.
- `bun run test:ai`: kept as the existing AI benchmark entrypoint for compatibility.

## Current Backend Coverage

- `client_id` idempotency is scoped per user.
- Duplicate client creates update one row and do not duplicate create history.
- Canvas, tile, thought, and tag upserts preserve relationships and payload fields.
- Concurrent tag renames through server and client IDs preserve thought labels, History transitions, and storage totals in either request order.
- Tag deletion reads the current name after a competing rename; name-conflict updates use the current colour, and renames of different tags preserve both labels on shared thoughts.
- Failed tag renames roll back their writes and release their locks.
- Thought creates without `sort_order` append after existing thoughts.
- Invalid tile and thought parent references reject before writes.
- Canvas deletion supports both `moveContents` and `deleteContents`.
- Snapshots return active-canvas data.
- Snapshots await their revision anchor before reading entity data; a concurrent canvas change omitted by the snapshot remains available to the next pull.
- New-user snapshots initialize a default canvas and return a numeric zero revision when no sync events exist.
- Pull responses expose normalized numeric revisions and include entity events.
- Sync event publication waits for an earlier same-user transaction to commit or roll back before allocating its revision; global and canvas pulls cannot skip the blocked events.
- Rollback gaps do not stall pulls, other users can publish independently, and the event sequence retains `CACHE 1`.

## Browser Tag Checks

Shared-browser checks against the running backend cover tag creation, renaming, and deletion through the UI. Concurrent authenticated pushes use server-only and client-only identities in both request orders; server snapshots, pulled local caches, and the History panel preserve the rename chain and unrelated thought labels. The temporary tag and canvas are removed after the checks, and the original canvas is restored.

## Browser Publication Checks

Authenticated shared-browser checks hold an earlier PostgreSQL publication open while two temporary tag updates are pushed. Both requests wait, global and canvas pull cursors stay below the held revision, and snapshots can expose the updated tags without advancing past their unpublished events. Releasing the transaction makes all three events available in revision order to both pulls. The frontend cache receives the updates, and a repeat pull does not replay the test events. Cleanup removes the temporary tags from the server and cache; reloading restores the workspace with an empty outbox.

## Browser Sync Motion Checks

Shared-browser checks in the real workspace use temporary in-memory updates, restored after each check. They cover desktop thoughts, mobile focused thoughts and preview bars, and canvas tabs on both layouts. Animation timeline samples verify that removals fade before survivors slide, with no remaining transforms at the end. Focus survives updates; drag gestures suppress sync motion; overflowing mobile tabs remain scrollable.

Desktop regression: the canvas retains its displayed thoughts during canvas transitions. Their remote animation revision must travel with that displayed list through `Tile` and `TileContent`; reading the newer revision directly in `TileContent` consumes the signal before the displayed thoughts change.

Mobile thought entry checks use a temporary phone-width focused tile in the shared browser without changing saved data. Background and footer-spacing clicks focus the input in populated and empty tiles. Thought cards, selected text, prevented clicks, and active or just-completed drags do not redirect focus. Starting or cancelling a pointer gesture does not focus the input; thought editing and the delete dialog still work. Opening the software keyboard needs a physical-device check.

Mobile tab gesture checks use touch pointer events: a swipe scrolls without reordering or switching canvases, a stationary 350 ms hold arms reordering, and cancellation clears the pending hold. Holding and releasing opens tab actions. Mouse movement still starts reordering immediately.

## Current Frontend Coverage

- Completed upserts keep separate durable operations and flush in order for each entity, preserving their History actions.
- Delayed snapshots preserve remote deletions, their Past entries, and newer confirmed baselines for pending local edits.
- Past identity matching distinguishes tiles from thoughts even when their numeric IDs overlap.
- Confirmed canvas moves, parent deletions, and tag changes update child baselines so discard cannot restore obsolete parents or labels.
- Temporary create followed by delete stays hidden locally while both completed actions flush in order for History.
- Operations with temporary parents wait until the parent has a server id.
- Server-id adoption rewrites cached children and pending payloads.
- Tile moves, cross-canvas drops, resizing, and Undo survive creation sync before, during, and after the gesture commit. Adoption preserves the dropped frame even when its local entity write finishes before its outbox row.
- Rendering the mobile overview after server-ID adoption keeps the dragged tile's original hidden while other tiles remain visible.
- Flush skips unresolved temporary dependencies without network calls.
- Network failures preserve operations with retry metadata.
- Reconnecting bypasses pending network retry delays, including a failure still in flight, without retrying rejected or local-only operations.
- Token retrieval failures and temporarily missing tokens recover on later sync attempts, even if authentication recovers after the reconnect event. Reconnect rechecks a previously latched auth failure; repeated server 401 responses still pause sync.
- History uses matching action badges for local and server entries and expands only meaningful details, including full text when summaries are shortened.
- Stale `flushing` records retry and clear after server acknowledgement.
- Server acknowledgement of a temporary parent rewrites pending child payloads.
- Snapshot reconciliation deletes clean missing records while preserving dirty ones.
- Server tag rename rewrites cached thought tag labels.
- Pull preserves pending local changes over stale remote upserts.
- Pull applies remote tile creates to cache, store, metadata, and animation state.
- Pulling this device's already-applied payload does not animate.
- Remote thought moves, additions, and deletions publish their animation revision with the final visible list; repeated pulls do not replay the update.
- Snapshot thought removals publish their animation revision with the refreshed list.
- Canvas additions, deletions, reordering, and favourite changes publish their animation revision with the final tabs; repeated pulls and protected local edits do not replay it.
- Cached canvas refreshes publish snapshot removals with their animation revision, and signing out resets it.
- Remote deletes do not remove locally dirty entities.
- Remote canvas deletes with `moveContents` move cached child tiles.
- Optimistic canvas creation updates state and queues sync.
- Optimistic tag rename updates visible thought labels, cached thought labels, and queues sync.
- Rapid canvas -> tile -> thought creation queues the dependency chain.
- Rapid tile create -> move coalesces to the final canvas and position.
- Cross-canvas tile moves carry cached thoughts.
- Thought reorder bursts keep final sort orders in the outbox.
- Temporary tiles and thoughts can be deleted before flush without leaving local records.
- Canvas `moveContents` updates known caches and queues the required server work.

## Still Required

- API route-level sync tests with an explicit Clerk auth test harness.
- Broader store tests for synced delete edge cases and hidden/visibility tile flows.
- Browser smoke tests against an existing dev server for offline edit, reload, reconnect, and flush.
- CI wiring once the manual suite is stable enough to run automatically on pull requests.
