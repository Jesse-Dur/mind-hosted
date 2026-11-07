# Regression Test Plan

The AI prompt harness is intentionally separate from the regression suite. It is
used to compare prompt quality, token use, iterations, and latency across prompt
changes; it is not the pass/fail gate for application behavior.

## Manual Commands

- `bun run test`: run the current manual regression suite and type/build checks.
- `bun run test:backend`: run snapshot revision tests, then backend sync database integration tests in a separate process to isolate the mocked database client.
- `bun run test:frontend-sync`: run frontend offline sync tests.
- `bun run test:store`: run frontend optimistic store tests.
- `bun run test:recording`: run audio-format checks and DOM-based microphone lifecycle regressions in separate processes.
- `bun run typecheck`: run backend TypeScript checking and the frontend production build.
- `bun run test:mobile`: run the mobile regression suite, including thought keyboard dismissal checks. The runner preloads IndexedDB before shared modules load.
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

The isolated popover fixture at `/tests/tag-popover.html` uses the real tag component with in-memory sample data and makes no backend writes. Start the frontend with `bun run dev:frontend`, open that path through the configured shared-browser URL, and run `await window.runTagPopoverChecks()` in the browser console. Keep the pointer over the reset button while the checks run. All returned `passed` values must be true. Run at desktop and phone viewport sizes. The fixture is excluded from the production build.

The 63 checks sample animation frames to verify source-dot alignment, actual travel, stable thought layout, viewport placement, and the return to source dots without a second fade. Every row's movement must stay in step with its shrinking width throughout contraction and finish at its own source dot. Contraction uses layout coordinates so WebKit does not advance a composited transform separately from resizing; expansion keeps its original transform animation. These checks pass in Chromium and Linux WebKit 26.6 at desktop and phone sizes. Native Safari on macOS remains a separate platform check.

Thought tag circles and their spacing scale with the displayed thought font. Desktop callers pass the tile's fitted font size; mobile thoughts and drag previews use the Font Size preference. Circle diameters are 5, 8, 15, and 22 pixels at font sizes 8, 13, 24, and 36. Tile font fitting includes the scaled dot widths and trailing spacing. Chromium and Linux WebKit checks at desktop and phone sizes verify these sizes, spacing, dot-to-pill travel, and continuous contraction to the exact scaled source circles. Animation measurements use the rendered circles rather than fixed eight-pixel targets.

The checks also cover touch opening, outside-tap dismissal, rapid reopening, keyboard focus, immediate tag removal, stable panel width, removing the final tag, and layout-appropriate removal targets. The expanded view keeps individual coloured pills inside the original "Tag as" menu's white outer box. Its "Tags" heading shares the right-click menu's heading style and stays above the scrollable pill list. Both popups use a shared dot-and-label component whose text follows the Font Size preference, with 13-pixel labels at the default setting. Headings, label dots, close icons, controls, and spacing scale together; padding is capped to leave room for large labels on phones. Expanded mobile pills retain removal targets of at least 44×44 pixels; desktop targets start at 20×20 pixels. Responsive sizing follows the existing mobile workspace breakpoint. `?long` and `?many` provide manual checks for truncation and scrolling. Reduced-motion checks verify immediate labelled pills with no active animations. Phone viewport and synthetic touch checks do not replace testing on a physical phone.

`?menu` shows the real right-click tag menu alongside the expanded popover. Both use shared label, heading, and outer surface styles based on the original right-click menu; the expanded view uses pills for the assigned tags. Right-click the sample thought or use the edge-placement button. The selector changes only the fixture's in-memory Font Size setting. Chromium and Linux WebKit checks at desktop and phone sizes cover settings 8, 13, 24, and 36: both popup label sizes match the setting, with matching scaled heading styles and label dots. Live updates while a popover is open remeasure its natural width and placement before updating the animation geometry. At the default setting, a comparison with the original right-click component verifies its typography, header, padding, colours, border, and shadow. Checks also cover toggling assigned and unassigned tags by mouse, tap, and keyboard; selection indicators; scaled empty-state text; Escape and backdrop dismissal; edge placement and viewport resizing; and reduced motion. Combine with `&many` or `&long` for scrolling and truncation. Touch cancellation during scrolling leaves selection unchanged.

