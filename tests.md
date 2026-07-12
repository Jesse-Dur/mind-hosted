# Regression Test Plan

The AI prompt harness is intentionally separate from the regression suite. It is
used to compare prompt quality, token use, iterations, and latency across prompt
changes; it is not the pass/fail gate for application behavior.

## Manual Commands

- `bun run test`: run the current manual regression suite and type/build checks.
- `bun run test:backend`: run backend sync database integration tests.
- `bun run test:frontend-sync`: run frontend offline sync tests.
- `bun run test:store`: run frontend optimistic store tests.
- `bun run typecheck`: run backend TypeScript checking and the frontend production build.
- `bun run bench:ai-prompts`: run the AI prompt benchmark harness.
- `bun run test:ai`: kept as the existing AI benchmark entrypoint for compatibility.

## Current Backend Coverage

- `client_id` idempotency is scoped per user.
- Duplicate client creates update one row and do not duplicate create history.
- Canvas, tile, thought, and tag upserts preserve relationships and payload fields.
- Thought creates without `sort_order` append after existing thoughts.
- Invalid tile and thought parent references reject before writes.
- Canvas deletion supports both `moveContents` and `deleteContents`.
- Snapshots return active-canvas data.
- Pull responses expose normalized numeric revisions and include entity events.

## Current Frontend Coverage

- Repeated queued upserts keep one durable operation with the latest payload.
- Temporary create followed by delete removes local state before flush.
- Operations with temporary parents wait until the parent has a server id.
- Server-id adoption rewrites cached children and pending payloads.
- Flush skips unresolved temporary dependencies without network calls.
- Network failures preserve operations with retry metadata.
- Stale `flushing` records retry and clear after server acknowledgement.
- Server acknowledgement of a temporary parent rewrites pending child payloads.
- Snapshot reconciliation deletes clean missing records while preserving dirty ones.
- Server tag rename rewrites cached thought tag labels.
- Pull preserves pending local changes over stale remote upserts.
- Pull applies remote tile creates to cache, store, metadata, and animation state.
- Pulling this device's already-applied payload does not animate.
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
