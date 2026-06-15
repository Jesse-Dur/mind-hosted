# Autumn billing integration

Autumn is the source of truth for tiers, daily limits, paid plans, PAYG, and user-specific overrides.

## Required Autumn features

Create these feature IDs in Autumn:

- `ai_processing_requests`
- `transcription_seconds`
- `storage`
- `canvases`
- `tiles`
- `thoughts`

Configure plan limits and customer overrides in Autumn. The app uses Clerk `userId` as Autumn `customer_id`.

## Environment

- `AUTUMN_SECRET_KEY`: Autumn secret key.
- `AUTUMN_FREE_PLAN_ID`: optional free plan to auto-enable when a customer is first created.
- `AUTUMN_API_BASE`: optional, defaults to `https://api.useautumn.com`.
- `AUTUMN_FAIL_OPEN`: defaults to fail-open. Set to `false` to fail closed when Autumn is unavailable.
- `AUTUMN_DISABLED`: set to `true` in automated tests so test users are not created in Autumn.

## Usage model

- AI processing is consumed atomically with Autumn `balances.check` and `send_event`.
- Transcription is consumed as `transcription_seconds`; current server-side duration is estimated from uploaded audio size.
- Storage is tracked locally in bytes and lazily synced to Autumn as megabytes (`1 unit = 1 MB`).
- Resource features are checked before create and synced from active DB counts using `balances.update`.
- Soft-deleted tiles and thoughts do not count.
- Hourly limits are intentionally not implemented here; model daily/monthly/PAYG limits in Autumn.

## Usage endpoint

`GET /api/billing/usage` returns local active counts, local storage usage, and Autumn allowance metadata. Polling this endpoint lazily syncs current storage MB to Autumn.

## Testing

Automated tests must not call the real Autumn API. The backend test script sets `AUTUMN_DISABLED=true`, so billing checks fail open and storage usage remains local. Test Autumn itself only in an explicit integration test suite against a sandbox account with cleanup.