Desktop hover closing also needs native pointer hit testing. Hover the center cluster, call `window.armTagPopoverHoverClose("center")`, then move the real pointer to the returned coordinates in the gap between the cluster and panel. All five results in `window.tagPopoverHoverCloseResult` must pass. Repeat with `"bottom"` for a panel that opens above its source. Returning pills ignore pointer hits during contraction, so they cannot repeatedly reopen the panel while passing under a stationary cursor. The source cluster and panel remain hover targets for deliberate reopening.

`?sync` mounts real desktop thoughts with small, normal, large, wrapped, blank, and untagged content. Its buttons select pending, acknowledged, failed, local-only, or cleared status using in-memory records; thought writes are stubbed. Chromium and Linux WebKit frame checks verify unchanged row bounds, text width and wrapping, vertical indicator centring, and a continuous tag-dot slide over 220ms. Save spinners follow the displayed thought font: 7, 12, 22, and 33 pixels at font sizes 8, 13, 24, and 36. The sync button stays outside the row's vertical sizing inside a stable control area. Its reserved width grows with the spinner, from 26 pixels at the default font to 47 pixels at the largest font. Tile font fitting includes that reserved area. The indicator disappears when its 750ms fade finishes, and the dots do not jump again when the store's three-second acknowledgement expires. New work cancels an older fade. Error options remain accessible, and reduced motion removes the slide and acknowledgement delay. During a popover's return animation the source dots stay still; any pending sync-driven movement starts after the popover reaches them.

`?sync&mobile` mounts the real mobile focused tile with the same sample thoughts and a Font Size selector. Run `await window.runThoughtSyncChecks()` on either sync fixture: all results must pass. These checks measure every frame through pending, acknowledged, failed, local-only, and cleared status, including blank thoughts at the largest size. They verify fixed thought bounds and text wrapping, scaled and centred spinners, and separation from the tag circles. Mobile checks cover all four font settings; desktop samples include each displayed font size.

On a fresh `?sync` or `?sync&mobile` fixture, run `await window.runThoughtTagFocusChecks()`. Its four assertions cover keyboard entry, focus moving to the next removal button, final-tag dismissal, and restoration to the thought's delete button. Real keyboard checks in Chromium and Linux WebKit also verify that Tab continues normally and that moving focus outside during removal is respected, on desktop/mobile and with normal/reduced motion. Consumers supply an explicit focus-restoration callback rather than relying on the tag trigger's parent structure.

`?sync&tile` mounts real desktop tile headers at font sizes 8, 13, 24, and 36. Tile headers use the same spinner sizing as thoughts; mobile tile headers follow the Font Size selector in `?sync&mobile`. Chromium and Linux WebKit checks cover all four settings, pending and acknowledgement sizes, completed fades, and unchanged header bounds through every sync state. A tile-only pending save shows the header spinner while thought indicators stay absent. History pagination, AI status, and microphone transcription also use loading indicators; these belong to controls with fixed typography or icon sizes and do not follow the canvas Font Size preference.

`?spinner` isolates shared spinners at 7, 12, 22, and 33 pixels, both pending and fading, plus a scaled canvas example and microphone transcription. Run `await window.runSpinnerMotionChecks()`: all 50 results must pass. Chromium and Linux WebKit checks at desktop and phone widths sample eight angles through a full rotation. The outer SVG bounds and grey track transform remain fixed; the moving arc rotates around the ring centre and follows its circumference at every angle. Rotation applies only to the arc with an explicit view-box centre. Opacity fades remain on the outer SVG, and microphone transcription reuses the shared spinner.

Shared-browser checks against the running backend cover tag creation, renaming, and deletion through the UI. Concurrent authenticated pushes use server-only and client-only identities in both request orders; server snapshots, pulled local caches, and the History panel preserve the rename chain and unrelated thought labels. The temporary tag and canvas are removed after the checks, and the original canvas is restored.

## Browser Publication Checks

