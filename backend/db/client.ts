import postgres from "postgres"

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set")
export const sql = postgres(process.env.DATABASE_URL)

await sql.unsafe(`
  CREATE TABLE IF NOT EXISTS canvases (
    id BIGSERIAL PRIMARY KEY,
    user_id TEXT NOT NULL,
    client_id TEXT,
    name TEXT NOT NULL DEFAULT 'Home',
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_favourite BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS tiles (
    id BIGSERIAL PRIMARY KEY,
    user_id TEXT NOT NULL,
    client_id TEXT,
    canvas_id BIGINT REFERENCES canvases(id) ON DELETE SET NULL,
    title TEXT NOT NULL DEFAULT 'New Tile',
    x INTEGER NOT NULL DEFAULT 0,
    y INTEGER NOT NULL DEFAULT 0,
    width INTEGER NOT NULL DEFAULT 280,
    height INTEGER NOT NULL DEFAULT 200,
    importance INTEGER NOT NULL DEFAULT 1,
    visible BOOLEAN NOT NULL DEFAULT TRUE,
    deleted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS thoughts (
    id BIGSERIAL PRIMARY KEY,
    user_id TEXT NOT NULL,
    client_id TEXT,
    tile_id BIGINT NOT NULL REFERENCES tiles(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    tags TEXT[] NOT NULL DEFAULT '{}',
    sort_order INTEGER NOT NULL DEFAULT 0,
    deleted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS tags (
    id BIGSERIAL PRIMARY KEY,
    user_id TEXT NOT NULL,
    client_id TEXT,
    name TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '#444',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, name)
  );

  ALTER TABLE tiles ADD COLUMN IF NOT EXISTS canvas_id BIGINT REFERENCES canvases(id) ON DELETE SET NULL;
  ALTER TABLE canvases ADD COLUMN IF NOT EXISTS is_favourite BOOLEAN NOT NULL DEFAULT FALSE;
  ALTER TABLE canvases ADD COLUMN IF NOT EXISTS client_id TEXT;
  ALTER TABLE canvases ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
  ALTER TABLE tiles ADD COLUMN IF NOT EXISTS client_id TEXT;
  ALTER TABLE tiles ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
  ALTER TABLE thoughts ADD COLUMN IF NOT EXISTS client_id TEXT;
  ALTER TABLE thoughts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
  ALTER TABLE tags ADD COLUMN IF NOT EXISTS client_id TEXT;
  ALTER TABLE tags ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

  CREATE UNIQUE INDEX IF NOT EXISTS canvases_user_client_id_unique ON canvases(user_id, client_id) WHERE client_id IS NOT NULL;
  CREATE UNIQUE INDEX IF NOT EXISTS tiles_user_client_id_unique ON tiles(user_id, client_id) WHERE client_id IS NOT NULL;
  CREATE UNIQUE INDEX IF NOT EXISTS thoughts_user_client_id_unique ON thoughts(user_id, client_id) WHERE client_id IS NOT NULL;
  CREATE UNIQUE INDEX IF NOT EXISTS tags_user_client_id_unique ON tags(user_id, client_id) WHERE client_id IS NOT NULL;

  CREATE TABLE IF NOT EXISTS history (
    id BIGSERIAL PRIMARY KEY,
    user_id TEXT NOT NULL,
    action TEXT NOT NULL,
    summary TEXT NOT NULL,
    detail JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    client_id TEXT NOT NULL,
    op_id TEXT,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  ALTER TABLE history ADD COLUMN IF NOT EXISTS client_id TEXT;
  ALTER TABLE history ADD COLUMN IF NOT EXISTS op_id TEXT;
  ALTER TABLE history ADD COLUMN IF NOT EXISTS occurred_at TIMESTAMPTZ;
  UPDATE history SET client_id = 'legacy-history-' || id WHERE client_id IS NULL;
  UPDATE history SET occurred_at = created_at WHERE occurred_at IS NULL;
  ALTER TABLE history ALTER COLUMN client_id SET NOT NULL;
  ALTER TABLE history ALTER COLUMN occurred_at SET DEFAULT NOW();
  ALTER TABLE history ALTER COLUMN occurred_at SET NOT NULL;
  DROP INDEX IF EXISTS history_user_client_id_unique;
  CREATE UNIQUE INDEX IF NOT EXISTS history_user_op_id_unique
    ON history(user_id, op_id) WHERE op_id IS NOT NULL;

  CREATE TABLE IF NOT EXISTS sync_events (
    revision BIGSERIAL PRIMARY KEY,
    user_id TEXT NOT NULL,
    canvas_id BIGINT,
    entity_type TEXT NOT NULL,
    entity_id BIGINT,
    client_id TEXT,
    op_id TEXT,
    action TEXT NOT NULL,
    data JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS sync_applied_ops (
    user_id TEXT NOT NULL,
    op_id TEXT NOT NULL,
    result JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, op_id)
  );

  CREATE TABLE IF NOT EXISTS user_usage (
    user_id TEXT PRIMARY KEY,
    storage_bytes BIGINT NOT NULL DEFAULT 0,
    storage_synced_bytes BIGINT NOT NULL DEFAULT 0,
    storage_synced_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS device_preferences (
    user_id TEXT NOT NULL,
    device_id TEXT NOT NULL,
    device_class TEXT NOT NULL,
    preferences JSONB NOT NULL DEFAULT '{}',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, device_id)
  );

  CREATE INDEX IF NOT EXISTS device_preferences_user_class_updated
    ON device_preferences(user_id, device_class, updated_at DESC);
`)