Authenticated shared-browser checks hold an earlier PostgreSQL publication open while two temporary tag updates are pushed. Both requests wait, global and canvas pull cursors stay below the held revision, and snapshots can expose the updated tags without advancing past their unpublished events. Releasing the transaction makes all three events available in revision order to both pulls. The frontend cache receives the updates, and a repeat pull does not replay the test events. Cleanup removes the temporary tags from the server and cache; reloading restores the workspace with an empty outbox.

## Browser Sync Motion Checks

Shared-browser checks in the real workspace use temporary in-memory updates, restored after each check. They cover desktop thoughts, mobile focused thoughts and preview bars, and canvas tabs on both layouts. Animation timeline samples verify that removals fade before survivors slide, with no remaining transforms at the end. Focus survives updates; drag gestures suppress sync motion; overflowing mobile tabs remain scrollable.

Desktop regression: the canvas retains its displayed thoughts during canvas transitions. Their remote animation revision must travel with that displayed list through `Tile` and `TileContent`; reading the newer revision directly in `TileContent` consumes the signal before the displayed thoughts change.

Mobile thought entry checks use a temporary phone-width focused tile in the shared browser without changing saved data. Background and footer-spacing clicks focus the input in populated and empty tiles. Thought cards, selected text, prevented clicks, and active or just-completed drags do not redirect focus. Starting or cancelling a pointer gesture does not focus the input; thought editing and the delete dialog still work. Opening the software keyboard needs a physical-device check.

Mobile tab gesture checks use touch pointer events: a swipe scrolls without reordering or switching canvases, a stationary 350 ms hold arms reordering, and cancellation clears the pending hold. Holding and releasing opens tab actions. Mouse movement still starts reordering immediately.

Mobile editing checks use isolated tile and thought data with captured writes. Escape restores the original title or thought text without saving; Enter and ordinary blur save changed text. A scrollable tag menu ignores touch pointer movement followed by cancellation, accepts mouse clicks and touch-style taps, and closes when its backdrop is pressed.

Mobile tile and thought delete controls use the desktop SVG cross, centered at 12 pixels within the existing 28-pixel buttons. Isolated component checks at narrow desktop and phone widths verify centering, touch-hold isolation from parent gestures, confirmation before deletion, cancellation without writes, and one deletion per confirmation. Safari desktop rendering still needs a Safari check.

Mobile thought scroll checks mount the real focused-tile component with captured writes. Touch-down leaves text read-only; a completed tap accepts up to 9px of movement and places the caret at the tapped text. Movement beyond that distance, cancellation, or another pointer cannot start editing. Repeated swipes after editing stay out of edit mode. Simulated keyboard dismissal and scroll intent save a changed draft once, including a native pan that cancels before the movement threshold. Dismissal waits for active text composition to finish. Native mouse typing, Enter/Escape, text selection, tag long presses, and cancelled thought dragging are also checked. Software keyboard visibility and native touch panning still need physical-device verification.

Keyboard observer unit tests cover animated opening and dismissal, toolbar movement, keyboard height changes, rotation, pinch zoom, the window-resize fallback, and listener cleanup.

Selection-drag regression checks start with a collapsed caret in the active thought. Crossing the movement threshold keeps the draft focused and unsaved before the selection expands. An actual list scroll after native pointer cancellation still commits the draft.

Desktop thought editing checks use isolated data with captured writes. Escape restores the original text and exits editing without saving. Enter and clicking outside the editor each save the changed text once.

Desktop drag and resize checks use the real hook with in-memory writes. Rejected drops, cross-canvas no-ops, missing canvas rectangles, and rejected resizes restore transitions. Successful releases flush final geometry before transitions resume. Delayed completions cannot end a newer gesture. Checks also cover remounting, a click after a pending write, and Canvas-style delayed tile props.

Spotlight checks use the real component with an isolated database. Workspace deletion, creation, and moves update search while it stays open; background Past refresh and restoration update Past results.

History browser checks use an isolated database and captured server refreshes. Scrolling loads 450 saved entries in pages while keeping two older sync issues accessible. A burst of 50 acknowledgements produces one server History refresh. Loading a server entry outside the local page promptly attaches its local operation metadata.

Isolated History panel checks verify that pagination starts with 25 displayed events remaining and preserves scroll position after a page loads. The bottom spinner stays visible while either the server or local page is loading, then disappears when the new events arrive, including at a narrow panel width.

Preference recovery checks mount the real App in an isolated browser harness with simulated authentication, storage, and server responses. Same-account sign-in after cached startup uploads pending local settings and resumes later saves without another workspace boot or reset. With no pending edits, it applies the server profile.

## Current Frontend Coverage

- Microphone lifecycle checks mount the shared recording hook and Spotlight in Happy DOM with simulated media devices. Button, typing, shortcut, silence, Escape, dismissal, and page exit release every audio track and close the audio context. Checks cover pending permission cancellation, setup and recorder failures, final audio chunks, rapid restarts, ignored late transcription results, and shortcut startup under React Strict Mode.
- Completed upserts keep separate durable operations and flush in order for each entity, preserving their History actions.
- Local History reads start with a bounded page, retain old pending/error/device-only entries, and load every retained entry on demand. Hidden acknowledgement markers remain durable without filling visible pages.
- Paging upgrades index existing visible activity without deleting hidden markers. Status notifications are batched, and an update arriving during a read receives a follow-up refresh.
- Visible acknowledgements outside loaded pages refresh History even when another operation on the same entity needs attention. Hidden operations and previous account generations do not advance the refresh marker.
- Account preparation blocks new sync work while waiting for a database lock or open, drains old scoped and unscoped tasks, and prevents superseded preparation from replacing a newer account's database.
- Startup retries back off to 15 seconds, announce retrying only after the first retry fails, and stop after success or cancellation. A database-open failure keeps sync fenced until setup succeeds on retry.
- PWA cleanup message failures are logged without deleting caches; a later message can retry cleanup.
- Delayed snapshots preserve remote deletions, their Past entries, and newer confirmed baselines for pending local edits.
- Past identity matching distinguishes tiles from thoughts even when their numeric IDs overlap.
- Device preference hydration preserves settings edited while its server request is in flight.
- Re-enabling preference sync after cached hydration preserves and uploads pending local settings, then saves later edits automatically.
- Uncached startup waits for a successful server snapshot and can retry after sign-in or reconnect.
- Sync status reads stop at an account change and cannot repopulate the next account's History.
- Account resets clear private cross-canvas drag previews.
- Confirmed canvas moves, parent deletions, and tag changes update child baselines so discard cannot restore obsolete parents or labels.
- Temporary create followed by delete stays hidden locally while both completed actions flush in order for History.
- Operations with temporary parents wait until the parent has a server id.
- Server-id adoption rewrites cached children and pending payloads.
- Tile moves, cross-canvas drops, resizing, and Undo survive creation sync before, during, and after the gesture commit. Adoption preserves the dropped frame even when its local entity write finishes before its outbox row.
- Tile gestures and Undo resolve their source canvas after its temporary ID is adopted.
- Rendering the mobile overview after server-ID adoption keeps the dragged tile's original hidden while other tiles remain visible.
- Mobile thought drag references adopt thought, tile, and canvas IDs without duplicating the focused preview. Browser gesture checks confirm that the drop uses the current ID and ignores another pointer's release.
- Flush skips unresolved temporary dependencies without network calls.
- Network failures preserve operations with retry metadata.
- Reconnecting bypasses pending network retry delays, including a failure still in flight, without retrying rejected or local-only operations.
- Reconnect owns its retry/auth reset and the following fresh flush, so an overlapping upload cannot consume the retry or restore stale backoff. Persistent authentication failures pause without retry loops.
- Token retrieval failures and temporarily missing tokens recover on later sync attempts, even if authentication recovers after the reconnect event. Reconnect rechecks a previously latched auth failure; repeated server 401 responses still pause sync.
- History uses matching action badges for local and server entries and expands only meaningful details, including full text when summaries are shortened.
- Stale `flushing` records retry and clear after server acknowledgement.
- Server acknowledgement of a temporary parent rewrites pending child payloads.
- Snapshot reconciliation deletes clean missing records while preserving dirty ones.
- Snapshot client-ID adoption leaves unchanged legacy tiles and thoughts unmarked, while payload changes still produce change markers.
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
